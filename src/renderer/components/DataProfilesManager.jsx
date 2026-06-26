import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';

function emptyDraft() {
  return { name: '' };
}

export default function DataProfilesManager({
  scenarioId,
  skeletonKeys = [],
  onToast,
  onChanged,
}) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [profileDetail, setProfileDetail] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [valueDraft, setValueDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadProfiles = async () => {
    if (!scenarioId || !window.electronAPI?.getVariableProfiles) {
      setProfiles([]);
      return;
    }

    setLoading(true);
    try {
      const items = await window.electronAPI.getVariableProfiles(scenarioId);
      setProfiles(Array.isArray(items) ? items : []);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Không tải được hồ sơ dữ liệu' });
    } finally {
      setLoading(false);
    }
  };

  const loadProfileDetail = async (profileId) => {
    if (!profileId || !window.electronAPI?.getVariableProfile) {
      setProfileDetail(null);
      setValueDraft({});
      return;
    }

    try {
      const detail = await window.electronAPI.getVariableProfile(profileId);
      setProfileDetail(detail);
      const nextValues = {};
      for (const item of detail?.values || []) {
        nextValues[item.variable_key] = item.value ?? '';
      }
      setValueDraft(nextValues);
      setDraft({ name: detail?.name || '' });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Không tải được chi tiết hồ sơ' });
    }
  };

  useEffect(() => {
    setSelectedProfileId(null);
    setProfileDetail(null);
    setValueDraft({});
    setDraft(emptyDraft());
    loadProfiles();
  }, [scenarioId]);

  useEffect(() => {
    if (skeletonKeys.length) {
      loadProfiles();
    }
  }, [skeletonKeys.length]);

  useEffect(() => {
    if (!selectedProfileId) {
      setProfileDetail(null);
      setValueDraft({});
      if (!creating) {
        setDraft(emptyDraft());
      }
      return;
    }
    loadProfileDetail(selectedProfileId);
  }, [selectedProfileId]);

  const handleCreateProfile = async () => {
    const name = String(draft.name || '').trim();
    if (!scenarioId || !name) return;

    if (!skeletonKeys.length) {
      onToast?.({ type: 'error', message: 'Thêm biến mặc định (khung) trong editor trước khi tạo hồ sơ' });
      return;
    }

    setCreating(true);
    try {
      const saved = await window.electronAPI.saveVariableProfile({
        scenario_id: scenarioId,
        name,
      });
      await loadProfiles();
      setSelectedProfileId(saved.id);
      onChanged?.();
      onToast?.({ type: 'success', message: 'Đã tạo hồ sơ dữ liệu' });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Tạo hồ sơ thất bại' });
    } finally {
      setCreating(false);
    }
  };

  const handleSaveProfileMeta = async () => {
    if (!selectedProfileId) return;
    const name = String(draft.name || '').trim();
    if (!name) return;

    setSaving(true);
    try {
      await window.electronAPI.saveVariableProfile({
        id: selectedProfileId,
        scenario_id: scenarioId,
        name,
      });
      await loadProfiles();
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Lưu tên hồ sơ thất bại' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveValues = async () => {
    if (!selectedProfileId) return;

    setSaving(true);
    try {
      const values = skeletonKeys.map((key) => ({
        variable_key: key,
        value: valueDraft[key] ?? '',
      }));
      await window.electronAPI.saveProfileVariableValues({
        profileId: selectedProfileId,
        values,
      });
      await loadProfileDetail(selectedProfileId);
      onChanged?.();
      onToast?.({ type: 'success', message: 'Đã lưu giá trị hồ sơ' });
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Lưu giá trị thất bại' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async (profileId) => {
    if (!profileId) return;

    try {
      await window.electronAPI.deleteVariableProfile(profileId);
      if (selectedProfileId === profileId) {
        setSelectedProfileId(null);
      }
      await loadProfiles();
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Xóa hồ sơ thất bại' });
    }
  };

  if (!scenarioId) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
        Chọn kịch bản để quản lý hồ sơ dữ liệu.
      </p>
    );
  }

  if (!skeletonKeys.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
        Kịch bản chưa có biến khung. Mở editor kịch bản và thêm biến mặc định trước.
      </p>
    );
  }

  return (
    <div className="grid min-h-[420px] grid-cols-[220px_minmax(0,1fr)] gap-4">
      <div className="flex min-h-0 flex-col rounded-xl border border-slate-700 bg-slate-900/50">
        <div className="border-b border-slate-700 p-3">
          <button
            type="button"
            onClick={() => {
              setSelectedProfileId(null);
              setDraft(emptyDraft());
              setValueDraft({});
            }}
            className="inline-flex h-9 w-full items-center justify-center gap-1 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" />
            Hồ sơ mới
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <p className="px-2 text-xs text-slate-400">Đang tải...</p>
          ) : profiles.length === 0 ? (
            <p className="px-2 text-xs text-slate-400">Chưa có hồ sơ.</p>
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
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProfile(profile.id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-950 hover:text-red-300"
                    title="Xóa hồ sơ"
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
          <>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm font-medium text-slate-300">Tên hồ sơ</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ name: event.target.value })}
                onBlur={handleSaveProfileMeta}
                className="input-field h-10"
                placeholder="Ví dụ: Shop A"
              />
            </label>

            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Giá trị theo biến</span>
              <button
                type="button"
                onClick={handleSaveValues}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-700 px-3 text-xs text-white hover:bg-slate-600 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                Lưu
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {skeletonKeys.map((key) => {
                const defaultValue = profileDetail?.values?.find((item) => item.variable_key === key)?.default_value ?? '';
                return (
                  <label key={key} className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-400">{key}</span>
                    <input
                      value={valueDraft[key] ?? ''}
                      onChange={(event) => setValueDraft((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))}
                      className="input-field h-9 text-sm"
                      placeholder={defaultValue ? `Mặc định: ${defaultValue}` : 'Dùng giá trị mặc định'}
                    />
                  </label>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-400">Tạo hồ sơ dữ liệu mới cho kịch bản này.</p>
            <label className="block max-w-md">
              <span className="mb-1 block text-sm font-medium text-slate-300">Tên hồ sơ</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ name: event.target.value })}
                className="input-field h-10"
                placeholder="Ví dụ: Tài khoản A"
              />
            </label>
            <button
              type="button"
              onClick={handleCreateProfile}
              disabled={creating || !String(draft.name || '').trim()}
              className="mt-4 inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-4 text-sm text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Tạo hồ sơ
            </button>
          </>
        )}
      </div>
    </div>
  );
}
