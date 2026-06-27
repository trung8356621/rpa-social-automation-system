import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  Shield,
  Wifi,
  WifiOff,
  Check,
  X,
  Save,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { fetchProxies, saveProxy, deleteProxy } from '../slices/proxySlice';
import { useLanguage, useTranslation } from '../i18n';

const PROTOCOLS = ['http', 'https', 'socks5', 'socks4'];

const emptyForm = {
  name: '',
  protocol: 'http',
  ip: '',
  port: '',
  username: '',
  password: '',
  status: 'active',
};

export default function ProxiesView() {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const language = useLanguage();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';
  const { items: proxies, loading, error } = useSelector((state) => state.proxies);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Tải danh sách proxy khi component mount
  useEffect(() => {
    dispatch(fetchProxies());
  }, [dispatch]);

  // Mở form thêm mới
  const handleAdd = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  // Mở form chỉnh sửa với dữ liệu hiện tại
  const handleEdit = (proxy) => {
    setEditingId(proxy.id);
    setForm({
      name: proxy.name || '',
      protocol: proxy.protocol || 'http',
      ip: proxy.ip || '',
      port: proxy.port?.toString() || '',
      username: proxy.username || '',
      password: proxy.password || '',
      status: proxy.status || 'active',
    });
    setShowForm(true);
  };

  // Xóa proxy
  const handleDelete = (id) => {
    if (window.confirm(t('proxies.confirm.delete'))) {
      dispatch(deleteProxy(id));
    }
  };

  // Submit form
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.ip || !form.port) {
      alert(t('proxies.validation.requiredFields'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name,
        protocol: form.protocol,
        ip: form.ip,
        port: parseInt(form.port, 10),
        username: form.username || null,
        password: form.password || null,
        status: form.status,
      };
      await dispatch(saveProxy(payload)).unwrap();
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      console.error('Lỗi lưu proxy:', err);
    } finally {
      setSaving(false);
    }
  };

  // Hủy form
  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Shield className="w-7 h-7 text-emerald-400" />
            {t('proxies.title')}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {t('proxies.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => dispatch(fetchProxies())}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            {t('proxies.add')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-sm text-red-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => dispatch(fetchProxies())}
            className="ml-auto text-red-200 hover:text-white underline"
          >
            {t('common.refresh')}
          </button>
        </div>
      )}

      <div className="flex gap-6">
        {/* Form thêm/sửa proxy */}
        {showForm && (
          <div className="w-96 flex-shrink-0">
            <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-5 shadow-xl">
              <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                {editingId ? (
                  <>
                    <Pencil className="w-4 h-4 text-amber-400" />
                    {t('proxies.form.editTitle')}
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 text-emerald-400" />
                    {t('proxies.form.addTitle')}
                  </>
                )}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Tên */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t('proxies.form.name')}
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                    placeholder={t('proxies.form.namePlaceholder')}
                  />
                </div>

                {/* Protocol */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t('proxies.form.protocol')}
                  </label>
                  <select
                    value={form.protocol}
                    onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                  >
                    {PROTOCOLS.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>

                {/* IP & Port */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      {t('proxies.form.ip')}
                    </label>
                    <input
                      type="text"
                      value={form.ip}
                      onChange={(e) => setForm({ ...form, ip: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                      placeholder={t('proxies.form.ipPlaceholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      {t('proxies.form.port')}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                      placeholder={t('proxies.form.portPlaceholder')}
                    />
                  </div>
                </div>

                {/* Username & Password */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      {t('proxies.form.username')}
                    </label>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                      placeholder={t('common.optional')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      {t('proxies.form.password')}
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                      placeholder={t('common.optional')}
                    />
                  </div>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    {t('common.status')}
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
                  >
                    <option value="active">{t('status.active')}</option>
                    <option value="inactive">{t('status.inactive')}</option>
                    <option value="error">{t('status.error')}</option>
                  </select>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-700 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {saving ? t('common.saving') : t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm font-medium transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Danh sách proxy */}
        <div className={`flex-1 ${showForm ? '' : ''}`}>
          {loading && proxies.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
            </div>
          ) : proxies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
              <Globe className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">{t('proxies.emptyTitle')}</p>
              <p className="text-xs mt-1">{t('proxies.emptyText')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {proxies.map((proxy) => (
                <div
                  key={proxy.id}
                  className="group bg-slate-800/60 border border-slate-700/80 hover:border-slate-600 rounded-2xl p-5 transition-all duration-200 hover:shadow-lg hover:shadow-slate-900/50"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          proxy.status === 'active'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : proxy.status === 'error'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-slate-600/30 text-slate-400'
                        }`}
                      >
                        <Globe className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {proxy.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {proxy.protocol?.toUpperCase()} • {proxy.ip}:{proxy.port}
                        </p>
                      </div>
                    </div>

                    {/* Status badge */}
                    <span
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
                        proxy.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : proxy.status === 'error'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-slate-600/30 text-slate-400'
                      }`}
                    >
                      {proxy.status === 'active' ? (
                        <Wifi className="w-3 h-3" />
                      ) : (
                        <WifiOff className="w-3 h-3" />
                      )}
                      {proxy.status === 'active'
                        ? t('status.active')
                        : proxy.status === 'error'
                          ? t('status.error')
                          : t('status.inactiveShort')}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="text-xs text-slate-500 space-y-1 mb-4">
                    {proxy.username && (
                      <p>
                        {t('proxies.card.account')}{' '}
                        <span className="text-slate-400">{proxy.username}</span>
                      </p>
                    )}
                    <p>
                      {t('proxies.card.updated')}{' '}
                      <span className="text-slate-400">
                        {new Date(proxy.updated_at).toLocaleString(dateLocale)}
                      </span>
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={() => handleEdit(proxy)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs font-medium transition-all"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(proxy.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
