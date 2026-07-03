import { enrichFacebookCrawlPosts } from './facebookCrawlConfig.js';
import {
  extractFacebookMediaUrls,
  mergeFacebookMediaUrls,
  parseFacebookMediaUrls,
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

const FACEBOOK_UI_NOISE_PATTERNS = [
  /bình luận đã bị tắt/i,
  /comments have been turned off/i,
  /commenting has been turned off/i,
  /comments are turned off/i,
  /xem thêm bình luận/i,
  /view more comments/i,
  /see more comments/i,
  /be the first to comment/i,
  /hãy là người đầu tiên bình luận/i,
];

const COMMENT_ONLY_QUERY_PATTERNS = [
  /CometUFICommentsProvider/i,
  /CometUFICommentsProviderQuery/i,
  /CometUFICommentsProviderPaginationQuery/i,
  /CommentsProvider/i,
  /CommentList/i,
];

function getFacebookGraphQLQueryName(payload = {}) {
  const request = payload?.__request || {};
  return String(
    request.friendlyName
      || request.queryName
      || request.operationName
      || payload?.operationName
      || payload?.queryName
      || payload?.extensions?.operationName
      || '',
  ).trim();
}

function isCommentOnlyGraphQLPayload(payload = {}) {
  const queryName = getFacebookGraphQLQueryName(payload);
  if (
    payload?.__request?.source === 'force_graphql_fetch'
    && /CometModernPost|CometSinglePost|CometPermalink/i.test(queryName)
  ) {
    return false;
  }
  return Boolean(queryName) && COMMENT_ONLY_QUERY_PATTERNS.some((pattern) => pattern.test(queryName));
}

export function isFacebookUiNoiseText(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  return FACEBOOK_UI_NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

export function sanitizeFacebookPostContent(text = '') {
  const value = String(text || '').trim();
  if (!value || isFacebookUiNoiseText(value)) return '';
  return value;
}

export function isKnownFacebookPostAuthor(name = '') {
  const value = String(name || '').trim();
  return Boolean(value) && value !== DEFAULT_POST_AUTHOR && !isAnonymousAuthorName(value);
}

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
    const paths = [
      story?.actors?.[0],
      story?.actor,
      story?.comet_sections?.actor_photo?.story?.actors?.[0],
      story?.comet_sections?.title?.story?.actors?.[0],
      story?.comet_sections?.context_layout?.story?.comet_sections?.actor_photo?.story?.actors?.[0],
      story?.comet_sections?.context_layout?.story?.actors?.[0],
      story?.comet_sections?.metadata?.story?.actors?.[0],
      story?.comet_sections?.content?.story?.actors?.[0],
      story?.comet_sections?.message?.story?.actors?.[0],
      story?.comet_sections?.introduction?.story?.actors?.[0],
      story?.attached_story?.actors?.[0],
    ];

    for (const candidate of paths) {
      if (candidate && typeof candidate === 'object') return candidate;
    }
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

function pickStoryActor(story) {
  const actor = pickStoryActorNode(story);
  if (!actor) return DEFAULT_POST_AUTHOR;

  try {
    const name = actor?.name || actor?.short_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // Fall through to default.
  }

  return DEFAULT_POST_AUTHOR;
}

function pickStoryAuthor(story) {
  return pickStoryActor(story);
}

function pickActorNameFromNode(node, depth = 0) {
  if (!node || depth > 12 || typeof node !== 'object') return '';
  if (node.__typename === 'Comment') return '';

  const typename = String(node.__typename || '');
  if (['User', 'Page', 'Group'].includes(typename) && typeof node.name === 'string' && node.name.trim()) {
    return node.name.trim();
  }

  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    const found = pickActorNameFromNode(value, depth + 1);
    if (found) return found;
  }

  return '';
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

  const directCandidates = [
    node?.post_id,
    node?.fbid,
    node?.legacy_fbid,
    node?.feedback?.legacy_fbid,
    node?.feedback?.id,
  ];

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    const text = String(candidate);
    const numeric = text.match(/(\d{10,})/);
    if (numeric?.[1]) return numeric[1];
  }

  const rawId = node?.id;
  if (!rawId) return null;

  const decoded = looksLikeBase64GraphQlId(rawId) ? decodeBase64Ascii(rawId) : String(rawId);
  const match = String(decoded || '').match(/(\d{10,})/);
  return match?.[1] || null;
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

function pickTrimmedText(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text || '';
}

function pickStoryMessageTextNormal(story) {
  const paths = [
    story?.comet_sections?.content?.story?.message?.text,
    story?.message?.text,
    story?.comet_sections?.content?.story?.comet_sections?.message_container?.story?.message?.text,
    story?.comet_sections?.message_container?.story?.message?.text,
    story?.comet_sections?.message?.story?.message?.text,
    story?.comet_sections?.message?.text,
    story?.attached_story?.message?.text,
    story?.comet_sections?.context_layout?.story?.comet_sections?.message_container?.story?.message?.text,
    story?.comet_sections?.metadata?.story?.message?.text,
    story?.comet_sections?.title?.story?.message?.text,
    story?.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text,
    story?.comet_sections?.introduction?.story?.message?.text,
  ];

  for (const candidate of paths) {
    const text = pickTrimmedText(candidate);
    if (text) return text;
  }

  return '';
}

function pickStoryMessageTextSpecialFallback(story) {
  try {
    const paths = [
      story?.styled_message?.text,
      story?.comet_sections?.content?.story?.styled_message?.text,
      story?.comet_sections?.content?.story?.message?.delight_ranges?.[0]?.text,
      story?.message?.delight_ranges?.[0]?.text,
      story?.comet_sections?.content?.story?.comet_sections?.message_container?.story?.styled_message?.text,
    ];

    for (const candidate of paths) {
      const text = pickTrimmedText(candidate);
      if (!text) continue;

      console.log(
        '-> Đã kích hoạt hàm vét và bóc được nội dung bài viết đặc biệt (Background Text):',
        `${text.substring(0, 30)}...`,
      );
      return text;
    }
  } catch {
    // Bỏ qua nhánh GraphQL lỗi/thiếu field — không làm crash parser.
  }

  return '';
}

function pickStoryMessageText(story) {
  if (!story || typeof story !== 'object') return '';

  let content = pickStoryMessageTextNormal(story);
  if (!content) {
    content = pickStoryMessageTextSpecialFallback(story);
  }
  if (!content) {
    content = collectStoryTextDeep(story);
  }

  return content;
}

function pickRenderableText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string' && node.text.trim()) return node.text.trim();
  if (typeof node.message?.text === 'string' && node.message.text.trim()) return node.message.text.trim();
  if (typeof node.body?.text === 'string' && node.body.text.trim()) return node.body.text.trim();
  if (typeof node.preferred_body?.text === 'string' && node.preferred_body.text.trim()) {
    return node.preferred_body.text.trim();
  }
  return '';
}

function collectStoryTextDeep(story, depth = 0, maxDepth = 16) {
  if (!story || depth > maxDepth) return '';

  const candidates = [];
  const seen = new Set();

  const visit = (node, currentDepth) => {
    if (!node || currentDepth > maxDepth) return;

    const direct = pickRenderableText(node);
    if (direct && direct.length >= 3 && !seen.has(direct)) {
      seen.add(direct);
      candidates.push(direct);
    }

    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, currentDepth + 1));
      return;
    }

    if (typeof node !== 'object') return;

    if (node.__typename === 'Comment') return;

    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') visit(value, currentDepth + 1);
    });
  };

  visit(story, 0);

  return candidates
    .filter((text) => text.length >= 8 && !isFacebookUiNoiseText(text))
    .sort((left, right) => right.length - left.length)[0] || '';
}

function collectPostImagesFromStory(story) {
  const images = mergeFacebookMediaUrls([], extractFacebookMediaUrls(story));
  const addMedia = (value) => {
    mergeFacebookMediaUrls(images, value).forEach((url) => {
      if (!images.includes(url)) images.push(url);
    });
  };

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 10) return;
    if (
      node.__typename === 'StoryAttachment'
      || node.__typename === 'Photo'
      || node.__typename === 'Video'
      || node.media
      || node.attachments
      || node.all_subattachments
      || node.subattachments
    ) {
      addMedia(extractFacebookMediaUrls(node));
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

function isStoryTypename(value = '') {
  const name = String(value || '').trim();
  return name === 'Story' || name === 'GroupPostStory' || /Story$/i.test(name);
}

function extractPostFromStory(story, groupSlug = DEFAULT_GROUP_SLUG) {
  if (!story || !isStoryTypename(story.__typename)) return null;

  try {
    const post_id = pickPostId(story);
    let post_author = pickStoryAuthor(story);
    if (post_author === DEFAULT_POST_AUTHOR) {
      const fallbackAuthor = pickActorNameFromNode(story);
      if (fallbackAuthor) post_author = fallbackAuthor;
    }
    const author_link = pickStoryAuthorLink(story);
    const post_content = sanitizeFacebookPostContent(pickStoryMessageText(story));
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

function looksLikeTruncatedText(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  return /(?:…|\.\.\.)$/.test(value);
}

function assembleTextFromBodyRanges(bodyNode) {
  if (!bodyNode || typeof bodyNode !== 'object') return '';

  const rangeLists = [
    bodyNode.ranges,
    bodyNode.delight_ranges,
    bodyNode.text_entity_ranges,
    bodyNode.entities,
  ].filter(Array.isArray);

  const parts = [];
  rangeLists.forEach((ranges) => {
    ranges.forEach((range) => {
      const text = pickTrimmedText(range?.text)
        || pickTrimmedText(range?.entity?.text)
        || pickTrimmedText(range?.entity?.name);
      if (text) parts.push(text);
    });
  });

  return parts.join('').trim();
}

function collectCommentTextDeep(comment, depth = 0, maxDepth = 14) {
  if (!comment || depth > maxDepth) return '';

  const candidates = [];
  const seen = new Set();

  const visit = (node, currentDepth) => {
    if (!node || currentDepth > maxDepth) return;

    if (typeof node === 'string') {
      const text = node.trim();
      if (text.length >= 4 && !seen.has(text) && !isFacebookUiNoiseText(text)) {
        seen.add(text);
        candidates.push(text);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, currentDepth + 1));
      return;
    }

    if (typeof node !== 'object') return;

    const typename = String(node.__typename || '');
    if (['User', 'Page', 'Group', 'Story'].includes(typename)) return;

    const direct = pickRenderableText(node);
    if (direct.length >= 4 && !seen.has(direct) && !isFacebookUiNoiseText(direct)) {
      seen.add(direct);
      candidates.push(direct);
    }

    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') visit(value, currentDepth + 1);
    });
  };

  visit(comment, 0);
  return candidates.sort((left, right) => right.length - left.length)[0] || '';
}

function pickCommentBodyText(comment) {
  if (!comment || typeof comment !== 'object') return '';

  try {
    const candidates = [];
    const push = (text) => {
      const value = pickTrimmedText(text);
      if (value && !isFacebookUiNoiseText(value)) candidates.push(value);
    };

    push(comment?.preferred_body?.text);
    push(comment?.body?.text);
    push(comment?.body_renderer?.text);
    push(assembleTextFromBodyRanges(comment?.preferred_body));
    push(assembleTextFromBodyRanges(comment?.body));
    push(comment?.translation?.text);
    push(typeof comment?.message === 'string' ? comment.message : comment?.message?.text);
    push(comment?.untruncated_body?.text);
    push(comment?.expanded_body?.text);

    const primary = pickTrimmedText(comment?.body?.text)
      || pickTrimmedText(comment?.preferred_body?.text);
    if (!primary || looksLikeTruncatedText(primary)) {
      push(collectCommentTextDeep(comment));
    }

    const unique = [...new Set(candidates)];
    return unique.sort((left, right) => right.length - left.length)[0] || '';
  } catch {
    return '';
  }
}

function looksLikeCommentNode(comment) {
  if (!comment || typeof comment !== 'object') return false;
  if (comment.__typename === 'Comment') return true;

  const text = pickCommentBodyText(comment);
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
    const comment_content = pickCommentBodyText(comment);
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
  const incomingText = String(incoming.comment_content || '').trim();
  const existingText = String(existing.comment_content || '').trim();
  if (incomingText.length > existingText.length) {
    existing.comment_content = incoming.comment_content;
  }
  if (
    (!existing.comment_author || existing.comment_author === 'Không rõ nguồn')
    && incoming.comment_author
    && incoming.comment_author !== 'Không rõ nguồn'
  ) {
    existing.comment_author = incoming.comment_author;
  }
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
        _feedback_only: true,
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
  'display_comments',
  'comment_list_renderer',
  'replies_connection',
  'if_viewer_can_comment',
]);

const POST_STORY_NODE_KEYS = new Set([
  'story',
  'permalink_story',
  'attached_story',
  'parent_story',
  'target_story',
]);

function tryExtractPostFromStoryNode(storyNode, ctx) {
  if (!storyNode || typeof storyNode !== 'object') return;
  if (!isStoryTypename(storyNode.__typename)) return;

  const post = extractPostFromStory(storyNode, ctx.groupSlug);
  if (!post) return;

  const key = post.post_id || `story:${post.post_content.slice(0, 120)}`;
  if (!ctx.postsByKey.has(key)) {
    ctx.postsByKey.set(key, { ...post, comments: [] });
  } else {
    mergePostFields(ctx.postsByKey.get(key), post);
  }
  ctx.activePostKey = key;
}

function walkGraph(node, ctx, depth = 0, inCommentContext = false) {
  if (!node || typeof node !== 'object' || depth > 36) return;

  if (Array.isArray(node)) {
    node.forEach((item) => walkGraph(item, ctx, depth + 1, inCommentContext));
    return;
  }

  const isCommentNode = node.__typename === 'Comment' || looksLikeCommentNode(node);
  if (inCommentContext || isCommentNode) {
    if (isCommentNode) {
      const parsed = extractCommentFromNode(node);
      if (parsed) registerComment(parsed, ctx);
    }

    if (Array.isArray(node.edges)) {
      extractCommentsFromEdges(node, ctx);
      node.edges.forEach((edge) => {
        if (edge?.node) walkGraph(edge.node, ctx, depth + 1, true);
      });
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      if (key === 'edges') continue;
      walkGraph(value, ctx, depth + 1, true);
    }
    return;
  }

  if (node.__typename === 'Story' || isStoryTypename(node.__typename)) {
    tryExtractPostFromStoryNode(node, ctx);
  }

  if (node.__typename === 'Feedback') {
    applyFeedbackToContext(node, ctx);
  }

  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue;
    if (key === 'edges') continue;
    if (POST_STORY_NODE_KEYS.has(key)) {
      tryExtractPostFromStoryNode(value, ctx);
    }
  }

  if (node.story && typeof node.story === 'object') {
    tryExtractPostFromStoryNode(node.story, ctx);
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

    walkGraph(root, ctx, 0, isCommentOnlyGraphQLPayload(apiJsonData));

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
      return markCommentOnlyFacebookPost({
        ...createEmptyPost(groupSlug),
        comments: ctx.orphanComments,
      });
    }

    return null;
  } catch {
    return null;
  }
}

export function mergeFacebookPostFields(existing, incoming) {
  if (!existing || !incoming) return;
  const incomingContent = sanitizeFacebookPostContent(incoming.post_content);
  const existingContent = sanitizeFacebookPostContent(existing.post_content);
  if (!existingContent && incomingContent) {
    existing.post_content = incomingContent;
  } else if (existingContent !== sanitizeFacebookPostContent(existing.post_content)) {
    existing.post_content = existingContent;
  }
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

function isCommentOnlyFacebookPost(post = {}) {
  const content = sanitizeFacebookPostContent(post?.post_content);
  const hasImages = parseFacebookMediaUrls(post?.post_images).length > 0
    || String(post?.local_image_path || '').trim();
  const hasAuthor = isKnownFacebookPostAuthor(post?.post_author);
  return Boolean((post?.comments || []).length) && !content && !hasImages && !hasAuthor;
}

function markCommentOnlyFacebookPost(post = {}) {
  return {
    ...post,
    _comments_only: true,
  };
}

function mergePostFields(existing, incoming) {
  mergeFacebookPostFields(existing, incoming);
  if (existing._comments_only && !isCommentOnlyFacebookPost(incoming)) {
    delete existing._comments_only;
  }
  if (existing._feedback_only && !incoming?._feedback_only) {
    delete existing._feedback_only;
  }
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
            mergedByPostId.set(key, {
              ...(isCommentOnlyFacebookPost(post) ? markCommentOnlyFacebookPost(post) : post),
              comments: [...(post.comments || [])],
            });
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
          mergedByPostId.set(key, {
            ...(isCommentOnlyFacebookPost(parsed) ? markCommentOnlyFacebookPost(parsed) : parsed),
            comments: [...(parsed.comments || [])],
          });
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
    results.push(markCommentOnlyFacebookPost({
      ...createEmptyPost(groupSlug),
      comments: orphanComments,
    }));
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
