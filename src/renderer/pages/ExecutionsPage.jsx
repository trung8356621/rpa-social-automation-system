import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios, setCurrentScenario } from '../slices/scenarioSlice';
import { runScenario, fetchAllExecutions, fetchExecutionDetail, clearCurrentExecution } from '../slices/executionSlice';
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
} from 'lucide-react';

const GUEST_BROWSER_PROFILE = '__guest__';

function resolveBrowserProfileId(selectedId) {
  if (selectedId && selectedId !== GUEST_BROWSER_PROFILE) return selectedId;
  return null;
}

export default function ExecutionsPage() {
  const dispatch = useDispatch();
  const { items: scenarios } = useSelector((state) => state.scenarios);
  const { items: executions, isRunning, loading: execLoading, currentExecution, liveStatus } = useSelector((state) => state.executions);
  const modalOpen = useSelector((state) => state.ui.modalOpen);
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [selectedBrowserProfileId, setSelectedBrowserProfileId] = useState('');
  const [browserProfileOptions, setBrowserProfileOptions] = useState([]);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const lastNotifyRef = useRef('');

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
    setSelectedBrowserProfileId(scenario.browser_profile_id || GUEST_BROWSER_PROFILE);
  }, [selectedScenarioId, scenarios]);

  useEffect(() => {
    if (!liveStatus?.type) return;
    const notifyKey = `${liveStatus.type}:${liveStatus.executionId || ''}:${liveStatus.timestamp || ''}`;
    if (lastNotifyRef.current === notifyKey) return;
    lastNotifyRef.current = notifyKey;

    if (liveStatus.type === 'execution:failed') {
      dispatch(showToast({
        type: 'error',
        message: liveStatus.error || 'Thực thi thất bại',
      }));
      dispatch(closeModal());
      dispatch(clearCurrentExecution());
      dispatch(fetchAllExecutions());
    }

    if (liveStatus.type === 'execution:completed') {
      dispatch(showToast({
        type: 'success',
        message: `Hoàn thành: ${liveStatus.scenarioName || 'kịch bản'}`,
      }));
      dispatch(fetchAllExecutions());
    }

    if (liveStatus.type === 'execution:closing') {
      dispatch(showToast({
        type: 'info',
        message: liveStatus.message || 'Đang lưu session trước khi đóng browser...',
      }));
    }

    if (liveStatus.type === 'execution:session-check') {
      if (liveStatus.hasAuthCookie === false) {
        dispatch(showToast({
          type: 'info',
          message: 'Chạy xong nhưng chưa thấy cookie đăng nhập — session có thể chưa được lưu.',
        }));
      } else if (liveStatus.savedCookies > 0) {
        dispatch(showToast({
          type: 'success',
          message: `Đã lưu ${liveStatus.savedCookies} cookie vào profile.`,
        }));
      }
    }
  }, [dispatch, liveStatus]);

  const handleRunScenario = async () => {
    if (!selectedScenarioId) return;
    const browserProfileId = resolveBrowserProfileId(selectedBrowserProfileId);
    const result = await dispatch(runScenario({
      scenarioId: selectedScenarioId,
      browserProfileId,
    }));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'info', message: 'Đã gửi lệnh thực thi' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Chạy thất bại' }));
    }
  };

  const openBrowserSessionApi = window.electronAPI.openBrowserSession
    || window.electronAPI.openGuestBrowser;

  const handleOpenBrowser = async () => {
    if (!openBrowserSessionApi) {
      dispatch(showToast({
        type: 'error',
        message: 'Khởi động lại ứng dụng (tắt và chạy lại npm run dev) để cập nhật preload',
      }));
      return;
    }

    if (!selectedBrowserProfileId && !selectedScenarioId) {
      dispatch(showToast({ type: 'error', message: 'Chọn kịch bản hoặc profile app để mở browser' }));
      return;
    }

    const scenario = scenarios.find((item) => item.id === selectedScenarioId);
    const browserProfileId = resolveBrowserProfileId(selectedBrowserProfileId);

    setOpeningBrowser(true);
    try {
      await openBrowserSessionApi({
        scenarioId: selectedScenarioId || null,
        browserProfileId,
        startUrl: scenario?.target_url || null,
      });
      const profileLabel = browserProfileId
        ? browserProfileOptions.find((item) => item.id === browserProfileId)?.display_name || 'profile app'
        : 'guest';
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

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
  };

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
              onChange={(event) => setSelectedBrowserProfileId(event.target.value)}
              className="select-field min-w-[200px] border-0 bg-transparent py-1 text-sm"
            >
              <option value={GUEST_BROWSER_PROFILE}>Guest (session tạm)</option>
              {browserProfileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.display_name}
                </option>
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
            Cùng thư mục profile với kịch bản — record, chạy và mở browser dùng chung session.
          </p>
        </div>
      </div>

      {/* Run Scenario Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Chạy kịch bản</h2>
        <div className="flex flex-wrap gap-3">
          <select
            value={selectedScenarioId || ''}
            onChange={(e) => setSelectedScenarioId(e.target.value || null)}
            className="select-field max-w-md min-w-[220px]"
          >
            <option value="">Chọn kịch bản...</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.platform})
              </option>
            ))}
          </select>
          <button
            onClick={handleRunScenario}
            disabled={!selectedScenarioId || isRunning}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-medium transition-all"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isRunning ? 'Đang chạy...' : 'Chạy'}
          </button>
        </div>

        {isRunning && (
          <div className="mt-4 flex items-center gap-2 text-sm text-yellow-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Kịch bản đang được thực thi...
          </div>
        )}
      </div>

      {/* Execution History */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Lịch sử thực thi gần đây</h2>

        {execLoading ? (
          <div className="text-center py-8 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm">Đang tải...</p>
          </div>
        ) : executions.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/30 border border-slate-700/50 rounded-xl">
            <Terminal className="w-12 h-12 mx-auto text-slate-600 mb-3" />
            <p className="text-slate-400 text-sm">Chưa có lịch sử thực thi</p>
            <p className="text-slate-600 text-xs mt-1">Chọn kịch bản và nhấn "Chạy" để bắt đầu</p>
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map((exec) => {
              const isSuccess = exec.status === 'completed';
              const isFailed = exec.status === 'failed';
              const isRunningExec = exec.status === 'running';
              return (
                <div
                  key={exec.id}
                  className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-all cursor-pointer"
                  onClick={() => viewExecutionDetail(exec.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {isSuccess ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : isFailed ? (
                        <XCircle className="w-5 h-5 text-red-400" />
                      ) : (
                        <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {exec.scenario_name || 'N/A'}
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
            })}
          </div>
        )}
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
                  currentExecution.status === 'completed' ? 'bg-emerald-600/20 text-emerald-400' :
                  currentExecution.status === 'failed' ? 'bg-red-600/20 text-red-400' :
                  'bg-yellow-600/20 text-yellow-400'
                }`}>
                  {currentExecution.status === 'completed' ? 'Hoàn thành' :
                   currentExecution.status === 'failed' ? 'Thất bại' : 'Đang chạy'}
                </span>
                <span className="text-slate-400">
                  {formatDateTime(currentExecution.started_at)}
                </span>
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
                      sSuccess ? 'bg-emerald-900/10 border-emerald-800/30' :
                      sFailed ? 'bg-red-900/10 border-red-800/30' :
                      sRunning ? 'bg-yellow-900/10 border-yellow-800/30 animate-pulse' :
                      'bg-slate-700/20 border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-slate-500">{i + 1}</span>
                      {sSuccess ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : sFailed ? (
                        <XCircle className="w-4 h-4 text-red-400" />
                      ) : (
                        <Clock className="w-4 h-4 text-slate-500" />
                      )}
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
