import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractFacebookGroupSlug } from '../../shared/parseFacebookGraphQL.js';
import { parseInteractionCount } from '../../shared/facebookInteractionCounts.js';

const DEFAULT_UNKNOWN_AUTHOR = 'unknown_author';

/**
 * PlatformCrawledDataService — SQLite riêng cho dữ liệu cào theo từng nền tảng.
 *
 * Mỗi platform có một file database độc lập tại:
 *   ${appDataPath}/data/${platform}_crawled_data.db
 *
 * Hiện tại chỉ khởi tạo schema chuẩn hóa cho Facebook (groups, authors, posts, comments).
 */
export class PlatformCrawledDataService {
  /**
   * @param {string} appDataPath - Thư mục userData của Electron (tương đương ./data/ trong app).
   */
  constructor(appDataPath) {
    if (!appDataPath) {
      throw new Error('[PlatformCrawledDataService] appDataPath is required.');
    }

    this.appDataPath = appDataPath;
    this.dataDir = path.join(appDataPath, 'data');
    /** @type {Map<string, Database.Database>} */
    this.connections = new Map();
  }

  /**
   * Đường dẫn file database cho một platform.
   * @param {string} platform
   * @returns {string}
   */
  getDatabasePath(platform) {
    const normalized = normalizePlatform(platform);
    return path.join(this.dataDir, `${normalized}_crawled_data.db`);
  }

  /**
   * Kết nối (hoặc tái sử dụng kết nối) tới database của platform.
   * Tự tạo thư mục ./data/ và schema Facebook nếu cần.
   *
   * @param {string} platform - Ví dụ: 'Facebook', 'TikTok', 'YouTube'
   * @returns {Database.Database}
   */
  connectPlatformDatabase(platform) {
    const normalized = normalizePlatform(platform);

    if (this.connections.has(normalized)) {
      return this.connections.get(normalized);
    }

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const dbPath = this.getDatabasePath(normalized);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    if (normalized === 'facebook') {
      initFacebookSchema(db);
    }

    this.connections.set(normalized, db);
    return db;
  }

  /**
   * Lưu một bài viết Facebook đã parse cùng comments vào database chuẩn hóa.
   * Không throw — trả về kết quả để không gián đoạn luồng cào offline.
   *
   * @param {object} postData - Dữ liệu post đã parse (post_id, post_author, author_link, post_link, post_content, comments[]).
   * @param {object} groupInfo - { group_id?, group_name?, group_link? }
   * @param {object} [options]
   * @param {string} [options.platform='facebook']
   * @returns {{ success: boolean, post_id?: string, error?: string }}
   */
  saveFacebookPostWithComments(postData, groupInfo = {}, options = {}) {
    const platform = options.platform || 'facebook';

    try {
      const db = this.connectPlatformDatabase(platform);
      const normalizedPost = normalizeFacebookPostInput(postData);
      const normalizedGroup = normalizeFacebookGroupInfo(groupInfo, normalizedPost);

      if (!normalizedPost.post_id) {
        return { success: false, error: 'post_id is required' };
      }
      if (!normalizedGroup.group_id) {
        return { success: false, error: 'group_id is required' };
      }

      const postAuthorId = resolveFacebookAuthorId(
        normalizedPost.author_link,
        normalizedPost.post_author,
      );

      const upsertGroup = db.prepare(`
        INSERT OR REPLACE INTO groups (group_id, group_name, group_link)
        VALUES (?, ?, ?)
      `);
      const upsertAuthor = db.prepare(`
        INSERT OR REPLACE INTO authors (author_id, author_name, author_link)
        VALUES (?, ?, ?)
      `);
      const upsertPost = db.prepare(`
        INSERT OR REPLACE INTO posts (
          post_id, group_id, author_id, post_link, post_content, post_date,
          like_count, share_count, comment_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertComment = db.prepare(`
        INSERT OR REPLACE INTO comments (
          comment_id, post_id, author_id, comment_content, like_count
        )
        VALUES (?, ?, ?, ?, ?)
      `);

      const saveTx = db.transaction(() => {
        upsertGroup.run(
          normalizedGroup.group_id,
          normalizedGroup.group_name || normalizedGroup.group_id,
          normalizedGroup.group_link || '',
        );

        upsertAuthor.run(
          postAuthorId,
          normalizedPost.post_author || '',
          normalizedPost.author_link || null,
        );

        upsertPost.run(
          normalizedPost.post_id,
          normalizedGroup.group_id,
          postAuthorId,
          normalizedPost.post_link || '',
          normalizedPost.post_content || '',
          normalizedPost.post_date || null,
          normalizedPost.like_count,
          normalizedPost.share_count,
          normalizedPost.comment_count,
        );

        (normalizedPost.comments || []).forEach((comment, index) => {
          const commentAuthorId = resolveFacebookAuthorId(
            comment?.author_link,
            comment?.comment_author,
          );

          upsertAuthor.run(
            commentAuthorId,
            comment?.comment_author || '',
            comment?.author_link || null,
          );

          const commentId = resolveFacebookCommentId(
            normalizedPost.post_id,
            comment,
            index,
          );

          upsertComment.run(
            commentId,
            normalizedPost.post_id,
            commentAuthorId,
            comment?.comment_content || '',
            parseInteractionCount(comment?.like_count),
          );
        });
      });

      saveTx();

      return { success: true, post_id: normalizedPost.post_id };
    } catch (error) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Lưu hàng loạt bài viết Facebook trong một transaction duy nhất.
   *
   * @param {object[]} posts
   * @param {object} groupInfo
   * @param {object} [options]
   * @returns {{ success: boolean, saved: number, failed: number, errors: string[] }}
   */
  saveFacebookPostsBatch(posts = [], groupInfo = {}, options = {}) {
    const platform = options.platform || 'facebook';
    const errors = [];
    let saved = 0;
    let failed = 0;

    try {
      this.connectPlatformDatabase(platform);
    } catch (error) {
      return {
        success: false,
        saved: 0,
        failed: Array.isArray(posts) ? posts.length : 0,
        errors: [error?.message || String(error)],
      };
    }

    (Array.isArray(posts) ? posts : []).forEach((post) => {
      const result = this.saveFacebookPostWithComments(post, groupInfo, { platform });
      if (result.success) {
        saved += 1;
      } else {
        failed += 1;
        if (result.error) errors.push(result.error);
      }
    });

    return {
      success: failed === 0,
      saved,
      failed,
      errors,
    };
  }

  /**
   * Thống kê nhanh dữ liệu Facebook đã lưu.
   * @returns {{ groups: number, authors: number, posts: number, comments: number }}
   */
  getFacebookStats() {
    const db = this.connectPlatformDatabase('facebook');
    const groups = db.prepare('SELECT COUNT(*) AS count FROM groups').get()?.count ?? 0;
    const authors = db.prepare('SELECT COUNT(*) AS count FROM authors').get()?.count ?? 0;
    const posts = db.prepare('SELECT COUNT(*) AS count FROM posts').get()?.count ?? 0;
    const comments = db.prepare('SELECT COUNT(*) AS count FROM comments').get()?.count ?? 0;
    return { groups, authors, posts, comments };
  }

  /**
   * Danh sách nhóm Facebook đã cào.
   * @param {{ limit?: number, offset?: number, search?: string }} [options]
   */
  listFacebookGroups(options = {}) {
    const { limit = 200, offset = 0, search = '' } = options;
    const db = this.connectPlatformDatabase('facebook');
    const term = String(search || '').trim();

    if (term) {
      const like = `%${term}%`;
      return db.prepare(`
        SELECT
          g.group_id,
          g.group_name,
          g.group_link,
          (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.group_id) AS post_count
        FROM groups g
        WHERE g.group_name LIKE ? OR g.group_id LIKE ? OR g.group_link LIKE ?
        ORDER BY g.group_name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `).all(like, like, like, limit, offset);
    }

    return db.prepare(`
      SELECT
        g.group_id,
        g.group_name,
        g.group_link,
        (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.group_id) AS post_count
      FROM groups g
      ORDER BY g.group_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  /**
   * Danh sách tác giả / thành viên Facebook đã gặp khi cào.
   * @param {{ limit?: number, offset?: number, search?: string }} [options]
   */
  listFacebookAuthors(options = {}) {
    const { limit = 200, offset = 0, search = '' } = options;
    const db = this.connectPlatformDatabase('facebook');
    const term = String(search || '').trim();

    if (term) {
      const like = `%${term}%`;
      return db.prepare(`
        SELECT
          a.author_id,
          a.author_name,
          a.author_link,
          (SELECT COUNT(*) FROM posts p WHERE p.author_id = a.author_id) AS post_count,
          (SELECT COUNT(*) FROM comments c WHERE c.author_id = a.author_id) AS comment_count
        FROM authors a
        WHERE a.author_name LIKE ? OR a.author_id LIKE ? OR a.author_link LIKE ?
        ORDER BY a.author_name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `).all(like, like, like, limit, offset);
    }

    return db.prepare(`
      SELECT
        a.author_id,
        a.author_name,
        a.author_link,
        (SELECT COUNT(*) FROM posts p WHERE p.author_id = a.author_id) AS post_count,
        (SELECT COUNT(*) FROM comments c WHERE c.author_id = a.author_id) AS comment_count
      FROM authors a
      ORDER BY a.author_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  /**
   * Danh sách bài viết Facebook đã lưu.
   * @param {{ limit?: number, offset?: number, search?: string, groupId?: string }} [options]
   */
  listFacebookPosts(options = {}) {
    const { limit = 200, offset = 0, search = '', groupId = '' } = options;
    const db = this.connectPlatformDatabase('facebook');
    const term = String(search || '').trim();
    const normalizedGroupId = String(groupId || '').trim();

    let sql = `
      SELECT
        p.post_id,
        p.group_id,
        p.author_id,
        p.post_link,
        p.post_content,
        p.post_date,
        p.like_count,
        p.share_count,
        p.comment_count,
        p.crawled_at,
        g.group_name,
        a.author_name,
        a.author_name AS post_author,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id) AS crawled_comment_count
      FROM posts p
      LEFT JOIN groups g ON g.group_id = p.group_id
      LEFT JOIN authors a ON a.author_id = p.author_id
      WHERE 1 = 1
    `;
    const params = [];

    if (normalizedGroupId) {
      sql += ' AND p.group_id = ?';
      params.push(normalizedGroupId);
    }

    if (term) {
      sql += ' AND (p.post_content LIKE ? OR p.post_id LIKE ? OR a.author_name LIKE ? OR g.group_name LIKE ?)';
      const like = `%${term}%`;
      params.push(like, like, like, like);
    }

    sql += ' ORDER BY COALESCE(p.post_date, p.crawled_at) DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  /**
   * Danh sách bình luận theo bài viết hoặc nhóm.
   * @param {{ postId?: string, groupId?: string, limit?: number, offset?: number }} [options]
   */
  listFacebookComments(options = {}) {
    const { postId = '', groupId = '', limit = 500, offset = 0 } = options;
    const db = this.connectPlatformDatabase('facebook');
    const normalizedPostId = String(postId || '').trim();
    const normalizedGroupId = String(groupId || '').trim();

    let sql = `
      SELECT
        c.comment_id,
        c.post_id,
        c.author_id,
        c.comment_content,
        c.like_count,
        c.crawled_at,
        a.author_name,
        a.author_name AS comment_author,
        p.post_link,
        p.post_content
      FROM comments c
      LEFT JOIN authors a ON a.author_id = c.author_id
      LEFT JOIN posts p ON p.post_id = c.post_id
      WHERE 1 = 1
    `;
    const params = [];

    if (normalizedPostId) {
      sql += ' AND c.post_id = ?';
      params.push(normalizedPostId);
    }

    if (normalizedGroupId) {
      sql += ' AND p.group_id = ?';
      params.push(normalizedGroupId);
    }

    sql += ' ORDER BY c.crawled_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  /**
   * Đóng kết nối của một platform.
   * @param {string} platform
   */
  closePlatformDatabase(platform) {
    const normalized = normalizePlatform(platform);
    const db = this.connections.get(normalized);
    if (!db) return;

    try {
      db.close();
    } catch {
      // Ignore close errors.
    }

    this.connections.delete(normalized);
  }

  /** Đóng tất cả kết nối platform đang mở. */
  closeAll() {
    for (const platform of [...this.connections.keys()]) {
      this.closePlatformDatabase(platform);
    }
  }
}

/**
 * Khởi tạo schema Facebook với ràng buộc khóa ngoại.
 * @param {Database.Database} db
 */
export function initFacebookSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      group_id TEXT PRIMARY KEY,
      group_name TEXT,
      group_link TEXT
    );

    CREATE TABLE IF NOT EXISTS authors (
      author_id TEXT PRIMARY KEY,
      author_name TEXT,
      author_link TEXT
    );

    CREATE TABLE IF NOT EXISTS posts (
      post_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      post_link TEXT,
      post_content TEXT,
      post_date TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      share_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(group_id),
      FOREIGN KEY (author_id) REFERENCES authors(author_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      comment_id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      comment_content TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(post_id),
      FOREIGN KEY (author_id) REFERENCES authors(author_id)
    );
  `);

  migrateFacebookSchema(db);
}

function migrateFacebookSchema(db) {
  const postColumns = db.prepare('PRAGMA table_info(posts)').all();
  const postColumnNames = new Set(postColumns.map((col) => col.name));

  if (!postColumnNames.has('post_date')) {
    db.exec('ALTER TABLE posts ADD COLUMN post_date TEXT');
  }
  if (!postColumnNames.has('like_count')) {
    db.exec('ALTER TABLE posts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!postColumnNames.has('share_count')) {
    db.exec('ALTER TABLE posts ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!postColumnNames.has('comment_count')) {
    db.exec('ALTER TABLE posts ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0');
  }

  const commentColumns = db.prepare('PRAGMA table_info(comments)').all();
  const commentColumnNames = new Set(commentColumns.map((col) => col.name));
  if (!commentColumnNames.has('like_count')) {
    db.exec('ALTER TABLE comments ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * Kết nối database theo platform — helper functional API.
 * @param {PlatformCrawledDataService} service
 * @param {string} platform
 */
export function connectPlatformDatabase(service, platform) {
  return service.connectPlatformDatabase(platform);
}

/**
 * Lưu post Facebook — helper functional API.
 * @param {PlatformCrawledDataService} service
 * @param {object} postData
 * @param {object} groupInfo
 * @param {object} [options]
 */
export function saveFacebookPostWithComments(service, postData, groupInfo = {}, options = {}) {
  return service.saveFacebookPostWithComments(postData, groupInfo, options);
}

function normalizePlatform(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('[PlatformCrawledDataService] platform is required.');
  }
  return normalized;
}

function normalizeFacebookPostInput(postData = {}) {
  const postDate = postData.post_date ? String(postData.post_date).trim() : '';
  return {
    post_id: postData.post_id ? String(postData.post_id) : '',
    post_author: postData.post_author ? String(postData.post_author) : '',
    author_link: postData.author_link ? String(postData.author_link) : null,
    post_link: postData.post_link ? String(postData.post_link) : '',
    post_content: postData.post_content ? String(postData.post_content) : '',
    post_date: postDate || null,
    like_count: parseInteractionCount(postData.like_count),
    share_count: parseInteractionCount(postData.share_count),
    comment_count: parseInteractionCount(postData.comment_count),
    comments: Array.isArray(postData.comments) ? postData.comments : [],
  };
}

function normalizeFacebookGroupInfo(groupInfo = {}, postData = {}) {
  const groupLink = groupInfo.group_link ? String(groupInfo.group_link) : '';
  const groupId = groupInfo.group_id
    ? String(groupInfo.group_id)
    : extractFacebookGroupSlug(groupLink || postData.post_link || '');

  const groupName = groupInfo.group_name
    ? String(groupInfo.group_name)
    : groupId;

  const resolvedLink = groupLink
    || (groupId ? `https://www.facebook.com/groups/${groupId}/` : '');

  return {
    group_id: groupId,
    group_name: groupName,
    group_link: resolvedLink,
  };
}

/**
 * Trích author_id từ profile link hoặc tên hiển thị.
 * @param {string|null|undefined} authorLink
 * @param {string|null|undefined} authorName
 * @returns {string}
 */
export function resolveFacebookAuthorId(authorLink, authorName) {
  try {
    if (authorLink) {
      const url = new URL(authorLink);

      const peopleMatch = url.pathname.match(/\/people\/[^/]+\/(\d+)\/?$/i);
      if (peopleMatch?.[1]) return peopleMatch[1];

      const queryId = url.searchParams.get('id');
      if (queryId) return String(queryId);

      const slug = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (slug && slug !== 'profile.php' && slug !== 'people') {
        return slug;
      }
    }
  } catch {
    // Fall through to name-based id.
  }

  if (typeof authorName === 'string' && authorName.trim()) {
    const normalized = authorName.trim().toLowerCase().replace(/\s+/g, '_');
    return `name:${normalized}`;
  }

  return DEFAULT_UNKNOWN_AUTHOR;
}

function resolveFacebookCommentId(postId, comment = {}, index = 0) {
  if (comment?.comment_id) return String(comment.comment_id);

  const seed = [
    postId,
    comment?.comment_author || '',
    comment?.comment_content || '',
    index,
  ].join('|');

  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

export default PlatformCrawledDataService;
