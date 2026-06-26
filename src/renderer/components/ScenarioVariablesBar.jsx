import React, { useEffect, useState } from 'react';
import { Braces, Plus, Trash2 } from 'lucide-react';

function emptyRow() {
  return {
    id: null,
    key: '',
    value: '',
  };
}

export default function ScenarioVariablesBar({
  scenarioId,
  onToast,
  onChanged,
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadVariables = async () => {
    if (!scenarioId || !window.electronAPI?.getScenarioVariables) {
      setRows([]);
      return;
    }

    setLoading(true);
    try {
      const items = await window.electronAPI.getScenarioVariables(scenarioId);
      setRows(Array.isArray(items) && items.length ? items : []);
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Không tải được biến' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVariables();
  }, [scenarioId]);

  const persistRow = async (row) => {
    const key = String(row.key || '').trim();
    if (!scenarioId || !key) return null;

    const saved = await window.electronAPI.saveScenarioVariable({
      id: row.id || undefined,
      scenario_id: scenarioId,
      key,
      value: row.value ?? '',
    });
    return saved;
  };

  const handleSaveRow = async (index) => {
    const row = rows[index];
    const key = String(row?.key || '').trim();
    if (!key) return;

    setSaving(true);
    try {
      const saved = await persistRow(row);
      setRows((prev) => prev.map((item, idx) => (idx === index ? saved : item)));
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Lưu biến thất bại' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRow = async (index) => {
    const row = rows[index];
    setRows((prev) => prev.filter((_, idx) => idx !== index));

    if (!row?.id) return;

    try {
      await window.electronAPI.deleteScenarioVariable(row.id);
      onChanged?.();
    } catch (error) {
      onToast?.({ type: 'error', message: error.message || 'Xóa biến thất bại' });
      loadVariables();
    }
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
    setOpen(true);
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  if (!scenarioId) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#2f3748] px-3 text-xs text-[#76849b]"
        title="Lưu kịch bản trước để thêm biến"
      >
        <Braces className="h-4 w-4" />
        Biến
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#2f3748] bg-[#171b26] px-3 text-xs font-medium text-[#c9d4e8] transition hover:bg-[#1f2633]"
      >
        <Braces className="h-4 w-4 text-[#7aa7ff]" />
        Biến
        <span className="rounded bg-[#242b3a] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">{rows.length}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Đóng quản lý biến"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-[420px] rounded-xl border border-[#2f3748] bg-[#12151c] p-3 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Biến kịch bản</p>
                <p className="text-[11px] text-[#76849b]">Dùng cú pháp {'{{ten_bien}}'} trong URL và Input</p>
              </div>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-[#243044] px-2 text-xs text-white hover:bg-[#2d3d56]"
              >
                <Plus className="h-3.5 w-3.5" />
                Thêm
              </button>
            </div>

            {loading ? (
              <p className="text-xs text-[#76849b]">Đang tải...</p>
            ) : rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#2f3748] px-3 py-4 text-center text-xs text-[#76849b]">
                Chưa có biến. Thêm key/value để dùng trong bước Input và URL.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {rows.map((row, index) => (
                  <div key={row.id || `new-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input
                      value={row.key || ''}
                      onChange={(event) => updateRow(index, { key: event.target.value })}
                      onBlur={() => handleSaveRow(index)}
                      className="input-field h-8 text-xs"
                      placeholder="key"
                    />
                    <input
                      value={row.value || ''}
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                      onBlur={() => handleSaveRow(index)}
                      className="input-field h-8 text-xs"
                      placeholder="value"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteRow(index)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[#76849b] hover:bg-[#2a1f24] hover:text-[#ff8fa0]"
                      title="Xóa biến"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {saving && (
              <p className="mt-2 text-[10px] text-[#76849b]">Đang lưu...</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
