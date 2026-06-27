import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios } from '../slices/scenarioSlice';
import { runScenario, fetchAllExecutions, fetchExecutionDetail, clearCurrentExecution, clearAllExecutions } from '../slices/executionSlice';
import { showToast, openModal, closeModal } from '../slices/uiSlice';
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

export default function ExecutionsPage() {
  const dispatch = useDispatch();
  const { items: scenarios } = useSelector((state) => state.scenarios);
  const { items: executions, runningExecutions = {}, loading: execLoading, currentExecution, liveStatus } = useSelector((state) => state.executions);
  const modalOpen = useSelector((state) => state.ui.modalOpen);

  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [selectedBrowserProfileId, setSelectedBrowserProfileId] = useState('');
  const [selectedVariableProfileId, setSelectedVariableProfileId] = useState('');
  const [variableProfileOptions, setVariableProfileOptions] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [browserProfileOptions, setBrowserProfileOptions] = useState([]);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [headless, setHeadless] = useState(() => {
    try { return localStorage.getItem(LS_HEADLESS) === 'true'; } catch { return false; }
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
  }, [selectedScenarioId, scenarios]);

  useEffect(() => {
    if (!selectedScenarioId || !window.electronAPI?.getVariableProfiles) {
      setVariableProfileOptions([]);
      setSelectedVariableProfileId('');
      return undefined;
    }

    let cancelled = false;
    setProfilesLoading(true);

    window.electronAPI.getVariableProfiles(selectedScenarioId)
      .then((items) => {
        if (cancelled) return;
        const next = Array.isArray(items) ? items : [];
        setVariableProfileOptions(next);
        setSelectedVariableProfileId((current) => (
          current && next.some((item) => item.id === current) ? current : ''
        ));
      })
      .catch(() => {
        if (!cancelled) {
          setVariableProfileOptions([]);
          setSelectedVariableProfileId('');
        }
      })
      .finally(() => { if (!cancelled) setProfilesLoading(false); });

    return () => { cancelled = true; };
  }, [selectedScenarioId]);

  useEffect(() => {
    if (!liveStatus?.type) return;
    const notifyKey = `${liveStatus.type}:${liveStatus.executionId || ''}:${liveStatus.timestamp || ''}`;
    if (lastNotifyRef.current === notifyKey) return;
    lastNotifyRef.current = notifyKey;

    if (liveStatus.type === 'execution:failed') {
      dispatch(showToast({ type: 'error', message: liveStatus.error || 'Thực thi thất bại' }));
    }
    if (liveStatus.type === 'execution:completed') {
      dispatch(showToast({ type: 'success', message: `Hoàn thành: ${liveStatus.scenarioName || 'kịch bản'}` }));
    }
    if (liveStatus.type === 'execution:closing') {
      dispatch(showToast({ type: 'info', message: liveStatus.message || 'Đang đóng browser...' }));
    }
  }, [dispatch, liveStatus]);

  const handleHeadlessChange = (e) => {
    const val = e.target.checked;
    setHeadless(val);
    try { localStorage.setItem(LS_HEADLESS, String(val)); } catch { /* ignore */ }
  };

  const handleRunScenario = async () => {
    if (!selectedScenarioId) return;
    if (!selectedBrowserProfileId) {
      dispatch(showToast({
        type: 'error',
        message: 'Chọn profile browser để chạy. Guest chỉ dùng khi cấu hình trong kịch bản.',
      }));
      return;
    }
    const browserProfileId = selectedBrowserProfileId;
    const result = await dispatch(runScenario({
      scenarioId: selectedScenarioId,
      browserProfileId,
      variableProfileId: selectedVariableProfileId || null,
      headless,
    }));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'info', message: 'Đã gửi lệnh thực thi' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Chạy thất bại' }));
    }
  };

  const openBrowserSessionApi = window.electronAPI.openBrowserSession || window.electronAPI.openGuestBrowser;

  const handleOpenBrowser = async () => {
    if (!openBrowserSessionApi) {
      dispatch(showToast({ type: 'error', message: 'Khởi động lại ứng dụng để cập nhật preload' }));
      return;
    }
    if (!selectedBrowserProfileId) {
      dispatch(showToast({ type: 'error', message: 'Chọn profile browser để mở trình duyệt' }));
      return;
    }
    const scenario = scenarios.find((item) => item.id === selectedScenarioId);
    const browserProfileId = selectedBrowserProfileId;
    setOpeningBrowser(true);
    try {
      await openBrowserSessionApi({ scenarioId: selectedScenarioId || null, browserProfileId, startUrl: scenario?.target_url || null });
      const profileLabel = browserProfileOptions.find((item) => item.id === browserProfileId)?.display_name || 'profile app';
      dispatch(showToast({ type: 'success', message: `Đã mở browser (${profileLabel})` }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Không mở được browser' }));
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
      `Xóa toàn bộ ${executions.length} bản ghi lịch sử thực thi? Hành động này không thể hoàn tác.`,
    );
    if (!confirmed) return;
    setClearingHistory(true);
    const result = await dispatch(clearAllExecutions());
    setClearingHistory(false);
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(closeModal());
      dispatch(clearCurrentExecution());
      dispatch(showToast({ type: 'success', message: `Đã xóa ${result.payload?.deleted ?? 0} bản ghi lịch sử` }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Không xóa được lịch sử' }));
    }
  };

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
  };

  const statsTotal = executions.length;
  const statsSuccess = executions.filter((e) => e.status === 'completed').length;
  const statsFailed = executions.filter((e) => e.status === 'failed').length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Thực thi</h1>
          <p className="text-sm text-slate-400 mt-1">Chạy kịch bản tự động hóa</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-3 py-2">
            <Globe className="h-4 w-4 shrink-0 text-slate-400" />
            <select
              value={selectedBrowserProfileId}
              onChange={(e) => setSelectedBrowserProfileId(e.target.value)}
              className="select-field min-w-[200px] border-0 bg-transparent py-1 text-sm"
            >
              <option value="">Chọn profile browser...</option>
              {browserProfileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.display_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleOpenBrowser}
              disabled={openingBrowser}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-800"
              title="Mở trình duyệt (cùng profile đã chạy)"
            >
              {openingBrowser ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            </button>
          </div>
          <p className="max-w-[280px] text-right text-xs text-slate-500">
            Bắt buộc chọn profile app. Guest chỉ cấu hình trong kịch bản khi ghi.
          </p>
        </div>
      </div>

      {/* Run Scenario Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Chạy kịch bản</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedScenarioId || ''}
            onChange={(e) => {
              setSelectedScenarioId(e.target.value || null);
              setSelectedVariableProfileId('');
            }}
            className="select-field max-w-md min-w-[220px]"
          >
            <option value="">Chọn kịch bản...</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.platform})</option>
            ))}
          </select>

          {selectedScenarioId && (
            <select
              value={selectedVariableProfileId}
              onChange={(e) => setSelectedVariableProfileId(e.target.value)}
              disabled={profilesLoading}
              className="select-field max-w-md min-w-[200px]"
            >
              <option value="">(Giá trị mặc định)</option>
              {variableProfileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
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
            Headless
          </label>

          <button
            onClick={handleRunScenario}
            disabled={!selectedScenarioId || !selectedBrowserProfileId}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-medium transition-all"
          >
            <Play className="w-4 h-4" />
            Chạy
          </button>
        </div>

        {runningCount > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-yellow-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            {runningCount} kịch bản đang chạy song song...
          </div>
        )}
      </div>

      {/* Stats Summary */}
      {statsTotal > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-emerald-400">{statsSuccess}</p>
            <p className="text-sm text-slate-400">Thành công</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-red-400">{statsFailed}</p>
            <p className="text-sm text-slate-400">Thất bại</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-2xl font-bold text-yellow-400">{runningCount}</p>
            <p className="text-sm text-slate-400">Đang chạy</p>
          </div>
        </div>
      )}

      {/* Execution History */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Lịch sử thực thi gần đây</h2>
          {executions.length > 0 && (
            <button
              type="button"
              onClick={handleClearHistory}
              disabled={clearingHistory || execLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-700/60 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              title="Xóa toàn bộ lịch sử"
            >
              {clearingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Xóa lịch sử
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
                      {exec.scenario_name || 'N/A'}
                      <span className="ml-2 text-xs font-normal text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">
                        đang chạy
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">{formatDateTime(exec.started_at)}</p>
                    <ProgressBar completed={exec.completed_steps || 0} total={exec.total_steps || 0} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 ml-4 shrink-0">
                  {exec.completed_steps ?? 0}/{exec.total_steps ?? '?'} bước
                </p>
              </div>
            </div>
          ))}

          {/* Completed / failed history items */}
          {execLoading ? (
            <div className="text-center py-8 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Đang tải...</p>
            </div>
          ) : executions.length === 0 && runningCount === 0 ? (
            <div className="text-center py-12 bg-slate-800/30 border border-slate-700/50 rounded-xl">
              <Terminal className="w-12 h-12 mx-auto text-slate-600 mb-3" />
              <p className="text-slate-400 text-sm">Chưa có lịch sử thực thi</p>
              <p className="text-slate-600 text-xs mt-1">Chọn kịch bản và nhấn "Chạy" để bắt đầu</p>
            </div>
          ) : (
            executions.map((exec) => {
              const isSuccess = exec.status === 'completed' || exec.status === 'completed_with_errors';
              const isFailed = exec.status === 'failed';
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
                          {exec.scenario_name || 'N/A'}
                          {exec.variable_profile_name && (
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
                          {exec.completed_steps}/{exec.total_steps} bước
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
                <h2 className="text-lg font-semibold text-white">Chi tiết thực thi</h2>
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
                  {currentExecution.status === 'completed' ? 'Hoàn thành'
                    : currentExecution.status === 'failed' ? 'Thất bại' : 'Đang chạy'}
                </span>
                <span className="text-slate-400">{formatDateTime(currentExecution.started_at)}</span>
              </div>
              {currentExecution.error_message && (
                <p className="mt-3 text-sm text-red-400">{currentExecution.error_message}</p>
              )}
            </div>

            <div className="p-6 space-y-3">
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
                <p className="text-sm text-slate-400">Không có chi tiết từng bước cho lần chạy này.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
