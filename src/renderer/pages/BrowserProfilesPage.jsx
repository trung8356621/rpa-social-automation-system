import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Globe,
  Info,
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
import { useLanguage, useTranslation } from '../i18n';

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
  const { t } = useTranslation();
  const language = useLanguage();
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
  const [showBlankModal, setShowBlankModal] = useState(false);
  const [blankProfileName, setBlankProfileName] = useState('');
  const [detectingId, setDetectingId] = useState('');

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

  useEffect(() => {
    if (!window.electronAPI?.onBrowserProfileAccountDetected) return undefined;
    return window.electronAPI.onBrowserProfileAccountDetected(() => {
      dispatch(fetchBrowserProfiles());
    });
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
      dispatch(showToast({ type: 'error', message: result.payload || t('browserProfiles.toast.scanFailed') }));
    }
  };

  const handleOpen = async (id) => {
    const result = await dispatch(openBrowserProfile(id));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.opened') }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('browserProfiles.toast.openFailed') }));
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
        message: result.message || t('browserProfiles.toast.imported', { name: profile.display_name }),
      }));
      setActiveTab('app');
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('browserProfiles.toast.importFailed') }));
    } finally {
      setImportingId('');
    }
  };

  const handleSetActiveImport = async (profileId) => {
    try {
      const result = await window.electronAPI.setActiveImportProfile(profileId);
      setActiveImportProfileId(profileId);
      setActiveImportPath(result.importRoot || '');
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.setActiveForRecord') }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('browserProfiles.toast.setActiveFailed') }));
    }
  };

  const handleCreateBlankProfile = () => {
    setBlankProfileName('');
    setShowBlankModal(true);
  };

  const confirmCreateBlankProfile = async () => {
    setCreatingBlank(true);
    try {
      const result = await window.electronAPI.createBlankBrowserProfile(blankProfileName);
      await dispatch(fetchBrowserProfiles());
      dispatch(showToast({ type: 'success', message: result.message || t('browserProfiles.toast.blankCreated') }));
      setShowBlankModal(false);
      setActiveTab('app');
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('browserProfiles.toast.blankCreateFailed') }));
    } finally {
      setCreatingBlank(false);
    }
  };

  const handleDeleteAppProfile = async (profile) => {
    const label = profile.display_name || profile.id;
    if (!window.confirm(t('browserProfiles.confirm.deleteFromApp', { label }))) return;

    setRemovingId(profile.id);
    try {
      await window.electronAPI.deleteAppBrowserProfile(profile);
      if (activeImportProfileId === profile.id) {
        setActiveImportProfileId('');
        setActiveImportPath('');
      }
      await dispatch(fetchBrowserProfiles());
      loadRecordingProfiles();
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.deleted') }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('browserProfiles.toast.deleteFailed') }));
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
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.opened') }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || t('browserProfiles.toast.openFailed') }));
    }
  };

  const handleCopyPath = async (pathValue) => {
    const text = String(pathValue || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      dispatch(showToast({ type: 'success', message: language === 'en' ? 'Path copied' : 'ÄÃ£ copy Ä‘Æ°á»ng dáº«n' }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || (language === 'en' ? 'Copy failed' : 'Copy tháº¥t báº¡i') }));
    }
  };


  const handleDetectAccount = async (profile) => {
    if (!window.electronAPI?.detectBrowserProfileAccount) return;
    setDetectingId(profile.id);
    try {
      const result = await window.electronAPI.detectBrowserProfileAccount(profile.id);
      await dispatch(fetchBrowserProfiles());
      const accountSummary = result?.account?.summary || '';
      dispatch(showToast({
        type: accountSummary ? 'success' : 'info',
        message: accountSummary
          ? (language === 'en' ? `Found: ${accountSummary}` : `DÃ² tháº¥y: ${accountSummary}`)
          : (language === 'en' ? 'No account found in this profile' : 'ChÆ°a dÃ² tháº¥y tÃ i khoáº£n trong profile'),
      }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err.message || (language === 'en' ? 'Profile scan failed' : 'DÃ² profile tháº¥t báº¡i') }));
    } finally {
      setDetectingId('');
    }
  };

  const handleSaveAccountSummary = async (profileId, accountSummary) => {
    if (!window.electronAPI?.updateBrowserProfileAccountSummary) return null;
    const updated = await window.electronAPI.updateBrowserProfileAccountSummary({ profileId, accountSummary });
    await dispatch(fetchBrowserProfiles());
    dispatch(showToast({ type: 'success', message: language === 'en' ? 'Account updated' : 'ÄÃ£ cáº­p nháº­t account' }));
    return updated;
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('browserProfiles.confirm.deleteMachine'))) return;
    const result = await dispatch(deleteBrowserProfile(id));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.machineDeleted') }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('common.deleteFailed') }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const displayName = form.display_name || `${form.browser_name} - ${form.profile_name}`;
    const result = await dispatch(saveBrowserProfile({ ...form, display_name: displayName, source: 'manual' }));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: t('browserProfiles.toast.added') }));
      setShowForm(false);
      setForm({ ...emptyForm });
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || t('browserProfiles.toast.saveFailed') }));
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
      else dispatch(showToast({ type: 'error', message: error.message || t('common.errors.filePickerFailed') }));
    }
  };

  const chooseUserDataDir = async () => {
    try {
      const directory = await window.electronAPI.selectDirectory() || await pickDirectoryWithInput();
      if (directory) setForm((current) => ({ ...current, user_data_dir: directory }));
    } catch (error) {
      const directory = await pickDirectoryWithInput();
      if (directory) setForm((current) => ({ ...current, user_data_dir: directory }));
      else dispatch(showToast({ type: 'error', message: error.message || t('common.errors.folderPickerFailed') }));
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
            {t('browserProfiles.title')}
          </h1>
          <p className="page-subtitle">
            {t('browserProfiles.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={refreshAll} className="btn-secondary">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </button>
          {activeTab === 'machine' && (
            <button type="button" onClick={handleScan} disabled={scanning} className="btn-secondary">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              {t('browserProfiles.scan')}
            </button>
          )}
          {activeTab === 'machine' && (
            <button type="button" onClick={() => setShowForm(true)} className="btn-primary">
              <Plus className="h-4 w-4" />
              {t('browserProfiles.addManual')}
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
          {t('browserProfiles.activeRecordProfile')}{' '}
          <span className="font-mono text-emerald-200">{activeImportPath}</span>
        </div>
      )}

      <div className="mb-5 flex gap-1 border-b border-[#2a2d34]">
        <TabButton
          active={activeTab === 'machine'}
          onClick={() => setActiveTab('machine')}
          label={t('browserProfiles.tabs.machine', { count: machineProfiles.length })}
        />
        <TabButton
          active={activeTab === 'app'}
          onClick={() => setActiveTab('app')}
          label={t('browserProfiles.tabs.app', { count: importedProfiles.length + recordingProfiles.length })}
        />
      </div>

      {showForm && activeTab === 'machine' && (
        <section className="card mb-6 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">{t('browserProfiles.form.title')}</h2>
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
              <input value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} className="input-field" placeholder={t('browserProfiles.form.displayNamePlaceholder')} />
            </Field>
            <Field label={t('common.status')}>
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="select-field">
                <option value="active">{t('status.active')}</option>
                <option value="inactive">{t('status.inactiveShort')}</option>
              </select>
            </Field>
            <div className="flex justify-end gap-3 lg:col-span-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('common.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('browserProfiles.form.save')}
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
          detectingId={detectingId}
          deleting={deleting}
          onImport={handleImport}
          onOpen={handleOpen}
          onDetect={handleDetectAccount}
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
          detectingId={detectingId}
          onCreateBlank={handleCreateBlankProfile}
          onOpen={handleOpenAppProfile}
          onDetect={handleDetectAccount}
          onCopyPath={handleCopyPath}
          onSaveAccountSummary={handleSaveAccountSummary}
          onDelete={handleDeleteAppProfile}
          onRemoveImported={handleRemoveImportedData}
        />
      )}

      {showBlankModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-[#344054] bg-[#1c2535] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{t('browserProfiles.blank.create')}</h2>
              <button type="button" className="icon-button" onClick={() => setShowBlankModal(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-[#b7c4d8]">{t('browserProfiles.blank.nameLabel')}</span>
              <input
                value={blankProfileName}
                onChange={(event) => setBlankProfileName(event.target.value)}
                className="input-field"
                placeholder={t('browserProfiles.blank.namePlaceholder')}
                autoFocus
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowBlankModal(false)} className="btn-secondary">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={confirmCreateBlankProfile} disabled={creatingBlank} className="btn-primary">
                {creatingBlank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t('common.create')}
              </button>
            </div>
          </div>
        </div>
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
  detectingId,
  deleting,
  onImport,
  onOpen,
  onDetect,
  onDelete,
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const detectLabel = language === 'en' ? 'Scan Account' : 'DÃ² Profile';

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
        <p className="text-sm font-semibold text-white">{t('browserProfiles.machine.emptyTitle')}</p>
        <p className="mt-1 max-w-md text-sm text-[#9aa7b7]">
          {t('browserProfiles.machine.emptyText')}
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
            <AccountDetails profile={profile} />
            <Detail label="Scanned" value={profile.last_scanned_at ? new Date(profile.last_scanned_at).toLocaleString(dateLocale) : t('browserProfiles.detail.manual')} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onImport(profile)}
              disabled={importingId === profile.id}
              className="btn-primary flex-1"
            >
              {importingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {t('browserProfiles.actions.import')}
            </button>
            <button type="button" onClick={() => onOpen(profile.id)} disabled={opening} className="btn-secondary">
              <ExternalLink className="h-4 w-4" />
              {t('browserProfiles.actions.testOpen')}
            </button>
            <button type="button" onClick={() => onDetect(profile)} disabled={detectingId === profile.id} className="btn-secondary">
              {detectingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              {detectLabel}
            </button>
            <button type="button" onClick={() => onDelete(profile.id)} disabled={deleting} className="btn-danger">
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
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
  detectingId,
  onCreateBlank,
  onOpen,
  onDetect,
  onSaveAccountSummary,
  onDelete,
  onRemoveImported,
}) {
  const { t } = useTranslation();
  const language = useLanguage();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const detectLabel = language === 'en' ? 'Scan Account' : 'DÃ² Profile';
  const [accountProfile, setAccountProfile] = useState(null);

  if (importedProfiles.length === 0 && recordingProfiles.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button type="button" onClick={onCreateBlank} disabled={creatingBlank} className="btn-primary">
            {creatingBlank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('browserProfiles.blank.create')}
          </button>
        </div>
        <div className="panel flex h-64 flex-col items-center justify-center text-center">
          <Monitor className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">{t('browserProfiles.app.emptyTitle')}</p>
          <p className="mt-1 max-w-md text-sm text-[#9aa7b7]">
            {t('browserProfiles.app.emptyText')}
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
          {t('browserProfiles.blank.create')}
        </button>
      </div>
      {importedProfiles.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#76849b]">
            {t('browserProfiles.app.importedSection', { count: importedProfiles.length })}
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
                      {isActive ? t('browserProfiles.badge.active') : t('browserProfiles.badge.imported')}
                    </span>
                  </div>
                  <div className="mb-4 grid grid-cols-1 gap-2 text-xs text-[#9aa7b7] sm:grid-cols-3">
                    <PathCopyTile
                      pathValue={profile.import_path}
                      language={language}
                      onCopy={() => onCopyPath(profile.import_path)}
                    />
                    <AccountSummaryTile
                      profile={profile}
                      language={language}
                      onOpen={() => setAccountProfile(profile)}
                    />
                    <ImportedTile importedAt={profile.imported_at} dateLocale={dateLocale} language={language} />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => onOpen(profile)} disabled={opening} className="btn-secondary flex-1">
                      <ExternalLink className="h-4 w-4" />
                      {t('browserProfiles.actions.testOpen')}
                    </button>
                    <button type="button" onClick={() => onDetect(profile)} disabled={detectingId === profile.id} className="btn-secondary">
                      {detectingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                      {detectLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveImported(profile)}
                      disabled={removingId === profile.id}
                      className="btn-danger"
                    >
                      {removingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {t('common.delete')}
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
            {t('browserProfiles.app.recordingSection', { count: recordingProfiles.length })}
          </h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {recordingProfiles.map((profile) => (
              <article key={profile.id} className="card p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-white">{profile.display_name}</h2>
                    <p className="mt-1 text-sm text-[#9aa7b7]">{t('browserProfiles.recording.autoCreated')}</p>
                  </div>
                  <span className="badge">{t('browserProfiles.badge.record')}</span>
                </div>
                <div className="mb-4 grid grid-cols-1 gap-2 text-xs text-[#9aa7b7] sm:grid-cols-3">
                  <PathCopyTile
                    pathValue={profile.import_path}
                    language={language}
                    onCopy={() => onCopyPath(profile.import_path)}
                  />
                  <AccountSummaryTile
                    profile={profile}
                    language={language}
                    onOpen={() => setAccountProfile(profile)}
                  />
                  <ImportedTile importedAt={profile.imported_at} dateLocale={dateLocale} language={language} />
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => onOpen(profile)} disabled={opening} className="btn-secondary flex-1">
                    <ExternalLink className="h-4 w-4" />
                    {t('browserProfiles.actions.testOpen')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(profile)}
                    disabled={removingId === profile.id}
                    className="btn-danger"
                  >
                    {removingId === profile.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {t('common.delete')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {accountProfile && (
        <AccountDetailModal
          profile={accountProfile}
          language={language}
          onSave={onSaveAccountSummary}
          onClose={() => setAccountProfile(null)}
        />
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

function PathCopyTile({ pathValue, language, onCopy }) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex min-h-[54px] items-center gap-3 rounded-lg border border-[#344257] bg-[#172233] px-3 text-left transition hover:border-[#4f8cff]/60 hover:bg-[#1d2b40]"
      title={pathValue || ''}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#22324a] text-[#9ec5ff]">
        <Clipboard className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-[#7f8ea3]">Path</span>
        <span className="block truncate text-sm font-semibold text-white">
          {language === 'en' ? 'Copy path' : 'Copy Ä‘Æ°á»ng dáº«n'}
        </span>
      </span>
    </button>
  );
}

function AccountSummaryTile({ profile, language, onOpen }) {
  const accounts = parseAccountSummary(profile);
  const count = accounts.length;
  const emptyLabel = language === 'en' ? 'Not detected' : 'ChÆ°a dÃ²';

  return (
    <button
      type="button"
      onClick={count ? onOpen : undefined}
      disabled={!count}
      className="flex min-h-[54px] items-center gap-3 rounded-lg border border-[#344257] bg-[#172233] px-3 text-left transition enabled:hover:border-emerald-400/60 enabled:hover:bg-[#1d2b40] disabled:cursor-default disabled:opacity-70"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300">
        <Info className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-[#7f8ea3]">Account</span>
        <span className="block truncate text-sm font-semibold text-white">
          {count ? `${count} site${count > 1 ? 's' : ''}` : emptyLabel}
        </span>
      </span>
    </button>
  );
}

function ImportedTile({ importedAt, dateLocale, language }) {
  const date = importedAt ? new Date(importedAt) : null;
  const value = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(dateLocale, { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '-';
  const title = date && !Number.isNaN(date.getTime()) ? date.toLocaleString(dateLocale) : '';

  return (
    <div className="flex min-h-[54px] items-center gap-3 rounded-lg border border-[#344257] bg-[#172233] px-3" title={title}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-300">
        <CalendarClock className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] uppercase tracking-wide text-[#7f8ea3]">
          {language === 'en' ? 'Imported' : 'ÄÃ£ import'}
        </span>
        <span className="block truncate text-sm font-semibold text-white">{value}</span>
      </span>
    </div>
  );
}

function AccountDetailModal({ profile, language, onSave, onClose }) {
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const [localProfile, setLocalProfile] = useState(profile);
  const [editingKey, setEditingKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const accounts = parseAccountSummary(localProfile, dateLocale);
  const title = language === 'en' ? 'Detected accounts' : 'TÃ i khoáº£n Ä‘Ã£ dÃ²';
  const beginEdit = (account, index) => {
    setEditingKey(`${account.site}-${index}`);
    setEditValue(account.account === '-' ? '' : account.account || '');
  };

  const saveEdit = async (account, nextValue) => {
    const value = String(nextValue || '').trim();
    const nextAccounts = accounts.map((item) => (
      item.site === account.site && item.kind === account.kind
        ? { ...item, account: value || '-' }
        : item
    ));
    const accountSummary = buildAccountSummary(nextAccounts);
    const updated = await onSave?.(localProfile.id, accountSummary);
    setLocalProfile(updated || { ...localProfile, account_summary: accountSummary });
    setEditingKey('');
    setEditValue('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-[#344054] bg-[#111b2a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#263449] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            <p className="mt-1 text-xs text-[#8ea0b8]">{profile.display_name}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto p-5">
          {accounts.length ? (
            <div className="overflow-hidden rounded-lg border border-[#2d3b52]">
              <div className="grid grid-cols-[1fr_1.4fr_1fr] bg-[#172233] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#8ea0b8]">
                <span>Site</span>
                <span>{language === 'en' ? 'Account' : 'TÃªn account'}</span>
                <span>{language === 'en' ? 'Login' : 'NgÃ y login'}</span>
              </div>
              {accounts.map((account, index) => {
                const editKey = `${account.site}-${index}`;
                const isEditing = editingKey === editKey;
                return (
                  <div key={editKey} className="grid grid-cols-[1fr_1.4fr_1fr] border-t border-[#2d3b52] px-4 py-3 text-sm text-[#d7e1ee]">
                    <span className="min-w-0 truncate font-medium text-white" title={account.site}>{account.site}</span>
                    <span className="min-w-0 truncate" title={account.account}>
                      {isEditing ? (
                        <input
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onBlur={() => saveEdit(account, editValue)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveEdit(account, editValue);
                            if (event.key === 'Escape') {
                              setEditingKey('');
                              setEditValue('');
                            }
                          }}
                          className="h-7 w-full rounded border border-[#4f8cff] bg-[#0f1724] px-2 text-sm text-white outline-none"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          onDoubleClick={() => beginEdit(account, index)}
                          className="max-w-full truncate rounded px-1 text-left hover:bg-[#24344b] hover:text-white"
                          title={language === 'en' ? 'Double-click to edit' : 'Double-click để sửa'}
                        >
                          {account.account || '-'}
                        </button>
                      )}
                    </span>
                    <span className="min-w-0 truncate text-[#9fb0c5]">{account.loginAt || '-'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[#9aa7b7]">{language === 'en' ? 'No account detected.' : 'ChÆ°a dÃ² tháº¥y tÃ i khoáº£n.'}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function parseAccountSummary(profile, dateLocale = 'vi-VN') {
  const detectedAt = formatAccountLoginDate(profile, dateLocale);
  const summary = String(profile?.account_summary || profile?.accountSummary || '').trim();
  if (!summary) {
    const fallback = [];
    if (profile?.facebook_id || profile?.facebookId) {
      fallback.push({ kind: 'fb', site: 'Facebook', account: profile.facebook_id || profile.facebookId, loginAt: detectedAt });
    }
    if (profile?.has_linkedin || profile?.hasLinkedIn) {
      fallback.push({ kind: 'linkedin', site: 'LinkedIn', account: 'Active', loginAt: detectedAt });
    }
    return fallback;
  }

  return summary
    .split('|')
    .map((item) => parseAccountLabel(item.trim(), detectedAt))
    .filter((item) => item.site || item.account);
}

function parseAccountLabel(label, loginAt = '') {
  const [rawSite, ...rest] = String(label || '').split(':');
  const type = (rawSite || '').trim();
  const value = rest.join(':').trim();
  const match = value.match(/^(.*?)\s*\((.*?)\)\s*$/);
  const primary = match ? match[1].trim() : value;
  const secondary = match ? match[2].trim() : '';

  if (/^wp$/i.test(type) || /^wordpress$/i.test(type)) {
    return { kind: 'wp', site: primary || 'WordPress', account: secondary || '-', loginAt };
  }
  if (/^fb$/i.test(type) || /^facebook$/i.test(type)) {
    return { kind: 'fb', site: 'Facebook', account: primary || 'Active', loginAt };
  }
  if (/^github$/i.test(type)) {
    return { kind: 'github', site: 'GitHub', account: primary || 'Active', loginAt };
  }
  if (/^linkedin$/i.test(type)) {
    return { kind: 'linkedin', site: primary && primary !== 'Active' ? primary : 'LinkedIn', account: 'Active', loginAt };
  }
  if (/^forum$/i.test(type)) {
    return { kind: 'forum', site: primary || 'Forum', account: secondary || '-', loginAt };
  }

  return {
    kind: type.toLowerCase(),
    site: type,
    account: secondary || primary,
    loginAt,
  };
}

function buildAccountSummary(accounts = []) {
  return accounts
    .map((account) => {
      const site = String(account.site || '').trim();
      const value = String(account.account || '').trim();
      const accountValue = value && value !== '-' ? value : '';

      if (account.kind === 'wp') {
        return `WP: ${site}${accountValue ? ` (${accountValue})` : ''}`;
      }
      if (account.kind === 'fb') {
        return `FB: ${accountValue || site || 'Active'}`;
      }
      if (account.kind === 'github') {
        return `GitHub: ${accountValue || 'Active'}`;
      }
      if (account.kind === 'linkedin') {
        return `LinkedIn: ${site && site !== 'LinkedIn' ? site : 'Active'}`;
      }
      if (account.kind === 'forum') {
        return `Forum: ${site}${accountValue ? ` (${accountValue})` : ''}`;
      }
      return `${site}: ${accountValue || 'Active'}`;
    })
    .filter(Boolean)
    .join(' | ');
}

function formatAccountLoginDate(profile, dateLocale) {
  const raw = profile?.account_detected_at || profile?.accountDetectedAt || profile?.imported_at || '';
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(dateLocale);
}

function AccountDetails({ profile }) {
  const summary = profile.account_summary || profile.accountSummary || '';
  const facebookId = profile.facebook_id || profile.facebookId;
  const hasLinkedIn = Boolean(profile.has_linkedin || profile.hasLinkedIn);

  if (!summary && !facebookId && !hasLinkedIn) return null;

  return (
    <div className="space-y-1">
      {summary ? (
        <Detail label="Account" value={summary} />
      ) : (
        <>
          {facebookId && <Detail label="FB" value={facebookId} />}
          {hasLinkedIn && <Detail label="LinkedIn" value="Active" />}
        </>
      )}
    </div>
  );
}

