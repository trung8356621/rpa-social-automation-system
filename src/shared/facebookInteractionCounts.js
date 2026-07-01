/**
 * Parse Facebook GraphQL interaction count fields (likes, shares, comments).
 */

export function parseInteractionCount(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  const text = String(value).replace(/,/g, '').trim();
  const parsed = parseInt(text, 10);
  return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
}

function readFirstPositiveCount(candidates = []) {
  for (const candidate of candidates) {
    const count = parseInteractionCount(candidate);
    if (count > 0) return count;
  }
  return 0;
}

export function pickReactionCount(node) {
  if (!node || typeof node !== 'object') return 0;

  const direct = readFirstPositiveCount([
    node?.reactors?.count,
    node?.reactors?.count_reduced,
    node?.reaction_count?.count,
    node?.reaction_count,
    node?.feedback?.reactors?.count,
    node?.feedback?.reactors?.count_reduced,
    node?.feedback?.reaction_count?.count,
  ]);
  if (direct > 0) return direct;

  const edges = node?.top_reactions?.edges
    || node?.feedback?.top_reactions?.edges
    || [];
  if (!Array.isArray(edges) || !edges.length) return 0;

  const sum = edges.reduce(
    (total, edge) => total + parseInteractionCount(edge?.reaction_count),
    0,
  );
  return sum > 0 ? sum : 0;
}

export function pickShareCount(node) {
  if (!node || typeof node !== 'object') return 0;

  return readFirstPositiveCount([
    node?.share_count?.count,
    node?.share_count,
    node?.feedback?.share_count?.count,
    node?.feedback?.share_count,
    node?.reshare_count?.count,
    node?.reshare_count,
    node?.share?.count,
  ]);
}

export function pickCommentCount(node) {
  if (!node || typeof node !== 'object') return 0;

  return readFirstPositiveCount([
    node?.comments?.count,
    node?.comments?.total_count,
    node?.total_comment_count,
    node?.comment_count,
    node?.comment_count?.count,
    node?.feedback?.comments?.count,
    node?.feedback?.comments?.total_count,
    node?.comment_rendering_instance_for_feed_location?.comments?.count,
    node?.comment_rendering_instance_for_feed_location?.comments?.total_count,
    node?.display_comments?.count,
    node?.replies_fields?.total_count,
  ]);
}

export function pickFeedbackStats(node) {
  return {
    like_count: pickReactionCount(node),
    share_count: pickShareCount(node),
    comment_count: pickCommentCount(node),
  };
}

export function mergeInteractionStats(existing = {}, incoming = {}) {
  const next = { ...existing };
  ['like_count', 'share_count', 'comment_count'].forEach((key) => {
    const current = parseInteractionCount(existing[key]);
    const added = parseInteractionCount(incoming[key]);
    next[key] = Math.max(current, added);
  });
  return next;
}
