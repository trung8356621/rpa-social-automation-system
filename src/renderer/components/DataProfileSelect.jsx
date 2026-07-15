import React, { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';

export default function DataProfileSelect({
  value,
  onChange,
  refreshKey = 0,
  className = 'select-field h-9 min-w-[180px]',
  disabled = false,
}) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.getVariableProfiles) {
      setProfiles([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    window.electronAPI.getVariableProfiles()
      .then((items) => {
        if (cancelled) return;
        setProfiles(Array.isArray(items) ? items : []);
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <select
      value={value || ''}
      onChange={(event) => {
        const next = event.target.value || '';
        onChange?.(next);
      }}
      disabled={disabled || loading}
      className={className}
      title={t('dataProfiles.selectTitle')}
    >
      <option value="">{t('dataProfiles.defaultOption')}</option>
      {profiles.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.name}
        </option>
      ))}
      {/* Keep current selection visible even if the profile list briefly omits it. */}
      {value && !profiles.some((profile) => profile.id === value) ? (
        <option value={value}>{value}</option>
      ) : null}
    </select>
  );
}
