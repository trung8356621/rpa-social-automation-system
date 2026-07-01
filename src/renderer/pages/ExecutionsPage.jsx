import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios } from '../slices/scenarioSlice';
import { runScenario, fetchAllExecutions, fetchExecutionDetail, clearCurrentExecution, clearAllExecutions } from '../slices/executionSlice';
import { showToast, openModal, closeModal } from '../slices/uiSlice';
import { useTranslation } from '../i18n';
import {
  Play,
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  Terminal,
  X,
  Trash2,
  EyeOff,
} from 'lucide-react';

const LS_HEADLESS = 'executions:headless';
const LS_VIEWPORT_WIDTH = 'executions:viewportWidth';
const LS_VIEWPORT_HEIGHT = 'executions:viewportHeight';

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const MIN_VIEWPORT = { width: 320, height: 240 };
const MAX_VIEWPORT = { width: 4096, height: 4096 };
const VIEWPORT_PRESETS = [
  {
    label: 'Mobile',
    options: [
      { label: 'Mobile S - 360 x 640', width: 360, height: 640 },
      { label: 'Mobile M - 390 x 844', width: 390, height: 844 },
      { label: 'Mobile L - 414 x 896', width: 414, height: 896 },
      { label: 'Android phổ biến - 360 x 800', width: 360, height: 800 },
    ],
  },
  {
    label: 'Tablet',
    options: [
      { label: 'iPad Mini - 768 x 1024', width: 768, height: 1024 },
      { label: 'iPad Pro - 1024 x 1366', width: 1024, height: 1366 },
    ],
  },
  {
    label: 'PC',
    options: [
      { label: 'HD - 1280 x 720', width: 1280, height: 720 },
      { label: 'Laptop - 1366 x 768', width: 1366, height: 768 },
      { label: 'Desktop - 1440 x 900', width: 1440, height: 900 },
      { label: 'Desktop - 1536 x 864', width: 1536, height: 864 },
      { label: 'Full HD - 1920 x 1080', width: 1920, height: 1080 },
    ],
  },
];

function viewportKey(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function clampViewport(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function ProgressBar({ completed, total }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="mt-2 h-1 w-full rounded-full bg-slate-700 overflow-hidden">
      <div
        className="h-full rounded-full bg-yellow-400 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function getCrawlRowCount(resultJson) {
  if (!resultJson) return null;
  if (Array.isArray(resultJson)) return resultJson.length;
  if (typeof resultJson !== 'object') return null;
  if (resultJson.scenario_type && resultJson.scenario_type !== 'crawl' && resultJson.scenario_type !== 'request_catching') return null;

  if (Array.isArray(resultJson.crawledData)) {
    return resultJson.crawledData.length;
  }

  const values = Object.values(resultJson);
  const crawlArrays = values.filter((value) => (
    Array.isArray(value)
    && value.every((item) => item && typeof item === 'object' && ('card_index' in item || 'data' in item))
  ));
  if (crawlArrays.length) {
    return Math.max(...crawlArrays.map((items) => items.length));
  }
  if (values.length && values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
    return values.length;
  }
  return null;
}

export default function ExecutionsPage() {
  const dispatch = useDispatch();
  const { t, language } = useTranslation();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const { items: scenarios } = useSelector((state) => state.scenarios);
  const { items: executions, runningExecutions = {}, loading: execLoading, currentExecution, liveStatus } = useSelector((state) => state.executions);
  const modalOpen = useSelector((state) => state.ui.modalOpen);

  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [selectedBrowserProfileId, setSelectedBrowserProfileId] = useState('');
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [sampleOptions, setSampleOptions] = useState([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [browserProfileOptions, setBrowserProfileOptions] = useState([]);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [headless, setHeadless] = useState(() => {
    try { return localStorage.getItem(LS_HEADLESS) === 'true'; } catch { return false; }
  });
  const [viewportWidth, setViewportWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(LS_VIEWPORT_WIDTH));
      return clampViewport(stored, MIN_VIEWPORT.width, MAX_VIEWPORT.width, DEFAULT_VIEWPORT.width);
    } catch { return DEFAULT_VIEWPORT.width; }
  });
  const [viewportHeight, setViewportHeight] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(LS_VIEWPORT_HEIGHT));
      return clampViewport(stored, MIN_VIEWPORT.height, MAX_VIEWPORT.height, DEFAULT_VIEWPORT.height);
    } catch { return DEFAULT_VIEWPORT.height; }
  });
  const lastNotifyRef = useRef('');

  const runningList = Object.values(runningExecutions);
  const runningCount = runningList.length;

  useEffect(() => {
    dispatch(fetchScenarios());
    dispatch(fetchAllExecutions());
    window.electronAPI.listAppBrowserProfiles?.()
      .then((profiles) => setBrowserProfileOptions(Array.isArray(profiles) ? profiles : []))
      .catch(() => setBrowserProfileOptions([]));
  }, [dispatch]);

  useEffect(() => {
    if (!selectedScenarioId) return;
    const scenario = scenarios.find((item) => item.id === selectedScenarioId);
    if (!scenario) return;
    setSelectedBrowserProfileId(scenario.browser_profile_id || '');
    setSelectedSampleId('');
    setViewportWidth(clampViewport(
      scenario.recorded_width,
      MIN_VIEWPORT.width,
      MAX_VIEWPORT.width,
      DEFAULT_VIEWPORT.width,
    ));
    setViewportHeight(clampViewport(
      scenario.recorded_height,
      MIN_VIEWPORT.height,
      MAX_VIEWPORT.height,
      DEFAULT_VIEWPORT.height,
    ));
  }, [selectedScenarioId, scenarios]);

  useEffect(() => {
    if (!window.electronAPI?.getVariableProfileSamples) {
      setSampleOptions([]);
      return undefined;
    }

    let cancelled = false;
    setSamplesLoading(true);

    const selectedScenario = scenarios.find((item) => item.id === selectedScenarioId);
    const profileFilter = selectedScenario?.variable_profile_id || null;

    window.electronAPI.getVariableProfileSamples(profileFilter)
      .then((items) => {
        if (cancelled) return;
        setSampleOptions(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (!cancelled) setSampleOptions([]);
      })
      .finally(() => { if (!cancelled) setSamplesLoading(false); });

    return () => { cancelled = true; };
  }, [selectedScenarioId, scenarios]);

  useEffect(() => {
    if (!liveStatus?.type) return;
    const notifyKey = `${liveStatus.type}:${liveStatus.executionId || ''}:${liveStatus.timestamp || ''}`;
    if (lastNotifyRef.current === notifyKey) return;
    lastNotifyRef.current = notifyKey;

    if (liveStatus.type === 'execution:failed') {
      dispatch(showToast({ type: 'error', message: liveStatus.error || t('executions.toast.failed') }));
    }
    if (liveStatus.type === 'execution:completed') {
      dispatch(showToast({
        type: 'success',
        message: t('executions.toast.completed', { name: liveStatus.scenarioName || t('scenarios.title') }),
      }));
    }
    if (liveStatus.type === 'execution:closing') {
      dispatch(showToast({ type: 'info', message: liveStatus.message || t('executions.toast.closingBrowser') }));
    }
  }, [dispatch, liveStatus, t]);

  const handleHeadlessChange = (e) => {
    const val = e.target.checked;
    setHeadless(val);
    try { localStorage.setItem(LS_HEADLESS, String(val)); } catch { /* ignore */ }
  };

  const handleViewportPresetChange = (event) => {
    const [rawWidth, rawHeight] = event.target.value.split('x');
    const next = {
      width: clampViewport(rawWidth, MIN_VIEWPORT.width, MAX_VIEWPORT.width, DEFAULT_VIEWPORT.width),
      height: clampViewport(rawHeight, MIN_VIEWPORT.height, MAX_VIEWPORT.height, DEFAULT_VIEWPORT.height),
    };
    setViewportWidth(next.width);
    setViewportHeight(next.height);
    try {
      localStorage.setItem(LS_VIEWPORT_WIDTH, String(next.width));
      localStorage.setItem(LS_VIEWPORT_HEIGHT, String(next.height));
    } catch { /* ignore */ }
  };

  const selectedScenario = scenarios.find((item) => item.id === selectedScenarioId) || null;
  const recordedViewport = selectedScenario
    ? {
      width: clampViewport(
        selectedScenario.recorded_width,
        MIN_VIEWPORT.width,
        MAX_VIEWPORT.width,
        DEFAULT_VIEWPORT.width,
      ),
      height: clampViewport(
        selectedScenario.recorded_height,
        MIN_VIEWPORT.height,
        MAX_VIEWPORT.height,
        DEFAULT_VIEWPORT.height,
      ),
    }
    : null;
  const viewportOverridden = Boolean(
    selectedScenario
    && recordedViewport
    && (viewportWidth !== recordedViewport.width || viewportHeight !== recordedViewport.height),
  );
  const currentViewport = {
    width: clampViewport(viewportWidth, MIN_VIEWPORT.width, MAX_VIEWPORT.width, DEFAULT_VIEWPORT.width),
    height: clampViewport(viewportHeight, MIN_VIEWPORT.height, MAX_VIEWPORT.height, DEFAULT_VIEWPORT.height),
  };
  const presetKeys = new Set(
    VIEWPORT_PRESETS.flatMap((group) => group.options.map((option) => viewportKey(option))),
  );
  const extraViewportOptions = [];
  if (recordedViewport && !presetKeys.has(viewportKey(recordedViewport))) {
    extraViewportOptions.push({
      label: `${t('executions.recordedViewportOption')} - ${recordedViewport.width} x ${recordedViewport.height}`,
      width: recordedViewport.width,
      height: recordedViewport.height,
    });
  }
  if (!presetKeys.has(viewportKey(currentViewport))
    && (!recordedViewport || viewportKey(currentViewport) !== viewportKey(recordedViewport))) {
    extraViewportOptions.push({
      label: `${t('executions.currentViewportOption')} - ${currentViewport.width} x ${currentViewport.height}`,
      width: currentViewport.width,
      height: currentViewport.height,
    });
  }

  const handleRunScenario = async () => {
    if (!selectedScenarioId) return;
    if (!selectedBrowserProfileId) {
      dispatch(showToast({
        type: 'error',
        message: t('executions.toast.selectProfileToRun'),
      }));
      return;
    }
    const browserProfileId = selectedBrowserProfileId;
    const runViewport = {
      width: clampViewport(
        viewportWidth,
        MIN_VIEWPORT.width,
        MAX_VIEWPORT.width,
        recordedViewport?.width || DEFAULT_VIEWPORT.width,
      ),
      height: clampViewport(
        viewportHeight,
        MIN_VIEWPORT.height,
        MAX_VIEWPORT.height,
        recordedViewport?.height || DEFAULT_VIEWPORT.height,
      ),
    };
    const result = await dispatch(runScenario({
      scenarioId: selectedScenarioId,
      browserProfileId,
      sampleId: selectedSampleId || null,
      headless,
      viewport: runViewport,
    }));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'info', message: t('executions.toast.commandSent') }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('executions.toast.runFailed') }));
    }
  };

  const openBrowserSessionApi = window.electronAPI.openBrowserSession || window.electronAPI.openGuestBrowser;

  const handleOpenBrowser = async () => {
    if (!openBrowserSessionApi) {
      dispatch(showToast({ type: 'error', message: t('executions.toast.restartApp') }));
      return;
    }
    if (!selectedBrowserProfileId) {
      dispatch(showToast({ type: 'error', message: t('executions.toast.selectProfileToOpen') }));
      return;
    }
    const scenario = scenarios.find((item) => item.id === selectedScenarioId);
    const browserProfileId = selectedBrowserProfileId;
    setOpeningBrowser(true);
    try {
      await openBrowserSessionApi({ scenarioId: selectedScenarioId || null, browserProfileId, startUrl: scenario?.target_url || null });
      const profileLabel = browserProfileOptions.find((item) => item.id === browserProfileId)?.display_name || 'profile app';
      dispatch(showToast({ type: 'success', message: t('executions.toast.browserOpened', { profile: profileLabel }) }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('executions.toast.browserOpenFailed') }));
    } finally {
      setOpeningBrowser(false);
    }
  };

  const viewExecutionDetail = (executionId) => {
    dispatch(fetchExecutionDetail(executionId));
    dispatch(openModal({ type: 'executionDetail' }));
  };

  const closeExecutionDetail = () => {
    dispatch(closeModal());
    dispatch(clearCurrentExecution());
  };

  const handleClearHistory = async () => {
    if (!executions.length) return;
    const confirmed = window.confirm(
      t('executions.confirm.clearHistory', { count: executions.length }),
    );
    if (!confirmed) return;
    setClearingHistory(true);
    const result = await dispatch(clearAllExecutions());
    setClearingHistory(false);
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(closeModal());
      dispatch(clearCurrentExecution());
      dispatch(showToast({
        type: 'success',
        message: t('executions.toast.historyCleared', { count: result.payload?.deleted ?? 0 }),
      }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('executions.toast.clearHistoryFailed') }));
    }
  };

  const formatDateTime = (value) => {
    if (!value) return t('common.na');
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t('common.na') : date.toLocaleString(dateLocale);
  };

  const statsTotal = executions.length;
  const statsSuccess = executions.filter((e) => e.status === 'completed').length;
  const statsFailed = executions.filter((e) => e.status === 'failed').length;
  const formatResultJson = (value) => {
    if (!value) return '';
    try {
      return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
    } catch {
      return String(value);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('executions.title')}</h1>
          <p className="text-sm text-slate-400 mt-1">{t('executions.subtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2">
            <Globe className="h-4 w-4 shrink-0 text-slate-400" />
            <select
              value={selectedBrowserProfileId}
              onChange={(e) => setSelectedBrowserProfileId(e.target.value)}
              className="select-field min-w-[200px] border-0 bg-transparent py-1 text-sm"
            >
              <option value="">{t('executions.selectBrowserProfile')}</option>
              {browserProfileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.display_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleOpenBrowser}
              disabled={openingBrowser}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-800"
              title={t('executions.openBrowserTitle')}
            >
              {openingBrowser ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            </button>
          </div>
          <p className="max-w-[280px] text-right text-xs text-slate-500">
            {t('executions.browserProfileHint')}
          </p>
        </div>
      </div>

      {/* Run Scenario Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">{t('executions.runSection.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedScenarioId || ''}
            onChange={(e) => {
              setSelectedScenarioId(e.target.value || null);
              setSelectedSampleId('');
            }}
            className="select-field max-w-md min-w-[220px]"
          >
            <option value="">{t('executions.selectScenario')}</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.platform})</option>
            ))}
          </select>

          {selectedScenarioId && (
            <select
              value={selectedSampleId}
              onChange={(e) => setSelectedSampleId(e.target.value)}
              disabled={samplesLoading}
              className="select-field max-w-md min-w-[220px]"
            >
              <option value="">{t('executions.defaultSample')}</option>
              {sampleOptions.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.profile_name ? `${sample.profile_name} / ${sample.name}` : sample.name}
                </option>
              ))}
            </select>
          )}

          {/* Headless toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-300 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/60 hover:border-slate-600 transition-colors">
            <input
              type="checkbox"
              checked={headless}
              onChange={handleHeadlessChange}
              className="w-4 h-4 accent-blue-500"
            />
            <EyeOff className="w-3.5 h-3.5 text-slate-400" />
            {t('executions.headless')}
          </label>

          {selectedScenarioId && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">{t('executions.viewport')}</span>
                <select
                  value={viewportKey(currentViewport)}
                  onChange={handleViewportPresetChange}
                  className="select-field h-9 min-w-[250px] text-sm"
                >
                  {extraViewportOptions.length > 0 && (
                    <optgroup label={t('executions.viewportSavedGroup')}>
                      {extraViewportOptions.map((option) => (
                        <option key={viewportKey(option)} value={viewportKey(option)}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {VIEWPORT_PRESETS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={viewportKey(option)} value={viewportKey(option)}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {recordedViewport && (
                <p className="pb-1 text-[11px] text-slate-500">
                  {t('executions.recordedViewport', {
                    width: recordedViewport.width,
                    height: recordedViewport.height,
                  })}
                  {viewportOverridden && (
                    <span className="ml-1 text-amber-400">{t('executions.viewportOverrideActive')}</span>
                  )}
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleRunScenario}
            disabled={!selectedScenarioId || !selectedBrowserProfileId}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-medium transition-all"
          >
            <Play className="w-4 h-4" />
            {t('common.run')}
          </button>
        </div>

        {runningCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-yellow-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('executions.runningParallel', { count: runningCount })}
          </div>
        )}

        {selectedScenarioId && (
          <p className="mt-3 text-xs text-slate-500">{t('executions.viewportHint')}</p>
        )}
      </div>

      {/* Stats Summary */}
      {statsTotal > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-emerald-400">{statsSuccess}</p>
            <p className="text-sm text-slate-400">{t('status.success')}</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-red-400">{statsFailed}</p>
            <p className="text-sm text-slate-400">{t('status.failed')}</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-yellow-400">{runningCount}</p>
            <p className="text-sm text-slate-400">{t('status.running')}</p>
          </div>
        </div>
      )}

      {/* Execution History */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{t('executions.history.title')}</h2>
          {executions.length > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={clearingHistory || execLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/60 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              title={t('executions.history.clearTitle')}
            >
              {clearingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {t('executions.history.clear')}
            </button>
          )}
        </div>

        <div className="space-y-3">
          {/* Live running items — shown at top */}
          {runningList.map((exec) => (
            <div
              key={exec.id}
              className="bg-slate-800/50 border border-yellow-700/50 rounded-xl p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Loader2 className="w-5 h-5 text-yellow-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200">
                      {exec.scenario_name || t('common.na')}
                      <span className="ml-2 text-xs font-normal text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">
                        {t('status.runningBadge')}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">{formatDateTime(exec.started_at)}</p>
                    <ProgressBar completed={exec.completed_steps || 0} total={exec.total_steps || 0} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 ml-4 shrink-0">
                  {t('common.stepsProgress', {
                    completed: exec.completed_steps ?? 0,
                    total: exec.total_steps ?? '?',
                  })}
                </p>
              </div>
            </div>
          ))}

          {/* Completed / failed history items */}
          {execLoading ? (
            <div className="text-center py-8 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">{t('common.loading')}</p>
            </div>
          ) : executions.length === 0 && runningCount === 0 ? (
            <div className="text-center py-12 bg-slate-800/30 border border-slate-700/50 rounded-xl">
              <Terminal className="w-12 h-12 mx-auto text-slate-600 mb-3" />
              <p className="text-slate-400 text-sm">{t('executions.history.emptyTitle')}</p>
              <p className="text-slate-600 text-xs mt-1">{t('executions.history.emptyText')}</p>
            </div>
          ) : (
            executions.map((exec) => {
              const isSuccess = exec.status === 'completed' || exec.status === 'completed_with_errors';
              const isFailed = exec.status === 'failed';
              const crawlRows = getCrawlRowCount(exec.result_json);
              const isCrawlExecution = crawlRows !== null;
              return (
                <div
                  key={exec.id}
                  className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-all cursor-pointer"
                  onClick={() => viewExecutionDetail(exec.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isSuccess
                        ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        : isFailed
                          ? <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                          : <Clock className="w-5 h-5 text-slate-500 shrink-0" />}
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {exec.scenario_name || t('common.na')}
                          {isCrawlExecution && (
                            <span className="ml-2 rounded bg-cyan-900/30 px-1.5 py-0.5 text-xs font-normal text-cyan-300">
                              crawl
                            </span>
                          )}
                          {exec.variable_sample_name && (
                            <span className="ml-2 text-xs font-normal text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded">
                              {exec.variable_sample_name}
                            </span>
                          )}
                          {!exec.variable_sample_name && exec.variable_profile_name && (
                            <span className="ml-2 text-xs font-normal text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                              {exec.variable_profile_name}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(exec.started_at)}
                          {exec.finished_at && ` - ${formatDateTime(exec.finished_at)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-slate-400">
                          {isCrawlExecution
                            ? `${crawlRows} rows`
                            : t('common.stepsProgress', {
                              completed: exec.completed_steps,
                              total: exec.total_steps,
                            })}
                        </p>
                        {exec.error_message && (
                          <p className="text-xs text-red-400 max-w-[200px] truncate" title={exec.error_message}>
                            {exec.error_message}
                          </p>
                        )}
                      </div>
                      <ExternalLink className="w-4 h-4 text-slate-500" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Execution Detail Modal */}
      {modalOpen === 'executionDetail' && currentExecution && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">{t('executions.detail.title')}</h2>
                <button
                  type="button"
                  onClick={closeExecutionDetail}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  currentExecution.status === 'completed' ? 'bg-emerald-600/20 text-emerald-400'
                    : currentExecution.status === 'failed' ? 'bg-red-600/20 text-red-400'
                      : 'bg-yellow-600/20 text-yellow-400'
                }`}>
                  {currentExecution.status === 'completed' ? t('status.completed')
                    : currentExecution.status === 'failed' ? t('status.failed') : t('status.running')}
                </span>
                <span className="text-slate-400">{formatDateTime(currentExecution.started_at)}</span>
              </div>
              {currentExecution.error_message && (
                <p className="mt-3 text-sm text-red-400">{currentExecution.error_message}</p>
              )}
            </div>

            <div className="p-6 space-y-3">
              {currentExecution.result_json && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/70">
                  <div className="border-b border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Result JSON
                  </div>
                  <pre className="max-h-72 overflow-auto p-3 text-xs leading-relaxed text-emerald-100">
                    {formatResultJson(currentExecution.result_json)}
                  </pre>
                </div>
              )}

              {currentExecution.steps?.length ? currentExecution.steps.map((stepExec, i) => {
                const sSuccess = stepExec.status === 'completed';
                const sFailed = stepExec.status === 'failed';
                const sRunning = stepExec.status === 'running';
                return (
                  <div
                    key={stepExec.id}
                    className={`p-3 rounded-lg border ${
                      sSuccess ? 'bg-emerald-900/10 border-emerald-800/30'
                        : sFailed ? 'bg-red-900/10 border-red-800/30'
                          : sRunning ? 'bg-yellow-900/10 border-yellow-800/30 animate-pulse'
                            : 'bg-slate-700/20 border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-slate-500">{i + 1}</span>
                      {sSuccess
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : sFailed
                          ? <XCircle className="w-4 h-4 text-red-400" />
                          : <Clock className="w-4 h-4 text-slate-500" />}
                      <span className="text-sm text-slate-200">{stepExec.action_type}</span>
                      {stepExec.page_url && (
                        <span className="text-xs text-slate-500 truncate ml-auto max-w-[200px]">
                          {stepExec.page_url}
                        </span>
                      )}
                    </div>
                    {stepExec.error_message && (
                      <p className="text-xs text-red-400 ml-6 mt-1">{stepExec.error_message}</p>
                    )}
                  </div>
                );
              }) : (
                <p className="text-sm text-slate-400">{t('executions.detail.noSteps')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
