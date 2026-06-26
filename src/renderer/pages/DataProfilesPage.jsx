import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Database } from 'lucide-react';
import { fetchLocalScenarios } from '../slices/scenarioSlice';
import { showToast } from '../slices/uiSlice';
import DataProfilesManager from '../components/DataProfilesManager';

export default function DataProfilesPage() {
  const dispatch = useDispatch();
  const { items: scenarios } = useSelector((state) => state.scenarios);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [skeletonKeys, setSkeletonKeys] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    dispatch(fetchLocalScenarios());
  }, [dispatch]);

  useEffect(() => {
    if (!selectedScenarioId) {
      setSkeletonKeys([]);
      return undefined;
    }

    let cancelled = false;

    window.electronAPI.getScenarioVariables(selectedScenarioId)
      .then((items) => {
        if (cancelled) return;
        const keys = (Array.isArray(items) ? items : [])
          .map((item) => item.key || item.name || '')
          .filter(Boolean);
        setSkeletonKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setSkeletonKeys([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedScenarioId, refreshKey]);

  const selectedScenario = useMemo(
    () => scenarios.find((item) => item.id === selectedScenarioId) || null,
    [scenarios, selectedScenarioId],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-emerald-400" />
          <h1 className="text-2xl font-bold text-white">Hồ sơ dữ liệu</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Quản lý bộ giá trị biến theo từng kịch bản. Ô trống dùng giá trị mặc định (khung).
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
        <label className="block max-w-xl">
          <span className="mb-2 block text-sm font-medium text-slate-300">Kịch bản</span>
          <select
            value={selectedScenarioId}
            onChange={(event) => setSelectedScenarioId(event.target.value)}
            className="select-field w-full"
          >
            <option value="">Chọn kịch bản...</option>
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name} ({scenario.platform || 'custom'})
              </option>
            ))}
          </select>
        </label>

        {selectedScenario && (
          <p className="mt-2 text-xs text-slate-500">
            {skeletonKeys.length} biến khung · chỉnh khung biến trong editor kịch bản
          </p>
        )}
      </div>

      <DataProfilesManager
        scenarioId={selectedScenarioId || null}
        skeletonKeys={skeletonKeys}
        onToast={(payload) => dispatch(showToast(payload))}
        onChanged={() => setRefreshKey((value) => value + 1)}
      />
    </div>
  );
}
