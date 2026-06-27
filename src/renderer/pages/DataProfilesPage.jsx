import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Database } from 'lucide-react';
import { showToast } from '../slices/uiSlice';
import DataProfilesManager from '../components/DataProfilesManager';
import { useTranslation } from '../i18n';

export default function DataProfilesPage() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">{t('dataProfiles.title')}</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {t('dataProfiles.subtitle')}
        </p>
      </div>

      <DataProfilesManager
        key={refreshKey}
        onToast={(payload) => dispatch(showToast(payload))}
        onChanged={() => setRefreshKey((value) => value + 1)}
      />
    </div>
  );
}
