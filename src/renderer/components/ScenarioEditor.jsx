import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  Eye,
  FileDown,
  FolderOpen,
  KeyRound,
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
  Type,
  Upload,
  X,
} from 'lucide-react';
import { setCurrentPage, showToast } from '../slices/uiSlice';

// ===== Helper Components =====

function IconOnly({ icon: Icon, label, ...props }) {
  return (
    <button type="button" className="icon-button h-9 w-9 text-[#9aa7b7]" title={label} {...props}>
      <Icon className="h-4 w-4" />
    </button>
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
  click: { selector: '' },
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
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2, 9)}`,
    action_type: actionType,
    target_anchor: { action_config: defaultConfig[actionType] || {} },
    delay_ms: 1000,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function toDatabaseStep(step) {
  return {
    ...step,
    target_anchor: parseJsonObject(step.target_anchor),
  };
}

function normalizeSteps(steps) {
  if (!steps || !Array.isArray(steps)) return [];
  return steps.map((step, idx) => ({
    ...step,
    order: idx,
    target_anchor: parseJsonObject(step.target_anchor),
    action_config:
      parseJsonObject(step.target_anchor).action_config || {},
  }));
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
    accumulatedTime += steps[i].delay_ms || 1000;
    if (time < accumulatedTime) return i;
  }
  return steps.length - 1;
}

function buildAutoTrimRanges(steps, totalTime, thresholdMs = 2500, bufferMs = 500) {
  if (!steps.length || totalTime <= 0) return [];
  const actionTimes = steps.map((step, index) => getStepTime({ ...step, order: index }, steps));
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
    .reduce((sum, s) => sum + (s.delay_ms || 1000), 0);
  return totalBefore;
}

function formatSeconds(totalMs) {
  const totalSec = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(Math.floor(millis / 100)).padStart(1, '0')}`;
}

function describeStep(actionType, config) {
  const descriptions = {
    navigate: 'Điều hướng đến trang web',
    click: 'Click vào phần tử trên trang',
    type: 'Nhập văn bản vào ô input',
    wait: 'Chờ trong một khoảng thời gian',
    waitForElement: 'Chờ phần tử xuất hiện',
    screenshot: 'Chụp màn hình',
    scroll: 'Cuộn trang',
    extractText: 'Trích xuất văn bản',
    submit: 'Gửi form',
    login: 'Đăng nhập',
    facebookPost: 'Đăng bài Facebook',
    like: 'Tương tác Like',
    comment: 'Viết bình luận',
    customScript: 'Chạy JavaScript tùy chỉnh',
  };
  return descriptions[actionType] || actionType || 'Unknown';
}

function getAction(actionType) {
  const icons = {
    navigate: ArrowLeft,
    click: MousePointer2,
    type: Type,
    wait: Timer,
    waitForElement: Eye,
    screenshot: SquareCode,
    scroll: FolderOpen,
    extractText: FileDown,
    submit: KeyRound,
    login: KeyRound,
    facebookPost: Share2,
    like: Plus,
    comment: Type,
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
  const config = step.action_config || {};
  const Icon = getAction(step.action_type);
  const time = getStepTime(step, []);
  const selector = config.selector || step.target_anchor?.selector_value || '';
  const text = config.text || '';
  const duration = config.duration || step.delay_ms || 1000;

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
            {describeStep(step.action_type, config)}
          </span>
          <span className="shrink-0 text-[10px] text-[#76849b]">{formatSeconds(time)}</span>
        </div>

        {step.action_type === 'navigate' && config.url && (
          <div className="mt-0.5 truncate text-[10px] text-[#5b8def]">{config.url}</div>
        )}

        {step.action_type === 'click' && selector && (
          <div className="mt-0.5 truncate text-[10px] text-[#9aa7b7]">{selector}</div>
        )}

        {step.action_type === 'type' && (
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
  onScenarioChange,
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Nền tảng</span>
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
          <option value="custom">Tùy chỉnh</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">URL chính</span>
        <input
          value={targetUrl || ''}
          onChange={(event) => onScenarioChange({ nextTargetUrl: event.target.value })}
          className="input-field h-9"
          placeholder="https://..."
        />
      </label>

      <label className="col-span-2 block">
        <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Mô tả</span>
        <textarea
          value={description || ''}
          onChange={(event) => onScenarioChange({ nextDescription: event.target.value })}
          className="textarea-field min-h-[70px]"
          placeholder="Ghi chú kịch bản..."
        />
      </label>
    </div>
  );
}

function StepEditPanel({
  selectedStep,
  onStepChange,
}) {
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
    <div className="max-h-[42vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        {selectedStep ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Loại bước</span>
              <select
                value={selectedStep.action_type}
                onChange={(event) => onStepChange({
                  action_type: event.target.value,
                  action_config: defaultConfig[event.target.value] || {},
                  target_anchor: {
                    ...(selectedStep.target_anchor || {}),
                    action_config: defaultConfig[event.target.value] || {},
                  },
                })}
                className="select-field h-9"
              >
                <option value="navigate">Đi tới URL</option>
                <option value="click">Click</option>
                <option value="type">Type</option>
                <option value="wait">Wait</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Delay ms</span>
              <input
                type="number"
                value={selectedStep.delay_ms || 1000}
                onChange={(event) => onStepChange({ delay_ms: Number(event.target.value) })}
                className="input-field h-9"
              />
            </label>

            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">
                {selectedStep.action_type === 'navigate' ? 'URL' : 'Selector'}
              </span>
              <input
                value={
                  selectedStep.action_type === 'navigate'
                    ? config.url || ''
                    : config.selector || selectedStep.target_anchor?.selector_value || ''
                }
                onChange={(event) => updateSelector(event.target.value)}
                className="input-field h-9"
                placeholder={selectedStep.action_type === 'navigate' ? 'https://example.com' : 'CSS selector, aria label hoặc text'}
              />
            </label>

            {selectedStep.action_type === 'type' && (
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Text nhập</span>
                <input
                  value={config.text || ''}
                  onChange={(event) => updateActionConfig({ text: event.target.value })}
                  className="input-field h-9"
                  placeholder="Nội dung cần nhập hoặc {{variable}}"
                />
              </label>
            )}

            {selectedStep.action_type === 'wait' && (
              <label className="col-span-2 block">
                <span className="mb-1 block text-xs font-semibold text-[#b7c4d8]">Thời gian chờ</span>
                <input
                  type="number"
                  value={config.duration || selectedStep.delay_ms || 1000}
                  onChange={(event) => updateActionConfig({ duration: Number(event.target.value) })}
                  className="input-field h-9"
                />
              </label>
            )}
          </>
        ) : (
          <div className="col-span-2 rounded border border-[#2a2d34] bg-[#101217] px-3 py-4 text-sm text-[#8b97aa]">
            Chọn một bước trong danh sách để chỉnh sửa chi tiết.
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
  trimRanges = [],
  selectingTrim = false,
  pendingTrimRange = null,
  onTrimRangeChange,
}) {
  const timelineRef = useRef(null);
  const [dragStartTime, setDragStartTime] = useState(null);
  const maxTime = totalTime || steps.reduce((sum, s) => sum + (s.delay_ms || 1000), 0) || 10000;
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

        {trimRanges.map((range, index) => {
          const left = maxTime > 0 ? (range.start_ms / maxTime) * 100 : 0;
          const width = maxTime > 0 ? ((range.end_ms - range.start_ms) / maxTime) * 100 : 0;
          return (
            <div
              key={`${range.start_ms}-${range.end_ms}-${index}`}
              className="absolute top-0 h-full border-x border-[#ff5c75]/60 bg-[#ff3b59]/20"
              style={{ left: `${left}%`, width: `${Math.max(0.2, width)}%` }}
              title={`Trim ${formatSeconds(range.start_ms)} - ${formatSeconds(range.end_ms)}`}
            />
          );
        })}

        {pendingTrimRange && (
          <div
            className="absolute top-0 h-full border-x border-[#ff9aaa] bg-[#ff3b59]/35"
            style={{
              left: `${(Math.min(pendingTrimRange.start_ms, pendingTrimRange.end_ms) / maxTime) * 100}%`,
              width: `${Math.max(0.2, (Math.abs(pendingTrimRange.end_ms - pendingTrimRange.start_ms) / maxTime) * 100)}%`,
            }}
          />
        )}

        <div className="absolute left-4 right-4 top-1/2 h-px bg-[#344054]" />

        {steps.map((step, idx) => {
          const stepTime = getStepTime(step, steps);
          const left = maxTime > 0 ? Math.min(98, (stepTime / maxTime) * 100) : 0;
          return (
            <button
              key={step.id || idx}
              type="button"
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[#7e8da5] bg-[#20242c] data-[active=true]:border-[#ffd2d2] data-[active=true]:bg-[#ff3b59]"
              style={{ left: `${left}%` }}
              data-active={Math.abs(stepTime - currentTime) < Math.max(120, step.delay_ms || 1000)}
              title={`${describeStep(step.action_type)} - ${formatSeconds(stepTime)}`}
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
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [scenarioPreviewPath, setScenarioPreviewPath] = useState(scenario?.preview_path || null);
  const [scenarioPreviewUrl, setScenarioPreviewUrl] = useState(scenario?.preview_url || null);
  const [recordStatus, setRecordStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [settings, setSettings] = useState({});
  const [frameDataUrls, setFrameDataUrls] = useState({});
  const [trimRanges, setTrimRanges] = useState(normalizeTrimRanges(scenario?.preview_trim_ranges));
  const [selectingTrim, setSelectingTrim] = useState(false);
  const [pendingTrimRange, setPendingTrimRange] = useState(null);
  const scenarioDraftRef = useRef({
    name: scenario?.name || '',
    description: scenario?.description || '',
    platform: scenario?.platform || 'facebook',
    targetUrl: scenario?.target_url || '',
  });

  // ======== Derived State ========
  const hasSteps = steps.length > 0;
  const totalTime = steps.reduce((sum, s) => sum + (s.delay_ms || 1000), 0);
  const selectedStep = selectedStepIndex !== null ? steps[selectedStepIndex] : null;
  const previewFrames = useMemo(() => (
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
  }, []);

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
        };
        setName(s.name || name);
        setDescription(s.description || '');
        setPlatform(s.platform || 'custom');
        setTargetUrl(s.target_url || '');
      }
      if (s?.preview_path) {
        setScenarioPreviewPath(s.preview_path);
        setScenarioPreviewUrl(s.preview_url || null);
      }
      if (s?.recorded_width && s?.recorded_height) {
        setActiveViewport({ width: s.recorded_width, height: s.recorded_height });
      }
      setTrimRanges(normalizeTrimRanges(s?.preview_trim_ranges));
    }).catch(() => {});
  }, [currentScenarioId]);

  useEffect(() => {
    const missingPaths = steps
      .map((step) => step.target_anchor?.associated_frame)
      .filter((item) => item && !frameDataUrls[item]);

    if (!missingPaths.length || !window.electronAPI.readFrameDataUrl) return;

    let cancelled = false;
    Promise.all([...new Set(missingPaths)].map(async (filePath) => {
      try {
        const dataUrl = await window.electronAPI.readFrameDataUrl(filePath);
        return dataUrl ? [filePath, dataUrl] : null;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) return;
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
  }, [frameDataUrls, steps]);

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

    const totalTime = steps.reduce((sum, s) => sum + (s.delay_ms || 1000), 0);
    let lastTick = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      setPreviewCurrentTime((current) => {
        const nextTime = skipTrimForward(current + delta, trimRanges, totalTime);
        if (nextTime >= totalTime) {
          setPreviewPlaying(false);
          setSelectedStepIndex(steps.length - 1);
          return totalTime;
        }
        setSelectedStepIndex(findStepIndexAtTime(nextTime, steps));
        return nextTime;
      });
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, [previewPlaying, hasSteps, steps, trimRanges]);

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
        recorded_width: activeViewport.width,
        recorded_height: activeViewport.height,
        preview_trim_ranges: trimRanges,
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
  }, [currentScenarioId, name, platform, activeViewport, steps, trimRanges, dispatch]);

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
        importProfileId: s['browser.importProfileId'] || null,
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
  }, [currentScenarioId, name, targetUrl, platform, activeViewport, settings, persist, dispatch]);

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
      });
      if (result.opened) {
        dispatch(showToast({ type: 'success', message: 'Đã mở Chromium. Đóng cửa sổ Chromium khi xong.' }));
      } else {
        dispatch(showToast({ type: 'error', message: result.error || 'Không thể mở Chromium' }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Không thể mở Chromium' }));
    }
  }, [activeViewport, currentScenarioId, dispatch, platform, targetUrl]);

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
        importProfileId: s['browser.importProfileId'] || null,
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
  }, [activeViewport, dispatch, persist, platform, targetUrl, settings]);

  const handlePublish = useCallback(async () => {
    if (!currentScenarioId) {
      const saved = await persist();
      if (!saved?.id) {
        dispatch(showToast({ type: 'error', message: 'Lưu kịch bản trước khi xuất bản' }));
        return;
      }
    }
    const id = currentScenarioId;
    setPublishing(true);
    dispatch(showToast({ type: 'info', message: 'Đang render video từ các frame screenshot...' }));
    try {
      const result = await window.electronAPI.renderScenarioVideo(id);
      if (result.success) {
        setScenarioPreviewPath(result.filePath);
        setScenarioPreviewUrl(result.fileUrl);
        dispatch(showToast({ type: 'success', message: 'Xuất bản video thành công!' }));
      } else {
        dispatch(showToast({ type: 'error', message: result.error || 'Không thể xuất bản video' }));
      }
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Lỗi khi xuất bản video' }));
    } finally {
      setPublishing(false);
    }
  }, [currentScenarioId, dispatch, persist]);

  const addStep = useCallback((actionType) => {
    const newStep = createStep(actionType);
    setSteps((prev) => [...prev, newStep]);
  }, []);

  const handleDeleteStep = useCallback((index) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setSelectedStepIndex((prev) => (prev === index ? null : prev > index ? prev - 1 : prev));
  }, []);

  const handleSelectStep = useCallback((index) => {
    setSelectedStepIndex(index);
  }, []);

  const handleUpdateStep = useCallback((index, updates) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const saveTrimRanges = useCallback(async (nextRanges) => {
    try {
      const scenarioData = {
        ...(currentScenarioId ? { id: currentScenarioId } : {}),
        name: scenarioDraftRef.current.name || name,
        description: scenarioDraftRef.current.description,
        platform: scenarioDraftRef.current.platform || platform,
        target_url: scenarioDraftRef.current.targetUrl || '',
        recorded_width: activeViewport.width,
        recorded_height: activeViewport.height,
        preview_path: scenarioPreviewPath,
        preview_trim_ranges: nextRanges,
      };
      const saved = await window.electronAPI.saveScenario(scenarioData, steps.map(toDatabaseStep));
      if (saved?.id) {
        setCurrentScenarioId(saved.id);
      }
      return saved;
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || 'Không lưu được vùng trim' }));
      return null;
    }
  }, [activeViewport, currentScenarioId, description, dispatch, name, platform, scenarioPreviewPath, steps, targetUrl]);

  const handleAutoTrim = useCallback(async () => {
    const autoRanges = buildAutoTrimRanges(steps, totalTime || 0);
    if (!autoRanges.length) {
      dispatch(showToast({ type: 'info', message: 'Không có đoạn trống dài để cắt.' }));
      return;
    }
    const manualRanges = trimRanges.filter((range) => range.source === 'manual');
    const nextRanges = mergeTrimRanges([...manualRanges, ...autoRanges]);
    setTrimRanges(nextRanges);
    setPendingTrimRange(null);
    setSelectingTrim(false);
    await saveTrimRanges(nextRanges);
    dispatch(showToast({ type: 'success', message: `Đã auto trim ${autoRanges.length} đoạn trống.` }));
  }, [dispatch, saveTrimRanges, steps, totalTime, trimRanges]);

  const handleSavePendingTrim = useCallback(async () => {
    const normalized = normalizeTrimRanges([pendingTrimRange], totalTime || 0);
    if (!normalized.length) {
      dispatch(showToast({ type: 'error', message: 'Vùng chọn quá ngắn.' }));
      return;
    }
    const nextRanges = mergeTrimRanges([...trimRanges, { ...normalized[0], source: 'manual' }]);
    setTrimRanges(nextRanges);
    setPendingTrimRange(null);
    setSelectingTrim(false);
    await saveTrimRanges(nextRanges);
    dispatch(showToast({ type: 'success', message: 'Đã trim vùng đã chọn.' }));
  }, [dispatch, pendingTrimRange, saveTrimRanges, totalTime, trimRanges]);

  const handleClearTrim = useCallback(async () => {
    setTrimRanges([]);
    setPendingTrimRange(null);
    setSelectingTrim(false);
    await saveTrimRanges([]);
    dispatch(showToast({ type: 'success', message: 'Đã bỏ toàn bộ trim preview.' }));
  }, [dispatch, saveTrimRanges]);

  const handleSeek = useCallback((time) => {
    const nextTime = skipTrimForward(time, trimRanges, totalTime || 0);
    setPreviewCurrentTime(nextTime);
    setSelectedStepIndex(findStepIndexAtTime(nextTime, steps));
  }, [steps, totalTime, trimRanges]);

  // ======== Render ========
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111216] text-[#dce5f2]">
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
          <span className="ml-4 rounded border border-[#3f4a5f] px-2 py-1 text-[10px] uppercase text-[#9eb2d0]">
            Premiere View
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="rounded-full bg-[#5a5b5f] px-3 py-1 text-xs font-semibold text-white">Mã</button>
          <button type="button" className="rounded-full bg-[#111216] px-3 py-1 text-xs font-semibold text-white ring-1 ring-[#5b5f69]">Xem trước</button>
          <IconOnly icon={FileDown} label="Xuất file" />
          <IconOnly icon={Upload} label={publishing ? 'Đang xuất...' : 'Xuất bản'} onClick={handlePublish} disabled={recording || !hasSteps || publishing} />
          <IconOnly icon={Share2} label="Chia sẻ" />
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
            {saving ? 'Đang lưu' : 'Lưu kịch bản'}
          </button>
          <button type="button" onClick={onBack} className="icon-button" title="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_190px]">
        <div className={`grid min-h-0 ${inspectorOpen ? 'grid-cols-[minmax(420px,1fr)_minmax(420px,0.98fr)]' : 'grid-cols-[minmax(420px,1fr)_320px]'}`}>
          <section className="flex min-h-0 flex-col border-r border-[#2a2d34]">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
              <span className="inline-flex items-center gap-2"><Code2 className="h-3.5 w-3.5" />PROGRAM: VIEWPORT MONITOR</span>
              <span className="text-[#7e8da5]">RES: {activeViewport.width} x {activeViewport.height}</span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mx-auto flex w-full max-w-[720px] flex-1 items-center">
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

              <div className="mt-3 flex items-center justify-between">
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

          <section className="flex min-h-0 flex-col">
            <div className="flex h-8 shrink-0 items-center justify-end border-b border-[#2a2d34] px-3">
              <button
                type="button"
                onClick={() => setInspectorOpen((current) => !current)}
                className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-1 text-[10px] text-[#c7d0dc] hover:bg-[#243047]"
              >
                {inspectorOpen ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
                {inspectorOpen ? 'Ẩn form' : 'Sửa bước'}
              </button>
            </div>

            <div className={`grid min-h-0 flex-1 ${inspectorOpen ? 'grid-rows-[auto_auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}>
              {inspectorOpen && (
              <>
                <div className="border-b border-[#2a2d34] bg-[#15171d] p-3">
                  <div className="rounded-md border border-[#2a2d34] bg-[#11141b]">
                  <button
                    type="button"
                    onClick={() => setScenarioInfoOpen((current) => !current)}
                    className="flex h-8 w-full items-center gap-2 border-b border-[#252b36] px-2 text-left text-[11px] font-bold uppercase text-[#8a96a8] hover:bg-[#171c25]"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 transition ${scenarioInfoOpen ? 'rotate-90' : ''}`} />
                    Thông tin kịch bản
                  </button>
                  {scenarioInfoOpen && (
                    <div className="p-3">
                      <ScenarioInfoPanel
                        description={description}
                        platform={platform}
                        targetUrl={targetUrl}
                        onScenarioChange={updateScenarioDraft}
                      />
                    </div>
                  )}
                  </div>
                </div>

                <div className="border-b border-[#2a2d34] bg-[#15171d] p-3">
                  <div className="rounded-md border border-[#2a2d34] bg-[#11141b]">
                  <button
                    type="button"
                    onClick={() => setStepEditorOpen((current) => !current)}
                    className="flex h-8 w-full items-center justify-between border-b border-[#252b36] px-2 text-left hover:bg-[#171c25]"
                  >
                    <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase text-[#8a96a8]">
                      <ChevronRight className={`h-3.5 w-3.5 transition ${stepEditorOpen ? 'rotate-90' : ''}`} />
                      Sửa bước
                    </span>
                    <span className="text-[10px] text-[#68758a]">{selectedStep ? describeStep(selectedStep.action_type) : 'Chưa chọn bước'}</span>
                  </button>
                  {stepEditorOpen && (
                  <div className="p-3">
                    <div className="mb-3 flex flex-wrap gap-2">
                      {['navigate', 'click', 'type', 'wait'].map((actionType) => (
                        <button key={actionType} type="button" onClick={() => addStep(actionType)} className="btn-secondary h-9 px-3">
                          <Plus className="h-3.5 w-3.5" />
                          {actionType === 'navigate' ? 'Đi tới URL' : actionType === 'click' ? 'Click' : actionType === 'type' ? 'Type' : 'Wait'}
                        </button>
                      ))}
                    </div>
                    <StepEditPanel
                      selectedStep={selectedStep}
                      onStepChange={(updates) => {
                        if (selectedStepIndex === null) return;
                        handleUpdateStep(selectedStepIndex, updates);
                      }}
                    />
                  </div>
                  )}
                  </div>
                </div>
              </>
              )}

              <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
                <span className="inline-flex items-center gap-2"><FolderOpen className="h-3.5 w-3.5" />LIST SCENARIO STEPS</span>
                <span className="text-[#7e8da5]">{steps.length} steps</span>
              </div>

              <div className="min-h-0 space-y-2 overflow-y-auto p-3">
                {steps.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <FolderOpen className="mb-3 h-12 w-12 text-[#4e586b]" />
                    <p className="text-sm font-semibold text-white">Chưa có bước nào</p>
                    <p className="mt-1 text-xs text-[#7e8da5]">Bấm Record để quay thao tác và đổ dữ liệu vào timeline.</p>
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
          </section>
        </div>

        <section className="border-t border-[#2a2d34] bg-[#14161b]">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#2a2d34] px-3 text-[11px] font-bold uppercase text-[#7288ff]">
            <span className="inline-flex items-center gap-2"><Timer className="h-3.5 w-3.5" />TIMELINE KEYFRAMES</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAutoTrim}
                disabled={!hasSteps}
                className="rounded border border-[#3c465c] px-2 py-1 text-[10px] text-[#c7d0dc] hover:bg-[#243047] disabled:cursor-not-allowed disabled:opacity-40"
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
                className={`rounded border px-2 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectingTrim
                    ? 'border-[#ff6b7a] bg-[#3a1d28] text-[#ffd0d8]'
                    : 'border-[#3c465c] text-[#c7d0dc] hover:bg-[#243047]'
                }`}
              >
                Select Trim
              </button>
              {pendingTrimRange && Math.abs(pendingTrimRange.end_ms - pendingTrimRange.start_ms) >= 100 && (
                <button
                  type="button"
                  onClick={handleSavePendingTrim}
                  className="rounded border border-[#ff6b7a] bg-[#3a1d28] px-2 py-1 text-[10px] text-[#ffd0d8] hover:bg-[#4a2431]"
                >
                  Delete selected range
                </button>
              )}
              <button
                type="button"
                onClick={handleClearTrim}
                disabled={!trimRanges.length}
                className="rounded border border-[#3c465c] px-2 py-1 text-[10px] text-[#c7d0dc] hover:bg-[#243047] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear Trim
              </button>
              <span className="text-[#7e8da5]">KEYFRAME KIM CƯƠNG = HÀNH ĐỘNG</span>
            </div>
          </div>
          <div className="px-4 pb-4 pt-3">
            <div className="h-24">
              <Timeline
                steps={steps}
                currentTime={previewCurrentTime}
                totalTime={totalTime || 20000}
                onSeek={handleSeek}
                trimRanges={trimRanges}
                selectingTrim={selectingTrim}
                pendingTrimRange={pendingTrimRange}
                onTrimRangeChange={(range) => setPendingTrimRange(normalizeTrimRanges([range], totalTime || 20000)[0] || null)}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-[#7e8da5]">
              <span>
                {selectingTrim
                  ? 'Kéo trên timeline để chọn vùng trống, rồi bấm Delete selected range.'
                  : 'Mẹo: Click vào khoảng trống bất kỳ trên timeline để chọn bước cần sửa.'}
              </span>
              <button type="button" className="inline-flex items-center gap-2 text-[#ff9f9f]">
                <Trash2 className="h-3.5 w-3.5" />
                Xóa kịch bản
              </button>
            </div>
          </div>
        </section>
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

      {selectedStep && selectedStep.action_type !== 'navigate' && (
        <div
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#ff3b59] bg-[#ff3b59]/20"
          style={{ left: coords.x + '%', top: coords.y + '%' }}
        >
          <div className="absolute left-6 top-5 min-w-[128px] rounded bg-[#1b1b1f] px-2 py-1 text-[10px] font-bold uppercase text-[#ffb6c0] shadow">
            {selectedStep.action_type} event
          </div>
        </div>
      )}
    </div>
  );
}
