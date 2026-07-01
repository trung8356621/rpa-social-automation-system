import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertCircle, Loader2, Save, Settings } from 'lucide-react';
import { fetchSettings, saveSettings, updateSetting } from '../slices/settingsSlice';
import { showToast } from '../slices/uiSlice';
import { useTranslation } from '../i18n';
import {
  FACEBOOK_CRAWL_COMMENT_PROFILE_ID,
  FACEBOOK_CRAWL_GROUP_PROFILE_ID,
  FACEBOOK_CRAWL_SETTINGS,
} from '../../shared/facebookCrawlConfig.js';

const CRAWL_SCENARIO_TYPES = new Set(['crawl', 'request_catching']);

function isCrawlScenarioType(scenario) {
  return CRAWL_SCENARIO_TYPES.has(scenario?.scenario_type || 'action');
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[#c7d0dc]">{label}</span>
      {children}
    </label>
  );
}

function SystemVariableProfileCard({ title, profile, variableHints = [], systemBadge }) {
  return (
    <div className="rounded-lg border border-[#243041] bg-[#182230] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-medium text-white">{title}</h4>
        <span className="rounded-full bg-[#2f80ed]/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#8ec0ff]">
          {systemBadge}
        </span>
      </div>
      <ul className="space-y-2">
        {variableHints.map((item) => (
          <li key={item.key} className="rounded-md border border-[#2e3b4e] bg-[#151f2d] px-3 py-2">
            <div className="font-mono text-xs text-[#8ec0ff]">{item.key}</div>
            <div className="mt-1 text-xs text-[#9aa7b7]">{item.hint}</div>
          </li>
        ))}
      </ul>
      {profile?.keys?.length ? (
        <p className="mt-3 text-xs text-[#6f7d90]">
          {profile.keys.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export default function FacebookDataSettingsPage() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { values, loading, saving, saved, error } = useSelector((state) => state.settings);
  const [scenarios, setScenarios] = useState([]);
  const [variableProfiles, setVariableProfiles] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      setLoadingConfig(true);
      try {
        const [scenarioItems, profileItems] = await Promise.all([
          window.electronAPI?.getScenarios?.() || [],
          window.electronAPI?.getVariableProfiles?.() || [],
        ]);
        if (!cancelled) {
          setScenarios(Array.isArray(scenarioItems) ? scenarioItems : []);
          setVariableProfiles(Array.isArray(profileItems) ? profileItems : []);
        }
      } catch {
        if (!cancelled) {
          setScenarios([]);
          setVariableProfiles([]);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    };

    loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (saved) {
      dispatch(showToast({ type: 'success', message: t('facebookData.settings.toast.saved') }));
    }
  }, [dispatch, saved, t]);

  const setValue = (key, value) => {
    dispatch(updateSetting({ key, value }));
  };

  const handleSave = async () => {
    const result = await dispatch(saveSettings(values));
    if (result.meta.requestStatus === 'rejected') {
      dispatch(showToast({
        type: 'error',
        message: result.payload || t('facebookData.settings.toast.saveFailed'),
      }));
    }
  };

  const crawlScenarioOptions = useMemo(
    () => scenarios.filter(isCrawlScenarioType),
    [scenarios],
  );

  const groupVariableProfile = useMemo(
    () => variableProfiles.find((profile) => profile.id === FACEBOOK_CRAWL_GROUP_PROFILE_ID),
    [variableProfiles],
  );

  const commentVariableProfile = useMemo(
    () => variableProfiles.find((profile) => profile.id === FACEBOOK_CRAWL_COMMENT_PROFILE_ID),
    [variableProfiles],
  );

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('facebookData.settings.title')}</h1>
          <p className="page-subtitle">{t('facebookData.settings.subtitle')}</p>
        </div>
        <button type="button" onClick={handleSave} disabled={saving || loading} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? t('facebookData.settings.saving') : t('facebookData.settings.save')}
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-700/50 bg-red-900/30 p-3 text-sm text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="card p-6">
        {loading || loadingConfig ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#9aa7b7]" />
          </div>
        ) : (
          <div className="space-y-6">
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Settings className="h-5 w-5 text-[#7db4ff]" />
              {t('facebookData.settings.scenariosTitle')}
            </h2>

            <div className="space-y-4 rounded-xl border border-[#2e3b4e] bg-[#151f2d] p-4">
              <Field label={t('facebookData.settings.crawlGroupScenario')}>
                <select
                  value={values[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || ''}
                  onChange={(event) => setValue(
                    FACEBOOK_CRAWL_SETTINGS.groupScenarioId,
                    event.target.value,
                  )}
                  className="select-field max-w-xl"
                >
                  <option value="">{t('facebookData.settings.noScenario')}</option>
                  {crawlScenarioOptions.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[#6f7d90]">
                  {t('facebookData.settings.crawlGroupScenarioHint')}
                </p>
              </Field>

              <Field label={t('facebookData.settings.crawlCommentScenario')}>
                <select
                  value={values[FACEBOOK_CRAWL_SETTINGS.commentScenarioId] || ''}
                  onChange={(event) => setValue(
                    FACEBOOK_CRAWL_SETTINGS.commentScenarioId,
                    event.target.value,
                  )}
                  className="select-field max-w-xl"
                >
                  <option value="">{t('facebookData.settings.noScenario')}</option>
                  {crawlScenarioOptions.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[#6f7d90]">
                  {t('facebookData.settings.crawlCommentScenarioHint')}
                </p>
              </Field>
            </div>

            <div className="space-y-4 rounded-xl border border-[#2e3b4e] bg-[#151f2d] p-4">
              <h3 className="text-sm font-semibold text-white">
                {t('facebookData.settings.variableProfilesTitle')}
              </h3>
              <p className="text-xs text-[#6f7d90]">{t('facebookData.settings.variableProfilesHint')}</p>

              <SystemVariableProfileCard
                title={t('facebookData.settings.groupProfileTitle')}
                profile={groupVariableProfile}
                variableHints={[
                  { key: 'group_id', hint: t('facebookData.settings.variables.groupId') },
                  { key: 'last_date', hint: t('facebookData.settings.variables.lastDate') },
                ]}
                systemBadge={t('facebookData.settings.systemProfile')}
              />

              <SystemVariableProfileCard
                title={t('facebookData.settings.commentProfileTitle')}
                profile={commentVariableProfile}
                variableHints={[
                  { key: 'group_id', hint: t('facebookData.settings.variables.groupIdFromPost') },
                  { key: 'post_id', hint: t('facebookData.settings.variables.postId') },
                ]}
                systemBadge={t('facebookData.settings.systemProfile')}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
