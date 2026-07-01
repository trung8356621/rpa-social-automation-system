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

function extractPostFromStory(story, groupSlug = DEFAULT_GROUP_SLUG) {
  if (!story || story.__typename !== 'Story') return null;

  try {
    const post_id = pickPostId(story);
    const post_author = pickStoryAuthor(story);
    const author_link = pickStoryAuthorLink(story);
    const post_content = pickStoryMessageText(story);
    const post_link = post_id ? buildFacebookPostLink(post_id, groupSlug) : '';

    if (!post_content && !post_id) return null;

    return {
      post_id: post_id || null,
      post_author,
      author_link,
      post_link,
      post_content,
      comments: [],
    };
  } catch {
    return null;
  }
}

function extractCommentFromNode(comment) {
  if (!comment || comment.__typename !== 'Comment') return null;

  try {
    const comment_content = (
      comment?.body?.text
      || comment?.preferred_body?.text
      || ''
    ).trim();

    if (!comment_content) return null;

    return {
      comment_id: comment?.id || comment?.legacy_fbid || null,
      comment_author: pickCommentAuthor(comment),
      comment_content,
      created_time: comment?.created_time ?? comment?.timestamp ?? null,
    };
  } catch {
    return null;
  }
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
      }
      ctx.activePostKey = key;
    }
  }

  if (node.__typename === 'Comment') {
    const parsed = extractCommentFromNode(node);
    if (parsed) {
      const dedupeKey = parsed.comment_id || `${parsed.comment_author || ''}::${parsed.comment_content}`;
      if (!ctx.seenComments.has(dedupeKey)) {
        ctx.seenComments.add(dedupeKey);
        const commentItem = {
          comment_author: parsed.comment_author,
          comment_content: parsed.comment_content,
        };
        if (parsed.comment_id) commentItem.comment_id = parsed.comment_id;
        if (parsed.created_time != null) commentItem.created_time = parsed.created_time;

        const bucket = ctx.activePostKey && ctx.postsByKey.has(ctx.activePostKey)
          ? ctx.postsByKey.get(ctx.activePostKey).comments
          : ctx.orphanComments;
        bucket.push(commentItem);
      }
    }
    return;
  }

  if (Array.isArray(node.edges)) {
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
      if (!comment?.comment_content) return;
      const dedupeKey = comment.comment_id
        || `${comment.comment_author || ''}::${comment.comment_content}`;
      if (seenComments.has(dedupeKey)) return;
      seenComments.add(dedupeKey);
      targetComments.push(comment);
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

  return results;
}
