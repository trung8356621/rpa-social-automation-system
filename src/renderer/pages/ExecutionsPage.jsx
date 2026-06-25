import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios, setCurrentScenario } from '../slices/scenarioSlice';
import { runScenario, fetchAllExecutions, fetchExecutionDetail } from '../slices/executionSlice';
import { launchBrowser, closeBrowser, checkBrowserStatus } from '../slices/browserSlice';
import { showToast, setCurrentPage, openModal, closeModal } from '../slices/uiSlice';
import {
  Play,
  Square,
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  Terminal,
} from 'lucide-react';

export default function ExecutionsPage() {
  const dispatch = useDispatch();
  const { items: scenarios } = useSelector((state) => state.scenarios);
  const { items: executions, isRunning, loading: execLoading, currentExecution } = useSelector((state) => state.executions);
  const { isRunning: browserRunning, loading: browserLoading } = useSelector((state) => state.browser);
  const [selectedScenarioId, setSelectedScenarioId] = useState(null);

  useEffect(() => {
    dispatch(fetchScenarios());
    dispatch(fetchAllExecutions());
    dispatch(checkBrowserStatus());
  }, [dispatch]);

  const handleRunScenario = async (scenarioId) => {
    const result = await dispatch(runScenario(scenarioId));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã bắt đầu thực thi' }));
      dispatch(fetchAllExecutions());
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Chạy thất bại' }));
    }
  };

  const handleLaunchBrowser = () => {
    dispatch(launchBrowser({ headless: false }));
  };

  const handleCloseBrowser = () => {
    dispatch(closeBrowser());
  };

  const viewExecutionDetail = (executionId) => {
    dispatch(fetchExecutionDetail(executionId));
    dispatch(openModal({ type: 'executionDetail' }));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Thực thi</h1>
          <p className="text-sm text-slate-400 mt-1">Chạy kịch bản tự động hóa</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Browser Controls */}
          <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2">
            <Globe className={`w-4 h-4 ${browserRunning ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className={`text-sm ${browserRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
              {browserRunning ? 'Đã kết nối' : 'Chưa kết nối'}
            </span>
            {browserRunning ? (
              <button
                onClick={handleCloseBrowser}
                className="ml-2 p-1 text-slate-400 hover:text-red-400 rounded transition-colors"
                title="Đóng trình duyệt"
              >
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleLaunchBrowser}
                disabled={browserLoading}
                className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white text-xs rounded-lg transition-colors"
              >
                {browserLoading ? 'Đang mở...' : 'Mở trình duyệt'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Run Scenario Section */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Chạy kịch bản</h2>
        <div className="flex gap-3">
          <select
            value={selectedScenarioId || ''}
            onChange={(e) => setSelectedScenarioId(e.target.value || null)}
            className="select-field max-w-md"
          >
            <option value="">Chọn kịch bản...</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.platform})
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedScenarioId && handleRunScenario(selectedScenarioId)}
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
                          {new Date(exec.started_at).toLocaleString('vi-VN')}
                          {exec.finished_at && ` - ${new Date(exec.finished_at).toLocaleString('vi-VN')}`}
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
      {currentExecution && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">Chi tiết thực thi</h2>
                <button
                  onClick={() => dispatch(closeModal())}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
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
                  {new Date(currentExecution.started_at).toLocaleString('vi-VN')}
                </span>
              </div>
            </div>

            <div className="p-6 space-y-3">
              {currentExecution.steps && currentExecution.steps.map((stepExec, i) => {
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
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
