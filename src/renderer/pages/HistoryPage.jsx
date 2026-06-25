import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchAllExecutions, fetchExecutionDetail } from '../slices/executionSlice';
import { openModal } from '../slices/uiSlice';
import {
  History,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Search,
  Filter,
} from 'lucide-react';

export default function HistoryPage() {
  const dispatch = useDispatch();
  const { items: executions, loading } = useSelector((state) => state.executions);

  useEffect(() => {
    dispatch(fetchAllExecutions());
  }, [dispatch]);

  const viewDetail = (executionId) => {
    dispatch(fetchExecutionDetail(executionId));
    dispatch(openModal({ type: 'executionDetail' }));
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return 'N/A';
    const ms = new Date(end) - new Date(start);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-600/20 text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            Hoàn thành
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-600/20 text-red-400">
            <XCircle className="w-3 h-3" />
            Thất bại
          </span>
        );
      case 'running':
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-600/20 text-yellow-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Đang chạy
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-600/20 text-slate-400">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Lịch sử thực thi</h1>
          <p className="text-sm text-slate-400 mt-1">
            Xem lại tất cả các lần thực thi kịch bản
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <History className="w-4 h-4" />
          <span>{executions.length} bản ghi</span>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4">
        {(() => {
          const total = executions.length;
          const success = executions.filter((e) => e.status === 'completed').length;
          const failed = executions.filter((e) => e.status === 'failed').length;
          const running = executions.filter((e) => e.status === 'running').length;
          return (
            <>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <p className="text-2xl font-bold text-emerald-400">{success}</p>
                <p className="text-sm text-slate-400">Thành công</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <p className="text-2xl font-bold text-red-400">{failed}</p>
                <p className="text-sm text-slate-400">Thất bại</p>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <p className="text-2xl font-bold text-yellow-400">{running}</p>
                <p className="text-sm text-slate-400">Đang chạy</p>
              </div>
            </>
          );
        })()}
      </div>

      {/* Execution List */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-400" />
          <p className="text-sm text-slate-400">Đang tải lịch sử...</p>
        </div>
      ) : executions.length === 0 ? (
        <div className="text-center py-16 bg-slate-800/30 border border-slate-700/50 rounded-xl">
          <History className="w-16 h-16 mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 mb-1">Chưa có lịch sử thực thi</p>
          <p className="text-slate-600 text-xs">
            Chạy một kịch bản từ tab "Thực thi" để bắt đầu ghi lại lịch sử
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {executions.map((exec) => (
            <div
              key={exec.id}
              className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 hover:border-slate-600 transition-all cursor-pointer"
              onClick={() => viewDetail(exec.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {getStatusBadge(exec.status)}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {exec.scenario_name || 'Không xác định'}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(exec.started_at).toLocaleString('vi-VN')}
                      </span>
                      <span>
                        Thời gian: {formatDuration(exec.started_at, exec.finished_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                  <span>
                    {exec.completed_steps}/{exec.total_steps} bước
                  </span>
                  {exec.error_message && (
                    <span className="text-red-400 max-w-[200px] truncate" title={exec.error_message}>
                      {exec.error_message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
