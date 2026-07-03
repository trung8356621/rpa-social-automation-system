/**
 * Self-contained scroll helpers for crawl / request-catching.
 * Single exported functions are safe for page.evaluate / executeJavaScript.
 */

export function runCrawlScrollStep(distance = 600, mode = 'scroll', scrollContext = 'auto') {
  function isScrollableElement(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') {
      return false;
    }
    return element.scrollHeight > element.clientHeight + 8;
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    if (rect.top > window.innerHeight + 20) return false;
    return true;
  }

  function findBestScrollContainer(root) {
    const nodes = root
      ? [root, ...root.querySelectorAll('div, section, article, main, ul, ol')]
      : Array.from(document.querySelectorAll('div, section, article, main, ul, ol'));

    let best = null;
    let bestArea = 0;
    for (const node of nodes) {
      if (!isScrollableElement(node) || !isVisibleElement(node)) continue;
      const rect = node.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = node;
      }
    }
    return best;
  }

  function findScrollableAncestor(start) {
    let node = start;
    while (node && node !== document.body) {
      if (isScrollableElement(node) && isVisibleElement(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function resolveScrollContext() {
    if (scrollContext === 'comments' || scrollContext === 'feed') return scrollContext;
    return /\/posts\/\d+/i.test(window.location.href) ? 'comments' : 'feed';
  }

  function findFacebookFeedScrollContainer() {
    const selectors = [
      '[role="feed"]',
      '[data-pagelet*="Feed"]',
      '[data-pagelet="GroupFeed"]',
      'div[role="main"]',
    ];

    for (const selector of selectors) {
      const anchors = Array.from(document.querySelectorAll(selector));
      for (const anchor of anchors) {
        const nested = findBestScrollContainer(anchor);
        if (nested) return nested;
        if (isScrollableElement(anchor) && isVisibleElement(anchor)) return anchor;
        const ancestor = findScrollableAncestor(anchor);
        if (ancestor) return ancestor;
      }
    }

    return null;
  }

  function findFacebookCommentScrollContainer() {
    const selectors = [
      '[data-pagelet*="Comments"]',
      '[data-pagelet*="Comment"]',
      '[aria-label*="Comment" i]',
      '[aria-label*="Bình luận"]',
      '[aria-label*="binh luan" i]',
      '[role="dialog"] [role="article"]',
      '[role="main"] [role="article"]',
    ];

    for (const selector of selectors) {
      const anchors = Array.from(document.querySelectorAll(selector));
      for (const anchor of anchors) {
        const container = findScrollableAncestor(anchor);
        if (container) return container;
      }
    }

    return null;
  }

  function findCrawlScrollContainer(context) {
    if (context === 'comments') {
      const commentContainer = findFacebookCommentScrollContainer();
      if (commentContainer) return commentContainer;

      const modalRoots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
        .filter((node) => isVisibleElement(node));

      for (const modal of modalRoots) {
        const nested = findBestScrollContainer(modal);
        if (nested) return nested;
        if (isScrollableElement(modal) && isVisibleElement(modal)) return modal;
      }
    } else {
      const feedContainer = findFacebookFeedScrollContainer();
      if (feedContainer) return feedContainer;
    }

    return findBestScrollContainer(null);
  }

  function readWindowScrollState() {
    const root = document.scrollingElement || document.documentElement;
    return {
      mode: 'window',
      scrollTop: window.scrollY || root.scrollTop || 0,
      clientHeight: window.innerHeight || root.clientHeight || 0,
      scrollHeight: root.scrollHeight || document.body.scrollHeight || 0,
    };
  }

  function readState(container, context) {
    if (context === 'feed') {
      return readWindowScrollState();
    }

    if (container) {
      return {
        mode: 'element',
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      };
    }

    return readWindowScrollState();
  }

  const context = resolveScrollContext();

  if (mode === 'read') {
    const container = context === 'comments' ? findCrawlScrollContainer(context) : null;
    return readState(container, context);
  }

  if (mode === 'reset') {
    if (context === 'comments') {
      const container = findCrawlScrollContainer(context);
      if (container) container.scrollTop = 0;
      window.scrollTo(0, 0);
      return readState(container, context);
    }
    return readWindowScrollState();
  }

  const amount = Math.max(0, Number(distance) || 0);

  if (context === 'feed') {
    const feedRoot = document.querySelector('[role="feed"]')
      || document.querySelector('[data-pagelet*="Feed"]')
      || document.querySelector('[data-pagelet="GroupFeed"]');
    if (feedRoot && isScrollableElement(feedRoot)) {
      feedRoot.scrollTop += amount;
    }
    window.scrollBy(0, amount);
    return readWindowScrollState();
  }

  const container = findCrawlScrollContainer(context);
  if (container) container.scrollTop += amount;
  window.scrollBy(0, amount);

  if (context === 'comments') {
    const loadMorePatterns = [
      'xem thêm bình luận',
      'xem thêm',
      'view more comments',
      'see more comments',
      'view previous comments',
      'xem các bình luận trước',
      'view more replies',
      'xem thêm phản hồi',
    ];
    const clicked = new Set();
    Array.from(document.querySelectorAll('span, div, a, button, [role="button"]'))
      .filter((node) => {
        const text = String(node.textContent || '').trim().toLowerCase();
        if (!text || text.length > 80) return false;
        return loadMorePatterns.some((pattern) => text.includes(pattern));
      })
      .slice(0, 5)
      .forEach((node) => {
        if (clicked.has(node)) return;
        clicked.add(node);
        if (typeof node.click === 'function') node.click();
      });
  }

  return readState(container, context);
}

export function isCrawlScrollAtBottom(state, tolerance = 2) {
  if (!state) return false;
  return state.scrollTop + state.clientHeight >= state.scrollHeight - tolerance;
}

export function isCrawlScrollStuck(previousState, nextState) {
  if (!previousState || !nextState) return false;
  return previousState.scrollTop === nextState.scrollTop
    && previousState.scrollHeight === nextState.scrollHeight;
}

export function shouldStopCrawlScrollEarly({
  infiniteEnabled = false,
  atBottom = false,
  didNotMove = false,
} = {}) {
  if (infiniteEnabled) return false;
  return atBottom && didNotMove;
}

export function resolveCrawlScrollContext(targetUrl = '') {
  const url = String(targetUrl || '').trim();
  if (/\/posts\/\d+/i.test(url)) return 'comments';
  if (/\/groups\//i.test(url)) return 'feed';
  return 'auto';
}

/**
 * Resolve scroll loop timing for batch scroll -> settle -> repeat.
 */
export function resolveCrawlScrollLoopConfig(crawlMeta = {}, scrollContext = 'feed') {
  const autoscroll = crawlMeta.autoscroll || {};
  const infinite = crawlMeta.infinity_scroll || {};
  const infiniteEnabled = Boolean(infinite.enabled);
  const scrollDistance = Math.max(100, Number(autoscroll.distance_px) || 600);
  const configuredDelay = Math.max(100, Number(autoscroll.delay_ms) || 500);
  const context = scrollContext === 'auto' ? 'feed' : scrollContext;

  const scrollsPerBatch = context === 'comments' ? 8 : 3;
  const betweenScrollMs = Math.min(configuredDelay, 350);
  const settleMs = infiniteEnabled
    ? Math.max(3000, Number(infinite.settle_ms) || 4000)
    : Math.max(configuredDelay * 2, 1500);

  const defaultMaxScrolls = context === 'comments' ? 120 : 200;
  const minMaxScrolls = context === 'feed' ? 200 : 1;
  const maxScrollCap = context === 'feed' ? 600 : 300;
  const configuredMaxScrolls = Number(infinite.max_scrolls) || defaultMaxScrolls;
  const maxScrolls = infiniteEnabled
    ? Math.max(minMaxScrolls, Math.min(maxScrollCap, configuredMaxScrolls))
    : (context === 'comments' ? 50 : 5);
  const maxBatches = Math.ceil(maxScrolls / scrollsPerBatch);
  const defaultTimeoutMs = context === 'comments' ? 180000 : 600000;
  const minTimeoutMs = context === 'feed' ? 600000 : 1000;
  const timeoutMs = Math.max(minTimeoutMs, Number(infinite.timeout_ms) || defaultTimeoutMs);
  const minBatchesBeforeConditionStop = context === 'feed' ? 3 : 1;

  return {
    scrollDistance,
    scrollsPerBatch,
    betweenScrollMs,
    settleMs,
    maxScrolls,
    maxBatches,
    timeoutMs,
    infiniteEnabled,
    initialDelayMs: configuredDelay,
    minBatchesBeforeConditionStop,
  };
}
