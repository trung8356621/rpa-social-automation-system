import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Globe,
  Loader2,
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
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [importProfileId, setImportProfileId] = useState('');
  const [importPath, setImportPath] = useState('');

  useEffect(() => {
    dispatch(fetchBrowserProfiles());
    window.electronAPI.getSettings()
      .then((settings) => {
        setImportProfileId(settings['browser.importProfileId'] || '');
        setImportPath(settings['browser.importUserDataDir'] || '');
      })
      .catch(() => {});
  }, [dispatch]);

  const handleScan = async () => {
    const result = await dispatch(scanBrowserProfiles());
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: result.payload.foundCount ? 'success' : 'info', message: result.payload.message }));
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
    try {
      const result = await window.electronAPI.importBrowserProfile(profile.id);
      setImportProfileId(profile.id);
      setImportPath(result.importRoot || '');
      dispatch(showToast({ type: 'success', message: result.message || `Đã import data từ ${profile.display_name}` }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || 'Import browser profile thất bại' }));
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

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <Globe className="h-7 w-7 text-[#7db4ff]" />
            Browser
          </h1>
          <p className="page-subtitle">Quét browser Chromium trên máy và chọn profile để import data khi Record.</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => dispatch(fetchBrowserProfiles())} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            Quét browser
          </button>
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            Thêm thủ công
          </button>
        </div>
      </div>

      {(error || lastScan?.message) && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#344257] bg-[#182230] p-3 text-sm text-[#c7d0dc]">
          <AlertCircle className="h-5 w-5 shrink-0 text-[#7db4ff]" />
          <span>{error || lastScan.message}</span>
        </div>
      )}

      {importPath && (
        <div className="mb-5 rounded-lg border border-emerald-600/40 bg-emerald-900/20 p-3 text-sm text-emerald-100">
          Data import hiện tại: <span className="font-mono text-emerald-200">{importPath}</span>
        </div>
      )}

      {showForm && (
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

      {loading && items.length === 0 ? (
        <div className="panel flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#9aa7b7]" />
        </div>
      ) : items.length === 0 ? (
        <div className="panel flex h-64 flex-col items-center justify-center text-center">
          <Globe className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">Chưa có browser profile</p>
          <p className="mt-1 max-w-md text-sm text-[#9aa7b7]">Bấm “Quét browser” để tự tìm Chrome, Edge, Brave, Cốc Cốc rồi chọn Import.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {items.map((profile) => {
            const isImported = importProfileId === profile.id;
            return (
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
                  <button type="button" onClick={() => handleImport(profile)} className={isImported ? 'btn-primary flex-1' : 'btn-secondary flex-1'}>
                    <CheckCircle2 className="h-4 w-4" />
                    {isImported ? 'Đang import' : 'Import'}
                  </button>
                  <button type="button" onClick={() => handleOpen(profile.id)} disabled={opening} className="btn-secondary">
                    <ExternalLink className="h-4 w-4" />
                    Mở thử
                  </button>
                  <button type="button" onClick={() => handleDelete(profile.id)} disabled={deleting} className="btn-danger">
                    <Trash2 className="h-4 w-4" />
                    Xóa
                  </button>
                </div>
              </article>
            );
          })}
        </div>
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
