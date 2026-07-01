import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Clock, Edit3, Plus, Search, Trash2, Workflow, X } from 'lucide-react';
import TaskBuilderPage from './TaskBuilderPage';
import { deleteTask, fetchTaskDetails, fetchTasks, setCurrentTask } from '../slices/taskSlice';
import { showToast } from '../slices/uiSlice';

const createDraftTask = () => ({
  id: null,
  name: 'Task mới',
  description: '',
  is_active: 1,
  flow_data: {
    nodes: [],
    edges: [],
  },
});

export default function TasksPage() {
  const dispatch = useDispatch();
  const { items: tasks, currentTask, loading } = useSelector((state) => state.tasks);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    dispatch(fetchTasks());
  }, [dispatch]);

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tasks;

    return tasks.filter((task) => (
      [task.name, task.description, task.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    ));
  }, [tasks, searchQuery]);

  const openTask = (task) => {
    if (task.id) {
      dispatch(fetchTaskDetails(task.id));
    } else {
      dispatch(setCurrentTask(task));
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    const result = await dispatch(deleteTask(deleteConfirm));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã xoá task' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Xoá task thất bại' }));
    }
    setDeleteConfirm(null);
  };

  if (currentTask) {
    return <TaskBuilderPage task={currentTask} onBack={() => dispatch(setCurrentTask(null))} />;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">Quản lý nhiều workflow task và mở builder để chỉnh flow.</p>
        </div>
        <button type="button" onClick={() => openTask(createDraftTask())} className="btn-primary">
          <Plus className="h-4 w-4" />
          Tạo task
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
            placeholder="Tìm theo tên, mô tả hoặc ID..."
          />
        </div>
      </div>

      {loading ? (
        <div className="panel flex items-center justify-center py-16 text-sm text-[#9aa7b7]">Đang tải tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-16 text-center">
          <Workflow className="mb-3 h-12 w-12 text-[#6f7d90]" />
          <p className="text-sm font-semibold text-white">
            {searchQuery ? 'Không tìm thấy task phù hợp' : 'Chưa có task nào'}
          </p>
          <p className="mt-1 text-sm text-[#9aa7b7]">Tạo task đầu tiên để dựng workflow scenario.</p>
          {!searchQuery && (
            <button type="button" onClick={() => openTask(createDraftTask())} className="btn-primary mt-4">
              <Plus className="h-4 w-4" />
              Tạo task
            </button>
          )}
        </div>
      ) : (
        <div className="panel w-full overflow-hidden">
          <div className="grid grid-cols-[minmax(260px,1.2fr)_minmax(220px,1fr)_170px_120px] border-b border-[#2e3b4e] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#7e8da5]">
            <span>Task</span>
            <span>Mô tả</span>
            <span>Cập nhật</span>
            <span className="text-right"></span>
          </div>

          <div className="divide-y divide-[#243044]">
            {filteredTasks.map((task) => (
              <article
                key={task.id}
                className="grid grid-cols-[minmax(260px,1.2fr)_minmax(220px,1fr)_170px_120px] items-center gap-3 px-4 py-3 transition hover:bg-[#202b3a]"
              >
                <button type="button" onClick={() => openTask(task)} className="min-w-0 text-left">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#223044] text-[#7db4ff]">
                      <Workflow className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-white">{task.name}</h2>
                      <p className="mt-0.5 truncate text-xs text-[#7e8da5]">{task.id}</p>
                    </div>
                  </div>
                </button>

                <p className="truncate text-sm text-[#c7d0dc]">{task.description || 'Chưa có mô tả'}</p>

                <span className="inline-flex items-center gap-1 text-xs text-[#9aa7b7]">
                  <Clock className="h-3.5 w-3.5" />
                  {task.updated_at ? new Date(task.updated_at).toLocaleString('vi-VN') : 'Chưa cập nhật'}
                </span>

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => openTask(task)} className="icon-button" title="Sửa">
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(task.id)}
                    className="icon-button text-[#ffb4b4]"
                    title="Xoá"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {deleteConfirm ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4">
          <div className="card w-full max-w-lg">
            <div className="flex items-center justify-between border-b border-[#2e3b4e] px-5 py-4">
              <h2 className="text-base font-semibold text-white">Xoá task</h2>
              <button type="button" onClick={() => setDeleteConfirm(null)} className="icon-button">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#c7d0dc]">Task và flow đã lưu sẽ bị xoá. Thao tác này không thể hoàn tác.</p>
              <div className="mt-6 flex justify-end gap-3">
                <button type="button" onClick={() => setDeleteConfirm(null)} className="btn-secondary">
                  Huỷ
                </button>
                <button type="button" onClick={handleDelete} className="btn-danger">
                  Xoá
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
