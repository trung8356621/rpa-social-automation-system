import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  Braces,
  FolderOpen,
  Globe2,
  Loader2,
  Monitor,
  Save,
} from 'lucide-react';
import { fetchSettings, saveSettings, updateSetting } from '../slices/settingsSlice';
import { showToast } from '../slices/uiSlice';
import { pickDirectoryWithInput } from '../utils/filePicker';
import { SUPPORTED_LANGUAGES, useTranslation } from '../i18n';

export default function SettingsPage() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { values, loading, saving, saved, error } = useSelector((state) => state.settings);
  const [activeTab, setActiveTab] = useState('general');

  const tabs = useMemo(() => ([
    { id: 'general', label: t('settings.tabs.general'), icon: Globe2 },
    { id: 'browser', label: t('settings.tabs.browser'), icon: Monitor },
    { id: 'automation', label: t('settings.tabs.automation'), icon: Braces },
  ]), [t]);

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);

  useEffect(() => {
    if (saved) {
      dispatch(showToast({ type: 'success', message: t('settings.toast.saved') }));
    }
  }, [dispatch, saved, t]);

  const setValue = (key, value) => {
    dispatch(updateSetting({ key, value }));
  };

  const handleSave = async () => {
    const result = await dispatch(saveSettings(values));
    if (result.meta.requestStatus === 'rejected') {
      dispatch(showToast({ type: 'error', message: result.payload || t('settings.toast.saveFailed') }));
    }
  };

  const chooseUserDataDir = async () => {
    try {
      const directory = await window.electronAPI.selectDirectory() || await pickDirectoryWithInput();
      if (directory) {
        setValue('browser.userDataDir', directory);
      }
    } catch (pickerError) {
      const directory = await pickDirectoryWithInput();
      if (directory) setValue('browser.userDataDir', directory);
      else dispatch(showToast({
        type: 'error',
        message: pickerError.message || t('common.errors.folderPickerFailed'),
      }));
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
          <p className="page-subtitle">{t('settings.subtitle')}</p>
        </div>
        <button type="button" onClick={handleSave} disabled={saving || loading} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-700/50 bg-red-900/30 p-3 text-sm text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-6">
        <aside className="w-52 shrink-0 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#2f80ed] text-white'
                    : 'text-[#9aa7b7] hover:bg-[#202b3a] hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </aside>

        <section className="card flex-1 p-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#9aa7b7]" />
            </div>
          ) : (
            <>
              {activeTab === 'general' && (
                <div className="space-y-5">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                    <Globe2 className="h-5 w-5 text-[#7db4ff]" />
                    {t('settings.tabs.general')}
                  </h2>

                  <Field label={t('settings.language.label')}>
                    <select
                      value={values['app.language'] || 'vi'}
                      onChange={(event) => setValue('app.language', event.target.value)}
                      className="select-field max-w-xs"
                    >
                      {SUPPORTED_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>{lang.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-[#6f7d90]">{t('settings.language.hint')}</p>
                  </Field>
                </div>
              )}

              {activeTab === 'browser' && (
                <div className="space-y-5">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                    <Monitor className="h-5 w-5 text-[#7db4ff]" />
                    {t('settings.browser.title')}
                  </h2>

                  <label className="flex items-center gap-3 text-sm text-[#c7d0dc]">
                    <input
                      type="checkbox"
                      checked={Boolean(values['browser.headless'])}
                      onChange={(event) => setValue('browser.headless', event.target.checked)}
                      className="h-4 w-4 accent-[#2f80ed]"
                    />
                    {t('settings.browser.headless')}
                  </label>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label={t('settings.browser.viewportWidth')}>
                      <input
                        type="number"
                        min="800"
                        max="2560"
                        value={values['browser.viewportWidth']}
                        onChange={(event) => setValue('browser.viewportWidth', parseInt(event.target.value, 10) || 1280)}
                        className="input-field"
                      />
                    </Field>
                    <Field label={t('settings.browser.viewportHeight')}>
                      <input
                        type="number"
                        min="600"
                        max="1920"
                        value={values['browser.viewportHeight']}
                        onChange={(event) => setValue('browser.viewportHeight', parseInt(event.target.value, 10) || 800)}
                        className="input-field"
                      />
                    </Field>
                  </div>

                  <Field label={t('settings.browser.userDataDir')}>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={values['browser.userDataDir']}
                        onChange={(event) => setValue('browser.userDataDir', event.target.value)}
                        className="input-field"
                        placeholder={t('settings.browser.userDataDirPlaceholder')}
                      />
                      <button type="button" onClick={chooseUserDataDir} className="icon-button bg-[#243244]">
                        <FolderOpen className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-[#6f7d90]">{t('settings.browser.userDataDirHint')}</p>
                  </Field>
                </div>
              )}

              {activeTab === 'automation' && (
                <div className="space-y-5">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                    <Braces className="h-5 w-5 text-[#7db4ff]" />
                    {t('settings.automation.title')}
                  </h2>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label={t('settings.automation.waitBefore')}>
                      <input
                        type="number"
                        min="0"
                        max="30000"
                        value={values['automation.defaultWaitBefore']}
                        onChange={(event) => setValue('automation.defaultWaitBefore', parseInt(event.target.value, 10) || 0)}
                        className="input-field"
                      />
                    </Field>
                    <Field label={t('settings.automation.waitAfter')}>
                      <input
                        type="number"
                        min="0"
                        max="30000"
                        value={values['automation.defaultWaitAfter']}
                        onChange={(event) => setValue('automation.defaultWaitAfter', parseInt(event.target.value, 10) || 0)}
                        className="input-field"
                      />
                    </Field>
                  </div>

                  <Field label={t('settings.automation.maxRetries')}>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={values['automation.maxRetries']}
                      onChange={(event) => setValue('automation.maxRetries', parseInt(event.target.value, 10) || 0)}
                      className="input-field max-w-xs"
                    />
                  </Field>

                  <Field label={t('settings.automation.browserCloseDelay')}>
                    <input
                      type="number"
                      min="1000"
                      max="120000"
                      step="500"
                      value={values['execution.browserCloseDelayMs']}
                      onChange={(event) => setValue(
                        'execution.browserCloseDelayMs',
                        parseInt(event.target.value, 10) || 5000,
                      )}
                      className="input-field max-w-xs"
                    />
                    <p className="mt-1 text-xs text-[#6f7d90]">{t('settings.automation.browserCloseDelayHint')}</p>
                  </Field>

                  <label className="flex items-center gap-3 text-sm text-[#c7d0dc]">
                    <input
                      type="checkbox"
                      checked={Boolean(values['automation.screenshotOnError'])}
                      onChange={(event) => setValue('automation.screenshotOnError', event.target.checked)}
                      className="h-4 w-4 accent-[#2f80ed]"
                    />
                    {t('settings.automation.screenshotOnError')}
                  </label>
                </div>
              )}
            </>
          )}
        </section>
      </div>
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
