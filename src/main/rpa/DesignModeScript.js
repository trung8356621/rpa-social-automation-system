import { Buffer } from 'node:buffer';
import { getElementAnchorHelpersScript } from './ElementAnchorScript.js';
import { getCardExtractorScript } from './CardExtractorScript.js';

export function slimAnchorForPage(anchor = null) {
  if (!anchor) return null;
  return {
    parent_container_selector: String(anchor.parent_container_selector || ''),
    selector_value: String(anchor.selector_value || ''),
    field_selector: String(anchor.field_selector || ''),
    card_class: String(anchor.card_class || ''),
    action_config: {
      selector_mode: anchor.action_config?.selector_mode === 'single' ? 'single' : 'multiple',
    },
  };
}

export function buildEncodedPageCall(functionName, payload, failureError = 'page_call_failed') {
  const encoded = Buffer.from(JSON.stringify(payload ?? null), 'utf8').toString('base64');
  return `(function(){try{var p=JSON.parse(atob('${encoded}'));var fn=window['${functionName}'];if(typeof fn!=='function'){return{error:'design_script_not_ready'};}return fn(p);}catch(e){return{error:'${failureError}',message:e&&e.message?e.message:String(e)};}})()`;
}

/**
 * Returns a function body to inject into BrowserView pages for crawl design mode.
 */
export function getDesignModeInjectionScript() {
  const helpers = getElementAnchorHelpersScript();
  const cardExtractor = getCardExtractorScript();

  return `
    (function installRpaDesignMode() {
      if (window.__rpaDesignModeInstalled && typeof window.__rpaDesignSetActive === 'function') {
        return;
      }
      window.__rpaDesignModeInstalled = true;
      window.__rpaDesignModeActive = false;

      ${helpers}

      ${cardExtractor}

      let overlay = null;
      let tooltip = null;
      let selectionOverlay = null;
      let selectionTooltip = null;
      let selectionOverlays = [];
      let parentAnchor = null;
      let pinnedElement = null;
      let pinnedElements = [];
      let pinnedListenersBound = false;

      function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = '__rpa-design-overlay';
        overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #635bff;background:rgba(99,91,255,0.12);box-sizing:border-box;display:none;';
        document.documentElement.appendChild(overlay);

        tooltip = document.createElement('div');
        tooltip.id = '__rpa-design-tooltip';
        tooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#1b1b1f;color:#dce5f2;font:11px/1.3 sans-serif;padding:4px 8px;border-radius:4px;border:1px solid #635bff;display:none;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        document.documentElement.appendChild(tooltip);

        selectionOverlay = document.createElement('div');
        selectionOverlay.id = '__rpa-design-selection-overlay';
        selectionOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #22c55e;background:rgba(34,197,94,0.14);box-sizing:border-box;display:none;';
        document.documentElement.appendChild(selectionOverlay);

        selectionTooltip = document.createElement('div');
        selectionTooltip.id = '__rpa-design-selection-tooltip';
        selectionTooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#14261a;color:#d7f5df;font:11px/1.3 sans-serif;padding:4px 8px;border-radius:4px;border:1px solid #22c55e;display:none;max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        document.documentElement.appendChild(selectionTooltip);
      }

      function hideOverlay() {
        if (overlay) overlay.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
      }

      function hideSelectionOverlay() {
        if (selectionOverlay) selectionOverlay.style.display = 'none';
        if (selectionTooltip) selectionTooltip.style.display = 'none';
        selectionOverlays.forEach(function(item) {
          if (item.overlay) item.overlay.style.display = 'none';
          if (item.tooltip) item.tooltip.style.display = 'none';
        });
      }

      function getSelectionOverlayPair(index) {
        ensureOverlay();
        if (selectionOverlays[index]) return selectionOverlays[index];

        const multiOverlay = document.createElement('div');
        multiOverlay.id = '__rpa-design-selection-overlay-' + index;
        multiOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;border:2px solid #22c55e;background:rgba(34,197,94,0.10);box-sizing:border-box;display:none;';
        document.documentElement.appendChild(multiOverlay);

        const multiTooltip = document.createElement('div');
        multiTooltip.id = '__rpa-design-selection-tooltip-' + index;
        multiTooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;background:#14261a;color:#d7f5df;font:11px/1.3 sans-serif;padding:3px 6px;border-radius:4px;border:1px solid #22c55e;display:none;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        document.documentElement.appendChild(multiTooltip);

        selectionOverlays[index] = { overlay: multiOverlay, tooltip: multiTooltip };
        return selectionOverlays[index];
      }

      function positionOverlayForElement(element, overlayEl, tooltipEl, label, borderColor) {
        if (!element || !element.getBoundingClientRect) {
          if (overlayEl) overlayEl.style.display = 'none';
          if (tooltipEl) tooltipEl.style.display = 'none';
          return;
        }
        ensureOverlay();
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          if (overlayEl) overlayEl.style.display = 'none';
          if (tooltipEl) tooltipEl.style.display = 'none';
          return;
        }
        overlayEl.style.display = 'block';
        overlayEl.style.left = rect.left + 'px';
        overlayEl.style.top = rect.top + 'px';
        overlayEl.style.width = rect.width + 'px';
        overlayEl.style.height = rect.height + 'px';
        if (tooltipEl && label) {
          tooltipEl.textContent = label;
          tooltipEl.style.display = 'block';
          tooltipEl.style.left = Math.max(4, rect.left) + 'px';
          tooltipEl.style.top = Math.max(4, rect.top - 24) + 'px';
        }
      }

      function updatePinnedSelectionOverlay() {
        if (pinnedElements.length) {
          if (selectionOverlay) selectionOverlay.style.display = 'none';
          if (selectionTooltip) selectionTooltip.style.display = 'none';
          pinnedElements.slice(0, 30).forEach(function(element, index) {
            const pair = getSelectionOverlayPair(index);
            const label = ((element.tagName || 'element').toLowerCase())
              + ' · ' + (index + 1) + '/' + pinnedSelectionMatchCount;
            positionOverlayForElement(element, pair.overlay, pair.tooltip, label);
          });
          selectionOverlays.slice(pinnedElements.length).forEach(function(pair) {
            if (pair.overlay) pair.overlay.style.display = 'none';
            if (pair.tooltip) pair.tooltip.style.display = 'none';
          });
          return;
        }

        if (!pinnedElement) {
          hideSelectionOverlay();
          return;
        }
        const label = (pinnedElement.tagName || 'element').toLowerCase()
          + (pinnedSelectionMatchCount > 1 ? ' · 1/' + pinnedSelectionMatchCount : '');
        positionOverlayForElement(pinnedElement, selectionOverlay, selectionTooltip, label);
      }

      let pinnedSelectionMatchCount = 1;

      function bindPinnedListeners() {
        if (pinnedListenersBound) return;
        pinnedListenersBound = true;
        window.addEventListener('scroll', updatePinnedSelectionOverlay, true);
        window.addEventListener('resize', updatePinnedSelectionOverlay);
      }

      function unpinSelectionHighlight() {
        pinnedElement = null;
        pinnedElements = [];
        pinnedSelectionMatchCount = 1;
        hideSelectionOverlay();
      }

      function resolveHighlightElements(anchor) {
        const selector = anchor && (anchor.parent_container_selector || anchor.selector_value || anchor.field_selector);
        if (!selector) return [];
        try {
          return Array.from(document.querySelectorAll(selector))
            .filter(function(element) {
              if (!element || !element.getBoundingClientRect) return false;
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
        } catch (_) {
          return [];
        }
      }

      function showOverlayForElement(element, pickKind) {
        if (!window.__rpaDesignModeActive || !element || !element.getBoundingClientRect) {
          hideOverlay();
          return;
        }

        const isRoot = !pickKind || pickKind === 'root';
        const highlightElement = isRoot ? findCardContainer(element) : element;
        const selector = buildClassSelector(highlightElement, isRoot ? 2 : 1);
        const matchCount = countSelectorMatches(selector);
        const tag = (highlightElement.tagName || 'element').toLowerCase();
        const label = tag
          + (selector ? ' · ' + selector : '')
          + (matchCount > 1 ? ' · ' + matchCount + ' cards' : '');

        positionOverlayForElement(highlightElement, overlay, tooltip, label);
      }

      window.__rpaDesignHighlightAnchor = function(anchor) {
        ensureOverlay();
        bindPinnedListeners();
        if (!anchor) {
          unpinSelectionHighlight();
          return { found: false, matchCount: 0 };
        }
        const selectorMode = anchor.action_config && anchor.action_config.selector_mode === 'single' ? 'single' : 'multiple';
        pinnedSelectionMatchCount = countAnchorMatches(anchor);
        if (selectorMode === 'multiple') {
          const elements = resolveHighlightElements(anchor);
          if (elements.length) {
            pinnedElement = null;
            pinnedElements = elements.slice(0, 30);
            try {
              pinnedElements[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } catch (_) {}
            updatePinnedSelectionOverlay();
            return { found: true, matchCount: pinnedSelectionMatchCount, highlightedCount: pinnedElements.length };
          }
        }

        const element = resolveBestElementFromAnchor(anchor, pinnedElement);
        if (!element) {
          unpinSelectionHighlight();
          return { found: false, matchCount: pinnedSelectionMatchCount };
        }
        pinnedElement = element;
        pinnedElements = [];
        try {
          element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch (_) {}
        updatePinnedSelectionOverlay();
        return { found: true, matchCount: pinnedSelectionMatchCount };
      };

      window.__rpaDesignClearHighlight = function() {
        unpinSelectionHighlight();
        hideOverlay();
        return { cleared: true };
      };

      window.__rpaDesignPromoteToParent = function(anchor) {
        try {
          const currentSelector = (anchor && (anchor.parent_container_selector || anchor.selector_value)) || '';
          if (!currentSelector) {
            return { error: 'no_selector' };
          }

          const element = resolveBestElementFromAnchor(anchor, pinnedElement);
          if (!element) {
            return { error: 'not_found' };
          }

          const parentEl = element.parentElement;
          if (!parentEl || parentEl === document.body || parentEl === document.documentElement) {
            return { error: 'at_root' };
          }

          const parentSelector = buildClassSelector(parentEl, 1) || parentEl.tagName.toLowerCase();
          const matchCount = countSelectorMatches(parentSelector);
          const cardClasses = getStableClassNames(parentEl);
          const baseAnchor = getAnchor(parentEl) || {};

          pinnedElement = parentEl;
          pinnedSelectionMatchCount = matchCount;
          bindPinnedListeners();
          updatePinnedSelectionOverlay();
          try {
            parentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } catch (_) {}

          let sampleDump = [];
          try {
            sampleDump = [{
              card_index: 0,
              html: parentEl.outerHTML || '',
            }];
          } catch (_) {
            sampleDump = [];
          }

          return {
            parent_container_selector: parentSelector,
            selector_value: parentSelector,
            card_class: getPrimaryMiniClass(parentEl),
            match_count: matchCount,
            sample_dump: sampleDump,
            widget_type: 'parent',
            target_anchor: Object.assign({}, baseAnchor, {
              selector_value: parentSelector,
              parent_container_selector: parentSelector,
              card_class: getPrimaryMiniClass(parentEl),
              classList: cardClasses,
              xpath: '',
            }),
          };
        } catch (err) {
          return {
            error: 'promote_failed',
            message: err && err.message ? err.message : String(err),
          };
        }
      };

      function sendPick(payload) {
        if (window.__rpaDesign && typeof window.__rpaDesign.sendPick === 'function') {
          window.__rpaDesign.sendPick(payload);
        }
      }

      function getPickKind(event) {
        return 'root';
      }

      document.addEventListener('mousemove', (event) => {
        if (!window.__rpaDesignModeActive) return;
        let target = event.target;
        if (target === overlay || target === tooltip) return;
        if (target?.closest?.('#__rpa-design-overlay, #__rpa-design-tooltip, #__rpa-design-selection-overlay, #__rpa-design-selection-tooltip')) return;
        while (target && target.nodeType !== Node.ELEMENT_NODE) {
          target = target.parentElement;
        }
        if (!target || target === document.documentElement || target === document.body) {
          hideOverlay();
          return;
        }
        const pickKind = getPickKind(event);
        showOverlayForElement(target, pickKind);
      }, true);

      document.addEventListener('click', (event) => {
        if (!window.__rpaDesignModeActive) return;

        let target = event.target;
        while (target && target.nodeType !== Node.ELEMENT_NODE) {
          target = target.parentElement;
        }
        if (!target || target?.closest?.('#__rpa-design-overlay, #__rpa-design-tooltip')) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const pickKind = getPickKind(event);
        const pickPayload = buildCardPickPayload(target, pickKind);
        sendPick(Object.assign(pickPayload, {
          relative_coords: {
            x: Number(((event.clientX / window.innerWidth) * 100).toFixed(4)),
            y: Number(((event.clientY / window.innerHeight) * 100).toFixed(4)),
          },
        }));
      }, true);

      window.__rpaDesignSetActive = function(active) {
        window.__rpaDesignModeActive = Boolean(active);
        if (!window.__rpaDesignModeActive) hideOverlay();
        document.documentElement.style.cursor = window.__rpaDesignModeActive ? 'crosshair' : '';
      };

      window.__rpaDesignSetParentAnchor = function(anchor) {
        window.__rpaDesignParentAnchor = anchor || null;
      };
    })();
  `;
}

export function getPromoteToParentScript(anchor = null) {
  return buildEncodedPageCall('__rpaDesignPromoteToParent', slimAnchorForPage(anchor), 'promote_failed');
}

export function getHighlightAnchorScript(anchor = null) {
  return buildEncodedPageCall('__rpaDesignHighlightAnchor', slimAnchorForPage(anchor), 'highlight_failed');
}

export function getClearHighlightScript() {
  return `
    (function() {
      if (typeof window.__rpaDesignClearHighlight === 'function') {
        return window.__rpaDesignClearHighlight();
      }
      return { cleared: false };
    })();
  `;
}

export function getDesignModeDeactivateScript() {
  return `
    if (typeof window.__rpaDesignSetActive === 'function') {
      window.__rpaDesignSetActive(false);
    } else {
      window.__rpaDesignModeActive = false;
    }
  `;
}

export function getDesignModeActivateScript(parentAnchor = null) {
  const parentJson = JSON.stringify(parentAnchor || null);
  return `
    if (typeof window.__rpaDesignSetActive === 'function') {
      window.__rpaDesignSetParentAnchor(${parentJson});
      window.__rpaDesignSetActive(true);
    } else {
      window.__rpaDesignModeActive = true;
      window.__rpaDesignParentAnchor = ${parentJson};
    }
  `;
}
