import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FolderOpen,
  Info,
  KeyRound,
  Keyboard,
  ListPlus,
  PanelRightClose,
  PanelRightOpen,
  MousePointer2,
  Play,
  Plus,
  Save,
  Share2,
  SquareCode,
  Square,
  Timer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { setCurrentPage, showToast } from '../slices/uiSlice';
import { fetchScenarios } from '../slices/scenarioSlice';
import { useTranslation } from '../i18n/index.jsx';
import VariableInput from './VariableInput';
import ScenarioVariablesBar from './ScenarioVariablesBar';
import DataProfileSelect from './DataProfileSelect';
import { normalizeActionType } from '../utils/variables';

const DEFAULT_ACTION_DELAY_MS = 300;
const MAX_UNDO_STEPS = 20;

// ===== Helper Components =====

function IconOnly({ icon: Icon, label, ...props }) {
  return (
    <button type="button" className="icon-button h-9 w-9 text-[#9aa7b7]" title={label} {...props}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function PanelSectionHeader({ icon: Icon, title, trailing, onToggle, open }) {
  const TitleTag = onToggle ? 'button' : 'span';
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
      <TitleTag
        type={onToggle ? 'button' : undefined}
        onClick={onToggle}
        className={`inline-flex min-w-0 items-center gap-2 ${onToggle ? 'hover:text-white' : ''}`}
      >
        {onToggle && (
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition ${open ? 'rotate-90' : ''}`} />
        )}
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{title}</span>
      </TitleTag>
      {trailing && <div className="ml-2 shrink-0">{trailing}</div>}
    </div>
  );
}

const ACTION_BUTTON_KEYS = [
  { actionType: 'navigate', icon: ExternalLink, labelKey: 'scenarioEditor.actions.navigate' },
  { actionType: 'click', icon: MousePointer2, labelKey: 'scenarioEditor.actions.click' },
  { actionType: 'input', icon: Keyboard, labelKey: 'scenarioEditor.actions.input' },
  { actionType: 'wait', icon: Timer, labelKey: 'scenarioEditor.actions.wait' },
];

function ActionIconBar({ onAddStep }) {
  const { t } = useTranslation();
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-[#2a2d34] bg-[#15171d] py-2">
      {ACTION_BUTTON_KEYS.map(({ actionType, icon: ActionIcon, labelKey }) => (
        <button
          key={actionType}
          type="button"
          onClick={() => onAddStep(actionType)}
          className="flex h-9 w-9 items-center justify-center rounded text-[#9aa7b7] transition hover:bg-[#1c2130] hover:text-white"
          title={t(labelKey)}
        >
          <ActionIcon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function PanelTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#76849b]">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span>{children}</span>
    </div>
  );
}

function Field({ label, value, className = '' }) {
  return (
    <div className={`flex items-center gap-2 text-xs ${className}`}>
      <span className="w-16 shrink-0 text-[#76849b]">{label}</span>
      <span className="truncate text-white">{value || '\u2014'}</span>
    </div>
  );
}

// ===== Helper Functions =====

const defaultConfig = {
  navigate: { url: '' },
  click: { selector: '', skip_if_checked: false },
  input: { selector: '', text: '' },
  type: { selector: '', text: '' },
  wait: { duration: 2000 },
};

const defaultUrl = (platform) => {
  const urls = {
    facebook: 'https://www.facebook.com',
    google: 'https://www.google.com',
    instagram: 'https://www.instagram.com',
    tiktok: 'https://www.tiktok.com',
    twitter: 'https://www.twitter.com',
    linkedin: 'https://www.linkedin.com',
  };
  return urls[platform] || '';
};

function createStep(actionType, overrides = {}) {
  const now = Date.now();
  const normalizedType = normalizeActionType(actionType);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2, 9)}`,
    action_type: normalizedType,
    target_anchor: { action_config: defaultConfig[normalizedType] || defaultConfig[actionType] || {} },
    delay_ms: DEFAULT_ACTION_DELAY_MS,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function toDatabaseStep(step) {
  return {
    ...step,
    delay_ms: Number(step.delay_ms) || DEFAULT_ACTION_DELAY_MS,
    target_anchor: parseJsonObject(step.target_anchor),
  };
}

function normalizeSteps(steps) {
  if (!steps || !Array.isArray(steps)) return [];
  return steps.map((step, idx) => ({
    ...step,
    action_type: normalizeActionType(step.action_type),
    delay_ms: Number(step.delay_ms) || DEFAULT_ACTION_DELAY_MS,
    order: idx,
    target_anchor: parseJsonObject(step.target_anchor),
    action_config:
      parseJsonObject(step.target_anchor).action_config || {},
  }));
}

function createEditorSnapshot(steps, manifestFrames) {
  return {
    steps: normalizeSteps(JSON.parse(JSON.stringify(steps))),
    manifestFrames: JSON.parse(JSON.stringify(manifestFrames)),
  };
}

function parseJsonObject(value) {
  let parsed = value || {};
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
      break;
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function normalizeTrimRanges(value, totalTime = Number.POSITIVE_INFINITY) {
  let parsed = value || [];
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
      break;
    }
  }

  if (!Array.isArray(parsed)) return [];

  const maxTime = Number.isFinite(totalTime) ? Math.max(0, totalTime) : Number.POSITIVE_INFINITY;
  return mergeTrimRanges(parsed
    .map((range) => ({
      start_ms: Math.max(0, Math.min(Number(range?.start_ms) || 0, maxTime)),
      end_ms: Math.max(0, Math.min(Number(range?.end_ms) || 0, maxTime)),
      source: range?.source === 'manual' ? 'manual' : 'auto',
      created_at: range?.created_at || new Date().toISOString(),
    }))
    .filter((range) => range.end_ms - range.start_ms >= 100));
}

function mergeTrimRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start_ms - b.start_ms);
  const merged = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start_ms > last.end_ms + 50) {
      merged.push({ ...range });
    } else {
      last.end_ms = Math.max(last.end_ms, range.end_ms);
      last.source = last.source === 'manual' || range.source === 'manual' ? 'manual' : 'auto';
    }
  }

  return merged;
}

function skipTrimForward(time, ranges, totalTime) {
  let nextTime = Math.max(0, Math.min(time, totalTime));
  for (const range of ranges) {
    if (nextTime >= range.start_ms && nextTime < range.end_ms) {
      nextTime = Math.min(range.end_ms, totalTime);
    }
  }
  return nextTime;
}

function findStepIndexAtTime(time, steps) {
  if (!steps.length) return null;
  let accumulatedTime = 0;
  for (let i = 0; i < steps.length; i += 1) {
    accumulatedTime += steps[i].delay_ms || DEFAULT_ACTION_DELAY_MS;
    if (time < accumulatedTime) return i;
  }
  return steps.length - 1;
}

// Find the step whose time_offset is closest to `time` (used when timeline uses recording timestamps).
function findStepIndexByTimeOffset(time, steps) {
  if (!steps.length) return null;
  let closestIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < steps.length; i += 1) {
    const t = steps[i].target_anchor?.time_offset != null
      ? Number(steps[i].target_anchor.time_offset)
      : getStepTime(steps[i], steps);
    const dist = Math.abs(t - time);
    if (dist < minDist) { minDist = dist; closestIdx = i; }
  }
  return closestIdx;
}

function getStepTimestamp(step, index, steps) {
  if (step.target_anchor?.time_offset != null) {
    return Number(step.target_anchor.time_offset);
  }
  return getStepTime({ ...step, order: index }, steps);
}

function isInTrimRange(time, ranges) {
  return ranges.some((range) => time >= range.start_ms && time < range.end_ms);
}

function compactTimestamp(time, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start_ms - b.start_ms);
  let offset = 0;
  for (const range of sorted) {
    if (time >= range.end_ms) {
      offset += range.end_ms - range.start_ms;
    } else if (time >= range.start_ms) {
      return null;
    } else {
      break;
    }
  }
  return time - offset;
}

function applyTrimDeletion(ranges, steps, manifestFrames) {
  const merged = mergeTrimRanges(ranges);
  if (!merged.length) {
    return { steps, manifestFrames };
  }

  const keptSteps = steps
    .map((step, index) => ({
      step,
      time: getStepTimestamp(step, index, steps),
    }))
    .filter(({ time }) => !isInTrimRange(time, merged))
    .map(({ step, time }) => {
      const newTime = compactTimestamp(time, merged);
      const anchor = parseJsonObject(step.target_anchor);
      return {
        ...step,
        target_anchor: {
          ...anchor,
          time_offset: newTime,
        },
      };
    });

  const newManifestFrames = manifestFrames
    .filter((frame) => !isInTrimRange(Number(frame.time) || 0, merged))
    .map((frame) => ({
      ...frame,
      time: compactTimestamp(Number(frame.time) || 0, merged),
    }))
    .filter((frame) => frame.time != null)
    .sort((a, b) => a.time - b.time);

  return {
    steps: normalizeSteps(keptSteps),
    manifestFrames: newManifestFrames,
  };
}

function buildAutoTrimRanges(steps, totalTime, thresholdMs = 2500, bufferMs = 500) {
  if (!steps.length || totalTime <= 0) return [];
  const actionTimes = steps.map((step, index) => getStepTimestamp(step, index, steps));
  const ranges = [];

  if (actionTimes[0] > thresholdMs) {
    ranges.push({
      start_ms: 0,
      end_ms: Math.max(0, actionTimes[0] - bufferMs),
      source: 'auto',
      created_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < actionTimes.length - 1; i += 1) {
    const gap = actionTimes[i + 1] - actionTimes[i];
    if (gap > thresholdMs) {
      ranges.push({
        start_ms: actionTimes[i] + bufferMs,
        end_ms: actionTimes[i + 1] - bufferMs,
        source: 'auto',
        created_at: new Date().toISOString(),
      });
    }
  }

  const lastTime = actionTimes[actionTimes.length - 1] || 0;
  if (totalTime - lastTime > thresholdMs) {
    ranges.push({
      start_ms: lastTime + bufferMs,
      end_ms: totalTime,
      source: 'auto',
      created_at: new Date().toISOString(),
    });
  }

  return normalizeTrimRanges(ranges, totalTime);
}

function getStepTime(step, steps) {
  if (step.order === 0) return 0;
  const totalBefore = steps
    .slice(0, step.order)
    .reduce((sum, s) => sum + (s.delay_ms || DEFAULT_ACTION_DELAY_MS), 0);
  return totalBefore;
}

function formatSeconds(totalMs) {
  const totalSec = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(Math.floor(millis / 100)).padStart(1, '0')}`;
}

function describeStep(actionType, config, t) {
  const descriptions = {
    navigate: t('scenarioEditor.stepDescriptions.navigate'),
    click: t('scenarioEditor.stepDescriptions.click'),
    input: t('scenarioEditor.stepDescriptions.input'),
    type: t('scenarioEditor.stepDescriptions.type'),
    wait: t('scenarioEditor.stepDescriptions.wait'),
  };
  return descriptions[actionType] || actionType || 'Unknown';
}

function getAction(actionType) {
  const icons = {
    navigate: ArrowLeft,
    click: MousePointer2,
    input: Keyboard,
    type: Keyboard,
    wait: Timer,
    waitForElement: Eye,
    screenshot: SquareCode,
    scroll: FolderOpen,
    extractText: FileDown,
    submit: KeyRound,
    login: KeyRound,
    facebookPost: Share2,
    like: Plus,
    comment: Keyboard,
    customScript: Code2,
  };
  return icons[actionType] || CircleDot;
}

function drawImageContain(ctx, img, canvasWidth, canvasHeight) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  const imageRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = canvasWidth / canvasHeight;
  let drawWidth = canvasWidth;
  let drawHeight = canvasHeight;

  if (imageRatio > canvasRatio) {
    drawHeight = canvasWidth / imageRatio;
  } else {
    drawWidth = canvasHeight * imageRatio;
  }

  const x = (canvasWidth - drawWidth) / 2;
  const y = (canvasHeight - drawHeight) / 2;
  ctx.fillStyle = '#e9edf3';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

function StepCard({ step, index, isSelected, onSelect, onDelete, onUpdate }) {
  const { t } = useTranslation();
  const config = step.action_config || {};
  const Icon = getAction(step.action_type);
  const time = getStepTime(step, []);
  const selector = config.selector || step.target_anchor?.selector_value || '';
  const text = config.text || '';
  const duration = config.duration || step.delay_ms || DEFAULT_ACTION_DELAY_MS;

  return (
    <div
      className={`group relative flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 transition ${
        isSelected
          ? 'border-[#635bff] bg-[#1e2140]'
          : 'border-transparent bg-[#171b26] hover:bg-[#1c2130]'
      }`}
      onClick={() => onSelect(index)}
    >
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#232838]">
        <Icon className="h-3.5 w-3.5 text-[#9aa7b7]" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-white">
            {describeStep(step.action_type, config, t)}
          </span>
          <span className="shrink-0 text-[10px] text-[#76849b]">{formatSeconds(time)}</span>
        </div>

        {step.action_type === 'navigate' && config.url && (
          <div className="mt-0.5 truncate text-[10px] text-[#5b8def]">{config.url}</div>
        )}

        {step.action_type === 'click' && selector && (
          <div className="mt-0.5 truncate text-[10px] text-[#9aa7b7]">
            {selector}
            {config.skip_if_checked ? t('scenarioEditor.skipIfCheckedBadge') : ''}
          </div>
        )}

        {(['input', 'type'].includes(step.action_type)) && (
          <div className="mt-0.5 truncate text-[10px] text-[#9aa7b7]">
            {selector ? `${selector} \u2192 ` : ''}{text ? `"${text}"` : ''}
          </div>
        )}

        {step.action_type === 'wait' && (
          <div className="mt-0.5 text-[10px] text-[#9aa7b7]">{duration}ms</div>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(index); }}
        className="invisible absolute right-1.5 top-1.5 rounded p-0.5 text-[#76849b] hover:bg-[#2a3144] hover:text-[#ff6b7a] group-hover:visible"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function ScenarioInfoPanel({
  description,
  platform,
  targetUrl,
  variables,
  onScenarioChange,
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.info.platform')}</span>
        <select
          value={platform}
          onChange={(event) => onScenarioChange({ nextPlatform: event.target.value })}
          className="select-field h-9"
        >
          <option value="facebook">Facebook</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="linkedin">LinkedIn</option>
          <option value="custom">{t('scenarioEditor.platform.custom')}</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.info.targetUrl')}</span>
        <VariableInput
          value={targetUrl || ''}
          onChange={(value) => onScenarioChange({ nextTargetUrl: value })}
          variables={variables}
          placeholder={t('scenarioEditor.info.urlPlaceholder')}
        />
      </label>

      <label className="col-span-2 block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.info.description')}</span>
        <textarea
          value={description || ''}
          onChange={(event) => onScenarioChange({ nextDescription: event.target.value })}
          className="textarea-field min-h-[70px]"
          placeholder={t('scenarioEditor.info.descriptionPlaceholder')}
        />
      </label>
    </div>
  );
}

function StepEditPanel({
  selectedStep,
  variables,
  onStepChange,
}) {
  const { t } = useTranslation();
  const config = selectedStep?.action_config || {};

  const updateActionConfig = (patch) => {
    onStepChange({
      action_config: { ...config, ...patch },
      target_anchor: {
        ...(selectedStep?.target_anchor || {}),
        action_config: { ...config, ...patch },
      },
    });
  };

  const updateSelector = (value) => {
    const patch = selectedStep?.action_type === 'navigate'
      ? { url: value }
      : { selector: value };
    onStepChange({
      action_config: { ...config, ...patch },
      target_anchor: {
        ...(selectedStep?.target_anchor || {}),
        action_config: { ...config, ...patch },
        selector_value: value,
      },
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        {selectedStep ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.step.type')}</span>
              <select
                value={normalizeActionType(selectedStep.action_type)}
                onChange={(event) => {
                  const nextType = normalizeActionType(event.target.value);
                  onStepChange({
                    action_type: nextType,
                    action_config: defaultConfig[nextType] || {},
                    target_anchor: {
                      ...(selectedStep.target_anchor || {}),
                      action_config: defaultConfig[nextType] || {},
                    },
                  });
                }}
                className="select-field h-9"
              >
                <option value="navigate">{t('scenarioEditor.actions.navigate')}</option>
                <option value="click">{t('scenarioEditor.actions.click')}</option>
                <option value="input">{t('scenarioEditor.actions.input')}</option>
                <option value="wait">{t('scenarioEditor.actions.wait')}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">
                {selectedStep.action_type === 'navigate' ? 'URL' : 'Selector'}
              </span>
              {selectedStep.action_type === 'navigate' ? (
                <VariableInput
                  value={config.url || ''}
                  onChange={(value) => updateSelector(value)}
                  variables={variables}
                  placeholder={t('scenarioEditor.step.urlOrVariable')}
                />
              ) : (
                <input
                  value={config.selector || selectedStep.target_anchor?.selector_value || ''}
                  onChange={(event) => updateSelector(event.target.value)}
                  className="input-field h-9"
                  placeholder={t('scenarioEditor.step.selectorPlaceholder')}
                />
              )}
            </label>

            {(['input', 'type'].includes(selectedStep.action_type)) && (
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.step.text')}</span>
                <VariableInput
                  value={config.text || ''}
                  onChange={(value) => updateActionConfig({ text: value })}
                  variables={variables}
                  placeholder="Nội dung hoặc {{variable}}"
                />
              </label>
            )}

            {selectedStep.action_type === 'click' && (
              <label className="col-span-2 flex cursor-pointer items-start gap-2 rounded-lg border border-[#2a3144] bg-[#101217] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(config.skip_if_checked)}
                  onChange={(event) => updateActionConfig({ skip_if_checked: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#2f80ed]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[#dce5f2]">
                    {t('scenarioEditor.skipIfChecked')}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#8b97aa]">
                    {t('scenarioEditor.skipIfCheckedHint')}
                  </span>
                </span>
              </label>
            )}

            {selectedStep.action_type === 'wait' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">{t('scenarioEditor.step.waitDuration')}</span>
                <input
                  type="number"
                  value={config.duration || selectedStep.delay_ms || DEFAULT_ACTION_DELAY_MS}
                  onChange={(event) => updateActionConfig({ duration: Number(event.target.value) })}
                  className="input-field h-9"
                />
              </label>
            )}
          </>
        ) : (
          <div className="col-span-2 rounded border border-[#2a2d34] bg-[#101217] px-3 py-4 text-sm text-[#8b97aa]">
            {t('scenarioEditor.step.selectPrompt')}
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({
  steps,
  currentTime,
  totalTime,
  onSeek,
  selectingTrim = false,
  pendingTrimRange = null,
  onTrimRangeChange,
}) {
  const { t } = useTranslation();
  const timelineRef = useRef(null);
  const [dragStartTime, setDragStartTime] = useState(null);
  const maxTime = totalTime || steps.reduce((sum, s) => sum + (s.delay_ms || DEFAULT_ACTION_DELAY_MS), 0) || 10000;
  const progress = maxTime > 0 ? (currentTime / maxTime) * 100 : 0;

  const timeFromEvent = (e) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    return ratio * maxTime;
  };

  const handleClick = (e) => {
    if (selectingTrim) return;
    const newTime = timeFromEvent(e);
    if (newTime === null) return;
    onSeek?.(newTime);
  };

  const handlePointerDown = (e) => {
    if (!selectingTrim) return;
    const startTime = timeFromEvent(e);
    if (startTime === null) return;
    e.preventDefault();
    timelineRef.current?.setPointerCapture?.(e.pointerId);
    setDragStartTime(startTime);
    onTrimRangeChange?.({ start_ms: startTime, end_ms: startTime, source: 'manual' });
  };

  const handlePointerMove = (e) => {
    if (!selectingTrim || dragStartTime === null) return;
    const nextTime = timeFromEvent(e);
    if (nextTime === null) return;
    onTrimRangeChange?.({
      start_ms: Math.min(dragStartTime, nextTime),
      end_ms: Math.max(dragStartTime, nextTime),
      source: 'manual',
    });
  };

  const handlePointerUp = (e) => {
    if (!selectingTrim || dragStartTime === null) return;
    timelineRef.current?.releasePointerCapture?.(e.pointerId);
    setDragStartTime(null);
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={timelineRef}
        className={`relative h-full w-full rounded-md border border-[#2a2d34] bg-[#171a20] ${selectingTrim ? 'cursor-crosshair' : 'cursor-pointer'}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {Array.from({ length: 6 }, (_, index) => (maxTime / 5) * index).map((tick) => (
          <div
            key={tick}
            className="absolute top-0 h-full border-l border-[#2a2d34]"
            style={{ left: `${(tick / maxTime) * 100}%` }}
          >
            <span className="absolute left-1 top-1 text-[10px] text-[#64728a]">{formatSeconds(tick)}</span>
          </div>
        ))}

        {pendingTrimRange && (
          <div
            className="absolute top-0 h-full border-x border-[#635bff]/70 bg-[#635bff]/15"
            style={{
              left: `${(Math.min(pendingTrimRange.start_ms, pendingTrimRange.end_ms) / maxTime) * 100}%`,
              width: `${Math.max(0.2, (Math.abs(pendingTrimRange.end_ms - pendingTrimRange.start_ms) / maxTime) * 100)}%`,
            }}
          />
        )}

        <div className="absolute left-4 right-4 top-1/2 h-px bg-[#344054]" />

        {steps.map((step, idx) => {
          const stepTime = getStepTime(step, steps);
          // Prefer time_offset (actual recording timestamp) over cumulative delay_ms so
          // keyframe diamonds spread across the full recording timeline.
          const displayTime = step.target_anchor?.time_offset != null
            ? Number(step.target_anchor.time_offset)
            : stepTime;
          const left = maxTime > 0 ? Math.min(98, (displayTime / maxTime) * 100) : 0;
          return (
            <button
              key={step.id || idx}
              type="button"
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#7e8da5] bg-[#20242c] data-[active=true]:border-[#ffd2d2] data-[active=true]:bg-[#ff3b59]"
              style={{ left: `${left}%` }}
              data-active={Math.abs(displayTime - currentTime) < Math.max(120, step.delay_ms || DEFAULT_ACTION_DELAY_MS)}
              title={`${describeStep(step.action_type, {}, t)} - ${formatSeconds(displayTime)}`}
            />
          );
        })}

        <div
          className="absolute top-0 h-full w-0.5 bg-[#635bff] transition-all duration-75"
          style={{ left: `${Math.min(100, progress)}%` }}
        />
      </div>

      <div className="mt-2 flex justify-between px-0.5">
        <span className="text-[10px] text-[#76849b]">{formatSeconds(currentTime)}</span>
        <span className="text-[10px] text-[#76849b]">{formatSeconds(maxTime)}</span>
      </div>
    </div>
  );
}

// ===== Main ScenarioEditor Component =====

export default function ScenarioEditor({ scenario, onBack }) {
  const dispatch = useDispatch();
  const { t } = useTranslation();

  // ======== State ========
  const [name, setName] = useState(scenario?.name || '');
  const [description, setDescription] = useState(scenario?.description || '');
  const [platform, setPlatform] = useState(scenario?.platform || 'facebook');
  const [targetUrl, setTargetUrl] = useState(scenario?.target_url || '');
  const [steps, setSteps] = useState(normalizeSteps(scenario?.steps || []));
  const [selectedStepIndex, setSelectedStepIndex] = useState(null);
  const [currentScenarioId, setCurrentScenarioId] = useState(scenario?.id || null);
  const [activeViewport, setActiveViewport] = useState({
    width: scenario?.recorded_width || 1280,
    height: scenario?.recorded_height || 720,
  });
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showRecordMode, setShowRecordMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [scenarioInfoOpen, setScenarioInfoOpen] = useState(true);
  const [stepEditorOpen, setStepEditorOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [scenarioPreviewPath, setScenarioPreviewPath] = useState(scenario?.preview_path || null);
  const [scenarioManifestPath, setScenarioManifestPath] = useState(scenario?.preview_manifest_path || null);
  const [scenarioPreviewUrl, setScenarioPreviewUrl] = useState(scenario?.preview_url || null);
  const [recordStatus, setRecordStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [variablesTransferBusy, setVariablesTransferBusy] = useState(false);
  const [settings, setSettings] = useState({});
  const [browserProfileId, setBrowserProfileId] = useState(scenario?.browser_profile_id || '');
  const [browserProfileOptions, setBrowserProfileOptions] = useState([]);
  const [frameDataUrls, setFrameDataUrls] = useState({});
  const frameLoadFailedRef = useRef(new Set());
  const [manifestFrames, setManifestFrames] = useState([]);
  const [selectingTrim, setSelectingTrim] = useState(false);
  const [pendingTrimRange, setPendingTrimRange] = useState(null);
  const [scenarioVariables, setScenarioVariables] = useState([]);
  const [variablesRefreshKey, setVariablesRefreshKey] = useState(0);
  const [profilesRefreshKey, setProfilesRefreshKey] = useState(0);
  const [activeVariableProfileId, setActiveVariableProfileId] = useState('');
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const isApplyingHistoryRef = useRef(false);
  const stepEditUndoPushedRef = useRef(false);
  const stepEditUndoTimerRef = useRef(null);
  const scenarioDraftRef = useRef({
    name: scenario?.name || '',
    description: scenario?.description || '',
    platform: scenario?.platform || 'facebook',
    targetUrl: scenario?.target_url || '',
    browserProfileId: scenario?.browser_profile_id || '',
  });

  const loadScenarioVariables = useCallback(async (scenarioId) => {
    if (!scenarioId || !window.electronAPI?.getScenarioVariables) {
      setScenarioVariables([]);
      return;
    }

    try {
      const items = await window.electronAPI.getScenarioVariables(scenarioId);
      setScenarioVariables(
        (Array.isArray(items) ? items : []).map((item) => ({
          ...item,
          key: item.key || item.name || '',
        })),
      );
    } catch {
      setScenarioVariables([]);
    }
  }, []);

  useEffect(() => {
    loadScenarioVariables(currentScenarioId);
  }, [currentScenarioId, variablesRefreshKey, loadScenarioVariables]);

  const handleVariableProfileChange = useCallback(async (profileId) => {
    setActiveVariableProfileId(profileId);
    if (!currentScenarioId || !window.electronAPI?.setScenarioVariableProfile) return;

    try {
      await window.electronAPI.setScenarioVariableProfile({
        scenarioId: currentScenarioId,
        profileId: profileId || null,
      });
      setVariablesRefreshKey((value) => value + 1);
      setProfilesRefreshKey((value) => value + 1);
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Không áp dụng được hồ sơ biến' }));
    }
  }, [currentScenarioId, dispatch]);

  // ======== Derived State ========
  const hasSteps = steps.length > 0;
  const stepTotalTime = steps.reduce((sum, s) => sum + (s.delay_ms || DEFAULT_ACTION_DELAY_MS), 0);
  const manifestDuration = manifestFrames.length
    ? Math.max(...manifestFrames.map((frame) => Number(frame.time) || 0))
    : 0;
  const totalTime = Math.max(stepTotalTime, manifestDuration);
  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;
  const stepPreviewFrames = useMemo(() => (
    steps
      .map((step, index) => {
        const stepTime = getStepTime(step, steps);
        return {
          index,
          time: Number(step.target_anchor?.time_offset ?? stepTime),
          path: step.target_anchor?.associated_frame || null,
          url: frameDataUrls[step.target_anchor?.associated_frame] || step.target_anchor?.associated_frame_url || null,
        };
      })
      .filter((frame) => Boolean(frame.url))
      .sort((a, b) => a.time - b.time)
  ), [frameDataUrls, steps]);
  const manifestPreviewFrames = useMemo(() => (
    manifestFrames
      .map((frame, index) => ({
        index,
        time: Number(frame.time) || 0,
        path: frame.path || null,
        url: frameDataUrls[frame.path] || frame.url || null,
      }))
      .filter((frame) => Boolean(frame.url))
      .sort((a, b) => a.time - b.time)
  ), [frameDataUrls, manifestFrames]);
  const previewFrames = manifestPreviewFrames.length ? manifestPreviewFrames : stepPreviewFrames;
  const currentPreviewFrame = useMemo(() => {
    if (!previewFrames.length) return null;
    let activeFrame = previewFrames[0];
    for (const frame of previewFrames) {
      if (frame.time <= previewCurrentTime) activeFrame = frame;
      else break;
    }
    return activeFrame;
  }, [previewCurrentTime, previewFrames]);

  const updateScenarioDraft = useCallback((patch) => {
    if (patch.nextName !== undefined) {
      scenarioDraftRef.current.name = patch.nextName;
      setName(patch.nextName);
    }
    if (patch.nextDescription !== undefined) {
      scenarioDraftRef.current.description = patch.nextDescription;
      setDescription(patch.nextDescription);
    }
    if (patch.nextPlatform !== undefined) {
      scenarioDraftRef.current.platform = patch.nextPlatform;
      setPlatform(patch.nextPlatform);
    }
    if (patch.nextTargetUrl !== undefined) {
      scenarioDraftRef.current.targetUrl = patch.nextTargetUrl;
      setTargetUrl(patch.nextTargetUrl);
    }
    if (patch.nextBrowserProfileId !== undefined) {
      scenarioDraftRef.current.browserProfileId = patch.nextBrowserProfileId || '';
      setBrowserProfileId(patch.nextBrowserProfileId || '');
    }
  }, []);

  const clearUndoHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    if (isApplyingHistoryRef.current) return;
    const snapshot = createEditorSnapshot(steps, manifestFrames);
    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-MAX_UNDO_STEPS);
    redoStackRef.current = [];
  }, [steps, manifestFrames]);

  const applyEditorSnapshot = useCallback((snapshot) => {
    isApplyingHistoryRef.current = true;
    stepEditUndoPushedRef.current = false;
    if (stepEditUndoTimerRef.current) {
      clearTimeout(stepEditUndoTimerRef.current);
      stepEditUndoTimerRef.current = null;
    }
    setSteps(snapshot.steps);
    setManifestFrames(snapshot.manifestFrames);
    setSelectedStepIndex(null);
    setPreviewCurrentTime(0);
    queueMicrotask(() => {
      isApplyingHistoryRef.current = false;
    });
  }, []);

  const undo = useCallback(() => {
    if (!undoStackRef.current.length) return;
    const current = createEditorSnapshot(steps, manifestFrames);
    redoStackRef.current = [...redoStackRef.current, current].slice(-MAX_UNDO_STEPS);
    const previous = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    applyEditorSnapshot(previous);
  }, [applyEditorSnapshot, manifestFrames, steps]);

  const redo = useCallback(() => {
    if (!redoStackRef.current.length) return;
    const current = createEditorSnapshot(steps, manifestFrames);
    undoStackRef.current = [...undoStackRef.current, current].slice(-MAX_UNDO_STEPS);
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    applyEditorSnapshot(next);
  }, [applyEditorSnapshot, manifestFrames, steps]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        undo();
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);

  // ======== Load Settings ========
  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      setSettings(s || {});
      if (s?.['browser.viewportWidth'] && s?.['browser.viewportHeight']) {
        setActiveViewport({
          width: Number(s['browser.viewportWidth']),
          height: Number(s['browser.viewportHeight']),
        });
      }
    }).catch(() => {});

    window.electronAPI.listAppBrowserProfiles?.()
      .then((profiles) => setBrowserProfileOptions(Array.isArray(profiles) ? profiles : []))
      .catch(() => setBrowserProfileOptions([]));
  }, []);

  // ======== Load Scenario Frames ========
  useEffect(() => {
    if (!currentScenarioId) return;
    window.electronAPI.getScenarioDetails(currentScenarioId).then((s) => {
      if (s?.steps) {
        setSteps(normalizeSteps(s.steps));
      }
      if (s) {
        scenarioDraftRef.current = {
          name: s.name || name,
          description: s.description || '',
          platform: s.platform || 'custom',
          targetUrl: s.target_url || '',
          browserProfileId: s.browser_profile_id || '',
        };
        setName(s.name || name);
        setDescription(s.description || '');
        setPlatform(s.platform || 'custom');
        setTargetUrl(s.target_url || '');
        setBrowserProfileId(s.browser_profile_id || '');
        setActiveVariableProfileId(s.variable_profile_id || '');
      }
      if (s?.preview_path) {
        setScenarioPreviewPath(s.preview_path);
        setScenarioPreviewUrl(s.preview_url || null);
      }
      if (s?.preview_manifest_path) {
        setScenarioManifestPath(s.preview_manifest_path);
      }
      if (s?.recorded_width && s?.recorded_height) {
        setActiveViewport({ width: s.recorded_width, height: s.recorded_height });
      }
      setManifestFrames(Array.isArray(s?.preview_frames) ? s.preview_frames : []);
      clearUndoHistory();
    }).catch(() => {});
  }, [clearUndoHistory, currentScenarioId]);

  useEffect(() => {
    if (!currentScenarioId) {
      setActiveVariableProfileId('');
    }
  }, [currentScenarioId]);

  useEffect(() => {
    const missingPaths = [
      ...steps.map((step) => step.target_anchor?.associated_frame),
      ...manifestFrames.map((frame) => frame.path),
    ]
      .filter((item) => item && !frameDataUrls[item] && !frameLoadFailedRef.current.has(item));

    if (!missingPaths.length || !window.electronAPI.readFrameDataUrl) return;

    let cancelled = false;
    const uniquePaths = [...new Set(missingPaths)];

    Promise.all(uniquePaths.map(async (filePath) => {
      try {
        const dataUrl = await window.electronAPI.readFrameDataUrl(filePath);
        return dataUrl ? [filePath, dataUrl] : null;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) return;

      for (const filePath of uniquePaths) {
        const loaded = entries.some((entry) => entry && entry[0] === filePath);
        if (!loaded) {
          frameLoadFailedRef.current.add(filePath);
        }
      }

      const next = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      if (Object.keys(next).length) {
        setFrameDataUrls((current) => ({ ...current, ...next }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [frameDataUrls, manifestFrames, steps]);

  // ======== Listen for recording status events ========
  useEffect(() => {
    let statusInterval;
    if (recording) {
      statusInterval = setInterval(async () => {
        try {
          const status = await window.electronAPI.getScenarioRecordingStatus();
          setRecordStatus(status);
        } catch { /* ignore */ }
      }, 1000);
    }
    return () => {
      if (statusInterval) clearInterval(statusInterval);
    };
  }, [recording]);

  // ======== Preview playback timer ========
  useEffect(() => {
    if (!previewPlaying || !hasSteps) return;

    // Use the full totalTime (max of stepTotalTime and manifestDuration) so all manifest
    // frames are reachable during playback, not just the first stepTotalTime milliseconds.
    const playDuration = totalTime;
    const hasTimeOffset = steps.some((s) => s.target_anchor?.time_offset != null);
    let lastTick = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      setPreviewCurrentTime((current) => {
        const nextTime = Math.min(current + delta, playDuration);
        if (nextTime >= playDuration) {
          setPreviewPlaying(false);
          setSelectedStepIndex(steps.length - 1);
          return playDuration;
        }
        setSelectedStepIndex(
          hasTimeOffset
            ? findStepIndexByTimeOffset(nextTime, steps)
            : findStepIndexAtTime(nextTime, steps),
        );
        return nextTime;
      });
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [previewPlaying, hasSteps, steps, totalTime]);

  // ======== Callbacks ========

  const persist = useCallback(async () => {
    setSaving(true);
    try {
      const scenarioData = {
        ...(currentScenarioId ? { id: currentScenarioId } : {}),
        name: scenarioDraftRef.current.name || name,
        description: scenarioDraftRef.current.description,
        platform: scenarioDraftRef.current.platform || platform,
        target_url: scenarioDraftRef.current.targetUrl || '',
        browser_profile_id: scenarioDraftRef.current.browserProfileId || null,
        variable_profile_id: activeVariableProfileId || null,
        recorded_width: activeViewport.width,
        recorded_height: activeViewport.height,
        preview_trim_ranges: [],
        preview_manifest_path: scenarioManifestPath,
        preview_manifest_frames: manifestFrames,
        preview_duration_ms: manifestDuration,
      };
      const dbSteps = steps.map(toDatabaseStep);
      const saved = await window.electronAPI.saveScenario(scenarioData, dbSteps);
      if (saved) {
        setCurrentScenarioId(saved.id);
        dispatch(showToast({ type: 'success', message: 'Đã lưu kịch bản' }));
      }
      return saved;
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Lưu thất bại' }));
      return null;
    } finally {
      setSaving(false);
    }
  }, [currentScenarioId, name, platform, activeViewport, steps, manifestFrames, manifestDuration, scenarioManifestPath, activeVariableProfileId, dispatch]);

  const resolveRecordImportProfileId = useCallback(() => {
    const selected = scenarioDraftRef.current.browserProfileId || browserProfileId;
    return selected || null;
  }, [browserProfileId]);

  const handleRecordClick = useCallback(async () => {
    if (recording) {
      // Stop recording
      try {
        setRecordingBusy(true);
        const result = await window.electronAPI.stopScenarioRecording();
        setRecording(false);
        setRecordStatus(null);

        if (result?.scenario) {
          const savedScenario = result.scenario;
          setCurrentScenarioId(savedScenario.id);
          setSteps(normalizeSteps(savedScenario.steps || result.steps || []));
          setScenarioPreviewPath(savedScenario.preview_path || null);
          setScenarioPreviewUrl(savedScenario.preview_url || result.metadata?.previewVideo?.fileUrl || null);

          dispatch(showToast({
            type: 'success',
            message: 'Đã lưu ' + (result.metadata?.totalSteps || 0) + ' bước.',
          }));

          // Refresh details
          const details = await window.electronAPI.getScenarioDetails(savedScenario.id);
          if (details?.steps) {
            setSteps(normalizeSteps(details.steps));
          }
          if (details?.preview_manifest_path) {
            setScenarioManifestPath(details.preview_manifest_path);
          }
          setManifestFrames(Array.isArray(details?.preview_frames) ? details.preview_frames : []);
          clearUndoHistory();
        }
      } catch (error) {
        dispatch(showToast({ type: 'error', message: error.message || 'Dừng record thất bại' }));
      } finally {
        setRecordingBusy(false);
      }
      return;
    }

    // Start recording - check if steps already exist
    if (hasSteps) {
      setShowRecordMode(true);
      return;
    }

    // No steps yet - start recording immediately
    startRecording('replace');
  }, [recording, hasSteps, dispatch]);

  const startRecording = useCallback(async (mode) => {
    setShowRecordMode(false);
    setRecordingBusy(true);
    setPreviewPlaying(false);

    try {
      const canSave = currentScenarioId || scenarioDraftRef.current.name || name;
      if (!canSave) {
        dispatch(showToast({ type: 'error', message: 'Nhập tên kịch bản trước khi Record.' }));
        return;
      }

      // Save first to ensure we have an ID
      const saved = await persist();
      if (!saved?.id) {
        dispatch(showToast({ type: 'error', message: 'Lưu kịch bản thất bại, không thể Record.' }));
        return;
      }

      const s = settings;
      const viewport = {
        width: Number(s['browser.viewportWidth']) || activeViewport.width,
        height: Number(s['browser.viewportHeight']) || activeViewport.height,
      };
      const latestTargetUrl = scenarioDraftRef.current.targetUrl || targetUrl;
      const latestPlatform = scenarioDraftRef.current.platform || platform;

      const result = await window.electronAPI.startScenarioRecording({
        scenarioId: saved.id,
        targetUrl: latestTargetUrl || defaultUrl(latestPlatform) || 'about:blank',
        viewport,
        mode,
        importProfileId: resolveRecordImportProfileId(),
      });

      if (result) {
        setCurrentScenarioId(result.scenarioId);
        setActiveViewport(result.viewport || viewport);
        setRecording(true);
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Record thất bại' }));
    } finally {
      setRecordingBusy(false);
    }
  }, [currentScenarioId, name, targetUrl, platform, activeViewport, resolveRecordImportProfileId, persist, dispatch]);

  const handleRun = useCallback(async () => {
    if (!hasSteps) {
      dispatch(showToast({ type: 'error', message: 'Chưa có dữ liệu quay. Bấm Record trước khi Play.' }));
      return;
    }

    setPreviewPlaying((current) => !current);
  }, [dispatch, hasSteps]);

  const handleOpenBrowser = useCallback(async () => {
    try {
      const latestTargetUrl = scenarioDraftRef.current.targetUrl || targetUrl;
      const latestPlatform = scenarioDraftRef.current.platform || platform;
      dispatch(showToast({ type: 'info', message: 'Đang mở Chromium để kiểm tra thủ công...' }));
      const result = await window.electronAPI.openScenarioBrowser({
        scenarioId: currentScenarioId || undefined,
        targetUrl: latestTargetUrl || defaultUrl(latestPlatform) || 'about:blank',
        viewport: activeViewport,
        importProfileId: resolveRecordImportProfileId(),
      });
      if (result.opened) {
        dispatch(showToast({ type: 'success', message: 'Đã mở Chromium. Đóng cửa sổ Chromium khi xong.' }));
      } else {
        dispatch(showToast({ type: 'error', message: result.error || 'Không thể mở Chromium' }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Không thể mở Chromium' }));
    }
  }, [activeViewport, currentScenarioId, dispatch, platform, resolveRecordImportProfileId, targetUrl]);

  const handleReplayAndRecord = useCallback(async () => {
    const saved = await persist();
    if (!saved?.id) {
      dispatch(showToast({ type: 'error', message: 'Lưu kịch bản trước khi Record lại' }));
      return;
    }

    setShowRecordMode(false);
    setReplaying(true);

    try {
      const s = settings;
      const viewport = {
        width: Number(s['browser.viewportWidth']) || activeViewport.width,
        height: Number(s['browser.viewportHeight']) || activeViewport.height,
      };
      const latestTargetUrl = scenarioDraftRef.current.targetUrl || targetUrl;
      const latestPlatform = scenarioDraftRef.current.platform || platform;

      dispatch(showToast({ type: 'info', message: 'Đang phát lại steps cũ...' }));

      const result = await window.electronAPI.replayAndRecord({
        scenarioId: saved.id,
        targetUrl: latestTargetUrl || defaultUrl(latestPlatform) || 'about:blank',
        viewport,
        importProfileId: resolveRecordImportProfileId(),
      });

      if (result.success) {
        setCurrentScenarioId(result.scenarioId);
        setRecordStatus({ isRecording: true, eventsCount: 0, frameCount: 0, elapsedMs: 0, ...result });
        setRecording(true);
        dispatch(showToast({
          type: 'success',
          message: 'Đã phát lại ' + result.replayedSteps + ' bước. Hãy thao tác thêm trong Chromium rồi bấm Stop.',
        }));
      } else {
        dispatch(showToast({ type: 'error', message: result.error || 'Phát lại thất bại' }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Lỗi khi phát lại steps' }));
    } finally {
      setReplaying(false);
    }
  }, [activeViewport, dispatch, persist, platform, resolveRecordImportProfileId, targetUrl]);

  const ensureScenarioId = useCallback(async () => {
    if (currentScenarioId) return currentScenarioId;
    const saved = await persist();
    return saved?.id || null;
  }, [currentScenarioId, persist]);

  const handleExportScenario = useCallback(async () => {
    setVariablesTransferBusy(true);
    try {
      const id = await ensureScenarioId();
      if (!id) {
        dispatch(showToast({ type: 'error', message: t('scenarios.editor.saveBeforeExport') }));
        return;
      }
      const result = await window.electronAPI.exportScenario(id);
      if (result?.cancelled) return;
      dispatch(showToast({
        type: 'success',
        message: t('scenarios.editor.toast.exported', { frames: result?.copiedFrames ?? 0 }),
      }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || t('scenarios.editor.toast.exportFailed') }));
    } finally {
      setVariablesTransferBusy(false);
    }
  }, [dispatch, ensureScenarioId, t]);

  const handleImportScenario = useCallback(async () => {
    setVariablesTransferBusy(true);
    try {
      const result = await window.electronAPI.importScenario();
      if (result?.cancelled) return;
      if (!result?.scenario?.id) {
        dispatch(showToast({ type: 'error', message: t('scenarios.editor.toast.importFailed') }));
        return;
      }
      setFrameDataUrls({});
      frameLoadFailedRef.current = new Set();
      setCurrentScenarioId(result.scenario.id);
      setVariablesRefreshKey((value) => value + 1);
      dispatch(fetchScenarios());
      dispatch(showToast({ type: 'success', message: t('scenarios.editor.toast.imported') }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || t('scenarios.editor.toast.importFailed') }));
    } finally {
      setVariablesTransferBusy(false);
    }
  }, [dispatch, t]);

  const handlePublish = useCallback(async () => {
    let id = currentScenarioId;
    if (!id) {
      const saved = await persist();
      if (!saved?.id) {
        dispatch(showToast({ type: 'error', message: t('scenarios.editor.saveBeforePublish') }));
        return;
      }
      id = saved.id;
    }
    setPublishing(true);
    dispatch(showToast({ type: 'info', message: t('scenarios.editor.publishingVideo') }));
    try {
      const result = await window.electronAPI.renderScenarioVideo(id);
      if (result.success) {
        setScenarioPreviewPath(result.filePath);
        setScenarioPreviewUrl(result.fileUrl);
        dispatch(showToast({ type: 'success', message: t('scenarios.editor.publishSuccess') }));
      } else {
        dispatch(showToast({ type: 'error', message: result.error || t('scenarios.editor.publishFailed') }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || t('scenarios.editor.publishFailed') }));
    } finally {
      setPublishing(false);
    }
  }, [currentScenarioId, dispatch, persist, t]);

  const addStep = useCallback((actionType) => {
    pushUndoSnapshot();
    const newStep = createStep(actionType);
    setSteps((prev) => [...prev, newStep]);
  }, [pushUndoSnapshot]);

  const handleDeleteStep = useCallback((index) => {
    pushUndoSnapshot();
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setSelectedStepIndex((prev) => (prev === index ? null : prev > index ? prev - 1 : prev));
  }, [pushUndoSnapshot]);

  const handleSelectStep = useCallback((index) => {
    setSelectedStepIndex(index);
    const step = steps[index];
    if (step) {
      // Seek preview to the step's actual recording time so the correct frame is shown
      const stepTime = step.target_anchor?.time_offset != null
        ? Number(step.target_anchor.time_offset)
        : getStepTime(step, steps);
      setPreviewCurrentTime(Math.max(0, stepTime));
    }
  }, [steps]);

  const handleUpdateStep = useCallback((index, updates) => {
    if (!stepEditUndoPushedRef.current) {
      pushUndoSnapshot();
      stepEditUndoPushedRef.current = true;
    }
    if (stepEditUndoTimerRef.current) {
      clearTimeout(stepEditUndoTimerRef.current);
    }
    stepEditUndoTimerRef.current = setTimeout(() => {
      stepEditUndoPushedRef.current = false;
    }, 1000);

    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, [pushUndoSnapshot]);

  useEffect(() => {
    stepEditUndoPushedRef.current = false;
    if (stepEditUndoTimerRef.current) {
      clearTimeout(stepEditUndoTimerRef.current);
      stepEditUndoTimerRef.current = null;
    }
  }, [selectedStepIndex]);

  const saveScenarioEdits = useCallback(async (nextSteps, nextManifestFrames) => {
    try {
      const nextDuration = nextManifestFrames.length
        ? Math.max(...nextManifestFrames.map((frame) => Number(frame.time) || 0))
        : nextSteps.reduce((sum, s) => sum + (s.delay_ms || DEFAULT_ACTION_DELAY_MS), 0);
      const scenarioData = {
        ...(currentScenarioId ? { id: currentScenarioId } : {}),
        name: scenarioDraftRef.current.name || name,
        description: scenarioDraftRef.current.description,
        platform: scenarioDraftRef.current.platform || platform,
        target_url: scenarioDraftRef.current.targetUrl || '',
        browser_profile_id: scenarioDraftRef.current.browserProfileId || null,
        variable_profile_id: activeVariableProfileId || null,
        recorded_width: activeViewport.width,
        recorded_height: activeViewport.height,
        preview_path: scenarioPreviewPath,
        preview_manifest_path: scenarioManifestPath,
        preview_manifest_frames: nextManifestFrames,
        preview_duration_ms: nextDuration,
        preview_trim_ranges: [],
      };
      const saved = await window.electronAPI.saveScenario(scenarioData, nextSteps.map(toDatabaseStep));
      if (saved?.id) {
        setCurrentScenarioId(saved.id);
      }
      return saved;
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Không lưu được thay đổi' }));
      return null;
    }
  }, [activeViewport, currentScenarioId, dispatch, name, platform, scenarioManifestPath, scenarioPreviewPath, targetUrl]);

  const applyAndSaveTrim = useCallback(async (ranges) => {
    const merged = mergeTrimRanges(ranges);
    if (!merged.length) return false;

    pushUndoSnapshot();
    const { steps: nextSteps, manifestFrames: nextManifestFrames } = applyTrimDeletion(merged, steps, manifestFrames);

    setSteps(nextSteps);
    setManifestFrames(nextManifestFrames);
    setPendingTrimRange(null);
    setSelectingTrim(false);
    setPreviewCurrentTime(0);
    setSelectedStepIndex(nextSteps.length ? 0 : null);

    const saved = await saveScenarioEdits(nextSteps, nextManifestFrames);
    return Boolean(saved);
  }, [manifestFrames, pushUndoSnapshot, saveScenarioEdits, steps]);

  const handleAutoTrim = useCallback(async () => {
    const autoRanges = buildAutoTrimRanges(steps, totalTime || 0);
    if (!autoRanges.length) {
      dispatch(showToast({ type: 'info', message: 'Không có đoạn trống dài để cắt.' }));
      return;
    }
    const ok = await applyAndSaveTrim(autoRanges);
    if (ok) {
      dispatch(showToast({ type: 'success', message: `Đã xóa ${autoRanges.length} đoạn trống khỏi timeline.` }));
    }
  }, [applyAndSaveTrim, dispatch, steps, totalTime]);

  const handleSavePendingTrim = useCallback(async () => {
    const normalized = normalizeTrimRanges([pendingTrimRange], totalTime || 0);
    if (!normalized.length) {
      dispatch(showToast({ type: 'error', message: 'Vùng chọn quá ngắn.' }));
      return;
    }
    const range = normalized[0];
    const ok = await applyAndSaveTrim([range]);
    if (ok) {
      dispatch(showToast({ type: 'success', message: 'Đã xóa vùng đã chọn khỏi timeline.' }));
    }
  }, [applyAndSaveTrim, dispatch, pendingTrimRange, totalTime]);

  const handleSeek = useCallback((time) => {
    const nextTime = Math.max(0, Math.min(time, totalTime || 0));
    setPreviewCurrentTime(nextTime);
    const hasTimeOffset = steps.some((s) => s.target_anchor?.time_offset != null);
    setSelectedStepIndex(
      hasTimeOffset
        ? findStepIndexByTimeOffset(nextTime, steps)
        : findStepIndexAtTime(nextTime, steps),
    );
  }, [steps, totalTime]);

  // ======== Render ========
  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-[#111216] text-[#dce5f2]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#2a2d34] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="icon-button" title="Quay lại">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#3b4252] bg-[#20242c] text-[#7aa7ff]">
            <SquareCode className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <input
              value={name}
              onChange={(event) => updateScenarioDraft({ nextName: event.target.value })}
              className="w-full min-w-0 bg-transparent text-sm font-semibold text-white outline-none"
              placeholder="Tên kịch bản"
            />
            <p className="truncate text-xs text-[#7e8da5]">Puppeteer scenario editor</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DataProfileSelect
            value={activeVariableProfileId}
            onChange={handleVariableProfileChange}
            refreshKey={profilesRefreshKey + variablesRefreshKey}
            className="select-field h-9 min-w-[150px] max-w-[180px] text-xs"
          />
          <ScenarioVariablesBar
            scenarioId={currentScenarioId}
            refreshKey={variablesRefreshKey}
            onToast={(payload) => dispatch(showToast(payload))}
            onChanged={() => {
              setVariablesRefreshKey((value) => value + 1);
              setProfilesRefreshKey((value) => value + 1);
            }}
          />
          <button
            type="button"
            onClick={handleImportScenario}
            disabled={variablesTransferBusy || recording}
            title={t('scenarios.editor.importHint')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[#b8c5d6] ring-1 ring-[#3b4252] hover:bg-[#242833] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />
            {t('scenarios.editor.import')}
          </button>
          <button
            type="button"
            onClick={handleExportScenario}
            disabled={variablesTransferBusy || recording}
            title={t('scenarios.editor.exportHint')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[#b8c5d6] ring-1 ring-[#3b4252] hover:bg-[#242833] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {t('scenarios.editor.export')}
          </button>
          <button
            type="button"
            onClick={handleRecordClick}
            disabled={recordingBusy}
            className={'inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ' + (
              recording
                ? 'bg-[#ff3b59] text-white hover:bg-[#ff5670]'
                : 'bg-[#242833] text-[#ff8fa0] ring-1 ring-[#4c2b35] hover:bg-[#2f3442]'
            ) + ' disabled:cursor-not-allowed disabled:opacity-60'}
          >
            {recording ? <Square className="h-4 w-4 fill-current" /> : <CircleDot className="h-4 w-4" />}
            {recording ? 'Stop' : 'Record'}
          </button>
          <button type="button" onClick={persist} disabled={saving} className="btn-primary h-9">
            <Save className="h-4 w-4" />
            {saving ? t('scenarios.editor.saving') : t('scenarios.editor.save')}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={recording || !hasSteps || publishing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#16804a] px-3 text-sm font-semibold text-white ring-1 ring-[#1f9c5c] hover:bg-[#1a9353] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {publishing ? t('scenarios.editor.publishing') : t('scenarios.editor.publish')}
          </button>
          <button type="button" onClick={onBack} className="icon-button" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className={`grid min-h-0 min-w-0 flex-1 overflow-x-hidden ${timelineOpen ? 'grid-rows-[minmax(0,1fr)_190px]' : 'grid-rows-[minmax(0,1fr)]'}`}>
        <div className={`grid min-h-0 min-w-0 overflow-x-hidden ${inspectorOpen ? 'grid-cols-[minmax(420px,1fr)_minmax(480px,1.1fr)]' : 'grid-cols-[minmax(420px,1fr)_minmax(360px,0.9fr)]'}`}>
          <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-[#2a2d34]">
            <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[#2a2d34] px-3">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <Code2 className="h-3.5 w-3.5 shrink-0 text-[#7288ff]" />
                <select
                  value={browserProfileId || ''}
                  onChange={(event) => updateScenarioDraft({ nextBrowserProfileId: event.target.value || null })}
                  className="select-field h-7 min-w-0 flex-1 text-xs"
                >
                  <option value="">Guest (không lưu profile)</option>
                  {browserProfileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="shrink-0 text-[11px] text-[#7e8da5]">RES: {activeViewport.width} x {activeViewport.height}</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center overflow-hidden">
                <ProgramMonitor
                  platform={platform}
                  selectedStep={selectedStep}
                  targetUrl={targetUrl}
                  hasSteps={hasSteps}
                  recording={recording}
                  previewPlaying={previewPlaying}
                  currentFrameUrl={currentPreviewFrame?.url || selectedStep?.target_anchor?.associated_frame_url || null}
                  currentTime={previewCurrentTime}
                  frameCount={previewFrames.length}
                />
              </div>

              <div className="mt-3 flex shrink-0 items-center justify-between">
                <span className="rounded border border-[#2f3541] bg-[#0b0d12] px-3 py-1.5 text-xs font-semibold text-[#9eb2d0]">
                  {recording
                    ? `REC ${formatSeconds(recordStatus?.elapsedMs || 0)} | ${recordStatus?.eventsCount || 0} events`
                    : `${formatSeconds(previewCurrentTime)} / ${formatSeconds(totalTime || 20000)}`}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => handleSeek(Math.max(0, previewCurrentTime - 1000))} className="icon-button">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={!hasSteps || recording}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#635bff] text-white shadow-lg shadow-[#635bff]/25 disabled:cursor-not-allowed disabled:bg-[#3a4050] disabled:text-[#7e8da5] disabled:shadow-none"
                  >
                    {previewPlaying ? <Square className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                  </button>
                  <button type="button" onClick={() => handleSeek(Math.min(totalTime, previewCurrentTime + 1000))} className="icon-button">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <IconOnly icon={Eye} label="Hiển thị overlay" />
              </div>
            </div>
          </section>

          <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-[#14161b]">
            <PanelSectionHeader
              icon={Info}
              title={t('scenarioEditor.info.title')}
              onToggle={() => setScenarioInfoOpen((current) => !current)}
              open={scenarioInfoOpen}
            />
            {scenarioInfoOpen && (
              <div className="shrink-0 border-b border-[#2a2d34] bg-[#15171d] p-3">
                <ScenarioInfoPanel
                  description={description}
                  platform={platform}
                  targetUrl={targetUrl}
                  variables={scenarioVariables}
                  onScenarioChange={updateScenarioDraft}
                />
              </div>
            )}

            <div className={`grid min-h-0 flex-1 ${inspectorOpen ? 'grid-cols-[40px_minmax(0,1fr)_minmax(260px,300px)]' : 'grid-cols-[40px_minmax(0,1fr)]'}`}>
              <ActionIconBar onAddStep={addStep} />

              <div className="flex min-h-0 min-w-0 flex-col">
                <PanelSectionHeader
                  icon={FolderOpen}
                  title="List scenario steps"
                  trailing={(
                    <div className="flex items-center gap-2">
                      <span className="text-[#7e8da5]">{steps.length} steps</span>
                      {!inspectorOpen && (
                        <button
                          type="button"
                          onClick={() => setInspectorOpen(true)}
                          className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-0.5 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]"
                        >
                          <PanelRightOpen className="h-3 w-3" />
                          {t('scenarioEditor.step.editTitle')}
                        </button>
                      )}
                    </div>
                  )}
                />

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {steps.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-center">
                      <FolderOpen className="mb-3 h-12 w-12 text-[#4e586b]" />
                      <p className="text-sm font-semibold text-white">Chưa có bước nào</p>
                      <p className="mt-1 text-xs text-[#7e8da5]">Bấm Record hoặc icon bên trái để thêm bước.</p>
                    </div>
                  ) : (
                    steps.map((step, idx) => (
                      <StepCard
                        key={step.id || idx}
                        step={step}
                        index={idx}
                        isSelected={idx === selectedStepIndex}
                        onSelect={handleSelectStep}
                        onDelete={handleDeleteStep}
                        onUpdate={(updates) => handleUpdateStep(idx, updates)}
                      />
                    ))
                  )}
                </div>
              </div>

              {inspectorOpen && (
                <div className="flex min-h-0 min-w-0 flex-col border-l border-[#2a2d34] bg-[#15171d]">
                  <PanelSectionHeader
                    icon={MousePointer2}
                    title={t('scenarioEditor.step.editTitle')}
                    onToggle={() => setStepEditorOpen((current) => !current)}
                    open={stepEditorOpen}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <span className="max-w-[100px] truncate text-[10px] font-normal normal-case text-[#68758a]">
                          {selectedStep ? describeStep(selectedStep.action_type, {}, t) : t('scenarioEditor.step.noneSelected')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setInspectorOpen(false)}
                          className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-0.5 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]"
                        >
                          <PanelRightClose className="h-3 w-3" />
                          {t('scenarioEditor.step.hideForm')}
                        </button>
                      </div>
                    )}
                  />
                  {stepEditorOpen && (
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                      <StepEditPanel
                        selectedStep={selectedStep}
                        variables={scenarioVariables}
                        onStepChange={(updates) => {
                          if (selectedStepIndex === null) return;
                          handleUpdateStep(selectedStepIndex, updates);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {timelineOpen ? (
          <section className="min-w-0 overflow-x-hidden border-t border-[#2a2d34] bg-[#14161b]">
            <PanelSectionHeader
              icon={Timer}
              title="Timeline keyframes"
              trailing={(
                <div className="max-w-[min(100%,720px)] overflow-x-auto">
                  <div className="flex w-max items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAutoTrim}
                      disabled={!hasSteps}
                      className="rounded border border-[#3c465c] px-2 py-1 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Auto Trim
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectingTrim((current) => !current);
                        setPendingTrimRange(null);
                      }}
                      disabled={!hasSteps}
                      className={`rounded border px-2 py-1 text-[10px] font-normal normal-case disabled:cursor-not-allowed disabled:opacity-40 ${
                        selectingTrim
                          ? 'border-[#635bff] bg-[#2a2550] text-[#c8c4ff]'
                          : 'border-[#3c465c] text-[#c7d0dc] hover:bg-[#243047]'
                      }`}
                    >
                      Chọn vùng xóa
                    </button>
                    {pendingTrimRange && Math.abs(pendingTrimRange.end_ms - pendingTrimRange.start_ms) >= 100 && (
                      <button
                        type="button"
                        onClick={handleSavePendingTrim}
                        className="rounded border border-[#635bff] bg-[#2a2550] px-2 py-1 text-[10px] font-normal normal-case text-[#c8c4ff] hover:bg-[#342f66]"
                      >
                        Xóa vùng đã chọn
                      </button>
                    )}
                    <span className="whitespace-nowrap text-[10px] font-normal normal-case text-[#7e8da5]">KEYFRAME KIM CƯƠNG = HÀNH ĐỘNG</span>
                    <button
                      type="button"
                      onClick={() => setTimelineOpen(false)}
                      className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-1 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]"
                    >
                      <ChevronDown className="h-3 w-3" />
                      Ẩn timeline
                    </button>
                  </div>
                </div>
              )}
            />
            <div className="overflow-x-auto px-4 pb-3 pt-3">
              <div className="h-24 min-w-[640px]">
                <Timeline
                  steps={steps}
                  currentTime={previewCurrentTime}
                  totalTime={totalTime || 20000}
                  onSeek={handleSeek}
                  selectingTrim={selectingTrim}
                  pendingTrimRange={pendingTrimRange}
                  onTrimRangeChange={(range) => setPendingTrimRange(normalizeTrimRanges([range], totalTime || 20000)[0] || null)}
                />
              </div>
            </div>
          </section>
        ) : (
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-[#2a2d34] bg-[#14161b] px-3">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase text-[#7288ff]">
              <Timer className="h-3.5 w-3.5" />
              Timeline keyframes
            </span>
            <button
              type="button"
              onClick={() => setTimelineOpen(true)}
              className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-1 text-[10px] text-[#c7d0dc] hover:bg-[#243047]"
            >
              <ChevronRight className="h-3 w-3 rotate-[-90deg]" />
              Hiện timeline
            </button>
          </div>
        )}
      </div>

      {/* ===== Record Mode Modal ===== */}
      {showRecordMode && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-[#344054] bg-[#1c2535] p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-white">Record lại kịch bản</h2>
            <p className="mt-2 text-sm text-[#b7c4d8]">
              Kịch bản đã có bước. Chọn cách đổ dữ liệu record mới vào timeline.
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => startRecording('replace')}
                className="rounded-md border border-[#3d4a60] bg-[#243047] px-4 py-3 text-left hover:bg-[#2b3852]"
              >
                <span className="block text-sm font-semibold text-white">Ghi đè steps hiện tại</span>
                <span className="mt-1 block text-xs text-[#9aa7b7]">Timeline sẽ được thay bằng dữ liệu vừa quay.</span>
              </button>
              <button
                type="button"
                onClick={() => startRecording('append')}
                className="rounded-md border border-[#3d4a60] bg-[#243047] px-4 py-3 text-left hover:bg-[#2b3852]"
              >
                <span className="block text-sm font-semibold text-white">Ghi nối tiếp</span>
                <span className="mt-1 block text-xs text-[#9aa7b7]">Dữ liệu mới được thêm vào cuối timeline hiện có.</span>
              </button>
              <button
                type="button"
                onClick={handleReplayAndRecord}
                disabled={replaying}
                className="rounded-md border border-[#3d4a60] bg-[#243047] px-4 py-3 text-left hover:bg-[#2b3852] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="block text-sm font-semibold text-white">
                  {replaying ? 'Đang phát lại steps cũ...' : 'Record lại (phát lại steps cũ trước)'}
                </span>
                <span className="mt-1 block text-xs text-[#9aa7b7]">
                  {replaying
                    ? 'Vui lòng chờ phát lại xong...'
                    : 'Phát lại các bước cũ, sau đó cho phép record thêm bước mới.'}
                </span>
              </button>
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setShowRecordMode(false)} className="btn-secondary">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Recording Status Overlay ===== */}
      {recording && recordStatus && (
        <div className="fixed bottom-4 left-4 z-50 rounded bg-[#ff3b59]/90 px-3 py-2 text-xs font-semibold text-white shadow-lg">
          <div className="flex items-center gap-3">
            <span className="animate-pulse">● Recording</span>
            <span>Sự kiện: {recordStatus.eventsCount || 0}</span>
            <span>Frame: {recordStatus.frameCount || 0}</span>
            <span>Thời gian: {formatSeconds(recordStatus.elapsedMs || 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgramMonitor({ platform, selectedStep, targetUrl, hasSteps, recording, previewPlaying, currentFrameUrl, currentTime, frameCount }) {
  const coords = selectedStep?.target_anchor?.relative_coords || { x: 42, y: 43 };
  const isFacebook = platform === 'facebook' || targetUrl?.includes('facebook');
  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  const drawFrame = useCallback((img = imageRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawImageContain(ctx, img, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        drawFrame();
      }
    });

    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, [drawFrame, currentFrameUrl]);

  useEffect(() => {
    if (!currentFrameUrl) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [currentFrameUrl]);

  return (
    <div className="relative flex aspect-video max-h-full w-full flex-none items-center justify-center overflow-hidden rounded border border-[#2b3038] bg-[#e9edf3]">
      {currentFrameUrl ? (
        <>
          <canvas
            ref={canvasRef}
            className="h-full w-full"
          />
          <img
            ref={imageRef}
            src={currentFrameUrl}
            alt=""
            className="hidden"
            onLoad={(event) => drawFrame(event.currentTarget)}
            onError={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }}
          />
        </>
      ) : isFacebook ? (
        <div className="grid h-full w-full max-w-[640px] grid-cols-[1.15fr_0.9fr] bg-[#f0f2f5] p-7 text-[#1c1e21]">
          <div className="flex flex-col justify-center">
            <div className="text-5xl font-bold tracking-normal text-[#1877f2]">facebook</div>
            <p className="mt-2 max-w-xs text-lg leading-snug">Facebook giúp bạn kết nối và chia sẻ với mọi người trong cuộc sống của bạn.</p>
          </div>
          <div className="my-auto rounded bg-white p-4 shadow">
            <input className="mb-2 h-11 w-full rounded border border-[#ccd0d5] px-3 text-sm" value="Email hoặc số điện thoại" readOnly />
            <input className="mb-3 h-11 w-full rounded border border-[#ccd0d5] px-3 text-sm" value="Mật khẩu" readOnly />
            <div className="mb-3 flex h-11 items-center justify-center rounded bg-[#1877f2] text-sm font-bold text-white">Đăng nhập</div>
            <div className="text-center text-xs text-[#1877f2]">Quên mật khẩu?</div>
            <div className="mx-auto mt-4 flex h-10 w-36 items-center justify-center rounded bg-[#42b72a] text-sm font-bold text-white">Tạo tài khoản mới</div>
          </div>
        </div>
      ) : (
        <div className="text-center text-[#344054]">
          <Code2 className="mx-auto mb-3 h-14 w-14 text-[#667085]" />
          <p className="text-sm font-semibold">Viewport Preview</p>
          <p className="mt-1 text-xs">{targetUrl || 'Chưa có URL đích'}</p>
        </div>
      )}

      {!hasSteps && !recording && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#101217]/80 text-center">
          <div>
            <CircleDot className="mx-auto mb-3 h-12 w-12 text-[#ff8fa0]" />
            <p className="text-sm font-semibold text-white">Chưa có dữ liệu quay</p>
            <p className="mt-1 text-xs text-[#9aa7b7]">Bấm Record để mở Chromium và ghi thao tác thật.</p>
          </div>
        </div>
      )}

      {recording && (
        <div className="absolute left-3 top-3 rounded bg-[#ff3b59] px-2 py-1 text-xs font-bold uppercase text-white">
          Recording
        </div>
      )}

      {previewPlaying && (
        <div className="absolute left-3 top-3 rounded bg-[#635bff] px-2 py-1 text-xs font-bold uppercase text-white">
          Preview {formatSeconds(currentTime)}
        </div>
      )}

      {frameCount > 0 && (
        <div className="absolute bottom-3 left-3 rounded bg-[#111827]/85 px-2 py-1 text-[10px] font-semibold text-[#dce5f2]">
          {frameCount} frames
        </div>
      )}

      {selectedStep?.action_type === 'click' && (
        <div
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#ff3b59] bg-[#ff3b59]/20"
          style={{ left: coords.x + '%', top: coords.y + '%' }}
        >
          <div className="absolute left-6 top-5 min-w-[128px] rounded bg-[#1b1b1f] px-2 py-1 text-[10px] font-bold uppercase text-[#ffb6c0] shadow">
            click event
          </div>
        </div>
      )}
    </div>
  );
}
