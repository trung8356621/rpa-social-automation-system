import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchScenarios } from '../slices/scenarioSlice';
import { fetchAllExecutions } from '../slices/executionSlice';
import { setCurrentPage } from '../slices/uiSlice';
import { useTranslation } from '../i18n';
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
  const { t, language } = useTranslation();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
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
      label: t('dashboard.stats.scenarios.label'),
      value: scenariosLoading ? '...' : scenarios.length,
      detail: t('dashboard.stats.scenarios.detail'),
      icon: ScrollText,
      tone: 'text-[#7db4ff]',
    },
    {
      label: t('dashboard.stats.runs.label'),
      value: executionsLoading ? '...' : executions.length,
      detail: t('dashboard.stats.runs.detailRunning', { running }),
      icon: PlayCircle,
      tone: 'text-[#8ddfc7]',
    },
    {
      label: t('dashboard.stats.success.label'),
      value: `${successRate}%`,
      detail: t('dashboard.stats.success.detail', { completed, failed }),
      icon: CheckCircle2,
      tone: successRate >= 70 ? 'text-[#8ddfc7]' : 'text-[#f1c16b]',
    },
    {
      label: t('dashboard.stats.lastRun.label'),
      value: lastRun ? new Date(lastRun).toLocaleDateString(dateLocale) : t('common.none'),
      detail: lastRun ? new Date(lastRun).toLocaleTimeString(dateLocale) : t('dashboard.stats.lastRun.noHistory'),
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
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-subtitle">{t('dashboard.subtitle')}</p>
        </div>
        <button type="button" onClick={() => dispatch(setCurrentPage('scenarios'))} className="btn-primary">
          <Plus className="h-4 w-4" />
          {t('dashboard.createScenario')}
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
            <h2 className="text-base font-semibold text-white">{t('dashboard.recentScenarios.title')}</h2>
            <button type="button" onClick={() => dispatch(setCurrentPage('scenarios'))} className="btn-ghost h-8 px-2">
              {t('common.viewAll')}
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>

          <div className="divide-y divide-[#2e3b4e]">
            {recentScenarios.length === 0 ? (
              <EmptyState
                icon={ScrollText}
                title={t('dashboard.recentScenarios.emptyTitle')}
                text={t('dashboard.recentScenarios.emptyText')}
              />
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
                      {scenario.target_url || scenario.platform || t('common.noUrl')}
                    </p>
                  </div>
                  <span className="badge">{t('common.stepsCount', { count: scenario.steps?.length || 0 })}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
            <h2 className="text-base font-semibold text-white">{t('dashboard.recentExecutions.title')}</h2>
            <button type="button" onClick={() => dispatch(setCurrentPage('history'))} className="btn-ghost h-8 px-2">
              {t('dashboard.recentExecutions.viewHistory')}
              <ExternalLink className="h-4 w-4" />
            </button>
          </div>

          <div className="divide-y divide-[#2e3b4e]">
            {recentExecutions.length === 0 ? (
              <EmptyState
                icon={PlayCircle}
                title={t('dashboard.recentExecutions.emptyTitle')}
                text={t('dashboard.recentExecutions.emptyText')}
              />
            ) : (
              recentExecutions.map((execution) => (
                <div key={execution.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusIcon status={execution.status} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{execution.scenario_name || t('common.unknown')}</p>
                      <p className="mt-1 text-xs text-[#9aa7b7]">
                        {execution.started_at ? new Date(execution.started_at).toLocaleString(dateLocale) : t('common.noTime')}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-[#9aa7b7]">
                    {t('common.stepsProgress', {
                      completed: execution.completed_steps || 0,
                      total: execution.total_steps || 0,
                    })}
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
