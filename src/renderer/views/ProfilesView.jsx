import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { deleteProfile, fetchProfiles, saveProfile } from '../slices/profileSlice';
import { fetchBrowserProfiles, openBrowserProfile } from '../slices/browserProfileSlice';
import { setCurrentPage, showToast } from '../slices/uiSlice';

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'google', label: 'Google' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'zalo', label: 'Zalo' },
  { value: 'other', label: 'Khác' },
];

const emptyForm = {
  browser_profile_id: '',
  platform: 'facebook',
  username: '',
  password: '',
  status: 'active',
};

export default function ProfilesView() {
  const dispatch = useDispatch();
  const { items: profiles, loading, error } = useSelector((state) => state.profiles);
  const {
    items: browserProfiles,
    opening,
    error: browserProfileError,
  } = useSelector((state) => state.browserProfiles);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchProfiles());
    dispatch(fetchBrowserProfiles());
  }, [dispatch]);

  const handleAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const handleEdit = (profile) => {
    setEditingId(profile.id);
    setForm({
      browser_profile_id: profile.browser_profile_id || '',
      platform: profile.platform || 'facebook',
      username: profile.username || '',
      password: profile.password || '',
      status: profile.status || 'active',
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa tài khoản này?')) {
      dispatch(deleteProfile(id));
    }
  };

  const handleOpenBrowser = async (profile) => {
    if (!profile.browser_profile_id) {
      dispatch(showToast({ type: 'error', message: 'Tài khoản chưa gán browser profile' }));
      return;
    }

    const result = await dispatch(openBrowserProfile(profile.browser_profile_id));
    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: `Đã mở trình duyệt cho ${profile.username}` }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Không mở được trình duyệt' }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.username || !form.platform) {
      dispatch(showToast({ type: 'error', message: 'Vui lòng nhập nền tảng và tên đăng nhập' }));
      return;
    }

    setSaving(true);
    try {
      await dispatch(saveProfile({
        ...(editingId ? { id: editingId } : {}),
        proxy_id: null,
        browser_profile_id: form.browser_profile_id || null,
        platform: form.platform,
        username: form.username,
        password: form.password || null,
        status: form.status,
      })).unwrap();

      dispatch(showToast({ type: 'success', message: 'Đã lưu tài khoản' }));
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      dispatch(showToast({ type: 'error', message: err || 'Lưu tài khoản thất bại' }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <Users className="h-7 w-7 text-[#7db4ff]" />
            Tài khoản
          </h1>
          <p className="page-subtitle">Quản lý tài khoản mạng xã hội và gán browser profile riêng.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              dispatch(fetchProfiles());
              dispatch(fetchBrowserProfiles());
            }}
            className="btn-secondary"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button type="button" onClick={handleAdd} className="btn-primary">
            <Plus className="h-4 w-4" />
            Thêm tài khoản
          </button>
        </div>
      </div>

      {(error || browserProfileError) && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-red-700/50 bg-red-900/30 p-3 text-sm text-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error || browserProfileError}</span>
        </div>
      )}

      <div className="flex gap-6">
        {showForm && (
          <aside className="w-96 shrink-0">
            <div className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
                {editingId ? <Pencil className="h-4 w-4 text-[#f1c16b]" /> : <Plus className="h-4 w-4 text-[#7db4ff]" />}
                {editingId ? 'Chỉnh sửa tài khoản' : 'Thêm tài khoản mới'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field label="Nền tảng *">
                  <select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })} className="select-field">
                    {PLATFORMS.map((platform) => (
                      <option key={platform.value} value={platform.value}>{platform.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Tên đăng nhập / Email *">
                  <input type="text" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="input-field" placeholder="user@example.com" />
                </Field>

                <Field label="Mật khẩu">
                  <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="input-field" placeholder="Tùy chọn" />
                </Field>

                <Field label="Browser profile">
                  <select value={form.browser_profile_id} onChange={(event) => setForm({ ...form, browser_profile_id: event.target.value })} className="select-field">
                    <option value="">Chưa gán browser profile</option>
                    {browserProfiles.map((browserProfile) => (
                      <option key={browserProfile.id} value={browserProfile.id}>{browserProfile.display_name}</option>
                    ))}
                  </select>
                  {browserProfiles.length === 0 && (
                    <button type="button" onClick={() => dispatch(setCurrentPage('browserProfiles'))} className="mt-1 text-left text-xs text-[#7db4ff] hover:text-white">
                      Chưa có browser profile. Mở màn Browser để quét hoặc thêm thủ công.
                    </button>
                  )}
                </Field>

                <Field label="Trạng thái">
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className="select-field">
                    <option value="active">Hoạt động</option>
                    <option value="inactive">Tắt</option>
                    <option value="banned">Bị khóa</option>
                  </select>
                </Field>

                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="btn-primary flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Hủy</button>
                </div>
              </form>
            </div>
          </aside>
        )}

        <section className="min-w-0 flex-1">
          {loading && profiles.length === 0 ? (
            <div className="panel flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#9aa7b7]" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="panel flex h-56 flex-col items-center justify-center text-center">
              <Users className="mb-3 h-12 w-12 text-[#6f7d90]" />
              <p className="text-sm font-semibold text-white">Chưa có tài khoản nào</p>
              <p className="mt-1 text-sm text-[#9aa7b7]">Thêm tài khoản và gán browser profile để bắt đầu.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {profiles.map((profile) => (
                <article key={profile.id} className="card p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#223044] text-[#7db4ff]">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{profile.username}</p>
                        <p className="mt-0.5 text-xs text-[#9aa7b7]">
                          {PLATFORMS.find((platform) => platform.value === profile.platform)?.label || profile.platform}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={profile.status} />
                  </div>

                  <div className="mb-4 space-y-2 text-xs text-[#9aa7b7]">
                    <Detail label="Browser" value={profile.browser_profile_display_name || 'Chưa gán'} />
                    {profile.proxy_name && <Detail label="Proxy" value={profile.proxy_name} />}
                    <Detail label="Cập nhật" value={profile.updated_at ? new Date(profile.updated_at).toLocaleString('vi-VN') : 'Chưa có'} />
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleOpenBrowser(profile)} disabled={!profile.browser_profile_id || opening} className="btn-secondary flex-1">
                      <ExternalLink className="h-4 w-4" />
                      Mở trình duyệt
                    </button>
                    <button type="button" onClick={() => handleEdit(profile)} className="icon-button" title="Sửa">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleDelete(profile.id)} className="icon-button text-[#ffb4b4]" title="Xóa">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#c7d0dc]">{label}</span>
      {children}
    </label>
  );
}

function Detail({ label, value }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="min-w-0 truncate text-[#c7d0dc]">{value}</span>
    </p>
  );
}

function StatusBadge({ status }) {
  const isActive = status === 'active';
  const isBanned = status === 'banned';

  return (
    <span
      className={`badge ${
        isActive
          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
          : isBanned
            ? 'border-red-500/30 bg-red-500/15 text-red-300'
            : 'border-slate-500/30 bg-slate-500/15 text-slate-300'
      }`}
    >
      {isActive ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {isActive ? 'Hoạt động' : isBanned ? 'Bị khóa' : 'Tắt'}
    </span>
  );
}
