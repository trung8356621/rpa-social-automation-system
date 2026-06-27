import React, { useEffect, useState } from 'react';
import { Braces, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';

const CREATE_NEW_PROFILE = '__new__';

function emptyRow() {
  return {
    id: null,
    key: '',
    value: '',
  };
}

function randomName(prefix) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}-${token}`;
}

export default function ScenarioVariablesBar({
  scenarioId,
  refreshKey = 0,
  onToast,
  onChanged,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [sampleProfileId, setSampleProfileId] = useState(CREATE_NEW_PROFILE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const loadVariables = async () => {
    if (!scenarioId || !window.electronAPI?.getScenarioLocalVariables) {
      setRows([]);
      return;
    }

    setLoading(true);
    try {
      const items = await window.electronAPI.getScenarioLocalVariables(scenarioId);
      const normalized = (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        key: item.key || item.name || '',
      }));
      setRows(normalized.length ? normalized : []);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('variables.toast.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  const loadProfiles = async () => {
    if (!window.electronAPI?.getVariableProfiles) {
      setProfiles([]);
      return;
    }
    try {
      const items = await window.electronAPI.getVariableProfiles();
      setProfiles(Array.isArray(items) ? items : []);
    } catch {
      setProfiles([]);
    }
  };

  useEffect(() => {
    loadVariables();
    loadProfiles();
  }, [scenarioId, refreshKey]);

  const persistRow = async (row) => {
    const key = String(row.key || row.name || '').trim();
    if (!scenarioId || !key) return null;

    const saved = await window.electronAPI.saveScenarioVariable({
      id: row.id || undefined,
      scenario_id: scenarioId,
      key,
      name: key,
      value: row.value ?? '',
    });
    return saved;
  };

  const handleSaveRow = async (index, patch = {}) => {
    const row = { ...rows[index], ...patch };
    const key = String(row?.key || row?.name || '').trim();
    if (!key) return;

    setSaving(true);
    try {
      const saved = await persistRow(row);
      if (!saved) return;
      setRows((prev) => prev.map((item, idx) => (idx === index ? saved : item)));
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('variables.toast.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRow = async (index) => {
    const row = rows[index];
    const nextRows = rows.filter((_, idx) => idx !== index);
    setRows(nextRows);

    if (!row?.id) return;

    try {
      await window.electronAPI.deleteScenarioVariable(row.id);
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('variables.toast.deleteFailed') });
      loadVariables();
    }
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
    setOpen(true);
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const handleQuickSaveSample = async () => {
    const variables = rows
      .map((row) => ({
        key: String(row.key || '').trim(),
        value: row.value ?? '',
      }))
      .filter((row) => row.key);

    if (!variables.length) {
      onToast?.({ type: 'error', message: t('variables.toast.noKeys') });
      return;
    }

    setBusyAction('sample');
    try {
      let profileId = sampleProfileId;

      if (profileId === CREATE_NEW_PROFILE) {
        const profile = await window.electronAPI.saveVariableProfileQuick({
          name: randomName('profile'),
          keys: variables.map((row) => row.key),
        });
        profileId = profile?.id;
        if (!profileId) {
          throw new Error(t('variables.toast.profileSaveFailed'));
        }
        await loadProfiles();
      }

      await window.electronAPI.saveVariableProfileSampleQuick({
        profileId,
        name: randomName('sample'),
        variables,
      });

      onToast?.({ type: 'success', message: t('variables.toast.sampleSaved') });
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('variables.toast.sampleSaveFailed') });
    } finally {
      setBusyAction('');
    }
  };

  if (!scenarioId) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#2f3748] px-3 text-xs text-[#76849b]"
        title={t('variables.saveScenarioFirst')}
      >
        <Braces className="h-4 w-4" />
        {t('variables.button')}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#2f3748] bg-[#171b26] px-3 text-xs font-medium text-[#c9d4e8] transition hover:bg-[#1f2633]"
      >
        <Braces className="h-4 w-4 text-[#7aa7ff]" />
        {t('variables.button')}
        <span className="rounded bg-[#242b3a] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">{rows.length}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label={t('variables.closePanel')}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-[480px] rounded-xl border border-[#2f3748] bg-[#12151c] p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{t('variables.panel.title')}</p>
                <p className="text-[11px] text-[#76849b]">{t('variables.panel.hint')}</p>
              </div>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[#243044] px-2 text-xs text-white hover:bg-[#2d3d56]"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('common.add')}
              </button>
            </div>

            <div className="mb-3 flex items-center gap-2 border-b border-[#2f3748] pb-3">
              <select
                value={sampleProfileId}
                onChange={(event) => setSampleProfileId(event.target.value)}
                className="select-field h-8 min-w-0 flex-1 text-xs"
              >
                <option value={CREATE_NEW_PROFILE}>{t('variables.createNewProfile')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleQuickSaveSample}
                disabled={!!busyAction}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#3a465c] px-2.5 text-xs text-[#c9d4e8] hover:bg-[#1f2633] disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {t('variables.quickSaveSample')}
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-[#76849b]">{t('common.loading')}</p>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#2f3748] px-3 py-4 text-center text-xs text-[#76849b]">
                {t('variables.panel.empty')}
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {rows.map((row, index) => (
                  <div key={row.id || `new-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      value={row.key || row.name || ''}
                      onChange={(event) => updateRow(index, { key: event.target.value })}
                      onBlur={(event) => handleSaveRow(index, { key: event.target.value })}
                      className="input-field h-8 text-xs"
                      placeholder={t('variables.field.key')}
                    />
                    <input
                      value={row.value || ''}
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                      onBlur={(event) => handleSaveRow(index, { value: event.target.value })}
                      className="input-field h-8 text-xs"
                      placeholder={t('variables.field.value')}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(index)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[#76849b] hover:bg-[#2a1f24] hover:text-[#ff8fa0]"
                      title={t('variables.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {saving && (
              <p className="mt-2 text-[10px] text-[#76849b]">{t('common.saving')}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
