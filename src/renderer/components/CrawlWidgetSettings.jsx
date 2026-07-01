import React, { useState } from 'react';
import { ArrowUpFromLine, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from '../i18n';

function createLocalId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function SelectorFields({ anchor, selectorMode, onModeChange, onChange, onPromoteToParent, promoting }) {
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

      <div>
        <span className="mb-1 block text-[10px] font-semibold text-[#b7c4d8]">{t('crawlWidget.selectorMode')}</span>
        <div className="grid grid-cols-2 overflow-hidden rounded border border-[#2a3144]">
          {['single', 'multiple'].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onModeChange(mode)}
              className={`h-8 text-[11px] font-semibold ${
                selectorMode === mode ? 'bg-[#243047] text-white' : 'bg-[#141923] text-[#8b97aa] hover:text-white'
              }`}
            >
              {t(`crawlWidget.${mode}`)}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[#8b97aa]">
          {selectorMode === 'single' ? t('crawlWidget.singleHint') : t('crawlWidget.multipleHint')}
        </p>
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

function ResultPatternTable({ patterns = [], onChange }) {
  const { t } = useTranslation();
  const [editingIndex, setEditingIndex] = useState(null);
  const [draft, setDraft] = useState(null);

  const normalizeAttribute = (attribute) => {
    if (typeof attribute === 'string') {
      return { name: attribute, result_key: '' };
    }
    return {
      name: attribute?.name || attribute?.attribute || attribute?.key || '',
      result_key: attribute?.result_key || '',
    };
  };

  const getAttributeName = (attribute) => (
    typeof attribute === 'string' ? attribute : attribute?.name
  );

  const openPatternModal = (pattern, index) => {
    setEditingIndex(index);
    setDraft({
      id: pattern.id || createLocalId(),
      label: pattern.label || '',
      selector: pattern.selector || '',
      attributes: Array.isArray(pattern.attributes) && pattern.attributes.length
        ? pattern.attributes.map(normalizeAttribute)
        : [{ name: 'text', result_key: '' }],
    });
  };

  const addPattern = () => {
    openPatternModal({
      id: createLocalId(),
      label: '',
      selector: '',
      attributes: [{ name: 'text', result_key: '' }],
    }, patterns.length);
  };

  const selectPattern = (value) => {
    if (value === '') {
      setEditingIndex(null);
      setDraft(null);
      return;
    }
    if (value === 'create') {
      addPattern();
      return;
    }
    const index = Number(value);
    if (Number.isInteger(index) && patterns[index]) {
      openPatternModal(patterns[index], index);
    }
  };

  const removePattern = (index) => {
    onChange(patterns.filter((_, itemIndex) => itemIndex !== index));
    if (editingIndex === index) {
      setEditingIndex(null);
      setDraft(null);
    }
  };

  const saveDraft = () => {
    const nextPattern = {
      ...draft,
      label: draft.label.trim() || `pattern_${editingIndex + 1}`,
      selector: draft.selector.trim(),
      attributes: draft.attributes
        .map((item) => ({
          name: item.name.trim(),
          result_key: item.result_key.trim(),
        }))
        .filter((item) => item.name),
    };
    const nextPatterns = editingIndex >= patterns.length
      ? [...patterns, nextPattern]
      : patterns.map((pattern, index) => (index === editingIndex ? nextPattern : pattern));
    onChange(nextPatterns);
    setEditingIndex(null);
    setDraft(null);
  };

  const updateAttribute = (index, patch) => {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, itemIndex) => (
        itemIndex === index ? { ...attribute, ...patch } : attribute
      )),
    }));
  };

  const addAttribute = () => {
    setDraft((current) => ({ ...current, attributes: [...current.attributes, { name: 'text', result_key: '' }] }));
  };

  const removeAttribute = (index) => {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  return (
    <div className="space-y-2 rounded border border-[#2a3144] bg-[#101217] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase text-[#7288ff]">{t('crawlWidget.resultPatterns')}</p>
        <button
          type="button"
          onClick={addPattern}
          className="inline-flex h-7 items-center gap-1 rounded border border-[#3c465c] px-2 text-[10px] font-semibold text-[#c7d0dc] hover:bg-[#243047]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('crawlWidget.addPattern')}
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold text-[#b7c4d8]">{t('crawlWidget.selectPattern')}</span>
        <select
          value={draft ? (editingIndex >= patterns.length ? 'create' : String(editingIndex)) : ''}
          onChange={(event) => selectPattern(event.target.value)}
          className="input-field h-8 text-[11px]"
        >
          <option value="">{t('crawlWidget.choosePattern')}</option>
          {patterns.map((pattern, index) => (
            <option key={pattern.id || index} value={index}>
              {pattern.label || t('crawlWidget.unnamedPattern')}
            </option>
          ))}
          <option value="create">{t('crawlWidget.createPattern')}</option>
        </select>
      </label>

      <div className="space-y-2">
        {patterns.map((pattern, index) => (
          <div key={pattern.id || index} className="grid grid-cols-[minmax(0,1fr)_28px] gap-1">
            <button
              type="button"
              onClick={() => openPatternModal(pattern, index)}
              className="min-w-0 rounded border border-[#2a3144] bg-[#151b27] px-2 py-2 text-left hover:bg-[#1c2433]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-white">{pattern.label || t('crawlWidget.unnamedPattern')}</span>
                <span className="shrink-0 rounded bg-[#232838] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">
                  {(pattern.attributes || []).length} attrs
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px] text-[#8b97aa]">
                {pattern.selector || t('crawlWidget.cardRoot')} - {(pattern.attributes || [])
                  .map(getAttributeName)
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </button>
            <button
              type="button"
              onClick={() => removePattern(index)}
              className="flex h-full min-h-10 items-center justify-center rounded border border-[#4c2b35] text-[#ff8fa0] hover:bg-[#2f1b22]"
              title={t('crawlWidget.removePattern')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {draft && (
        <div className="rounded border border-[#344054] bg-[#172033] p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{t('crawlWidget.patternModalTitle')}</h3>
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setDraft(null);
              }}
              className="icon-button h-8 w-8"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('crawlWidget.patternName')}</span>
              <input
                value={draft.label}
                onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                className="input-field h-9"
                placeholder="link"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('crawlWidget.subElement')}</span>
              <input
                value={draft.selector}
                onChange={(event) => setDraft((current) => ({ ...current, selector: event.target.value }))}
                className="input-field h-9 font-mono text-[12px]"
                placeholder="a"
              />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#b7c4d8]">{t('crawlWidget.attributesJson')}</span>
                <button
                  type="button"
                  onClick={addAttribute}
                  className="inline-flex h-7 items-center gap-1 rounded border border-[#3c465c] px-2 text-[10px] font-semibold text-[#c7d0dc] hover:bg-[#243047]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('crawlWidget.addAttribute')}
                </button>
              </div>
              {draft.attributes.map((attribute, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-1">
                  <input
                    value={attribute.name}
                    onChange={(event) => updateAttribute(index, { name: event.target.value })}
                    className="input-field h-8 font-mono text-[12px]"
                    placeholder="href | text | html"
                  />
                  <input
                    value={attribute.result_key}
                    onChange={(event) => updateAttribute(index, { result_key: event.target.value })}
                    className="input-field h-8 font-mono text-[12px]"
                    placeholder="result_key"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttribute(index)}
                    className="flex h-8 items-center justify-center rounded border border-[#4c2b35] text-[#ff8fa0] hover:bg-[#2f1b22]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <p className="text-[10px] leading-relaxed text-[#8b97aa]">{t('crawlWidget.specialAttributesHint')}</p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingIndex(null);
                setDraft(null);
              }}
              className="btn-secondary"
            >
              {t('crawlWidget.cancel')}
            </button>
            <button type="button" onClick={saveDraft} className="btn-primary">
              {t('crawlWidget.savePattern')}
            </button>
          </div>
        </div>
      )}
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

export default function CrawlWidgetSettings({
  selectedWidget,
  selectedConfig,
  onWidgetPatch,
  onWidgetAnchorPatch,
  onPromoteToParent,
  promoting,
  onDeleteWidget,
}) {
  const { t } = useTranslation();

  if (!selectedWidget) {
    return (
      <div className="rounded border border-[#2a3144] bg-[#101217] px-3 py-6 text-center text-xs text-[#8b97aa]">
        {t('crawlWidget.selectPrompt')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('crawlWidget.label')}</span>
        <input
          value={selectedConfig.label || ''}
          onChange={(event) => onWidgetPatch({ label: event.target.value })}
          className="input-field h-9"
        />
      </label>

      <SelectorFields
        anchor={selectedWidget.target_anchor}
        selectorMode={selectedConfig.selector_mode || 'multiple'}
        onModeChange={(selectorMode) => onWidgetPatch({ selector_mode: selectorMode })}
        onChange={onWidgetAnchorPatch}
        onPromoteToParent={onPromoteToParent}
        promoting={promoting}
      />

      <div className="space-y-2 rounded border border-[#2a3144] bg-[#101217] p-2">
        <span className="block text-[10px] font-semibold text-[#b7c4d8]">{t('crawlWidget.resultMode')}</span>
        <select
          value={selectedConfig.result_mode || 'full_html'}
          onChange={(event) => onWidgetPatch({ result_mode: event.target.value })}
          className="input-field h-8 text-[11px]"
        >
          <option value="full_html">{t('crawlWidget.fullHtml')}</option>
          <option value="patterns">{t('crawlWidget.patterns')}</option>
        </select>
      </div>

      {selectedConfig.result_mode === 'patterns' && (
        <ResultPatternTable
          patterns={selectedConfig.result_patterns}
          onChange={(resultPatterns) => onWidgetPatch({ result_patterns: resultPatterns })}
        />
      )}

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
  );
}
