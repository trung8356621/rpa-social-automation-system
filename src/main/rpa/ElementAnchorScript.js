/**
 * Shared DOM anchor helpers injected into browser pages (Puppeteer + BrowserView).
 * Returns a string of function declarations to embed in page scripts.
 */
export function getElementAnchorHelpersScript() {
  return `
    function buildXpath(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
      if (element.id) return '//*[@id="' + element.id + '"]';

      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tagName = current.tagName.toLowerCase();
        const siblings = Array.from(current.parentNode?.children || []).filter(
          (item) => item.tagName === current.tagName,
        );
        const index = siblings.indexOf(current) + 1;
        parts.unshift(tagName + (siblings.length > 1 ? '[' + index + ']' : ''));
        current = current.parentElement;
      }
      return parts.length ? '//' + parts.join('/') : '';
    }

    function stableClasses(element) {
      return Array.from(element.classList || [])
        .filter(function(className) {
          if (!className || className.length < 2) return false;
          if (/^(p|m|w|h|flex|grid|text|bg|border|rounded|items|justify|gap|px|py|mx|my|mt|mb|ml|mr)-/.test(className)) return false;
          return true;
        })
        .sort(function(a, b) { return b.length - a.length; })
        .slice(0, 5);
    }

    function buildClassSelectorFromAnchor(anchor) {
      if (!anchor) return '';
      if (anchor.parent_container_selector) return anchor.parent_container_selector;
      if (anchor.card_class_selector) return anchor.card_class_selector;
      if (anchor.field_selector) return anchor.field_selector;

      const tag = anchor.tagName || 'div';
      const classes = anchor.classList || [];
      if (classes.length) {
        return tag + '.' + classes.map(function(c) {
          return String(c).replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
        }).join('.');
      }
      if (anchor.card_class) {
        return tag + '.' + String(anchor.card_class).replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
      }
      return '';
    }

    function getAnchor(element) {
      if (!element || !element.tagName) return {};

      const text = (element.innerText || element.value || '').trim().slice(0, 160);
      const rect = element.getBoundingClientRect();

      return {
        id: element.id || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        placeholder: element.getAttribute('placeholder') || '',
        role: element.getAttribute('role') || '',
        name: element.getAttribute('name') || '',
        title: element.getAttribute('title') || '',
        testId: element.getAttribute('data-testid') || '',
        tagName: element.tagName.toLowerCase(),
        type: element.getAttribute('type') || '',
        innerText: text,
        contentEditable: Boolean(element.isContentEditable),
        classList: stableClasses(element),
        card_class: stableClasses(element)[0] || '',
        xpath: '',
        element_box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      };
    }

    function pickSelector(anchor) {
      if (!anchor) return '';
      if (anchor.parent_container_selector) return anchor.parent_container_selector;
      if (anchor.selector_value) return anchor.selector_value;
      if (anchor.id) return '#' + anchor.id;
      if (anchor.testId) return '[data-testid="' + anchor.testId + '"]';
      if (anchor.name) return '[name="' + anchor.name + '"]';
      if (anchor.ariaLabel) return '[aria-label="' + anchor.ariaLabel + '"]';
      if (anchor.placeholder) return '[placeholder="' + anchor.placeholder + '"]';
      const classSelector = buildClassSelectorFromAnchor(anchor);
      if (classSelector) return classSelector;
      return anchor.xpath || '';
    }

    function resolveElementFromXPath(xpath) {
      if (!xpath) return null;
      try {
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        return result.singleNodeValue || null;
      } catch (_) {
        return null;
      }
    }

    function resolveElementFromCssSelector(selector) {
      if (!selector) return null;
      try {
        return document.querySelector(selector) || null;
      } catch (_) {
        return null;
      }
    }

    function resolveElementFromAnchor(anchor) {
      if (!anchor) return null;

      if (anchor.parent_container_selector) {
        const parentMatch = resolveElementFromCssSelector(anchor.parent_container_selector);
        if (parentMatch) return parentMatch;
      }

      const explicitSelector = String(anchor.selector_value || anchor.field_selector || '').trim();
      if (explicitSelector) {
        if (explicitSelector.charAt(0) === '/' || explicitSelector.startsWith('(')) {
          const xpathMatch = resolveElementFromXPath(explicitSelector);
          if (xpathMatch) return xpathMatch;
        } else {
          const cssMatch = resolveElementFromCssSelector(explicitSelector);
          if (cssMatch) return cssMatch;
        }
      }

      const selector = pickSelector(anchor);
      if (selector && selector.charAt(0) !== '/') {
        const cssMatch = resolveElementFromCssSelector(selector);
        if (cssMatch) return cssMatch;
      }

      return resolveElementFromXPath(anchor.xpath);
    }

    function countAnchorMatches(anchor) {
      if (!anchor) return 0;

      if (anchor.parent_container_selector) {
        try {
          return document.querySelectorAll(anchor.parent_container_selector).length;
        } catch (_) {}
      }

      const explicitSelector = String(anchor.selector_value || anchor.field_selector || '').trim();
      if (explicitSelector) {
        if (explicitSelector.charAt(0) === '/' || explicitSelector.startsWith('(')) {
          try {
            const snapshot = document.evaluate(
              explicitSelector,
              document,
              null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
              null,
            );
            return snapshot.snapshotLength || 0;
          } catch (_) {}
        } else {
          try {
            return document.querySelectorAll(explicitSelector).length;
          } catch (_) {}
        }
      }

      const selector = pickSelector(anchor);
      if (selector && selector.charAt(0) !== '/') {
        try {
          return document.querySelectorAll(selector).length;
        } catch (_) {}
      }

      if (anchor.xpath) {
        try {
          const snapshot = document.evaluate(
            anchor.xpath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          return snapshot.snapshotLength || 0;
        } catch (_) {}
      }

      return resolveElementFromAnchor(anchor) ? 1 : 0;
    }
  `;
}
