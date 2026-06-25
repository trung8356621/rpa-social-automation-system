import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios } from '../slices/scenarioSlice';
import { fetchAllExecutions } from '../slices/executionSlice';
import { setCurrentPage } from '../slices/uiSlice';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  PlayCircle,
  Plus,
  ScrollText,
} from 'lucide-react';

export default function DashboardPage() {
  const dispatch = useDispatch();
  const { items: scenarios, loading: scenariosLoading } = useSelector((state) => state.scenarios);
  const { items: executions, loading: executionsLoading } = useSelector((state) => state.executions);

  useEffect(() => {
    dispatch(fetchScenarios());
    dispatch(fetchAllExecutions());
  }, [dispatch]);

  const completed = executions.filter((item) => item.status === 'completed').length;
  const failed = executions.filter((item) => item.status === 'failed').length;
  const running = executions.filter((item) => item.status === 'running').length;
  const successRate = executions.length ? Math.round((completed / executions.length) * 100) : 0;
  const lastRun = executions[0]?.started_at;

  const stats = [
    {
      label: 'Kịch bản',
      value: scenariosLoading ? '...' : scenarios.length,
      detail: 'Tổng số kịch bản đã tạo',
      icon: ScrollText,
      tone: 'text-[#7db4ff]',
    },
    {
      label: 'Lượt chạy',
      value: executionsLoading ? '...' : executions.length,
      detail: `${running} đang chạy`,
      icon: PlayCircle,
      tone: 'text-[#8ddfc7]',
    },
    {
      label: 'Thành công',
      value: `${successRate}%`,
      detail: `${completed} thành công, ${failed} lỗi`,
      icon: CheckCircle2,
      tone: successRate >= 70 ? 'text-[#8ddfc7]' : 'text-[#f1c16b]',
    },
    {
      label: 'Lần chạy cuối',
      value: lastRun ? new Date(lastRun).toLocaleDateString('vi-VN') : 'Chưa có',
      detail: lastRun ? new Date(lastRun).toLocaleTimeString('vi-VN') : 'Chưa ghi nhận lịch sử',
      icon: Clock,
      tone: 'text-[#c7d0dc]',
    },
  ];

  const recentScenarios = scenarios.slice(0, 5);
  const recentExecutions = executions.slice(0, 6);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tổng quan</h1>
          <p className="page-subtitle">Theo dõi kịch bản, lượt chạy và trạng thái hệ thống.</p>
        </div>
        <button type="button" onClick={() => dispatch(setCurrentPage('scenarios'))} className="btn-primary">
          <Plus className="h-4 w-4" />
          Tạo kịch bản
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[#9aa7b7]">{stat.label}</p>
                  <p className="mt-2 text-3xl font-bold text-white">{stat.value}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#223044]">
                  <Icon className={`h-5 w-5 ${stat.tone}`} />
                </div>
              </div>
              <p className="mt-3 text-sm text-[#6f7d90]">{stat.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
            <h2 className="text-base font-semibold text-white">Kịch bản gần đây</h2>
            <button type="button" onClick={() => dispatch(setCurrentPage('scenarios'))} className="btn-ghost h-8 px-2">
              Xem tất cả
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>

          <div className="divide-y divide-[#2e3b4e]">
            {recentScenarios.length === 0 ? (
              <EmptyState icon={ScrollText} title="Chưa có kịch bản" text="Tạo kịch bản đầu tiên để bắt đầu tự động hóa." />
            ) : (
              recentScenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  onClick={() => dispatch(setCurrentPage('scenarios'))}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#202b3a]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{scenario.name}</p>
                    <p className="mt-1 truncate text-xs text-[#9aa7b7]">
                      {scenario.target_url || scenario.platform || 'Chưa có URL'}
                    </p>
                  </div>
                  <span className="badge">{scenario.steps?.length || 0} bước</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
            <h2 className="text-base font-semibold text-white">Lịch sử gần đây</h2>
            <button type="button" onClick={() => dispatch(setCurrentPage('history'))} className="btn-ghost h-8 px-2">
              Xem lịch sử
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>

          <div className="divide-y divide-[#2e3b4e]">
            {recentExecutions.length === 0 ? (
              <EmptyState icon={PlayCircle} title="Chưa có lượt chạy" text="Chạy một kịch bản để xem trạng thái tại đây." />
            ) : (
              recentExecutions.map((execution) => (
                <div key={execution.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusIcon status={execution.status} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{execution.scenario_name || 'Không xác định'}</p>
                      <p className="mt-1 text-xs text-[#9aa7b7]">
                        {execution.started_at ? new Date(execution.started_at).toLocaleString('vi-VN') : 'Chưa có thời gian'}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-[#9aa7b7]">
                    {execution.completed_steps || 0}/{execution.total_steps || 0} bước
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusIcon({ status }) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 shrink-0 text-[#20b486]" />;
  if (status === 'failed') return <AlertTriangle className="h-5 w-5 shrink-0 text-[#e45f5f]" />;
  return <Clock className="h-5 w-5 shrink-0 text-[#d99a28]" />;
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#223044]">
        <Icon className="h-6 w-6 text-[#6f7d90]" />
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[#9aa7b7]">{text}</p>
    </div>
  );
}
