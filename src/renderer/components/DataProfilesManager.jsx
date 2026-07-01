import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { useTranslation } from '../i18n';

function createRowId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyDraft() {
  return { name: '' };
}

function emptyKeyRow() {
  return { id: createRowId(), key: '' };
}

function emptySampleDraft() {
  return { name: '' };
}

export default function DataProfilesManager({
  onToast,
  onChanged,
}) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [keyRows, setKeyRows] = useState([]);
  const [samples, setSamples] = useState([]);
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [sampleDraft, setSampleDraft] = useState(emptySampleDraft());
  const [sampleValueMap, setSampleValueMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showSampleModal, setShowSampleModal] = useState(false);
  const [newSampleName, setNewSampleName] = useState('');
  const [creatingSample, setCreatingSample] = useState(false);

  const loadProfiles = async () => {
    if (!window.electronAPI?.getVariableProfiles) {
      setProfiles([]);
      return;
    }

    setLoading(true);
    try {
      const items = await window.electronAPI.getVariableProfiles();
      setProfiles(Array.isArray(items) ? items : []);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  const loadProfileDetail = async (profileId) => {
    if (!profileId || !window.electronAPI?.getVariableProfile) {
      setKeyRows([]);
      setSamples([]);
      return;
    }

    try {
      const detail = await window.electronAPI.getVariableProfile(profileId);
      const keys = (detail?.variables || detail?.keys || []).map((item) => ({
        id: createRowId(),
        key: item.key || item.variable_key || '',
      }));
      setKeyRows(keys.length ? keys : [emptyKeyRow()]);
      setDraft({ name: detail?.name || '' });

      const sampleItems = await window.electronAPI.getVariableProfileSamples(profileId);
      setSamples(Array.isArray(sampleItems) ? sampleItems : []);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.loadDetailFailed') });
    }
  };

  const loadSampleDetail = async (sampleId) => {
    if (!sampleId || !window.electronAPI?.getVariableProfileSample) {
      setSampleValueMap({});
      return;
    }

    try {
      const detail = await window.electronAPI.getVariableProfileSample(sampleId);
      setSampleDraft({ name: detail?.name || '' });
      const nextMap = {};
      (detail?.variables || []).forEach((item) => {
        const key = item.key || item.variable_key || '';
        if (key) nextMap[key] = item.value ?? '';
      });
      setSampleValueMap(nextMap);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.loadSampleFailed') });
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setKeyRows([]);
      setSamples([]);
      setSelectedSampleId(null);
      if (!creating) setDraft(emptyDraft());
      return;
    }
    setSelectedSampleId(null);
    loadProfileDetail(selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedSampleId) {
      setSampleValueMap({});
      if (!selectedProfileId) setSampleDraft(emptySampleDraft());
      return;
    }
    loadSampleDetail(selectedSampleId);
  }, [selectedSampleId]);

  const templateKeys = useMemo(
    () => keyRows.map((row) => String(row.key || '').trim()).filter(Boolean),
    [keyRows],
  );

  const sampleDisplayRows = useMemo(
    () => templateKeys.map((key) => ({ key, value: sampleValueMap[key] ?? '' })),
    [templateKeys, sampleValueMap],
  );

  const handleCreateProfile = async () => {
    const name = String(draft.name || '').trim();
    if (!name) return;

    setCreating(true);
    try {
      const saved = await window.electronAPI.saveVariableProfile({ name, keys: [] });
      await loadProfiles();
      setSelectedProfileId(saved.id);
      setKeyRows([emptyKeyRow()]);
      onChanged?.();
      onToast?.({ type: 'success', message: t('dataProfiles.toast.created') });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.createFailed') });
    } finally {
      setCreating(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedProfileId) return;
    const name = String(draft.name || '').trim();
    if (!name) return;

    setSaving(true);
    try {
      const keys = keyRows
        .map((row) => String(row.key || '').trim())
        .filter(Boolean)
        .map((key) => ({ key }));

      await window.electronAPI.saveVariableProfile({
        id: selectedProfileId,
        name,
        keys,
      });
      await loadProfiles();
      await loadProfileDetail(selectedProfileId);
      onChanged?.();
      onToast?.({ type: 'success', message: t('dataProfiles.toast.saved') });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!profileId) return;

    try {
      await window.electronAPI.deleteVariableProfile(profileId);
      if (selectedProfileId === profileId) setSelectedProfileId(null);
      await loadProfiles();
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.deleteFailed') });
    }
  };

  const handleSaveSample = async () => {
    if (!selectedProfileId || !selectedSampleId) return;
    const name = String(sampleDraft.name || '').trim();
    if (!name) return;

    setSaving(true);
    try {
      await window.electronAPI.saveVariableProfileSample({
        id: selectedSampleId,
        profile_id: selectedProfileId,
        name,
        variables: templateKeys.map((key) => ({ key, value: sampleValueMap[key] ?? '' })),
      });
      await loadProfileDetail(selectedProfileId);
      await loadSampleDetail(selectedSampleId);
      onChanged?.();
      onToast?.({ type: 'success', message: t('dataProfiles.toast.sampleSaved') });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.sampleSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const openCreateSampleModal = () => {
    if (!selectedProfileId) return;

    const templateKeys = keyRows.map((row) => String(row.key || '').trim()).filter(Boolean);
    if (!templateKeys.length) {
      onToast?.({ type: 'error', message: t('dataProfiles.toast.noTemplateKeys') });
      return;
    }

    setNewSampleName('');
    setShowSampleModal(true);
  };

  const handleCreateSample = async () => {
    if (!selectedProfileId) return;
    const name = String(newSampleName || '').trim();
    if (!name) return;

    const templateKeys = keyRows.map((row) => String(row.key || '').trim()).filter(Boolean);
    if (!templateKeys.length) {
      onToast?.({ type: 'error', message: t('dataProfiles.toast.noTemplateKeys') });
      return;
    }

    const profileName = String(draft.name || '').trim();
    if (!profileName) {
      onToast?.({ type: 'error', message: t('dataProfiles.toast.saveFailed') });
      return;
    }

    setCreatingSample(true);
    try {
      await window.electronAPI.saveVariableProfile({
        id: selectedProfileId,
        name: profileName,
        keys: templateKeys.map((key) => ({ key })),
      });

      const saved = await window.electronAPI.saveVariableProfileSample({
        profile_id: selectedProfileId,
        name,
        variables: templateKeys.map((key) => ({ key, value: '' })),
      });
      setShowSampleModal(false);
      setNewSampleName('');
      await loadProfiles();
      await loadProfileDetail(selectedProfileId);
      setSelectedSampleId(saved.id);
      onChanged?.();
      onToast?.({ type: 'success', message: t('dataProfiles.toast.sampleCreated') });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.sampleSaveFailed') });
    } finally {
      setCreatingSample(false);
    }
  };

  const handleDeleteSample = async (sampleId) => {
    if (!sampleId) return;
    try {
      await window.electronAPI.deleteVariableProfileSample(sampleId);
      if (selectedSampleId === sampleId) setSelectedSampleId(null);
      await loadProfileDetail(selectedProfileId);
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || t('dataProfiles.toast.sampleDeleteFailed') });
    }
  };

  const updateKeyRow = (index, patch) => {
    setKeyRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const addKeyRow = () => setKeyRows((prev) => [...prev, emptyKeyRow()]);

  const removeKeyRow = (index) => {
    setKeyRows((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length ? next : [emptyKeyRow()];
    });
  };

  const updateSampleValue = (key, value) => {
    setSampleValueMap((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid min-h-[420px] grid-cols-[220px_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col rounded-xl border border-slate-700 bg-slate-900/50">
        <div className="border-b border-slate-700 p-3">
          <button
            type="button"
            onClick={() => {
              setSelectedProfileId(null);
              setDraft(emptyDraft());
              setKeyRows([]);
            }}
            className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            {t('dataProfiles.manager.newProfile')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="px-2 text-xs text-slate-400">{t('common.loading')}</p>
          ) : profiles.length === 0 ? (
            <p className="px-2 text-xs text-slate-400">{t('dataProfiles.manager.emptyList')}</p>
          ) : (
            <div className="space-y-1">
              {profiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedProfileId(profile.id)}
                    className={'min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition ' + (
                      selectedProfileId === profile.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-200 hover:bg-slate-800'
                    )}
                  >
                    {profile.name}
                    <span className="ml-1 text-[10px] opacity-70">({profile.keys?.length || 0})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(profile.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-950 hover:text-red-300"
                    title={t('dataProfiles.manager.deleteProfile')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/50 p-4">
        {selectedProfileId ? (
          <div className="space-y-6">
            <div>
              <label className="mb-4 block">
                <span className="mb-1 block text-sm font-medium text-slate-300">{t('dataProfiles.manager.nameLabel')}</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ name: event.target.value })}
                  className="input-field h-10"
                  placeholder={t('dataProfiles.manager.namePlaceholderExample')}
                />
              </label>

              <div className="mb-3 flex items-center justify-between">
                <div>
                  <span className="block text-sm font-medium text-slate-300">{t('dataProfiles.manager.skeletonSection')}</span>
                  <span className="text-xs text-slate-500">{t('dataProfiles.manager.skeletonHint')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={addKeyRow} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-600 px-3 text-xs text-slate-200 hover:bg-slate-800">
                    <Plus className="h-3.5 w-3.5" />
                    {t('common.add')}
                  </button>
                  <button type="button" onClick={handleSaveProfile} disabled={saving} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-700 px-3 text-xs text-white hover:bg-slate-600 disabled:opacity-60">
                    <Save className="h-3.5 w-3.5" />
                    {t('common.save')}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {keyRows.map((row, index) => (
                  <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      value={row.key}
                      onChange={(event) => updateKeyRow(index, { key: event.target.value })}
                      className="input-field h-9 text-sm"
                      placeholder={t('variables.field.key')}
                    />
                    <button type="button" onClick={() => removeKeyRow(index)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-950 hover:text-red-300" title={t('variables.delete')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-700 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-300">{t('dataProfiles.manager.samplesSection')}</span>
                <button type="button" onClick={openCreateSampleModal} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-600 px-3 text-xs text-slate-200 hover:bg-slate-800">
                  <Plus className="h-3.5 w-3.5" />
                  {t('dataProfiles.manager.newSample')}
                </button>
              </div>

              {samples.length === 0 ? (
                <p className="text-xs text-slate-500">{t('dataProfiles.manager.emptySamples')}</p>
              ) : (
                <div className="mb-4 flex flex-wrap gap-2">
                  {samples.map((sample) => (
                    <div key={sample.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedSampleId(sample.id)}
                        className={'rounded-lg px-3 py-1.5 text-xs ' + (
                          selectedSampleId === sample.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                        )}
                      >
                        {sample.name}
                      </button>
                      <button type="button" onClick={() => handleDeleteSample(sample.id)} className="text-slate-500 hover:text-red-300">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {selectedSampleId && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                  <label className="mb-3 block">
                    <span className="mb-1 block text-xs font-medium text-slate-400">{t('dataProfiles.manager.sampleNameLabel')}</span>
                    <input value={sampleDraft.name} onChange={(event) => setSampleDraft({ name: event.target.value })} className="input-field h-9 text-sm" />
                  </label>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">{t('dataProfiles.manager.sampleValuesHint')}</span>
                    <button type="button" onClick={handleSaveSample} disabled={saving} className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-700 px-2 text-xs text-white hover:bg-slate-600 disabled:opacity-60">
                      <Save className="h-3 w-3" />
                      {t('common.save')}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sampleDisplayRows.map((row) => (
                      <div key={row.key} className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="flex h-9 items-center truncate text-xs text-slate-400">{row.key}</span>
                        <input
                          value={row.value}
                          onChange={(event) => updateSampleValue(row.key, event.target.value)}
                          className="input-field h-9 text-sm"
                          placeholder={t('variables.field.value')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-400">{t('dataProfiles.manager.createHint')}</p>
            <label className="block max-w-md">
              <span className="mb-1 block text-sm font-medium text-slate-300">{t('dataProfiles.manager.nameLabel')}</span>
              <input value={draft.name} onChange={(event) => setDraft({ name: event.target.value })} className="input-field h-10" placeholder={t('dataProfiles.manager.namePlaceholderAccount')} />
            </label>
            <button type="button" onClick={handleCreateProfile} disabled={creating || !String(draft.name || '').trim()} className="mt-4 inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-4 text-sm text-white hover:bg-emerald-500 disabled:opacity-60">
              <Plus className="h-4 w-4" />
              {t('dataProfiles.manager.create')}
            </button>
          </>
        )}
      </div>

      {showSampleModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{t('dataProfiles.manager.sampleNamePrompt')}</h2>
              <button
                type="button"
                onClick={() => {
                  if (creatingSample) return;
                  setShowSampleModal(false);
                  setNewSampleName('');
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">{t('dataProfiles.manager.sampleNameLabel')}</span>
              <input
                value={newSampleName}
                onChange={(event) => setNewSampleName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && String(newSampleName || '').trim()) {
                    handleCreateSample();
                  }
                }}
                className="input-field h-10"
                placeholder={t('dataProfiles.manager.sampleNamePrompt')}
                autoFocus
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (creatingSample) return;
                  setShowSampleModal(false);
                  setNewSampleName('');
                }}
                className="btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreateSample}
                disabled={creatingSample || !String(newSampleName || '').trim()}
                className="btn-primary disabled:opacity-60"
              >
                {creatingSample ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
