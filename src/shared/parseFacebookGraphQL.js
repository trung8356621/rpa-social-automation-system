import { enrichFacebookCrawlPosts } from './facebookCrawlConfig.js';
import {
  extractFacebookMediaUrls,
  mergeFacebookMediaUrls,
} from './facebookMediaExtract.js';
import {
  mergeInteractionStats,
  parseInteractionCount,
  pickFeedbackStats,
  pickReactionCount,
} from './facebookInteractionCounts.js';

const DEFAULT_POST_AUTHOR = 'Không rõ nguồn';
const DEFAULT_GROUP_SLUG = 'wordpressvnteam';

const ANONYMOUS_AUTHOR_PATTERNS = [
  /ẩn danh/i,
  /anonymous/i,
  /anonymous participant/i,
];

export function extractFacebookGroupSlug(urlOrSlug = '') {
  const text = String(urlOrSlug || '').trim();
  if (!text) return DEFAULT_GROUP_SLUG;

  const match = text.match(/facebook\.com\/groups\/([^/?#]+)/i);
  if (match?.[1]) return match[1];

  if (!text.includes('/') && !text.includes('.')) return text;

  return DEFAULT_GROUP_SLUG;
}

export function buildFacebookPostLink(postId, groupSlug = DEFAULT_GROUP_SLUG) {
  if (!postId) return '';
  const slug = String(groupSlug || DEFAULT_GROUP_SLUG).trim() || DEFAULT_GROUP_SLUG;
  return `https://www.facebook.com/groups/${slug}/posts/${postId}/`;
}

export function extractFacebookPostId(urlOrId = '') {
  const text = String(urlOrId || '').trim();
  if (!text) return '';

  const fromUrl = text.match(/\/posts\/(\d+)/i);
  if (fromUrl?.[1]) return fromUrl[1];

  if (/^\d+$/.test(text)) return text;
  return '';
}

function isAnonymousAuthorName(name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  return ANONYMOUS_AUTHOR_PATTERNS.some((pattern) => pattern.test(name));
}

function pickStoryActorNode(story) {
  if (!story || typeof story !== 'object') return null;

  try {
    const fromActors = story?.actors?.[0];
    if (fromActors && typeof fromActors === 'object') return fromActors;

    const fromActor = story?.actor;
    if (fromActor && typeof fromActor === 'object') return fromActor;
  } catch {
    // Fall through.
  }

  return null;
}

function looksLikeBase64GraphQlId(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const text = value.trim();
  if (text.length < 8) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(text);
}

function decodeBase64Ascii(value) {
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(value, 'base64').toString('ascii');
    }
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(value);
    }
  } catch {
    // Fall through.
  }
  return null;
}

function normalizeFacebookProfileUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;

  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return /facebook\.com/i.test(trimmed) ? trimmed : null;
  }
  if (trimmed.startsWith('//') && /facebook\.com/i.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    return `https://www.facebook.com${trimmed}`;
  }
  if (/^(www\.)?facebook\.com/i.test(trimmed)) {
    return `https://${trimmed.replace(/^\/+/, '')}`;
  }

  return null;
}

function buildProfileLinkFromActorId(actorId) {
  if (typeof actorId !== 'string' || !actorId.trim()) return null;

  const id = actorId.trim();

  if (/^\d+$/.test(id)) {
    return `https://www.facebook.com/profile.php?id=${id}`;
  }

  if (!looksLikeBase64GraphQlId(id)) return null;

  try {
    const decoded = decodeBase64Ascii(id);
    if (typeof decoded !== 'string' || !decoded) return null;

    const userMatch = decoded.match(/^User:(\d+)$/);
    if (userMatch?.[1]) {
      return `https://www.facebook.com/profile.php?id=${userMatch[1]}`;
    }
  } catch {
    // Fall through.
  }

  return null;
}

function pickStoryAuthorLink(story) {
  if (!story || typeof story !== 'object') return null;

  try {
    const authorName = pickStoryAuthor(story);
    if (isAnonymousAuthorName(authorName)) return null;

    const actor = pickStoryActorNode(story);
    if (!actor) return null;

    const directUrl = normalizeFacebookProfileUrl(actor?.url);
    if (directUrl) return directUrl;

    return buildProfileLinkFromActorId(actor?.id);
  } catch {
    return null;
  }
}

function pickStoryAuthor(story) {
  const actor = pickStoryActorNode(story);
  if (!actor) return DEFAULT_POST_AUTHOR;

  try {
    const name = actor?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // Fall through to default.
  }

  return DEFAULT_POST_AUTHOR;
}

function pickCommentAuthor(comment) {
  if (!comment || typeof comment !== 'object') return 'Không rõ nguồn';

  try {
    const fromAuthor = comment?.author?.name;
    if (typeof fromAuthor === 'string' && fromAuthor.trim()) return fromAuthor.trim();

    const fromActor = comment?.actor?.name;
    if (typeof fromActor === 'string' && fromActor.trim()) return fromActor.trim();
  } catch {
    // Fall through.
  }

  return 'Không rõ nguồn';
}

function pickPostId(node) {
  if (!node || typeof node !== 'object') return null;
  return node?.post_id || node?.fbid || node?.legacy_fbid || node?.id || null;
}

function pickStoryCreationTime(story) {
  if (!story || typeof story !== 'object') return null;

  const paths = [
    story?.creation_time,
    story?.comet_sections?.metadata?.story?.creation_time,
    story?.comet_sections?.context_layout?.story?.comet_sections?.metadata?.story?.creation_time,
    story?.feedback?.creation_time,
    story?.attached_story?.creation_time,
    story?.comet_sections?.timestamp?.story?.creation_time,
  ];

  for (const candidate of paths) {
    if (candidate == null || candidate === '') continue;
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

/**
 * Convert Facebook UNIX timestamp (seconds or ms) to YYYY-MM-DD (local date).
 * @param {number|string|null|undefined} unixValue
 * @returns {string|null}
 */
export function formatFacebookPostDate(unixValue) {
  const ts = Number(unixValue);
  if (!Number.isFinite(ts) || ts <= 0) return null;

  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickStoryMessageText(story) {
  if (!story || typeof story !== 'object') return '';

  const paths = [
    story?.comet_sections?.content?.story?.comet_sections?.message_container?.story?.message?.text,
    story?.comet_sections?.message_container?.story?.message?.text,
    story?.comet_sections?.message?.story?.message?.text,
    story?.message?.text,
    story?.attached_story?.message?.text,
  ];

  for (const candidate of paths) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function collectPostImagesFromStory(story) {
  const images = mergeFacebookMediaUrls([], extractFacebookMediaUrls(story));

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 10) return;
    if (node.__typename === 'StoryAttachment' || node.__typename === 'Photo') {
      mergeFacebookMediaUrls(images, extractFacebookMediaUrls(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') visit(value, depth + 1);
    });
  };

  visit(story?.comet_sections, 0);
  return images;
}

function extractPostFromStory(story, groupSlug = DEFAULT_GROUP_SLUG) {
  if (!story || story.__typename !== 'Story') return null;

  try {
    const post_id = pickPostId(story);
    const post_author = pickStoryAuthor(story);
    const author_link = pickStoryAuthorLink(story);
    const post_content = pickStoryMessageText(story);
    const post_link = post_id ? buildFacebookPostLink(post_id, groupSlug) : '';
    const creationTime = pickStoryCreationTime(story);
    const post_date = formatFacebookPostDate(creationTime);
    const feedbackStats = pickFeedbackStats(story?.feedback || story);
    const post_images = collectPostImagesFromStory(story);

    if (!post_content && !post_id && !post_images.length) return null;

    return {
      post_id: post_id || null,
      post_author,
      author_link,
      post_link,
      post_content,
      post_date,
      post_images,
      like_count: feedbackStats.like_count,
      share_count: feedbackStats.share_count,
      comment_count: feedbackStats.comment_count,
      comments: [],
    };
  } catch {
    return null;
  }
}

function looksLikeCommentNode(comment) {
  if (!comment || typeof comment !== 'object') return false;
  if (comment.__typename === 'Comment') return true;

  const text = (
    comment?.body?.text
    || comment?.preferred_body?.text
    || ''
  ).trim();
  const hasAuthor = Boolean(
    comment?.author?.name
    || comment?.actor?.name,
  );
  const hasMedia = extractFacebookMediaUrls(comment).length > 0;

  return Boolean(comment?.id && hasAuthor && (text || hasMedia));
}

function pickPostIdFromFeedbackNode(node) {
  const id = node?.id || node?.legacy_fbid || '';
  const decoded = looksLikeBase64GraphQlId(id) ? decodeBase64Ascii(id) : id;
  const match = String(decoded || '').match(/(\d{10,})/);
  return match?.[1] || '';
}

function extractCommentFromNode(comment) {
  if (!looksLikeCommentNode(comment)) return null;

  try {
    const comment_content = (
      comment?.body?.text
      || comment?.preferred_body?.text
      || ''
    ).trim();
    const comment_images = extractFacebookMediaUrls(comment);

    if (!comment_content && !comment_images.length) return null;

    return {
      comment_id: comment?.id || comment?.legacy_fbid || null,
      comment_author: pickCommentAuthor(comment),
      comment_content,
      comment_images,
      created_time: comment?.created_time ?? comment?.timestamp ?? null,
      like_count: pickReactionCount(comment),
    };
  } catch {
    return null;
  }
}

function mergeCommentFields(existing, incoming) {
  if (!existing || !incoming) return;
  if (!existing.comment_id && incoming.comment_id) existing.comment_id = incoming.comment_id;
  if (!existing.created_time && incoming.created_time != null) {
    existing.created_time = incoming.created_time;
  }
  const nextLikes = parseInteractionCount(incoming.like_count);
  const currentLikes = parseInteractionCount(existing.like_count);
  if (nextLikes > currentLikes) existing.like_count = nextLikes;
  existing.comment_images = mergeFacebookMediaUrls(
    existing.comment_images || [],
    incoming.comment_images || [],
  );
}

function buildCommentDedupeKey(parsed = {}) {
  if (parsed.comment_id) return parsed.comment_id;
  const imageKey = (parsed.comment_images || []).join('|');
  return `${parsed.comment_author || ''}::${parsed.comment_content || ''}::${imageKey}`;
}

function hasCommentPayload(parsed = {}) {
  return Boolean(parsed.comment_content || (parsed.comment_images || []).length);
}

function registerComment(parsed, ctx) {
  if (!hasCommentPayload(parsed)) return;

  const dedupeKey = buildCommentDedupeKey(parsed);
  const bucket = ctx.activePostKey && ctx.postsByKey.has(ctx.activePostKey)
    ? ctx.postsByKey.get(ctx.activePostKey).comments
    : ctx.orphanComments;

  if (ctx.seenComments.has(dedupeKey)) {
    const existing = bucket.find((item) => (
      (parsed.comment_id && item.comment_id === parsed.comment_id)
      || buildCommentDedupeKey(item) === dedupeKey
    ));
    if (existing) mergeCommentFields(existing, parsed);
    return;
  }

  ctx.seenComments.add(dedupeKey);
  const commentItem = {
    comment_author: parsed.comment_author,
    comment_content: parsed.comment_content || '',
    like_count: parseInteractionCount(parsed.like_count),
  };
  if (parsed.comment_id) commentItem.comment_id = parsed.comment_id;
  if (parsed.created_time != null) commentItem.created_time = parsed.created_time;
  if (parsed.comment_images?.length) commentItem.comment_images = [...parsed.comment_images];
  bucket.push(commentItem);
}

function applyFeedbackToContext(feedback, ctx) {
  if (!feedback || typeof feedback !== 'object') return;

  const stats = pickFeedbackStats(feedback);
  const postId = pickPostIdFromFeedbackNode(feedback);

  if (postId) {
    const key = postId;
    if (!ctx.postsByKey.has(key)) {
      ctx.postsByKey.set(key, {
        ...createEmptyPost(ctx.groupSlug),
        post_id: postId,
        post_link: buildFacebookPostLink(postId, ctx.groupSlug),
        ...stats,
        comments: [],
      });
    } else {
      Object.assign(
        ctx.postsByKey.get(key),
        mergeInteractionStats(ctx.postsByKey.get(key), stats),
      );
    }
    ctx.activePostKey = key;
    return;
  }

  if (ctx.activePostKey && ctx.postsByKey.has(ctx.activePostKey)) {
    Object.assign(
      ctx.postsByKey.get(ctx.activePostKey),
      mergeInteractionStats(ctx.postsByKey.get(ctx.activePostKey), stats),
    );
  }
}

function extractCommentsFromEdges(node, ctx) {
  if (!node || !Array.isArray(node.edges) || !node.edges.length) return;

  const sample = node.edges[0]?.node;
  if (!looksLikeCommentNode(sample)) return;

  node.edges.forEach((edge) => {
    const parsed = extractCommentFromNode(edge?.node);
    if (parsed) registerComment(parsed, ctx);
  });
}

const COMMENT_CONTEXT_KEYS = new Set([
  'comments',
  'comment_renderer',
  'feedback',
  'display_comments',
  'comment_list_renderer',
  'replies_connection',
  'if_viewer_can_comment',
]);

function walkGraph(node, ctx, depth = 0, inCommentContext = false) {
  if (!node || typeof node !== 'object' || depth > 36) return;

  if (Array.isArray(node)) {
    node.forEach((item) => walkGraph(item, ctx, depth + 1, inCommentContext));
    return;
  }

  if (node.__typename === 'Story') {
    const post = extractPostFromStory(node, ctx.groupSlug);
    if (post) {
      const key = post.post_id || `story:${post.post_content.slice(0, 120)}`;
      if (!ctx.postsByKey.has(key)) {
        ctx.postsByKey.set(key, { ...post, comments: [] });
      } else {
        mergePostFields(ctx.postsByKey.get(key), post);
      }
      ctx.activePostKey = key;
    }
  }

  if (node.__typename === 'Feedback') {
    applyFeedbackToContext(node, ctx);
  }

  if (node.__typename === 'Comment' || looksLikeCommentNode(node)) {
    const parsed = extractCommentFromNode(node);
    if (parsed) registerComment(parsed, ctx);
  }

  if (Array.isArray(node.edges)) {
    extractCommentsFromEdges(node, ctx);
    node.edges.forEach((edge) => {
      if (edge?.node) {
        walkGraph(edge.node, ctx, depth + 1, true);
      }
    });
  }

  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    if (key === 'edges') continue;

    const nextInCommentContext = inCommentContext || COMMENT_CONTEXT_KEYS.has(key);
    walkGraph(value, ctx, depth + 1, nextInCommentContext);
  }
}

function normalizeOptions(options = {}) {
  return {
    groupSlug: extractFacebookGroupSlug(options.groupSlug || options.targetUrl || DEFAULT_GROUP_SLUG),
  };
}

function createEmptyPost(groupSlug) {
  return {
    post_id: null,
    post_author: DEFAULT_POST_AUTHOR,
    author_link: null,
    post_link: '',
    post_content: '',
    post_date: null,
    post_images: [],
    like_count: 0,
    share_count: 0,
    comment_count: 0,
    comments: [],
    ...(groupSlug ? { _group_slug: groupSlug } : {}),
  };
}

/**
 * Parse one Facebook GraphQL JSON payload into structured post + comments.
 */
export function parseFacebookGraphQL(apiJsonData, options = {}) {
  try {
    const { groupSlug } = normalizeOptions(options);
    const root = apiJsonData?.data && typeof apiJsonData.data === 'object'
      ? apiJsonData.data
      : apiJsonData;

    if (!root || typeof root !== 'object') return null;

    const ctx = {
      groupSlug,
      postsByKey: new Map(),
      seenComments: new Set(),
      orphanComments: [],
      activePostKey: null,
    };

    walkGraph(root, ctx);

    const posts = Array.from(ctx.postsByKey.values());

    if (posts.length === 1) {
      if (ctx.orphanComments.length) {
        posts[0].comments.push(...ctx.orphanComments);
      }
      return posts[0];
    }

    if (posts.length > 1) {
      return { posts };
    }

    if (ctx.orphanComments.length) {
      return {
        ...createEmptyPost(groupSlug),
        comments: ctx.orphanComments,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function mergePostFields(existing, incoming) {
  if (!existing.post_content && incoming.post_content) existing.post_content = incoming.post_content;
  if ((!existing.post_author || existing.post_author === DEFAULT_POST_AUTHOR) && incoming.post_author) {
    existing.post_author = incoming.post_author;
  }
  if (!existing.author_link && incoming.author_link) existing.author_link = incoming.author_link;
  if (!existing.post_link && incoming.post_link) existing.post_link = incoming.post_link;
  if (!existing.post_id && incoming.post_id) existing.post_id = incoming.post_id;
  if (!existing.post_date && incoming.post_date) existing.post_date = incoming.post_date;
  existing.post_images = mergeFacebookMediaUrls(
    existing.post_images || [],
    incoming.post_images || [],
  );
  Object.assign(existing, mergeInteractionStats(existing, incoming));
}

/**
 * Parse many raw GraphQL objects (NDJSON lines / batch) and merge by post_id.
 */
export function parseFacebookGraphQLBatch(rawObjects, options = {}) {
  if (!Array.isArray(rawObjects)) return [];

  const { groupSlug } = normalizeOptions(options);
  const mergedByPostId = new Map();
  const orphanComments = [];
  const seenComments = new Set();

  const mergeComments = (targetComments, incoming = []) => {
    incoming.forEach((comment) => {
      if (!hasCommentPayload(comment)) return;
      const dedupeKey = buildCommentDedupeKey(comment);
      if (seenComments.has(dedupeKey)) {
        const existing = targetComments.find((item) => (
          (comment.comment_id && item.comment_id === comment.comment_id)
          || buildCommentDedupeKey(item) === dedupeKey
        ));
        if (existing) mergeCommentFields(existing, comment);
        return;
      }
      seenComments.add(dedupeKey);
      targetComments.push({
        ...comment,
        like_count: parseInteractionCount(comment.like_count),
        comment_images: mergeFacebookMediaUrls([], comment.comment_images || []),
      });
    });
  };

  for (const raw of rawObjects) {
    try {
      const parsed = parseFacebookGraphQL(raw, { groupSlug });
      if (!parsed) continue;

      if (Array.isArray(parsed.posts)) {
        parsed.posts.forEach((post) => {
          const key = post.post_id || `story:${post.post_content?.slice(0, 120)}`;
          if (!mergedByPostId.has(key)) {
            mergedByPostId.set(key, { ...post, comments: [...(post.comments || [])] });
            return;
          }
          const existing = mergedByPostId.get(key);
          mergePostFields(existing, post);
          mergeComments(existing.comments, post.comments);
        });
        continue;
      }

      if (parsed.post_id || parsed.post_content) {
        const key = parsed.post_id || `story:${parsed.post_content?.slice(0, 120)}`;
        if (!mergedByPostId.has(key)) {
          mergedByPostId.set(key, { ...parsed, comments: [...(parsed.comments || [])] });
        } else {
          const existing = mergedByPostId.get(key);
          mergePostFields(existing, parsed);
          mergeComments(existing.comments, parsed.comments);
        }
      } else if (parsed.comments?.length) {
        mergeComments(orphanComments, parsed.comments);
      }
    } catch {
      // Skip broken payload.
    }
  }

  const results = Array.from(mergedByPostId.values());

  if (orphanComments.length) {
    results.push({
      ...createEmptyPost(groupSlug),
      comments: orphanComments,
    });
  }

  return enrichFacebookCrawlPosts(results, options);
}

/**
 * Count unique comments across parsed post batch results.
 */
export function countParsedFacebookComments(parsedPosts = []) {
  if (!Array.isArray(parsedPosts)) return 0;

  const seen = new Set();
  let count = 0;

  for (const post of parsedPosts) {
    for (const comment of (post?.comments || [])) {
      const key = comment?.comment_id
        || `${comment?.comment_author || ''}::${comment?.comment_content || ''}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
  }

  return count;
}

/**
 * Read the highest comment_count reported by Facebook feedback in a parsed batch.
 */
export function getExpectedFacebookCommentCount(parsedPosts = []) {
  if (!Array.isArray(parsedPosts)) return 0;

  return parsedPosts.reduce((max, post) => (
    Math.max(max, parseInteractionCount(post?.comment_count) || 0)
  ), 0);
}
