import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { useTranslation } from '../i18n';
import { buildCsvContent } from '../utils/exportTableCsv';
import { showToast } from '../slices/uiSlice';

const PLATFORM_OPTIONS = [
  { id: 'facebook', labelKey: 'facebookData.studio.platforms.facebook' },
];

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}

function truncateText(value, max = 180) {
  const text = String(value || '').trim();
  if (!text) return '—';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function StudioTable({
  columns,
  rows,
  emptyLabel,
  selectedRowId,
  onRowClick,
}) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-[#2e3b4e] bg-[#182230] px-4 py-12 text-center text-sm text-[#9aa7b7]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#2e3b4e] bg-[#182230]">
      <div className="max-h-[calc(100vh-280px)] overflow-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-[#2e3b4e] bg-[#151f2d] text-xs uppercase tracking-wide text-[#9aa7b7]">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#243041]">
            {rows.map((row) => {
              const isSelected = selectedRowId && selectedRowId === row.id;
              return (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={`transition-colors ${
                    onRowClick ? 'cursor-pointer hover:bg-[#1d2736]' : ''
                  } ${isSelected ? 'bg-[#2f80ed]/15 ring-1 ring-inset ring-[#2f80ed]/40' : ''}`}
                >
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3 align-top text-[#e8eef7]">
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FacebookDataPage() {
  const dispatch = useDispatch();
  const { t, language } = useTranslation();
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';

  const [platform, setPlatform] = useState('facebook');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [activeTab, setActiveTab] = useState('posts');
  const [groups, setGroups] = useState([]);
  const [posts, setPosts] = useState([]);
  const [comments, setComments] = useState([]);
  const [selectedPost, setSelectedPost] = useState(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const loadGroups = useCallback(async () => {
    if (!window.electronAPI?.listFacebookGroups) return;

    setLoadingGroups(true);
    try {
      const items = await window.electronAPI.listFacebookGroups({ limit: 1000, offset: 0 });
      setGroups(Array.isArray(items) ? items : []);
    } catch (loadError) {
      setError(loadError.message || t('facebookData.toast.loadFailed'));
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, [t]);

  const loadPosts = useCallback(async () => {
    if (!window.electronAPI?.listFacebookPosts) return;

    setLoadingPosts(true);
    setError('');

    try {
      const items = await window.electronAPI.listFacebookPosts({
        groupId: selectedGroupId,
        limit: 500,
        offset: 0,
      });
      const nextPosts = (Array.isArray(items) ? items : []).map((item) => ({
        id: item.post_id,
        ...item,
      }));
      setPosts(nextPosts);
    } catch (loadError) {
      setError(loadError.message || t('facebookData.toast.loadFailed'));
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, [selectedGroupId, t]);

  useEffect(() => {
    if (!selectedPost?.post_id) return;
    if (!posts.some((item) => item.post_id === selectedPost.post_id)) {
      setSelectedPost(null);
      setComments([]);
    }
  }, [posts, selectedPost]);

  const loadComments = useCallback(async (postId) => {
    if (!postId || !window.electronAPI?.listFacebookComments) {
      setComments([]);
      return;
    }

    setLoadingComments(true);
    setError('');

    try {
      const items = await window.electronAPI.listFacebookComments({
        postId,
        limit: 1000,
        offset: 0,
      });
      setComments((Array.isArray(items) ? items : []).map((item) => ({
        id: item.comment_id,
        ...item,
      })));
    } catch (loadError) {
      setError(loadError.message || t('facebookData.toast.loadCommentsFailed'));
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }, [t]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (selectedPost?.post_id) {
      loadComments(selectedPost.post_id);
    }
  }, [loadComments, selectedPost?.post_id]);

  const handleSelectPost = (row) => {
    setSelectedPost(row);
    setActiveTab('comments');
    loadComments(row.post_id);
  };

  const openExternalLink = useCallback(async (url) => {
    const target = String(url || '').trim();
    if (!target || !window.electronAPI?.openCrawlPreviewExternal) return;
    try {
      await window.electronAPI.openCrawlPreviewExternal(target);
    } catch (openError) {
      dispatch(showToast({
        type: 'error',
        message: openError.message || t('facebookData.toast.openLinkFailed'),
      }));
    }
  }, [dispatch, t]);

  const postColumns = useMemo(() => ([
    {
      key: 'post_author',
      label: t('facebookData.studio.columns.postAuthor'),
      render: (row) => row.post_author || row.author_name || '—',
      accessor: (row) => row.post_author || row.author_name || '',
    },
    {
      key: 'post_content',
      label: t('facebookData.studio.columns.postContent'),
      render: (row) => truncateText(row.post_content, 220),
      accessor: (row) => row.post_content || '',
    },
    {
      key: 'post_link',
      label: t('facebookData.studio.columns.postLink'),
      render: (row) => (
        row.post_link ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openExternalLink(row.post_link);
            }}
            className="inline-flex items-center gap-1 text-left text-[#8ec0ff] hover:underline"
          >
            <span>{truncateText(row.post_link, 56)}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </button>
        ) : '—'
      ),
      accessor: (row) => row.post_link || '',
    },
    {
      key: 'crawled_at',
      label: t('facebookData.studio.columns.crawledAt'),
      render: (row) => formatDate(row.crawled_at, dateLocale),
      accessor: (row) => formatDate(row.crawled_at, dateLocale),
    },
  ]), [dateLocale, openExternalLink, t]);

  const commentColumns = useMemo(() => ([
    {
      key: 'comment_author',
      label: t('facebookData.studio.columns.commentAuthor'),
      render: (row) => row.comment_author || row.author_name || '—',
      accessor: (row) => row.comment_author || row.author_name || '',
    },
    {
      key: 'comment_content',
      label: t('facebookData.studio.columns.commentContent'),
      render: (row) => truncateText(row.comment_content, 260),
      accessor: (row) => row.comment_content || '',
    },
    {
      key: 'crawled_at',
      label: t('facebookData.studio.columns.crawledAt'),
      render: (row) => formatDate(row.crawled_at, dateLocale),
      accessor: (row) => formatDate(row.crawled_at, dateLocale),
    },
  ]), [dateLocale, t]);

  const handleExport = async () => {
    const isPostsTab = activeTab === 'posts';
    const exportColumns = isPostsTab ? postColumns : commentColumns;
    const exportRows = isPostsTab ? posts : comments;

    if (!exportRows.length) {
      dispatch(showToast({ type: 'info', message: t('facebookData.studio.exportEmpty') }));
      return;
    }

    if (!window.electronAPI?.exportFacebookDataCsv) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.exportUnavailable') }));
      return;
    }

    setExporting(true);
    try {
      const content = buildCsvContent(exportColumns, exportRows);
      const groupSuffix = selectedGroupId ? `-${selectedGroupId}` : '';
      const tabSuffix = isPostsTab ? 'posts' : 'comments';
      const result = await window.electronAPI.exportFacebookDataCsv({
        content,
        defaultPath: `facebook-${tabSuffix}${groupSuffix}.csv`,
      });

      if (result?.cancelled) return;

      dispatch(showToast({
        type: 'success',
        message: t('facebookData.studio.exportSuccess'),
      }));
    } catch (exportError) {
      dispatch(showToast({
        type: 'error',
        message: exportError.message || t('facebookData.toast.exportFailed'),
      }));
    } finally {
      setExporting(false);
    }
  };

  const isLoading = loadingGroups || loadingPosts || loadingComments;
  const selectedGroup = groups.find((group) => group.group_id === selectedGroupId);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('facebookData.studio.title')}</h1>
          <p className="page-subtitle">{t('facebookData.studio.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              loadGroups();
              loadPosts();
              if (selectedPost?.post_id) loadComments(selectedPost.post_id);
            }}
            disabled={isLoading}
            className="btn-secondary"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t('facebookData.studio.export')}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#9aa7b7]">
            {t('facebookData.studio.platform')}
          </span>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
            className="input-field h-10"
          >
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#9aa7b7]">
            {t('facebookData.studio.group')}
          </span>
          <select
            value={selectedGroupId}
            onChange={(event) => {
              setSelectedGroupId(event.target.value);
              setSelectedPost(null);
              setComments([]);
              setActiveTab('posts');
            }}
            disabled={loadingGroups}
            className="input-field h-10"
          >
            <option value="">{t('facebookData.studio.allGroups')}</option>
            {groups.map((group) => (
              <option key={group.group_id} value={group.group_id}>
                {group.group_name || group.group_id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedGroup && (
        <p className="mb-3 text-xs text-[#9aa7b7]">
          {t('facebookData.studio.filteredByGroup', {
            name: selectedGroup.group_name || selectedGroup.group_id,
          })}
        </p>
      )}

      <div className="mb-4 flex items-center gap-2 border-b border-[#2e3b4e]">
        <button
          type="button"
          onClick={() => setActiveTab('posts')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'posts'
              ? 'border-[#2f80ed] text-white'
              : 'border-transparent text-[#9aa7b7] hover:text-white'
          }`}
        >
          {t('facebookData.studio.tabs.posts')}
          <span className="ml-2 rounded-full bg-[#243041] px-2 py-0.5 text-xs">{posts.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('comments')}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'comments'
              ? 'border-[#2f80ed] text-white'
              : 'border-transparent text-[#9aa7b7] hover:text-white'
          }`}
        >
          {t('facebookData.studio.tabs.comments')}
          <span className="ml-2 rounded-full bg-[#243041] px-2 py-0.5 text-xs">{comments.length}</span>
        </button>
      </div>

      {activeTab === 'comments' && selectedPost && (
        <div className="mb-3 rounded-lg border border-[#2e3b4e] bg-[#182230] px-4 py-3 text-sm text-[#c7d2e0]">
          {t('facebookData.studio.selectedPostHint', {
            author: selectedPost.post_author || selectedPost.author_name || t('common.unknown'),
          })}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {activeTab === 'posts' ? (
        loadingPosts && posts.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border border-[#2e3b4e] bg-[#182230] px-4 py-16 text-sm text-[#9aa7b7]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <StudioTable
            columns={postColumns}
            rows={posts}
            emptyLabel={t('facebookData.studio.emptyPosts')}
            selectedRowId={selectedPost?.post_id}
            onRowClick={handleSelectPost}
          />
        )
      ) : (
        loadingComments && comments.length === 0 ? (
          <div className="flex items-center justify-center rounded-xl border border-[#2e3b4e] bg-[#182230] px-4 py-16 text-sm text-[#9aa7b7]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <StudioTable
            columns={commentColumns}
            rows={comments}
            emptyLabel={
              selectedPost
                ? t('facebookData.studio.emptyComments')
                : t('facebookData.studio.selectPostHint')
            }
          />
        )
      )}
    </div>
  );
}
