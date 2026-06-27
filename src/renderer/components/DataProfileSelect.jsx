import React, { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'scenario-active-data-profile:';

export function readStoredDataProfileId(scenarioId) {
  if (!scenarioId) return '';
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${scenarioId}`) || '';
  } catch {
    return '';
  }
}

export function writeStoredDataProfileId(scenarioId, profileId) {
  if (!scenarioId) return;
  try {
    const key = `${STORAGE_PREFIX}${scenarioId}`;
    if (profileId) {
      localStorage.setItem(key, profileId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors.
  }
}

export default function DataProfileSelect({
  scenarioId,
  value,
  onChange,
  refreshKey = 0,
  className = 'select-field h-9 min-w-[180px]',
  disabled = false,
}) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!scenarioId || !window.electronAPI?.getVariableProfiles) {
      setProfiles([]);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    window.electronAPI.getVariableProfiles(scenarioId)
      .then((items) => {
        if (cancelled) return;
        const next = Array.isArray(items) ? items : [];
        setProfiles(next);

        if (value && !next.some((item) => item.id === value)) {
          onChange?.('');
          writeStoredDataProfileId(scenarioId, '');
        }
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
  }, [scenarioId, refreshKey]);

  if (!scenarioId) return null;

  return (
    <select
      value={value || ''}
      onChange={(event) => {
        const next = event.target.value || '';
        onChange?.(next);
        writeStoredDataProfileId(scenarioId, next);
      }}
      disabled={disabled || loading}
      className={className}
      title="Hồ sơ dữ liệu dùng khi chạy"
    >
      <option value="">(Mặc định)</option>
      {profiles.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.name}
        </option>
      ))}
    </select>
  );
}
