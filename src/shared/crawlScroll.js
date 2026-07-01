/**
 * Self-contained scroll helpers for crawl / request-catching.
 * Single exported functions are safe for page.evaluate / executeJavaScript.
 */

export function runCrawlScrollStep(distance = 600, mode = 'scroll') {
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

  function findFacebookCommentScrollContainer() {
    const selectors = [
      '[data-pagelet*="Comments"]',
      '[aria-label*="Comment" i]',
      '[aria-label*="Bình luận"]',
      '[aria-label*="binh luan" i]',
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

  function findCrawlScrollContainer() {
    const commentContainer = findFacebookCommentScrollContainer();
    if (commentContainer) return commentContainer;

    const modalRoots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
      .filter((node) => isVisibleElement(node));

    for (const modal of modalRoots) {
      const nested = findBestScrollContainer(modal);
      if (nested) return nested;
      if (isScrollableElement(modal) && isVisibleElement(modal)) return modal;
    }

    return findBestScrollContainer(null);
  }

  function readState(container) {
    if (container) {
      return {
        mode: 'element',
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
      };
    }

    const root = document.scrollingElement || document.documentElement;
    return {
      mode: 'window',
      scrollTop: window.scrollY || root.scrollTop || 0,
      clientHeight: window.innerHeight || root.clientHeight || 0,
      scrollHeight: root.scrollHeight || document.body.scrollHeight || 0,
    };
  }

  const container = findCrawlScrollContainer();
  if (mode === 'reset') {
    if (container) container.scrollTop = 0;
    window.scrollTo(0, 0);
    return readState(container);
  }

  const amount = Math.max(0, Number(distance) || 0);
  if (container) container.scrollTop += amount;
  window.scrollBy(0, amount);

  return readState(container);
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
