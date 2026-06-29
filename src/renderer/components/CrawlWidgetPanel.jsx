import React, { useState } from 'react';
import { ArrowUpFromLine, MousePointer2, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  applyPromoteToParentToStep,
  describeCrawlSelector,
  getCrawlActionConfig,
  patchStepAnchor,
  updateCrawlStepConfig,
} from '../utils/crawlWidget';

function SelectorFields({ anchor, onChange, onPromoteToParent, promoting }) {
  const { t } = useTranslation();
  const selectorValue = anchor?.parent_container_selector || anchor?.selector_value || '';

  return (
    <div className="space-y-2 rounded border border-[#2a3144] bg-[#101217] p-2">
      <div className="flex items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-[10px] font-semibold text-[#b7c4d8]">
            {t('crawlWidget.parentCardSelector')}
          </span>
          <input
            value={selectorValue}
            onChange={(event) => onChange({
              parent_container_selector: event.target.value,
              selector_value: event.target.value,
              xpath: '',
            })}
            className="input-field h-8 font-mono text-[11px]"
            placeholder="div.x1abc123..."
          />
        </label>
        <button
          type="button"
          onClick={onPromoteToParent}
          disabled={promoting}
          title={t('crawlWidget.toParentHint')}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-[#3c465c] px-2 text-[10px] font-semibold text-[#c7d0dc] hover:bg-[#243047] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" />
          {t('crawlWidget.toParent')}
        </button>
      </div>
      {anchor?.card_class && (
        <p className="text-[10px] text-[#8b97aa]">
          {t('crawlWidget.primaryClass')}: <span className="font-mono text-[#c7d0dc]">{anchor.card_class}</span>
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-[#8b97aa]">{t('crawlWidget.parentSelectorHint')}</p>
    </div>
  );
}

function SampleDumpPreview({ sampleDump = [], matchCount = 0 }) {
  const { t } = useTranslation();
  if (!sampleDump?.length) return null;

  return (
    <div className="rounded border border-[#2a3144] bg-[#101217] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase text-[#7288ff]">{t('crawlWidget.sampleDump')}</p>
        {matchCount > 0 && (
          <span className="rounded bg-[#232838] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">
            {t('crawlWidget.matchCount', { count: matchCount })}
          </span>
        )}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-[#b7c4d8]">
        {JSON.stringify(sampleDump, null, 2)}
      </pre>
    </div>
  );
}

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
  const crawlSteps = steps.filter((step) => step.action_type === 'crawl');
  const selectedWidget = crawlSteps.find((step) => step.id === selectedWidgetId);
  const selectedConfig = selectedWidget ? getCrawlActionConfig(selectedWidget) : null;

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
          {!selectedWidget ? (
            <div className="rounded border border-[#2a3144] bg-[#101217] px-3 py-6 text-center text-xs text-[#8b97aa]">
              {t('crawlWidget.selectPrompt')}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('crawlWidget.label')}</span>
                <input
                  value={selectedConfig.label || ''}
                  onChange={(event) => handleWidgetPatch({ label: event.target.value })}
                  className="input-field h-9"
                />
              </label>

              <SelectorFields
                anchor={selectedWidget.target_anchor}
                onChange={handleWidgetAnchorPatch}
                onPromoteToParent={handlePromoteToParent}
                promoting={promoting}
              />

              <SampleDumpPreview
                sampleDump={selectedConfig.sample_dump}
                matchCount={selectedConfig.match_count}
              />

              <button
                type="button"
                onClick={() => onDeleteWidget(selectedWidget.id)}
                className="inline-flex items-center gap-1 rounded border border-[#4c2b35] px-2 py-1 text-[11px] text-[#ff8fa0] hover:bg-[#2f1b22]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('crawlWidget.deleteWidget')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
