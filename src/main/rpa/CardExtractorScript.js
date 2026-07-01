import { Buffer } from 'node:buffer';
import { getElementAnchorHelpersScript } from './ElementAnchorScript.js';

/**
 * Class-based card container detection and DOM subtree JSON extraction.
 * Injected into BrowserView pages for crawl design mode (WebScraper-style).
 */
export function getCardExtractorScript() {
  return `
    function escapeCssClass(name) {
      return String(name || '').replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
    }

    function isUtilityClass(className) {
      return /^(p|m|w|h|flex|grid|text|bg|border|rounded|items|justify|gap|px|py|mx|my|mt|mb|ml|mr|space|font|leading|tracking|opacity|z|top|left|right|bottom|min|max|overflow|absolute|relative|fixed|sticky|block|inline|hidden|visible|cursor|select|pointer|shadow|ring|transition|transform|scale|rotate|translate|skew|aspect|object|fill|stroke|decoration|underline|line|truncate|whitespace|break|align|content|self|place|order|grow|shrink|basis|col|row|auto|snap|scroll|touch|will|from|via|to|duration|delay|ease|animate|backdrop|blur|brightness|contrast|drop|grayscale|hue|invert|saturate|sepia|filter|backdrop|divide|container|prose|sr-only|not|group|peer|first|last|odd|even|only|visited|hover|focus|active|disabled|checked|indeterminate|default|required|valid|invalid|in|out|within|before|after|placeholder|file|marker|selection|target|open|motion|reduce|print|screen|dark|light|sm|md|lg|xl|2xl|3xl)-/.test(className);
    }

    function isStableClass(className) {
      if (!className || className.length < 2) return false;
      if (isUtilityClass(className)) return false;
      if (/^(clearfix|hidden|show|active|open|closed|selected|disabled|enabled)$/i.test(className)) return false;
      return true;
    }

    function getStableClassNames(element) {
      if (!element?.classList) return [];
      return Array.from(element.classList).filter(isStableClass);
    }

    function getPrimaryMiniClass(element) {
      const classes = getStableClassNames(element);
      if (!classes.length) return '';
      return classes.sort(function(a, b) { return b.length - a.length; })[0];
    }

    function buildClassSelector(element, maxClasses) {
      if (!element?.tagName) return '';
      const tag = element.tagName.toLowerCase();
      const id = element.id;
      if (id) return tag + '#' + escapeCssClass(id);

      const testId = element.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';

      const role = element.getAttribute('role');
      const ariaLabel = element.getAttribute('aria-label');
      if (role && ariaLabel) {
        return tag + '[role="' + role.replace(/"/g, '\\\\"') + '"][aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
      }

      const classes = getStableClassNames(element).sort(function(a, b) { return b.length - a.length; });
      if (!classes.length) {
        if (role) return tag + '[role="' + role.replace(/"/g, '\\\\"') + '"]';
        return tag;
      }

      const limit = maxClasses || 2;
      for (let i = 1; i <= Math.min(classes.length, limit); i++) {
        const selector = tag + '.' + classes.slice(0, i).map(escapeCssClass).join('.');
        try {
          const count = document.querySelectorAll(selector).length;
          if (count >= 1 && count <= 200) return selector;
        } catch (_) {}
      }

      return tag + '.' + escapeCssClass(classes[0]);
    }

    function countSelectorMatches(selector) {
      if (!selector) return 0;
      try {
        return document.querySelectorAll(selector).length;
      } catch (_) {
        return 0;
      }
    }

    function scoreCardCandidate(element) {
      if (!element || element === document.body || element === document.documentElement) return -999;

      let score = 0;
      const rect = element.getBoundingClientRect();
      if (rect.height < 60 || rect.width < 120) score -= 8;
      if (rect.height > window.innerHeight * 0.92) score -= 12;
      if (rect.width < window.innerWidth * 0.25) score -= 4;

      const role = element.getAttribute('role');
      if (role === 'article' || role === 'listitem' || role === 'row') score += 24;
      if (element.getAttribute('data-pagelet')) score += 18;
      if (element.getAttribute('data-testid')) score += 12;

      const tag = element.tagName.toLowerCase();
      if (tag === 'article' || tag === 'li') score += 10;

      const classes = getStableClassNames(element);
      score += Math.min(classes.length * 4, 16);
      const longest = classes.sort(function(a, b) { return b.length - a.length; })[0];
      if (longest && longest.length >= 8) score += 12;

      const selector = buildClassSelector(element, 2);
      const matchCount = countSelectorMatches(selector);
      if (matchCount >= 2 && matchCount <= 120) score += Math.min(matchCount * 2, 30);
      if (matchCount === 1) score -= 2;
      if (matchCount > 120) score -= 6;

      return score;
    }

    function findCardContainer(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return element;

      let current = element;
      let best = element;
      let bestScore = scoreCardCandidate(element);

      while (current && current !== document.body && current !== document.documentElement) {
        const score = scoreCardCandidate(current);
        if (score > bestScore) {
          bestScore = score;
          best = current;
        }
        current = current.parentElement;
      }

      return best || element;
    }

    function getDirectTextContent(element) {
      if (!element) return '';
      let text = '';
      element.childNodes.forEach(function(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
        }
      });
      return text.replace(/\\s+/g, ' ').trim();
    }

    function compactEntry(fields) {
      const entry = {};
      Object.keys(fields).forEach(function(key) {
        const value = fields[key];
        if (value === null || value === undefined) return;
        if (typeof value === 'string' && !value.trim()) return;
        entry[key] = typeof value === 'string' ? value.trim() : value;
      });
      return entry;
    }

    function resolveAnchorHref(el) {
      if (!el) return '';
      const attrHref = el.getAttribute('href');
      if (attrHref != null && String(attrHref).trim()) {
        return String(attrHref).trim();
      }
      if (el.href) {
        return String(el.href).trim();
      }
      const dataHref = el.getAttribute('data-href')
        || el.getAttribute('data-url')
        || el.getAttribute('data-link');
      return dataHref ? String(dataHref).trim() : '';
    }

    function normalizeText(text) {
      return String(text || '').replace(/\\s+/g, ' ').trim();
    }

    function isVisuallyHiddenElement(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;

      // Thuộc tính HTML ẩn native: [hidden], aria-hidden, input[type=hidden]
      if (el.hasAttribute('hidden')) return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' && String(el.type || '').toLowerCase() === 'hidden') return true;

      let style;
      try {
        style = window.getComputedStyle(el);
      } catch (_) {
        return true;
      }

      // Cổng computed style: display/visibility/opacity = không nhìn thấy trên màn hình
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return true;
      }
      const opacity = parseFloat(style.opacity || '1');
      if (!Number.isFinite(opacity) || opacity <= 0) return true;

      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch (_) {
        return true;
      }

      // Cổng bounding box: phần tử không chiếm diện tích pixel nào
      if (rect.width === 0 && rect.height === 0) return true;

      // Cổng vị trí layout: bị đẩy hẳn ra ngoài viewport (sr-only, left:-9999px, tab ẩn...)
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const offScreenMargin = 200;
      if (rect.right <= -offScreenMargin || rect.bottom <= -offScreenMargin) return true;
      if (rect.left >= viewportWidth + offScreenMargin && rect.right >= viewportWidth + offScreenMargin) return true;
      if (rect.top >= viewportHeight + offScreenMargin && rect.bottom >= viewportHeight + offScreenMargin) return true;

      return false;
    }

    function hasDescriptiveAriaLabel(el) {
      const label = normalizeText(el.getAttribute('aria-label') || '');
      return label.length >= 4 && isMeaningfulText(label);
    }

    var EXTRACTOR_NOISE_TEXT = {
      vi: 1, en: 1, '—': 1, '–': 1, '-': 1, '|': 1, '/': 1,
      lưu: 1, hủy: 1, xem: 1, sửa: 1, 'chỉnh sửa': 1, 'sửa nhanh': 1, 'xóa tạm': 1, xóa: 1,
      edit: 1, 'quick edit': 1, trash: 1, view: 1, save: 1, cancel: 1, delete: 1, remove: 1,
    };

    function isMeaningfulText(text) {
      const normalized = normalizeText(text);
      if (normalized.length <= 1) return false;
      if (/^[\\u2014\\u2013\\-|/\\\\.,:;!?\\s]+$/u.test(normalized)) return false;
      if (EXTRACTOR_NOISE_TEXT[normalized.toLowerCase()]) return false;
      return true;
    }

    function matchesExtractorBlacklist(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
      // Ẩn trực quan -> bỏ qua toàn bộ subtree, không duyệt con
      if (isVisuallyHiddenElement(el)) return true;

      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;
      if (tag === 'button' && !hasDescriptiveAriaLabel(el)) return true;
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return true;

      try {
        if (el.matches('.row-actions, .toggle-row, .screen-reader-text, [class*="rank-math"], [class*="wpacu"]')) {
          return true;
        }
      } catch (_) {}

      return false;
    }

    function scoreTextCandidate(el, tag) {
      let score = 0;
      if (/^h[1-6]$/.test(tag)) score += 120 - (parseInt(tag.charAt(1), 10) || 0) * 5;
      if (tag === 'a') score += 30;
      if (tag === 'strong' || tag === 'b') score += 22;
      if (tag === 'td' || tag === 'th') score += 18;
      if (tag === 'p' || tag === 'li') score += 12;

      const cls = getPrimaryMiniClass(el).toLowerCase();
      if (/title|name|heading|post|author|excerpt|content|label|canonical|featured/.test(cls)) {
        score += 28;
      }
      if (tag === 'div' || tag === 'span') score += 2;
      score += Math.min(cls.length, 24);
      return score;
    }

    function isValidContentLink(href) {
      const raw = normalizeText(href);
      if (!raw) return false;

      const lower = raw.toLowerCase();
      if (lower === '#' || lower.startsWith('#')) return false;
      if (lower.startsWith('javascript:')) return false;

      if (/[?&]action=(edit|trash|delete|purge_cache|duplicate|inline-save)/i.test(lower)) return false;
      if (/post\\.php\\?post=\\d+/i.test(lower) && /action=edit/i.test(lower)) return false;

      if (/wp-admin\\/(?:load-scripts|load-styles|admin-ajax|async-upload|media-upload|plugins\\.php|update\\.php|edit\\.php|post\\.php|admin\\.php|upload\\.php)/i.test(lower)) {
        return false;
      }

      if (lower.startsWith('http://') || lower.startsWith('https://')) {
        if (/\\/wp-admin\\//i.test(lower)) return false;
        return true;
      }

      if (lower.startsWith('/')) {
        if (lower.startsWith('/wp-admin') || lower.startsWith('/wp-includes') || lower.startsWith('/wp-content/plugins')) {
          return false;
        }
        return true;
      }

      return false;
    }

    function resolveImageSrc(el) {
      if (!el) return '';
      const candidates = [
        el.getAttribute('src'),
        el.getAttribute('data-src'),
        el.getAttribute('data-lazy-src'),
        el.currentSrc,
        el.src,
      ];
      const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
      if (srcset) {
        candidates.push(String(srcset).split(',')[0].trim().split(' ')[0]);
      }
      for (let i = 0; i < candidates.length; i += 1) {
        const value = normalizeText(candidates[i]);
        if (value) return value;
      }
      return '';
    }

    function isValidImageSrc(src) {
      const normalized = normalizeText(src);
      if (!normalized) return false;

      const lower = normalized.toLowerCase();
      if (lower.startsWith('data:image/')) return false;
      if (!lower.startsWith('http://') && !lower.startsWith('https://')) return false;
      if (/pixel|tracking|spacer|blank\\.(gif|png)|1x1\\.(gif|png)/i.test(lower)) return false;
      if (/\\.(jpg|jpeg|png|webp|gif|avif)(\\?|#|$)/i.test(lower)) return true;
      if (/wp-content\\/uploads\\//i.test(lower)) return true;
      return false;
    }

    function dedupeTextCandidates(candidates, linkTexts) {
      const bestByText = new Map();
      candidates.forEach(function(candidate) {
        const key = candidate.text.toLowerCase();
        if (linkTexts.has(key)) return;
        const existing = bestByText.get(key);
        if (!existing || candidate.score > existing.score) {
          bestByText.set(key, candidate);
        }
      });
      return Array.from(bestByText.values());
    }

    function dedupeLinks(links) {
      const seen = new Set();
      const output = [];
      links.forEach(function(link) {
        const key = (link.href || '').toLowerCase() + '|' + (link.text || '').toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        output.push(link);
      });
      return output;
    }

    function dedupeImages(images) {
      const seen = new Set();
      const output = [];
      images.forEach(function(image) {
        const key = (image.src || '').toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        output.push(image);
      });
      return output;
    }

    function walkExtractTree(el, buckets) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
      // Parent ẩn / blacklist -> return ngay, không quét children
      if (matchesExtractorBlacklist(el)) return;

      const tag = el.tagName.toLowerCase();
      const cls = getPrimaryMiniClass(el);

      if (tag === 'a') {
        const href = resolveAnchorHref(el);
        const linkText = normalizeText(el.innerText || el.textContent || '').slice(0, 200);
        if (isValidContentLink(href)) {
          const linkEntry = compactEntry({
            class: cls,
            href: href,
            text: linkText,
          });
          if (linkEntry.href) {
            buckets.links.push(linkEntry);
            if (linkEntry.text) {
              buckets.linkTexts.add(linkEntry.text.toLowerCase());
            }
          }
        } else if (isMeaningfulText(linkText)) {
          buckets.textCandidates.push({
            tag: tag,
            class: cls,
            text: linkText,
            score: scoreTextCandidate(el, tag) + 15,
          });
        }
        return;
      }

      if (tag === 'img') {
        const src = resolveImageSrc(el);
        if (isValidImageSrc(src)) {
          const imageEntry = compactEntry({
            class: cls,
            src: src.slice(0, 500),
            alt: el.getAttribute('alt'),
          });
          if (imageEntry.src) {
            buckets.images.push(imageEntry);
          }
        }
        return;
      }

      const directText = getDirectTextContent(el);
      if (isMeaningfulText(directText)) {
        buckets.textCandidates.push({
          tag: tag,
          class: cls,
          text: directText.slice(0, 400),
          score: scoreTextCandidate(el, tag),
        });
      }

      Array.from(el.children).forEach(function(child) {
        walkExtractTree(child, buckets);
      });
    }

    function extractDOMTreeToJSON(element) {
      const result = {
        raw_texts: [],
        raw_links: [],
        raw_images: [],
      };

      if (!element) return result;

      // Card gốc ẩn trên UI -> bỏ qua toàn bộ dump
      if (isVisuallyHiddenElement(element)) return result;

      const buckets = {
        textCandidates: [],
        links: [],
        images: [],
        linkTexts: new Set(),
      };

      walkExtractTree(element, buckets);

      const dedupedTexts = dedupeTextCandidates(buckets.textCandidates, buckets.linkTexts);
      result.raw_texts = dedupedTexts.map(function(candidate) {
        return compactEntry({
          tag: candidate.tag,
          class: candidate.class,
          text: candidate.text,
        });
      });
      result.raw_links = dedupeLinks(buckets.links);
      result.raw_images = dedupeImages(buckets.images);

      return result;
    }

    function resolveAllElementsFromAnchor(anchor) {
      if (!anchor) return [];
      const selector = anchor.parent_container_selector
        || anchor.selector_value
        || anchor.field_selector
        || pickSelector(anchor);
      if (!selector) return [];
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch (_) {
        return [];
      }
    }

    function resolveBestElementFromAnchor(anchor, preferredElement) {
      if (preferredElement && preferredElement.isConnected) {
        const preferredSelector = (anchor && (anchor.parent_container_selector || anchor.selector_value || anchor.field_selector)) || '';
        if (!preferredSelector) {
          return preferredElement;
        }
        try {
          if (typeof preferredElement.matches === 'function' && preferredElement.matches(preferredSelector)) {
            return preferredElement;
          }
        } catch (_) {}
      }

      const matches = resolveAllElementsFromAnchor(anchor);
      if (!matches.length) {
        return resolveElementFromAnchor(anchor);
      }
      if (matches.length === 1) {
        return matches[0];
      }

      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      let best = matches[0];
      let bestScore = Infinity;

      matches.forEach(function(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const dx = (rect.left + rect.width / 2) - centerX;
        const dy = (rect.top + rect.height / 2) - centerY;
        const score = (dx * dx) + (dy * dy);
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      });

      return best;
    }

    function buildSampleDumpForElement(element) {
      if (!element) return [];
      const extracted = extractDOMTreeToJSON(element);
      return [{
        card_index: 0,
        raw_texts: extracted.raw_texts.slice(0, 30),
        raw_links: extracted.raw_links.slice(0, 20),
        raw_images: extracted.raw_images.slice(0, 20),
      }];
    }

    function buildCardDataDump(parentSelector, maxCards) {
      const limit = maxCards || 5;
      if (!parentSelector) return [];

      let cards = [];
      try {
        cards = Array.from(document.querySelectorAll(parentSelector));
      } catch (_) {
        return [];
      }

      return cards
        .filter(function(card) { return !isVisuallyHiddenElement(card); })
        .slice(0, limit)
        .map(function(card, index) {
          const extracted = extractDOMTreeToJSON(card);
          return {
            card_index: index,
            raw_texts: extracted.raw_texts.slice(0, 30),
            raw_links: extracted.raw_links.slice(0, 20),
            raw_images: extracted.raw_images.slice(0, 20),
          };
        });
    }

    function resolveCardsByMode(parentSelector, selectorMode, maxCards) {
      const limit = maxCards || 5;
      if (!parentSelector) return [];

      try {
        if (selectorMode === 'single') {
          const card = document.querySelector(parentSelector);
          return card && !isVisuallyHiddenElement(card) ? [card] : [];
        }

        return Array.from(document.querySelectorAll(parentSelector))
          .filter(function(card) { return !isVisuallyHiddenElement(card); })
          .slice(0, limit);
      } catch (_) {
        return [];
      }
    }

    function resolvePatternElement(card, selector) {
      if (!card) return null;
      if (!selector) return card;
      try {
        return card.querySelector(selector);
      } catch (_) {
        return null;
      }
    }

    function extractAttributeValue(el, attributeName) {
      const attrName = normalizeText(attributeName);
      if (!el || !attrName) return '';
      if (attrName === 'text') return normalizeText(el.innerText || el.textContent || '');
      if (attrName === 'html') return el.outerHTML || el.innerHTML || '';
      if (attrName === 'href' && el.href) return String(el.href).trim();
      if (attrName === 'src' && el.src) return String(el.src).trim();
      const attrValue = el.getAttribute(attrName);
      return attrValue == null ? '' : String(attrValue).trim();
    }

    function extractPatternValue(card, pattern) {
      const el = resolvePatternElement(card, pattern && pattern.selector);
      if (!el) return '';

      if (Array.isArray(pattern && pattern.attributes) && pattern.attributes.length) {
        const output = {};
        pattern.attributes.forEach(function(attribute) {
          const attributeName = typeof attribute === 'string'
            ? attribute
            : (attribute && (attribute.name || attribute.attribute || attribute.key));
          const key = normalizeText(attributeName);
          const resultKey = typeof attribute === 'object' && attribute
            ? normalizeText(attribute.result_key)
            : '';
          if (!key) return;
          output[resultKey || key] = extractAttributeValue(el, key);
        });
        return output;
      }

      const legacyAttribute = (pattern && (pattern.attribute_name || pattern.attribute)) || '';
      const mode = (pattern && pattern.extract_mode) || 'text';
      return extractAttributeValue(el, legacyAttribute || mode);
    }

    function assignPatternValue(data, pattern, patternIndex, value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.keys(value).forEach(function(key) {
          if (!key) return;
          data[key] = value[key];
        });
        return;
      }

      const label = normalizeText(pattern && pattern.label) || ('field_' + (patternIndex + 1));
      data[label] = value;
    }

    function buildPatternDataDump(parentSelector, selectorMode, patterns, maxCards) {
      const cards = resolveCardsByMode(parentSelector, selectorMode, maxCards);
      const safePatterns = Array.isArray(patterns) ? patterns : [];

      return cards.map(function(card, index) {
        const data = {};
        const rect = card.getBoundingClientRect();
        safePatterns.forEach(function(pattern, patternIndex) {
          assignPatternValue(data, pattern, patternIndex, extractPatternValue(card, pattern));
        });
        return {
          card_index: index,
          page_y: Math.round((window.scrollY || window.pageYOffset || 0) + rect.top),
          data: data,
        };
      });
    }

    function buildFullHtmlDataDump(parentSelector, selectorMode, maxCards) {
      const cards = resolveCardsByMode(parentSelector, selectorMode, maxCards);

      return cards.map(function(card, index) {
        const rect = card.getBoundingClientRect();
        return {
          card_index: index,
          page_y: Math.round((window.scrollY || window.pageYOffset || 0) + rect.top),
          html: card.outerHTML || '',
        };
      });
    }

    function buildCardPickPayload(element, pickKind) {
      const isRoot = pickKind === 'root';
      const cardElement = isRoot ? findCardContainer(element) : element;
      const parentSelector = buildClassSelector(cardElement, isRoot ? 2 : 1);
      const matchCount = countSelectorMatches(parentSelector);
      const cardClasses = getStableClassNames(cardElement);
      const anchor = getAnchor(cardElement);

      const payload = {
        pickKind: pickKind,
        selector_value: parentSelector,
        parent_container_selector: isRoot ? parentSelector : '',
        card_class: getPrimaryMiniClass(cardElement),
        card_class_selector: parentSelector,
        match_count: matchCount,
        target_anchor: Object.assign({}, anchor, {
          selector_value: parentSelector,
          parent_container_selector: isRoot ? parentSelector : '',
          card_class: getPrimaryMiniClass(cardElement),
          classList: cardClasses,
          xpath: '',
        }),
      };

      if (isRoot) {
        payload.sample_dump = buildFullHtmlDataDump(parentSelector, 'multiple', 3);
        payload.widget_type = 'parent';
      } else {
        payload.field_selector = parentSelector;
        payload.target_anchor.field_selector = parentSelector;
        payload.target_anchor.xpath = '';
      }

      return payload;
    }
  `;
}

export function getCrawlExtractionScript(anchor = {}, maxCards = 100) {
  const encodedAnchor = Buffer.from(JSON.stringify(anchor || {}), 'utf8').toString('base64');
  const safeMaxCards = Math.max(1, Math.min(500, Math.round(Number(maxCards) || 100)));

  return `
    (function runRpaCrawlExtraction() {
      try {
        var anchor = JSON.parse(atob('${encodedAnchor}')) || {};
        ${getElementAnchorHelpersScript()}
        ${getCardExtractorScript()}

        var config = anchor.action_config || {};
        var selectorMode = config.selector_mode === 'single' ? 'single' : 'multiple';
        var resultMode = config.result_mode === 'patterns' ? 'patterns' : 'full_html';
        var selector = config.parent_container_selector
          || anchor.parent_container_selector
          || config.selector
          || anchor.selector_value
          || anchor.field_selector
          || '';
        var cards = [];
        var matchCount = 0;

        if (selector) {
          matchCount = countSelectorMatches(selector);
          if (resultMode === 'patterns') {
            cards = buildPatternDataDump(selector, selectorMode, config.result_patterns || [], ${safeMaxCards});
          } else {
            cards = buildFullHtmlDataDump(selector, selectorMode, ${safeMaxCards});
          }
          if (selectorMode === 'single') {
            matchCount = cards.length;
          }
        }

        if (!cards.length) {
          var fallbackElement = resolveBestElementFromAnchor(anchor, null) || resolveElementFromAnchor(anchor);
          matchCount = fallbackElement ? 1 : matchCount;
          if (resultMode === 'patterns') {
            cards = fallbackElement ? buildPatternDataDump(selector || '', 'single', config.result_patterns || [], 1) : [];
            if (!cards.length && fallbackElement) {
              var fallbackData = {};
              (config.result_patterns || []).forEach(function(pattern, patternIndex) {
                assignPatternValue(fallbackData, pattern, patternIndex, extractPatternValue(fallbackElement, pattern));
              });
              cards = [{ card_index: 0, data: fallbackData }];
            }
          } else {
            cards = fallbackElement ? [{ card_index: 0, html: fallbackElement.outerHTML || '' }] : buildSampleDumpForElement(fallbackElement);
          }
        }

        return {
          ok: true,
          selector: selector,
          match_count: matchCount,
          sample_dump: cards,
        };
      } catch (err) {
        return {
          ok: false,
          error: 'crawl_extract_failed',
          message: err && err.message ? err.message : String(err),
        };
      }
    })()
  `;
}
