import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  deleteScenario,
  fetchScenarioDetails,
  fetchScenarios,
  setCurrentScenario,
  setScenarioPinned,
} from '../slices/scenarioSlice';
import { setCurrentPage, showToast } from '../slices/uiSlice';
import ScenarioEditor from '../components/ScenarioEditor';
import { useTranslation } from '../i18n';
import { ChevronDown, Clock, Edit3, FileText, Folder, Globe, Play, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';

const createDraftScenario = (t) => ({
  id: null,
  name: t('scenarios.defaultName'),
  description: '',
  platform: 'facebook',
  target_url: 'https://www.facebook.com',
  scenario_type: 'action',
  parent_id: null,
  dom_check_anchor: null,
  recorded_width: 1280,
  recorded_height: 720,
  device_pixel_ratio: 1,
  steps: [],
});

const getScenarioGroupName = (scenario) => {
  const name = String(scenario.name || '').trim();
  const [group] = name.split(/[\s_-]+/).filter(Boolean);
  return group || 'Ungrouped';
};

const sortScenarios = (left, right) => {
  const pinnedDiff = Number(right.is_pinned || 0) - Number(left.is_pinned || 0);
  if (pinnedDiff) return pinnedDiff;
  return new Date(right.updated_at || 0) - new Date(left.updated_at || 0);
};

export default function ScenariosPage() {
  const dispatch = useDispatch();
  const { t, language } = useTranslation();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const { items: scenarios, loading, currentScenario } = useSelector((state) => state.scenarios);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [importing, setImporting] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  useEffect(() => {
    dispatch(fetchScenarios());
  }, [dispatch]);

  const filteredScenarios = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return scenarios;

    return scenarios.filter((scenario) => (
      [scenario.name, scenario.description, scenario.target_url, scenario.platform, scenario.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
  }, [scenarios, searchQuery]);

  const scenarioGroups = useMemo(() => {
    const groups = new Map();
    [...filteredScenarios].sort(sortScenarios).forEach((scenario) => {
      const groupName = getScenarioGroupName(scenario);
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName).push(scenario);
    });
    return Array.from(groups.entries())
      .map(([name, items]) => ({
        name,
        items,
        pinnedCount: items.filter((item) => item.is_pinned).length,
      }))
      .sort((left, right) => {
        const pinnedDiff = right.pinnedCount - left.pinnedCount;
        if (pinnedDiff) return pinnedDiff;
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });
  }, [filteredScenarios]);

  const openEditor = useCallback((scenario) => {
    if (scenario.id) {
      dispatch(fetchScenarioDetails(scenario.id));
    } else {
      dispatch(setCurrentScenario(scenario));
    }
  }, [dispatch]);

  const handleImportScenario = useCallback(async () => {
    setImporting(true);
    try {
      const result = await window.electronAPI.importScenario();
      if (result?.cancelled) return;
      if (!result?.scenario?.id) {
        dispatch(showToast({ type: 'error', message: t('scenarios.toast.importFailed') }));
        return;
      }
      await dispatch(fetchScenarios());
      dispatch(fetchScenarioDetails(result.scenario.id));
      dispatch(showToast({ type: 'success', message: t('scenarios.toast.imported') }));
    } catch (error) {
      dispatch(showToast({ type: 'error', message: error.message || t('scenarios.toast.importFailed') }));
    } finally {
      setImporting(false);
    }
  }, [dispatch, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    const result = await dispatch(deleteScenario(deleteConfirm));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: t('scenarios.toast.deleted') }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('scenarios.toast.deleteFailed') }));
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, dispatch, t]);

  const toggleGroup = useCallback((groupName) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupName]: !current[groupName],
    }));
  }, []);

  const togglePinned = useCallback(async (scenario) => {
    const isPinned = !scenario.is_pinned;
    const result = await dispatch(setScenarioPinned({ id: scenario.id, isPinned }));
    if (result.meta.requestStatus === 'rejected') {
      dispatch(showToast({ type: 'error', message: result.payload || 'Failed to update pin' }));
    }
  }, [dispatch]);

  const requestDelete = useCallback((scenario) => {
    if (scenario.is_pinned) {
      dispatch(showToast({ type: 'info', message: 'Unpin this scenario before deleting it.' }));
      return;
    }
    setDeleteConfirm(scenario.id);
  }, [dispatch]);

  if (currentScenario) {
    return <ScenarioEditor scenario={currentScenario} onBack={() => dispatch(setCurrentScenario(null))} />;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('scenarios.title')}</h1>
          <p className="page-subtitle">{t('scenarios.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleImportScenario}
            disabled={importing}
            className="btn-secondary"
          >
            <Upload className="h-4 w-4" />
            {importing ? t('common.loading') : t('scenarios.import')}
          </button>
          <button type="button" onClick={() => openEditor(createDraftScenario(t))} className="btn-primary">
            <Plus className="h-4 w-4" />
            {t('scenarios.create')}
          </button>
        </div>
      </div>

      <div className="panel mb-5 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f7d90]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="input-field pl-10"
            placeholder={t('scenarios.searchPlaceholder')}
          />
        </div>
      </div>

      {loading ? (
        <div className="panel flex items-center justify-center py-16 text-sm text-[#9aa7b7]">{t('scenarios.loading')}</div>
      ) : filteredScenarios.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-16 text-center">
          <FileText className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">
            {searchQuery ? t('scenarios.emptySearch') : t('scenarios.emptyTitle')}
          </p>
          <p className="mt-1 text-sm text-[#9aa7b7]">{t('scenarios.emptyText')}</p>
          {!searchQuery && (
            <button type="button" onClick={() => openEditor(createDraftScenario(t))} className="btn-primary mt-4">
              <Plus className="h-4 w-4" />
              {t('scenarios.create')}
            </button>
          )}
        </div>
      ) : (
        <div className="panel w-full overflow-hidden">
          <div className="grid grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_100px_100px_90px_170px_170px] border-b border-[#2e3b4e] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#7e8da5]">
            <span>{t('scenarios.title')}</span>
            <span>{t('scenarios.table.url')}</span>
            <span>{t('scenarios.table.type')}</span>
            <span>{t('scenarios.table.platform')}</span>
            <span>{t('scenarios.table.steps')}</span>
            <span>{t('scenarios.table.updated')}</span>
            <span className="text-right"></span>
          </div>

          <div>
            {scenarioGroups.map((group) => {
              const isCollapsed = collapsedGroups[group.name];
              return (
                <section key={group.name} className="border-b border-[#243044] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.name)}
                    className="grid w-full grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_100px_100px_90px_170px_170px] items-center gap-3 bg-[#151f2c] px-4 py-2 text-left text-sm text-[#c7d0dc] transition hover:bg-[#1b2736]"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-white">
                      <ChevronDown className={`h-4 w-4 shrink-0 transition ${isCollapsed ? '-rotate-90' : ''}`} />
                      <Folder className="h-4 w-4 shrink-0 text-[#7db4ff]" />
                      <span className="truncate">{group.name}</span>
                      <span className="text-xs font-medium text-[#7e8da5]">({group.items.length})</span>
                      {group.pinnedCount > 0 && <Star className="h-3.5 w-3.5 shrink-0 fill-[#f7c948] text-[#f7c948]" />}
                    </span>
                  </button>
                  {!isCollapsed && group.items.map((scenario) => (
                    <article
                      key={scenario.id}
                      className="grid grid-cols-[minmax(240px,1.2fr)_minmax(220px,1fr)_100px_100px_90px_170px_170px] items-center gap-3 px-4 py-3 transition hover:bg-[#202b3a]"
                    >
                      <button type="button" onClick={() => openEditor(scenario)} className="min-w-0 text-left">
                        <div className="flex min-w-0 items-center gap-3 pl-6">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#223044] text-[#7db4ff]">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold text-white">{scenario.name}</h2>
                            <p className="mt-0.5 truncate text-xs text-[#7e8da5]">{scenario.id}</p>
                          </div>
                        </div>
                      </button>

                      <div className="min-w-0">
                        <p className="truncate text-sm text-[#c7d0dc]">{scenario.target_url || scenario.description || t('common.noUrl')}</p>
                        {scenario.description && scenario.target_url && (
                          <p className="mt-0.5 truncate text-xs text-[#7e8da5]">{scenario.description}</p>
                        )}
                      </div>

                      <span className="badge w-fit capitalize">
                        {t(`scenarios.types.${scenario.scenario_type || 'action'}`)}
                      </span>

                      <span className="badge w-fit">
                        <Globe className="h-3.5 w-3.5" />
                        {scenario.platform || 'custom'}
                      </span>

                      <span className="text-sm font-semibold text-[#dce5f2]">{Number(scenario.steps_count || 0)}</span>

                      <span className="inline-flex items-center gap-1 text-xs text-[#9aa7b7]">
                        <Clock className="h-3.5 w-3.5" />
                        {scenario.updated_at ? new Date(scenario.updated_at).toLocaleString(dateLocale) : t('common.notUpdated')}
                      </span>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => togglePinned(scenario)}
                          className={`icon-button ${scenario.is_pinned ? 'text-[#f7c948]' : ''}`}
                          title={scenario.is_pinned ? 'Unpin scenario' : 'Pin scenario'}
                        >
                          <Star className={`h-4 w-4 ${scenario.is_pinned ? 'fill-current' : ''}`} />
                        </button>
                        <button type="button" onClick={() => openEditor(scenario)} className="icon-button" title={t('common.edit')}>
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            dispatch(setCurrentScenario(scenario));
                            dispatch(setCurrentPage('executions'));
                          }}
                          className="icon-button text-[#8ddfc7]"
                          title={t('common.run')}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDelete(scenario)}
                          className={`icon-button text-[#ffb4b4] ${scenario.is_pinned ? 'opacity-45' : ''}`}
                          title={scenario.is_pinned ? 'Unpin before delete' : t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {deleteConfirm && (
        <Modal title={t('scenarios.deleteModal.title')} onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-[#c7d0dc]">
            {t('scenarios.deleteModal.body')}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-secondary">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={handleDelete} className="btn-danger">
              {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4">
      <div className="card w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="icon-button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
