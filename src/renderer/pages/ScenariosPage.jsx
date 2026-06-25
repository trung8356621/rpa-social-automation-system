import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  deleteScenario,
  fetchScenarioDetails,
  fetchScenarios,
  setCurrentScenario,
} from '../slices/scenarioSlice';
import { setCurrentPage, showToast } from '../slices/uiSlice';
import ScenarioEditor from '../components/ScenarioEditor';
import { Clock, Edit3, FileText, Globe, Play, Plus, Search, Trash2, X } from 'lucide-react';

const createDraftScenario = () => ({
  id: null,
  name: 'Kịch bản mới',
  description: '',
  platform: 'facebook',
  target_url: 'https://www.facebook.com',
  recorded_width: 1280,
  recorded_height: 720,
  device_pixel_ratio: 1,
  steps: [],
});

export default function ScenariosPage() {
  const dispatch = useDispatch();
  const { items: scenarios, loading, currentScenario } = useSelector((state) => state.scenarios);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    dispatch(fetchScenarios());
  }, [dispatch]);

  const filteredScenarios = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return scenarios;

    return scenarios.filter((scenario) => (
      [scenario.name, scenario.description, scenario.target_url, scenario.platform, scenario.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
  }, [scenarios, searchQuery]);

  const openEditor = useCallback((scenario) => {
    if (scenario.id) {
      dispatch(fetchScenarioDetails(scenario.id));
    } else {
      dispatch(setCurrentScenario(scenario));
    }
  }, [dispatch]);

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return;

    const result = await dispatch(deleteScenario(deleteConfirm));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã xóa kịch bản' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Xóa kịch bản thất bại' }));
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, dispatch]);

  if (currentScenario) {
    return <ScenarioEditor scenario={currentScenario} onBack={() => dispatch(setCurrentScenario(null))} />;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Kịch bản</h1>
          <p className="page-subtitle">Quản lý luồng tự động hóa dùng Puppeteer trên browser Chromium.</p>
        </div>
        <button type="button" onClick={() => openEditor(createDraftScenario())} className="btn-primary">
          <Plus className="h-4 w-4" />
          Tạo kịch bản
        </button>
      </div>

      <div className="panel mb-5 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f7d90]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="input-field pl-10"
            placeholder="Tìm theo tên, mô tả, nền tảng, URL hoặc ID..."
          />
        </div>
      </div>

      {loading ? (
        <div className="panel flex items-center justify-center py-16 text-sm text-[#9aa7b7]">Đang tải kịch bản...</div>
      ) : filteredScenarios.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-16 text-center">
          <FileText className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">
            {searchQuery ? 'Không tìm thấy kịch bản phù hợp' : 'Chưa có kịch bản nào'}
          </p>
          <p className="mt-1 text-sm text-[#9aa7b7]">Tạo kịch bản mới để bắt đầu dựng timeline tự động hóa.</p>
          {!searchQuery && (
            <button type="button" onClick={() => openEditor(createDraftScenario())} className="btn-primary mt-4">
              <Plus className="h-4 w-4" />
              Tạo kịch bản
            </button>
          )}
        </div>
      ) : (
        <div className="panel w-full overflow-hidden">
          <div className="grid grid-cols-[minmax(280px,1.35fr)_minmax(260px,1fr)_120px_90px_170px_120px] border-b border-[#2e3b4e] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#7e8da5]">
            <span>Kịch bản</span>
            <span>URL</span>
            <span>Nền tảng</span>
            <span>Bước</span>
            <span>Cập nhật</span>
            <span className="text-right"></span>
          </div>

          <div className="divide-y divide-[#243044]">
            {filteredScenarios.map((scenario) => (
              <article
                key={scenario.id}
                className="grid grid-cols-[minmax(280px,1.35fr)_minmax(260px,1fr)_120px_90px_170px_120px] items-center gap-3 px-4 py-3 transition hover:bg-[#202b3a]"
              >
                <button type="button" onClick={() => openEditor(scenario)} className="min-w-0 text-left">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#223044] text-[#7db4ff]">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-white">{scenario.name}</h2>
                      <p className="mt-0.5 truncate text-xs text-[#7e8da5]">{scenario.id}</p>
                    </div>
                  </div>
                </button>

                <div className="min-w-0">
                  <p className="truncate text-sm text-[#c7d0dc]">{scenario.target_url || scenario.description || 'Chưa có URL'}</p>
                  {scenario.description && scenario.target_url && (
                    <p className="mt-0.5 truncate text-xs text-[#7e8da5]">{scenario.description}</p>
                  )}
                </div>

                <span className="badge w-fit">
                  <Globe className="h-3.5 w-3.5" />
                  {scenario.platform || 'custom'}
                </span>

                <span className="text-sm font-semibold text-[#dce5f2]">{Number(scenario.steps_count || 0)}</span>

                <span className="inline-flex items-center gap-1 text-xs text-[#9aa7b7]">
                  <Clock className="h-3.5 w-3.5" />
                  {scenario.updated_at ? new Date(scenario.updated_at).toLocaleString('vi-VN') : 'Chưa cập nhật'}
                </span>

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => openEditor(scenario)} className="icon-button" title="Chỉnh sửa">
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      dispatch(setCurrentScenario(scenario));
                      dispatch(setCurrentPage('executions'));
                    }}
                    className="icon-button text-[#8ddfc7]"
                    title="Chạy"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(scenario.id)}
                    className="icon-button text-[#ffb4b4]"
                    title="Xóa"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {deleteConfirm && (
        <Modal title="Xóa kịch bản" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-[#c7d0dc]">
            Kịch bản và các bước liên quan sẽ bị xóa. Thao tác này không thể hoàn tác.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-secondary">
              Hủy
            </button>
            <button type="button" onClick={handleDelete} className="btn-danger">
              Xóa
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4">
      <div className="card w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="icon-button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
