import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import CrawlWidgetSettings from './CrawlWidgetSettings';
import {
  applyPromoteToParentToStep,
  describeCrawlSelector,
  getCrawlActionConfig,
  patchStepAnchor,
  updateCrawlStepConfig,
} from '../utils/crawlWidget';

export default function CrawlWidgetPanel({
  steps,
  selectedWidgetId,
  onSelectWidget,
  onUpdateSteps,
  onDeleteWidget,
  onToast,
}) {
  const { t } = useTranslation();
  const [promoting, setPromoting] = useState(false);
  const sampleRequestRef = useRef(0);
  const crawlSteps = steps.filter((step) => step.action_type === 'crawl');
  const selectedWidget = crawlSteps.find((step) => step.id === selectedWidgetId);
  const selectedConfig = selectedWidget ? getCrawlActionConfig(selectedWidget) : null;
  const liveSampleSignature = useMemo(() => {
    if (!selectedWidget || !selectedConfig) return '';
    return JSON.stringify({
      id: selectedWidget.id,
      selector: selectedConfig.parent_container_selector
        || selectedWidget.target_anchor?.parent_container_selector
        || selectedWidget.target_anchor?.selector_value
        || '',
      selectorMode: selectedConfig.selector_mode,
      resultMode: selectedConfig.result_mode,
      patterns: selectedConfig.result_patterns,
    });
  }, [selectedConfig, selectedWidget]);

  const handleWidgetPatch = (patch) => {
    if (!selectedWidget) return;
    const next = updateCrawlStepConfig(selectedWidget, patch);
    onUpdateSteps(steps.map((step) => (step.id === selectedWidget.id ? next : step)));
  };

  const handleWidgetAnchorPatch = (anchorPatch) => {
    if (!selectedWidget) return;
    const selector = anchorPatch.parent_container_selector ?? anchorPatch.selector_value;
    let next = patchStepAnchor(selectedWidget, anchorPatch);
    if (selector !== undefined) {
      next = updateCrawlStepConfig(next, { parent_container_selector: selector });
      next = patchStepAnchor(next, {
        parent_container_selector: selector,
        selector_value: selector,
      });
    }
    onUpdateSteps(steps.map((step) => (step.id === selectedWidget.id ? next : step)));
  };

  useEffect(() => {
    if (!selectedWidget || !selectedConfig || !window.electronAPI?.extractCrawlPreviewSample) return undefined;

    const selector = selectedConfig.parent_container_selector
      || selectedWidget.target_anchor?.parent_container_selector
      || selectedWidget.target_anchor?.selector_value
      || '';
    if (!selector) return undefined;

    const requestId = sampleRequestRef.current + 1;
    sampleRequestRef.current = requestId;
    const anchor = {
      ...(selectedWidget.target_anchor || {}),
      parent_container_selector: selector,
      selector_value: selector,
      action_config: {
        ...(selectedWidget.target_anchor?.action_config || {}),
        ...selectedConfig,
        parent_container_selector: selector,
      },
    };

    const timer = setTimeout(async () => {
      try {
        window.electronAPI?.highlightCrawlAnchor?.(anchor).catch(() => {});
        const result = await window.electronAPI.extractCrawlPreviewSample({ anchor, maxCards: 100 });
        if (sampleRequestRef.current !== requestId || !result?.ok) return;

        const cards = Array.isArray(result.sample_dump) ? result.sample_dump : [];
        const next = updateCrawlStepConfig(selectedWidget, {
          sample_dump: cards,
          match_count: Number(result.match_count) || 0,
        });
        onUpdateSteps(steps.map((step) => (step.id === selectedWidget.id ? next : step)), { skipUndo: true });
      } catch {
        // Live sample refresh should never block manual editing.
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [liveSampleSignature]);

  const handlePromoteToParent = async () => {
    if (!selectedWidget || !window.electronAPI?.promoteCrawlSelectorToParent) return;

    setPromoting(true);
    try {
      const anchor = selectedWidget.target_anchor || {};
      const result = await window.electronAPI.promoteCrawlSelectorToParent(anchor);
      if (result?.error) {
        const toastKey = {
          no_selector: 'crawlWidget.promoteNoSelector',
          not_found: 'crawlWidget.promoteNotFound',
          at_root: 'crawlWidget.promoteAtRoot',
          not_attached: 'crawlWidget.promoteNotAttached',
          design_script_not_ready: 'crawlWidget.promoteScriptNotReady',
          promote_failed: 'crawlWidget.promoteFailed',
        }[result.error];
        onToast?.({
          type: 'error',
          message: (result.error === 'promote_failed' && result.message)
            ? result.message
            : (toastKey ? t(toastKey) : (result.message || result.error)),
        });
        return;
      }

      const { step: nextStep, changed } = applyPromoteToParentToStep(selectedWidget, result);
      if (!changed) return;

      onUpdateSteps(steps.map((step) => (step.id === selectedWidget.id ? nextStep : step)));
      onToast?.({
        type: 'success',
        message: t('crawlWidget.promoteSuccess', { count: result.match_count || 0 }),
      });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('crawlWidget.promoteFailed') });
    } finally {
      setPromoting(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-[#2a2d34]">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
          <span className="inline-flex items-center gap-2">
            <MousePointer2 className="h-3.5 w-3.5" />
            {t('crawlWidget.listTitle')}
          </span>
          <span className="text-[#7e8da5]">{crawlSteps.length}</span>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {crawlSteps.length === 0 ? (
            <div className="rounded border border-[#2a3144] bg-[#101217] px-3 py-6 text-center text-xs text-[#8b97aa]">
              {t('crawlWidget.emptyHint')}
            </div>
          ) : (
            crawlSteps.map((step) => {
              const config = getCrawlActionConfig(step);
              const isSelected = step.id === selectedWidgetId;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onSelectWidget(step.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    isSelected ? 'border-[#635bff] bg-[#1e2140]' : 'border-[#2a3144] bg-[#171b26] hover:bg-[#1c2130]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-white">{config.label || t('crawlWidget.unnamed')}</span>
                    {config.match_count > 0 && (
                      <span className="shrink-0 rounded bg-[#1a2e1f] px-1.5 py-0.5 text-[10px] text-[#7ddea0]">
                        {config.match_count}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[10px] text-[#8b97aa]">{describeCrawlSelector(step)}</p>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-8 shrink-0 items-center border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
          {t('crawlWidget.settingsTitle')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <CrawlWidgetSettings
            selectedWidget={selectedWidget}
            selectedConfig={selectedConfig}
            onWidgetPatch={handleWidgetPatch}
            onWidgetAnchorPatch={handleWidgetAnchorPatch}
            onPromoteToParent={handlePromoteToParent}
            promoting={promoting}
            onDeleteWidget={onDeleteWidget}
          />
        </div>
      </div>
    </div>
  );
}
