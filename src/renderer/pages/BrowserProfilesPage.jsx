import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Globe,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteBrowserProfile,
  fetchBrowserProfiles,
  openBrowserProfile,
  saveBrowserProfile,
  scanBrowserProfiles,
} from '../slices/browserProfileSlice';
import { showToast } from '../slices/uiSlice';
import { pickDirectoryWithInput, pickFileWithInput } from '../utils/filePicker';

const emptyForm = {
  browser_key: 'chrome',
  browser_name: 'Google Chrome',
  profile_name: 'Default',
  executable_path: '',
  user_data_dir: '',
  profile_dir_name: 'Default',
  display_name: '',
  status: 'active',
};

export default function BrowserProfilesPage() {
  const dispatch = useDispatch();
  const { items, loading, scanning, opening, saving, deleting, lastScan, error } = useSelector(
    (state) => state.browserProfiles,
  );
  const [activeTab, setActiveTab] = useState('machine');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [activeImportProfileId, setActiveImportProfileId] = useState('');
  const [activeImportPath, setActiveImportPath] = useState('');
  const [recordingProfiles, setRecordingProfiles] = useState([]);
  const [importingId, setImportingId] = useState('');
  const [removingId, setRemovingId] = useState('');
  const [creatingBlank, setCreatingBlank] = useState(false);

  const machineProfiles = useMemo(
    () => items.filter((profile) => !profile.imported_at),
    [items],
  );
  const importedProfiles = useMemo(
    () => items.filter((profile) => profile.imported_at),
    [items],
  );

  const loadSettings = () => {
    window.electronAPI.getSettings()
      .then((settings) => {
        setActiveImportProfileId(settings['browser.importProfileId'] || '');
        setActiveImportPath(settings['browser.importUserDataDir'] || '');
      })
      .catch(() => {});
  };

  const loadRecordingProfiles = () => {
    window.electronAPI.listAppRecordingProfiles?.()
      .then((profiles) => setRecordingProfiles(Array.isArray(profiles) ? profiles : []))
      .catch(() => setRecordingProfiles([]));
  };

  useEffect(() => {
    dispatch(fetchBrowserProfiles());
    loadSettings();
    loadRecordingProfiles();
  }, [dispatch]);

  const handleScan = async () => {
    const result = await dispatch(scanBrowserProfiles());
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({
        type: result.payload.foundCount ? 'success' : 'info',
        message: result.payload.message,
      }));
      dispatch(fetchBrowserProfiles());
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Quét browser thất bại' }));
    }
  };

  const handleOpen = async (id) => {
    const result = await dispatch(openBrowserProfile(id));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã mở browser profile' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Không mở được browser' }));
    }
  };

  const handleImport = async (profile) => {
    setImportingId(profile.id);
    try {
      const result = await window.electronAPI.importBrowserProfile(profile.id);
      setActiveImportProfileId(profile.id);
      setActiveImportPath(result.importRoot || '');
      await dispatch(fetchBrowserProfiles());
      dispatch(showToast({
        type: 'success',
        message: result.message || `Đã import data từ ${profile.display_name}`,
      }));
      setActiveTab('app');
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Import browser profile thất bại' }));
    } finally {
      setImportingId('');
    }
  };

  const handleSetActiveImport = async (profileId) => {
    try {
      const result = await window.electronAPI.setActiveImportProfile(profileId);
      setActiveImportProfileId(profileId);
      setActiveImportPath(result.importRoot || '');
      dispatch(showToast({ type: 'success', message: 'Đã chọn profile này khi Record' }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Không chọn được profile' }));
    }
  };

  const handleCreateBlankProfile = async () => {
    const displayName = window.prompt('Tên profile trống (để trống sẽ tự đặt tên):', '');
    if (displayName === null) return;

    setCreatingBlank(true);
    try {
      const result = await window.electronAPI.createBlankBrowserProfile(displayName);
      await dispatch(fetchBrowserProfiles());
      dispatch(showToast({ type: 'success', message: result.message || 'Đã tạo profile trống' }));
      setActiveTab('app');
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Tạo profile trống thất bại' }));
    } finally {
      setCreatingBlank(false);
    }
  };

  const handleDeleteAppProfile = async (profile) => {
    const label = profile.display_name || profile.id;
    if (!window.confirm(`Xóa "${label}" khỏi app?`)) return;

    setRemovingId(profile.id);
    try {
      await window.electronAPI.deleteAppBrowserProfile(profile);
      if (activeImportProfileId === profile.id) {
        setActiveImportProfileId('');
        setActiveImportPath('');
      }
      await dispatch(fetchBrowserProfiles());
      loadRecordingProfiles();
      dispatch(showToast({ type: 'success', message: 'Đã xóa profile' }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Xóa profile thất bại' }));
    } finally {
      setRemovingId('');
    }
  };

  const handleRemoveImportedData = async (profile) => {
    await handleDeleteAppProfile(profile);
    setActiveTab('machine');
  };

  const handleOpenAppProfile = async (profile) => {
    try {
      await window.electronAPI.openAppBrowserProfile(profile);
      dispatch(showToast({ type: 'success', message: 'Đã mở browser profile' }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Không mở được browser' }));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Xóa browser profile này? Tài khoản đang gán sẽ được bỏ liên kết.')) return;
    const result = await dispatch(deleteBrowserProfile(id));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã xóa browser profile' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Xóa thất bại' }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const displayName = form.display_name || `${form.browser_name} - ${form.profile_name}`;
    const result = await dispatch(saveBrowserProfile({ ...form, display_name: displayName, source: 'manual' }));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã thêm browser profile' }));
      setShowForm(false);
      setForm({ ...emptyForm });
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Lưu browser profile thất bại' }));
    }
  };

  const chooseExecutable = async () => {
    try {
      const file = await window.electronAPI.selectFile([{ name: 'Browser executable', extensions: ['exe'] }])
        || await pickFileWithInput({ accept: '.exe' });
      if (file) setForm((current) => ({ ...current, executable_path: file }));
    } catch (error) {
      const file = await pickFileWithInput({ accept: '.exe' });
      if (file) setForm((current) => ({ ...current, executable_path: file }));
      else dispatch(showToast({ type: 'error', message: error.message || 'Không mở được hộp chọn file' }));
    }
  };

  const chooseUserDataDir = async () => {
    try {
      const directory = await window.electronAPI.selectDirectory() || await pickDirectoryWithInput();
      if (directory) setForm((current) => ({ ...current, user_data_dir: directory }));
    } catch (error) {
      const directory = await pickDirectoryWithInput();
      if (directory) setForm((current) => ({ ...current, user_data_dir: directory }));
      else dispatch(showToast({ type: 'error', message: error.message || 'Không mở được hộp chọn folder' }));
    }
  };

  const refreshAll = () => {
    dispatch(fetchBrowserProfiles());
    loadSettings();
    loadRecordingProfiles();
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <Globe className="h-7 w-7 text-[#7db4ff]" />
            Browser
          </h1>
          <p className="page-subtitle">
            Quét profile Chromium trên máy, import vào thư mục imports, rồi chọn profile dùng khi Record.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={refreshAll} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          {activeTab === 'machine' && (
            <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              Quét browser
            </button>
          )}
          {activeTab === 'machine' && (
            <button type="button" onClick={() => setShowForm(true)} className="btn-primary">
              <Plus className="h-4 w-4" />
              Thêm thủ công
            </button>
          )}
        </div>
      </div>

      {(error || lastScan?.message) && activeTab === 'machine' && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#344257] bg-[#182230] p-3 text-sm text-[#c7d0dc]">
          <AlertCircle className="h-5 w-5 shrink-0 text-[#7db4ff]" />
          <span>{error || lastScan.message}</span>
        </div>
      )}

      {activeImportPath && (
        <div className="mb-5 rounded-lg border border-emerald-600/40 bg-emerald-900/20 p-3 text-sm text-emerald-100">
          Profile đang dùng khi Record: <span className="font-mono text-emerald-200">{activeImportPath}</span>
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b border-[#2a2d34]">
        <TabButton
          active={activeTab === 'machine'}
          onClick={() => setActiveTab('machine')}
          label={`Trên máy (${machineProfiles.length})`}
        />
        <TabButton
          active={activeTab === 'app'}
          onClick={() => setActiveTab('app')}
          label={`Trong app (${importedProfiles.length + recordingProfiles.length})`}
        />
      </div>

      {showForm && activeTab === 'machine' && (
        <section className="card mb-6 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Thêm browser profile thủ công</h2>
            <button type="button" className="icon-button" onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field label="Browser key">
              <input value={form.browser_key} onChange={(event) => setForm({ ...form, browser_key: event.target.value })} className="input-field" required />
            </Field>
            <Field label="Browser name">
              <input value={form.browser_name} onChange={(event) => setForm({ ...form, browser_name: event.target.value })} className="input-field" required />
            </Field>
            <Field label="Executable path">
              <PathInput value={form.executable_path} onChange={(value) => setForm({ ...form, executable_path: value })} onPick={chooseExecutable} icon={FileSearch} />
            </Field>
            <Field label="User data dir">
              <PathInput value={form.user_data_dir} onChange={(value) => setForm({ ...form, user_data_dir: value })} onPick={chooseUserDataDir} icon={FolderOpen} />
            </Field>
            <Field label="Profile directory name">
              <input value={form.profile_dir_name} onChange={(event) => setForm({ ...form, profile_dir_name: event.target.value })} className="input-field" required />
            </Field>
            <Field label="Profile name">
              <input value={form.profile_name} onChange={(event) => setForm({ ...form, profile_name: event.target.value })} className="input-field" required />
            </Field>
            <Field label="Display name">
              <input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} className="input-field" placeholder="Để trống sẽ tự ghép Browser - Profile" />
            </Field>
            <Field label="Trạng thái">
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="select-field">
                <option value="active">Hoạt động</option>
                <option value="inactive">Tắt</option>
              </select>
            </Field>
            <div className="flex justify-end gap-3 lg:col-span-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Hủy</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Lưu browser profile
              </button>
            </div>
          </form>
        </section>
      )}

      {activeTab === 'machine' && (
        <MachineProfilesList
          loading={loading}
          profiles={machineProfiles}
          importingId={importingId}
          opening={opening}
          deleting={deleting}
          onImport={handleImport}
          onOpen={handleOpen}
          onDelete={handleDelete}
        />
      )}

      {activeTab === 'app' && (
        <AppProfilesList
          importedProfiles={importedProfiles}
          recordingProfiles={recordingProfiles}
          activeImportProfileId={activeImportProfileId}
          removingId={removingId}
          creatingBlank={creatingBlank}
          opening={opening}
          onCreateBlank={handleCreateBlankProfile}
          onSetActive={handleSetActiveImport}
          onOpen={handleOpenAppProfile}
          onDelete={handleDeleteAppProfile}
          onRemoveImported={handleRemoveImportedData}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-sm font-semibold transition ${
        active
          ? 'border-[#635bff] text-white'
          : 'border-transparent text-[#9aa7b7] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function MachineProfilesList({
  loading,
  profiles,
  importingId,
  opening,
  deleting,
  onImport,
  onOpen,
  onDelete,
}) {
  if (loading && profiles.length === 0) {
    return (
      <div className="panel flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#9aa7b7]" />
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="panel flex h-64 flex-col items-center justify-center text-center">
        <Globe className="mb-3 h-12 w-12 text-[#6f7d90]" />
        <p className="text-sm font-semibold text-white">Chưa có profile trên máy</p>
        <p className="mt-1 max-w-md text-sm text-[#9aa7b7]">
          Bấm &quot;Quét browser&quot; để tìm Chrome, Edge, Brave, Cốc Cốc rồi chọn Import.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {profiles.map((profile) => (
        <article key={profile.id} className="card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-white">{profile.display_name}</h2>
              <p className="mt-1 text-sm text-[#9aa7b7]">{profile.browser_name} / {profile.profile_dir_name}</p>
            </div>
            <span className="badge">{profile.source || 'scan'}</span>
          </div>
          <div className="mb-4 space-y-2 text-xs text-[#9aa7b7]">
            <Detail label="Executable" value={profile.executable_path} />
            <Detail label="User data" value={profile.user_data_dir} />
            <Detail label="Scanned" value={profile.last_scanned_at ? new Date(profile.last_scanned_at).toLocaleString('vi-VN') : 'Thủ công'} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onImport(profile)}
              disabled={importingId === profile.id}
              className="btn-primary flex-1"
            >
              {importingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Import
            </button>
            <button type="button" onClick={() => onOpen(profile.id)} disabled={opening} className="btn-secondary">
              <ExternalLink className="h-4 w-4" />
              Mở thử
            </button>
            <button type="button" onClick={() => onDelete(profile.id)} disabled={deleting} className="btn-danger">
              <Trash2 className="h-4 w-4" />
              Xóa
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AppProfilesList({
  importedProfiles,
  recordingProfiles,
  activeImportProfileId,
  removingId,
  creatingBlank,
  opening,
  onCreateBlank,
  onSetActive,
  onOpen,
  onDelete,
  onRemoveImported,
}) {
  if (importedProfiles.length === 0 && recordingProfiles.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button type="button" onClick={onCreateBlank} disabled={creatingBlank} className="btn-primary">
            {creatingBlank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Tạo profile trống
          </button>
        </div>
        <div className="panel flex h-64 flex-col items-center justify-center text-center">
          <Monitor className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">Chưa có profile trong app</p>
          <p className="mt-1 max-w-md text-sm text-[#9aa7b7]">
            Import từ tab &quot;Trên máy&quot; hoặc tạo profile trống mới.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button type="button" onClick={onCreateBlank} disabled={creatingBlank} className="btn-primary">
          {creatingBlank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Tạo profile trống
        </button>
      </div>
      {importedProfiles.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#76849b]">
            Đã import ({importedProfiles.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {importedProfiles.map((profile) => {
              const isActive = activeImportProfileId === profile.id;
              return (
                <article key={profile.id} className="card p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-white">{profile.display_name}</h2>
                      <p className="mt-1 text-sm text-[#9aa7b7]">{profile.browser_name} / {profile.profile_dir_name}</p>
                    </div>
                    <span className={`badge ${isActive ? 'border-emerald-500/50 text-emerald-300' : ''}`}>
                      {isActive ? 'Đang dùng' : 'imported'}
                    </span>
                  </div>
                  <div className="mb-4 space-y-2 text-xs text-[#9aa7b7]">
                    <Detail label="Import path" value={profile.import_path} />
                    <Detail
                      label="Imported"
                      value={profile.imported_at ? new Date(profile.imported_at).toLocaleString('vi-VN') : '-'}
                    />
                  </div>
                  <div className="flex gap-2">
                    {!isActive && (
                      <button type="button" onClick={() => onSetActive(profile.id)} className="btn-primary flex-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Dùng khi Record
                      </button>
                    )}
                    <button type="button" onClick={() => onOpen(profile)} disabled={opening} className="btn-secondary">
                      <ExternalLink className="h-4 w-4" />
                      Mở thử
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveImported(profile)}
                      disabled={removingId === profile.id}
                      className="btn-danger"
                    >
                      {removingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Xóa
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {recordingProfiles.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#76849b]">
            Profile ghi từ Record ({recordingProfiles.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {recordingProfiles.map((profile) => (
              <article key={profile.id} className="card p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-white">{profile.display_name}</h2>
                    <p className="mt-1 text-sm text-[#9aa7b7]">Tạo tự động khi ghi kịch bản</p>
                  </div>
                  <span className="badge">record</span>
                </div>
                <Detail label="Path" value={profile.import_path} />
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => onOpen(profile)} disabled={opening} className="btn-secondary flex-1">
                    <ExternalLink className="h-4 w-4" />
                    Mở thử
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(profile)}
                    disabled={removingId === profile.id}
                    className="btn-danger"
                  >
                    {removingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[#c7d0dc]">{label}</span>
      {children}
    </label>
  );
}

function PathInput({ value, onChange, onPick, icon: Icon }) {
  return (
    <div className="flex gap-2">
      <input value={value} onChange={(event) => onChange(event.target.value)} className="input-field" required />
      <button type="button" onClick={onPick} className="icon-button bg-[#243244]">
        <Icon className="h-4 w-4" />
      </button>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <p className="flex gap-3">
      <span className="w-24 shrink-0">{label}</span>
      <span className="min-w-0 truncate text-[#c7d0dc]" title={value || ''}>{value || '-'}</span>
    </p>
  );
}
