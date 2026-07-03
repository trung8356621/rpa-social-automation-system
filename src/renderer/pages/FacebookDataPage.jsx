import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Copy, ExternalLink, ImageIcon, Loader2, Play, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from '../i18n';
import { buildCsvContent } from '../utils/exportTableCsv';
import { showToast } from '../slices/uiSlice';
import { fetchSettings } from '../slices/settingsSlice';
import { startLocalCampaign } from '../slices/executionSlice';
import { parseFacebookMediaUrls } from '../../shared/facebookMediaExtract.js';
import {
  buildFacebookGroupCrawlVariables,
  buildFacebookSinglePostCrawlVariables,
  FACEBOOK_CRAWL_GROUP_PROFILE_ID,
  FACEBOOK_CRAWL_SETTINGS,
  parseFacebookGroupLink,
  parseFacebookPostLink,
  readFacebookCrawlLaunchOptions,
  readVariableSampleValue,
} from '../../shared/facebookCrawlConfig.js';
import {
  normalizeFacebookCrawlDateInput,
  toFacebookCrawlDateDisplay,
} from '../../shared/facebookDateFormat.js';
import FacebookDatePicker from '../components/FacebookDatePicker.jsx';

const THUMB_CLASS = 'h-12 w-12 shrink-0 rounded border border-[#2e3b4e] object-cover bg-[#151f2d]';
const MAX_VISIBLE_THUMBS = 4;

const PLATFORM_OPTIONS = [
  { id: 'facebook', labelKey: 'facebookData.studio.platforms.facebook' },
];

function formatDate(value, locale) {
  if (!value) return 'â€”';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return '0';
  return String(Math.floor(count));
}

function readFacebookDbSaveResult(status) {
  return status?.resultJson?.facebook_db_save
    || status?.result_json?.facebook_db_save
    || status?.result?.facebook_db_save
    || null;
}

function formatFacebookDbSaveError(dbSave, t) {
  const errors = Array.isArray(dbSave?.errors) ? dbSave.errors.map((item) => String(item || '')) : [];
  const firstError = errors.find(Boolean);
  if (firstError) return firstError;

  const failed = Number(dbSave?.failed || 0);
  return t('facebookData.toast.crawlDbSaveFailed', { failed: Number.isFinite(failed) ? failed : 0 });
}

function MediaThumbPlaceholder({ className = THUMB_CLASS }) {
  return (
    <div className={`${className} flex items-center justify-center text-[#6f7d90]`}>
      <ImageIcon className="h-4 w-4" aria-hidden />
    </div>
  );
}

function LocalMediaThumb({ relativePath, alt = '', className = THUMB_CLASS, onPreview }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pathValue = String(relativePath || '').trim();

    if (!pathValue || !window.electronAPI?.resolveFacebookMediaUrl) {
      setSrc('');
      setFailed(false);
      return undefined;
    }

    setFailed(false);
    window.electronAPI.resolveFacebookMediaUrl(pathValue)
      .then((url) => {
        if (!cancelled) setSrc(url || '');
      })
      .catch(() => {
        if (!cancelled) {
          setSrc('');
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [relativePath]);

  if (failed) return <MediaThumbPlaceholder className={className} />;
  if (!src) {
    return <div className={`${className} animate-pulse bg-[#243041]`} aria-hidden />;
  }

  return (
    <ClickableMediaThumb
      src={src}
      alt={alt}
      className={className}
      onPreview={onPreview}
      previewPayload={{
        src,
        alt,
        relativePath,
        externalUrl: null,
      }}
    />
  );
}

function RemoteMediaThumb({ url, alt = '', className = THUMB_CLASS, onPreview }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return <MediaThumbPlaceholder className={className} />;
  }

  return (
    <ClickableMediaThumb
      src={url}
      alt={alt}
      className={className}
      onPreview={onPreview}
      previewPayload={{
        src: url,
        alt,
        relativePath: null,
        externalUrl: url,
      }}
      onError={() => setFailed(true)}
    />
  );
}

function ClickableMediaThumb({
  src,
  alt = '',
  className = THUMB_CLASS,
  onPreview,
  previewPayload,
  onError,
}) {
  return (
    <button
      type="button"
      title={alt}
      className={`${className} cursor-pointer overflow-hidden p-0 transition hover:ring-2 hover:ring-[#2f80ed]/60`}
      onClick={(event) => {
        event.stopPropagation();
        onPreview?.(previewPayload);
      }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={onError}
      />
    </button>
  );
}

function ImagePreviewModal({ image, onClose, onOpenExternal, t }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!image?.src) return null;

  const canOpenExternal = Boolean(image.externalUrl || image.relativePath);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] max-w-[92vw] flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="truncate text-sm text-[#c7d2e0]">{image.alt || t('facebookData.studio.columns.localImage')}</p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#3a4a61] text-[#c7d2e0] hover:border-[#5b7ec7] hover:text-white"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border border-[#2e3b4e] bg-[#0f172a] p-2">
          <img
            src={image.src}
            alt={image.alt || ''}
            referrerPolicy="no-referrer"
            className="max-h-[75vh] max-w-[88vw] object-contain"
          />
        </div>
        {canOpenExternal ? (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t('common.close')}
            </button>
            <button type="button" onClick={onOpenExternal} className="btn-primary">
              {image.externalUrl
                ? t('facebookData.studio.openImageLink')
                : t('facebookData.studio.openImageFile')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MediaThumbnails({ localPath, mediaValue, alt = '', max = MAX_VISIBLE_THUMBS, onPreview }) {
  const localPaths = [
    ...parseFacebookMediaUrls(localPath),
    ...parseFacebookMediaUrls(mediaValue).filter((item) => !/^https?:\/\//i.test(item)),
  ];
  const remoteUrls = parseFacebookMediaUrls(mediaValue).filter((item) => /^https?:\/\//i.test(item));

  if (localPaths.length) {
    const visibleLocal = localPaths.slice(0, max);
    const hiddenCount = Math.max(0, localPaths.length - visibleLocal.length);
    return (
      <div className="flex flex-wrap items-center gap-1">
        {visibleLocal.map((relativePath, index) => (
          <LocalMediaThumb
            key={`${relativePath}-${index}`}
            relativePath={relativePath}
            alt={alt ? `${alt} ${index + 1}` : ''}
            onPreview={onPreview}
          />
        ))}
        {hiddenCount > 0 ? (
          <span className="rounded border border-[#2e3b4e] bg-[#151f2d] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">
            +{hiddenCount}
          </span>
        ) : null}
      </div>
    );
  }

  const visibleRemote = remoteUrls.slice(0, max);
  const hiddenCount = Math.max(0, remoteUrls.length - visibleRemote.length);

  if (!remoteUrls.length) return 'â€”';

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleRemote.map((url, index) => (
        <RemoteMediaThumb
          key={`${url}-${index}`}
          url={url}
          alt={alt ? `${alt} ${index + 1}` : ''}
          onPreview={onPreview}
        />
      ))}
      {hiddenCount > 0 ? (
        <span className="rounded border border-[#2e3b4e] bg-[#151f2d] px-1.5 py-0.5 text-[10px] text-[#9aa7b7]">
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function truncateText(value, max = 180) {
  const text = String(value || '').trim();
  if (!text) return 'â€”';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}â€¦`;
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

function iconActionButtonClassName() {
  return 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#2f3a4d] text-[#9eb4d6] hover:border-[#3f6fd6] hover:text-[#c7ddff]';
}

function CrawlGroupModal({
  open,
  groupLink,
  dateLock,
  crawling,
  onGroupLinkChange,
  onDateLockChange,
  onClose,
  onSubmit,
  t,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !crawling) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [crawling, onClose, open]);

  if (!open) return null;

  const parsedGroupId = parseFacebookGroupLink(groupLink).group_id || 'â€”';
  const canSubmit = Boolean(String(groupLink || '').trim()) && !crawling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => {
        if (!crawling) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#2e3b4e] bg-[#182230] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">{t('facebookData.studio.crawlGroupModalTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={crawling}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#3a4a61] text-[#c7d2e0] hover:border-[#5b7ec7] hover:text-white disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-[#c7d2e0]">{t('facebookData.studio.crawlGroupLink')}</span>
            <input
              type="url"
              value={groupLink}
              onChange={(event) => onGroupLinkChange(event.target.value)}
              placeholder={t('facebookData.studio.crawlGroupLinkPlaceholder')}
              className="input-field h-10"
              autoFocus
            />
            {String(groupLink || '').trim() ? (
              <p className="mt-1 text-xs text-[#9aa7b7]">
                {t('facebookData.studio.crawlGroupLinkHint', { groupId: parsedGroupId })}
              </p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-[#c7d2e0]">{t('facebookData.studio.crawlDateLock')}</span>
            <FacebookDatePicker
              value={dateLock}
              onChange={onDateLockChange}
              disabled={crawling}
              placeholder={t('facebookData.studio.crawlDateLockPlaceholder')}
            />
            <p className="mt-1 text-xs text-[#9aa7b7]">{t('facebookData.studio.crawlDateLockHint')}</p>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={crawling} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="btn-primary"
          >
            {crawling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('facebookData.studio.crawlGroupStart')}
          </button>
        </div>
      </div>
    </div>
  );
}

function CrawlSinglePostModal({
  open,
  postLink,
  crawling,
  onPostLinkChange,
  onClose,
  onSubmit,
  t,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !crawling) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [crawling, onClose, open]);

  if (!open) return null;

  const parsed = parseFacebookPostLink(postLink);
  const canSubmit = Boolean(String(postLink || '').trim()) && !crawling;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => {
        if (!crawling) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#2e3b4e] bg-[#182230] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">
            {t('facebookData.studio.crawlSinglePostModalTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={crawling}
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#3a4a61] text-[#c7d2e0] hover:border-[#5b7ec7] hover:text-white disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm text-[#c7d2e0]">
            {t('facebookData.studio.crawlSinglePostLink')}
          </span>
          <input
            type="url"
            value={postLink}
            onChange={(event) => onPostLinkChange(event.target.value)}
            placeholder={t('facebookData.studio.crawlSinglePostLinkPlaceholder')}
            className="input-field h-10"
            autoFocus
          />
          {String(postLink || '').trim() ? (
            <p className="mt-1 text-xs text-[#9aa7b7]">
              {t('facebookData.studio.crawlSinglePostLinkHint', {
                groupId: parsed.group_id || '-',
                postId: parsed.post_id || '-',
              })}
            </p>
          ) : null}
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={crawling} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="btn-primary"
          >
            {crawling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('facebookData.studio.crawlSinglePostStart')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeletePostConfirmModal({
  post,
  deleting,
  onClose,
  onConfirm,
  t,
}) {
  if (!post) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => {
        if (!deleting) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[#2e3b4e] bg-[#182230] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-white">{t('facebookData.studio.deletePostConfirmTitle')}</h2>
        <p className="mt-2 text-sm text-[#c7d2e0]">{t('facebookData.studio.deletePostConfirmMessage')}</p>
        <p className="mt-3 rounded-lg border border-[#2e3b4e] bg-[#151f2d] px-3 py-2 text-sm text-[#e8eef7]">
          {truncateText(post.post_content || post.post_author || post.post_id, 160)}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg border border-red-700/60 bg-red-900/40 px-4 py-2 text-sm text-red-100 hover:bg-red-900/60 disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('facebookData.studio.deletePost')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectedPostPreview({ post, onOpenLink, onPreview, onDelete, deleting, t }) {
  if (!post) return null;

  const authorName = post.post_author || post.author_name || t('common.unknown');
  const content = String(post.post_content || '').trim();
  const hasImages = Boolean(String(post.local_image_path || '').trim())
    || parseFacebookMediaUrls(post.post_images).length > 0;

  return (
    <div className="mb-3 rounded-lg border border-[#2e3b4e] bg-[#182230] px-4 py-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <AuthorCell
          name={authorName}
          authorLink={post.author_link}
          onOpenLink={onOpenLink}
          t={t}
        />
        {onDelete ? (
          <button
            type="button"
            title={t('facebookData.studio.deletePost')}
            aria-label={t('facebookData.studio.deletePost')}
            disabled={deleting}
            onClick={onDelete}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-800/50 text-red-300 hover:bg-red-900/30 disabled:opacity-60"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {content ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#e8eef7]">{content}</p>
      ) : (
        <p className="text-sm text-[#9aa7b7]">â€”</p>
      )}
      {hasImages ? (
        <div className="mt-3">
          <MediaThumbnails
            localPath={post.local_image_path}
            mediaValue={post.post_images}
            alt={authorName}
            max={8}
            onPreview={onPreview}
          />
        </div>
      ) : null}
      {post.post_date ? (
        <p className="mt-2 text-xs text-[#9aa7b7]">{post.post_date}</p>
      ) : null}
    </div>
  );
}

function AuthorCell({ name, authorLink, onOpenLink, t }) {
  const displayName = name || 'â€”';
  if (!authorLink) return displayName;

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="min-w-0 truncate">{displayName}</span>
      <button
        type="button"
        title={t('facebookData.studio.openAuthorLink')}
        aria-label={t('facebookData.studio.openAuthorLink')}
        onClick={(event) => {
          event.stopPropagation();
          onOpenLink(authorLink);
        }}
        className={iconActionButtonClassName()}
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function FacebookDataPage() {
  const dispatch = useDispatch();
  const { t, language } = useTranslation();
  const settings = useSelector((state) => state.settings.values);
  const liveStatus = useSelector((state) => state.executions.liveStatus);
  const dateLocale = language === 'en' ? 'en-US' : 'vi-VN';

  const pendingCrawlRef = useRef(null);
  const lastHandledExecutionRef = useRef('');

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
  const [crawlingGroup, setCrawlingGroup] = useState(false);
  const [crawlingSinglePost, setCrawlingSinglePost] = useState(false);
  const [showCrawlGroupModal, setShowCrawlGroupModal] = useState(false);
  const [showCrawlSinglePostModal, setShowCrawlSinglePostModal] = useState(false);
  const [crawlGroupLink, setCrawlGroupLink] = useState('');
  const [crawlSinglePostLink, setCrawlSinglePostLink] = useState('');
  const [postSearch, setPostSearch] = useState('');
  const [commentSearch, setCommentSearch] = useState('');
  const [crawlDateLock, setCrawlDateLock] = useState('');
  const [postPendingDelete, setPostPendingDelete] = useState(null);
  const [deletingPostId, setDeletingPostId] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    dispatch(fetchSettings());
  }, [dispatch]);

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

  const loadPosts = useCallback(async (searchTerm = postSearch) => {
    if (!window.electronAPI?.listFacebookPosts) return;

    setLoadingPosts(true);
    setError('');

    try {
      const items = await window.electronAPI.listFacebookPosts({
        groupId: selectedGroupId,
        search: searchTerm,
        limit: 500,
        offset: 0,
      });
      const nextPosts = (Array.isArray(items) ? items : []).map((item) => ({
        id: item.post_id,
        ...item,
      }));
      setPosts(nextPosts);
      setSelectedPost((prev) => {
        if (!prev?.post_id) return prev;
        return nextPosts.find((item) => item.post_id === prev.post_id) || prev;
      });
      return nextPosts;
    } catch (loadError) {
      setError(loadError.message || t('facebookData.toast.loadFailed'));
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, [postSearch, selectedGroupId, t]);

  useEffect(() => {
    if (!selectedPost?.post_id) return;
    if (!posts.some((item) => item.post_id === selectedPost.post_id)) {
      setSelectedPost(null);
      setComments([]);
    }
  }, [posts, selectedPost]);

  const loadComments = useCallback(async (postId, searchTerm = commentSearch) => {
    if (!postId || !window.electronAPI?.listFacebookComments) {
      setComments([]);
      return;
    }

    setLoadingComments(true);
    setError('');

    try {
      const items = await window.electronAPI.listFacebookComments({
        postId,
        search: searchTerm,
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
  }, [commentSearch, t]);

  const groupCrawlScenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || '').trim();

  useEffect(() => {
    if (!liveStatus?.executionId) return;

    const terminalTypes = new Set(['execution:completed', 'execution:failed']);
    if (!terminalTypes.has(liveStatus.type)) return;

    const scenarioId = String(liveStatus.scenarioId || '').trim();
    const isGroupCrawl = groupCrawlScenarioId && scenarioId === groupCrawlScenarioId;
    if (!isGroupCrawl) return;

    const handledKey = `${liveStatus.executionId}:${liveStatus.type}`;
    if (lastHandledExecutionRef.current === handledKey) return;
    lastHandledExecutionRef.current = handledKey;

    const facebookDbSave = readFacebookDbSaveResult(liveStatus);
    const dbSaveFailed = liveStatus.type === 'execution:completed'
      && facebookDbSave
      && facebookDbSave.success === false;

    const refreshCrawledData = async () => {
      await loadGroups();
      await loadPosts();

      pendingCrawlRef.current = null;

      if (dbSaveFailed) {
        dispatch(showToast({
          type: 'error',
          message: formatFacebookDbSaveError(facebookDbSave, t),
        }));
        return;
      }

      if (liveStatus.type === 'execution:failed') {
        dispatch(showToast({
          type: 'error',
          message: liveStatus.error || t('executions.toast.failed'),
        }));
        return;
      }

      if (liveStatus.type === 'execution:completed') {
        dispatch(showToast({
          type: 'success',
          message: t('facebookData.toast.crawlDataRefreshed'),
        }));
      }
    };

    refreshCrawledData();
  }, [
    dispatch,
    groupCrawlScenarioId,
    liveStatus,
    loadGroups,
    loadPosts,
    t,
  ]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPosts(postSearch);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadPosts, postSearch, selectedGroupId]);

  useEffect(() => {
    if (!selectedPost?.post_id) {
      setComments([]);
      return;
    }
    const timer = window.setTimeout(() => {
      loadComments(selectedPost.post_id, commentSearch);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [commentSearch, loadComments, selectedPost?.post_id]);

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

  const handlePreviewImage = useCallback((payload) => {
    if (!payload?.src) return;
    setPreviewImage(payload);
  }, []);

  const handleOpenPreviewExternal = useCallback(async () => {
    if (!previewImage) return;

    try {
      if (previewImage.externalUrl) {
        await openExternalLink(previewImage.externalUrl);
        return;
      }

      if (previewImage.relativePath && window.electronAPI?.openFacebookMediaFile) {
        const result = await window.electronAPI.openFacebookMediaFile(previewImage.relativePath);
        if (result?.success === false) {
          throw new Error(result.error || t('facebookData.toast.openLinkFailed'));
        }
      }
    } catch (openError) {
      dispatch(showToast({
        type: 'error',
        message: openError.message || t('facebookData.toast.openLinkFailed'),
      }));
    }
  }, [dispatch, openExternalLink, previewImage, t]);

  const copyPostLink = useCallback(async (url) => {
    const target = String(url || '').trim();
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      dispatch(showToast({
        type: 'success',
        message: t('facebookData.toast.copyLinkSuccess'),
      }));
    } catch (copyError) {
      dispatch(showToast({
        type: 'error',
        message: copyError.message || t('facebookData.toast.copyLinkFailed'),
      }));
    }
  }, [dispatch, t]);

  const handleOpenCrawlGroupModal = useCallback(async () => {
    setShowCrawlGroupModal(true);

    let lastDate = crawlDateLock;
    if (!lastDate && window.electronAPI?.getVariableProfileSamples) {
      try {
        const samples = await window.electronAPI.getVariableProfileSamples(FACEBOOK_CRAWL_GROUP_PROFILE_ID);
        lastDate = toFacebookCrawlDateDisplay(readVariableSampleValue(samples, 'last_date'));
      } catch {
        lastDate = '';
      }
    }
    if (lastDate) setCrawlDateLock(lastDate);
  }, [crawlDateLock]);

  const handleCloseCrawlGroupModal = useCallback(() => {
    if (crawlingGroup) return;
    setShowCrawlGroupModal(false);
  }, [crawlingGroup]);

  const handleOpenCrawlSinglePostModal = useCallback(() => {
    setShowCrawlSinglePostModal(true);
  }, []);

  const handleCloseCrawlSinglePostModal = useCallback(() => {
    if (crawlingSinglePost) return;
    setShowCrawlSinglePostModal(false);
  }, [crawlingSinglePost]);

  const handleCrawlGroup = useCallback(async () => {
    const scenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || '').trim();
    if (!scenarioId) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlGroupNoScenario') }));
      return;
    }

    const groupLink = String(crawlGroupLink || '').trim();
    if (!groupLink) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlGroupNoLink') }));
      return;
    }

    const parsed = parseFacebookGroupLink(groupLink);
    if (!parsed.group_id) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlGroupInvalidLink') }));
      return;
    }

    setCrawlingGroup(true);
    try {
      const runtimeVariables = buildFacebookGroupCrawlVariables({
        groupId: parsed.group_id,
        lastDate: normalizeFacebookCrawlDateInput(crawlDateLock),
      });
      const launchOptions = readFacebookCrawlLaunchOptions(settings);
      pendingCrawlRef.current = { kind: 'group', scenarioId, postId: null, groupId: parsed.group_id };

      const result = await dispatch(startLocalCampaign({
        scenarioId,
        runtimeVariables,
        ...launchOptions,
      }));
      if (result.meta.requestStatus === 'fulfilled') {
        setSelectedGroupId(parsed.group_id);
        setShowCrawlGroupModal(false);
        dispatch(showToast({ type: 'info', message: t('facebookData.toast.crawlGroupStarted') }));
      } else {
        dispatch(showToast({
          type: 'error',
          message: result.payload || t('executions.toast.runFailed'),
        }));
      }
    } finally {
      setCrawlingGroup(false);
    }
  }, [crawlDateLock, crawlGroupLink, dispatch, settings, t]);

  const handleCrawlSinglePost = useCallback(async () => {
    const scenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || '').trim();
    if (!scenarioId) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlGroupNoScenario') }));
      return;
    }

    const postLink = String(crawlSinglePostLink || '').trim();
    if (!postLink) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlSinglePostNoLink') }));
      return;
    }

    const parsed = parseFacebookPostLink(postLink);
    if (!parsed.group_id || !parsed.post_id) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlSinglePostInvalidLink') }));
      return;
    }

    setCrawlingSinglePost(true);
    try {
      const runtimeVariables = buildFacebookSinglePostCrawlVariables({ postLink });
      const launchOptions = readFacebookCrawlLaunchOptions(settings);
      pendingCrawlRef.current = {
        kind: 'single-post',
        scenarioId,
        postId: parsed.post_id,
        groupId: parsed.group_id,
      };

      const result = await dispatch(startLocalCampaign({
        scenarioId,
        runtimeVariables,
        ...launchOptions,
      }));
      if (result.meta.requestStatus === 'fulfilled') {
        setSelectedGroupId(parsed.group_id);
        setShowCrawlSinglePostModal(false);
        dispatch(showToast({ type: 'info', message: t('facebookData.toast.crawlSinglePostStarted') }));
      } else {
        dispatch(showToast({
          type: 'error',
          message: result.payload || t('executions.toast.runFailed'),
        }));
      }
    } finally {
      setCrawlingSinglePost(false);
    }
  }, [crawlSinglePostLink, dispatch, settings, t]);

  const handleDeletePost = useCallback(async () => {
    const post = postPendingDelete;
    if (!post?.post_id || !window.electronAPI?.deleteFacebookPost) return;

    setDeletingPostId(post.post_id);
    try {
      const result = await window.electronAPI.deleteFacebookPost({ postId: post.post_id });
      if (!result?.success) {
        const message = result?.error === 'post_not_found'
          ? t('facebookData.toast.deletePostNotFound')
          : (result?.error || t('facebookData.toast.deletePostFailed'));
        dispatch(showToast({ type: 'error', message }));
        return;
      }

      if (selectedPost?.post_id === post.post_id) {
        setSelectedPost(null);
        setComments([]);
        setActiveTab('posts');
      }

      setPostPendingDelete(null);
      await loadPosts();
      dispatch(showToast({ type: 'success', message: t('facebookData.toast.deletePostSuccess') }));
    } catch (deleteError) {
      dispatch(showToast({
        type: 'error',
        message: deleteError.message || t('facebookData.toast.deletePostFailed'),
      }));
    } finally {
      setDeletingPostId('');
    }
  }, [dispatch, loadPosts, postPendingDelete, selectedPost?.post_id, t]);

  const postColumns = useMemo(() => ([
    {
      key: 'post_author',
      label: t('facebookData.studio.columns.postAuthor'),
      render: (row) => (
        <AuthorCell
          name={row.post_author || row.author_name}
          authorLink={row.author_link}
          onOpenLink={openExternalLink}
          t={t}
        />
      ),
      accessor: (row) => row.post_author || row.author_name || '',
    },
    {
      key: 'post_content',
      label: t('facebookData.studio.columns.postContent'),
      render: (row) => truncateText(row.post_content, 220),
      accessor: (row) => row.post_content || '',
    },
    {
      key: 'post_images',
      label: t('facebookData.studio.columns.imageCount'),
      render: (row) => (
        <MediaThumbnails
          localPath={row.local_image_path}
          mediaValue={row.post_images}
          alt={row.post_author || row.author_name || t('facebookData.studio.columns.localImage')}
          onPreview={handlePreviewImage}
        />
      ),
      accessor: (row) => row.local_image_path || parseFacebookMediaUrls(row.post_images).join(' | '),
    },
    {
      key: 'like_count',
      label: t('facebookData.studio.columns.likeCount'),
      render: (row) => formatCount(row.like_count),
      accessor: (row) => formatCount(row.like_count),
    },
    {
      key: 'share_count',
      label: t('facebookData.studio.columns.shareCount'),
      render: (row) => formatCount(row.share_count),
      accessor: (row) => formatCount(row.share_count),
    },
    {
      key: 'crawled_comment_count',
      label: t('facebookData.studio.columns.crawledCommentCount'),
      render: (row) => formatCount(row.crawled_comment_count),
      accessor: (row) => formatCount(row.crawled_comment_count),
    },
    {
      key: 'post_link',
      label: t('facebookData.studio.columns.postLink'),
      render: (row) => (
        row.post_link ? (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              title={t('facebookData.studio.openLink')}
              aria-label={t('facebookData.studio.openLink')}
              onClick={(event) => {
                event.stopPropagation();
                openExternalLink(row.post_link);
              }}
              className={iconActionButtonClassName()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('facebookData.studio.columns.copyLink')}
              aria-label={t('facebookData.studio.columns.copyLink')}
              onClick={(event) => {
                event.stopPropagation();
                copyPostLink(row.post_link);
              }}
              className={iconActionButtonClassName()}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={t('facebookData.studio.deletePost')}
              aria-label={t('facebookData.studio.deletePost')}
              disabled={deletingPostId === row.post_id}
              onClick={(event) => {
                event.stopPropagation();
                setPostPendingDelete(row);
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#2f3a4d] text-[#d18a8a] hover:border-red-700/70 hover:text-red-200"
            >
              {deletingPostId === row.post_id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : 'â€”'
      ),
      accessor: (row) => row.post_link || '',
    },
    {
      key: 'post_date',
      label: t('facebookData.studio.columns.postDate'),
      render: (row) => row.post_date || 'â€”',
      accessor: (row) => row.post_date || '',
    },
    {
      key: 'crawled_at',
      label: t('facebookData.studio.columns.crawledAt'),
      render: (row) => formatDate(row.crawled_at, dateLocale),
      accessor: (row) => formatDate(row.crawled_at, dateLocale),
    },
  ]), [copyPostLink, dateLocale, deletingPostId, handlePreviewImage, openExternalLink, t]);

  const commentColumns = useMemo(() => ([
    {
      key: 'comment_author',
      label: t('facebookData.studio.columns.commentAuthor'),
      render: (row) => (
        <AuthorCell
          name={row.comment_author || row.author_name}
          authorLink={row.author_link}
          onOpenLink={openExternalLink}
          t={t}
        />
      ),
      accessor: (row) => row.comment_author || row.author_name || '',
    },
    {
      key: 'comment_content',
      label: t('facebookData.studio.columns.commentContent'),
      render: (row) => truncateText(row.comment_content, 260),
      accessor: (row) => row.comment_content || '',
    },
    {
      key: 'comment_images',
      label: t('facebookData.studio.columns.imageCount'),
      render: (row) => (
        <MediaThumbnails
          mediaValue={row.comment_images}
          alt={row.comment_author || row.author_name || t('facebookData.studio.columns.localImage')}
          onPreview={handlePreviewImage}
        />
      ),
      accessor: (row) => parseFacebookMediaUrls(row.comment_images).join(' | '),
    },
    {
      key: 'like_count',
      label: t('facebookData.studio.columns.likeCount'),
      render: (row) => formatCount(row.like_count),
      accessor: (row) => formatCount(row.like_count),
    },
    {
      key: 'crawled_at',
      label: t('facebookData.studio.columns.crawledAt'),
      render: (row) => formatDate(row.crawled_at, dateLocale),
      accessor: (row) => formatDate(row.crawled_at, dateLocale),
    },
  ]), [dateLocale, handlePreviewImage, openExternalLink, t]);

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleOpenCrawlSinglePostModal}
            disabled={crawlingSinglePost}
            className="btn-secondary"
          >
            {crawlingSinglePost ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('facebookData.studio.crawlSinglePost')}
          </button>
          <button
            type="button"
            onClick={handleOpenCrawlGroupModal}
            disabled={crawlingGroup}
            className="btn-secondary"
          >
            {crawlingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t('facebookData.studio.crawlGroup')}
          </button>
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
                {group.display_name || group.group_name || group.group_id}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedGroup && (
        <p className="mb-3 text-xs text-[#9aa7b7]">
          {t('facebookData.studio.filteredByGroup', {
            name: selectedGroup.display_name || selectedGroup.group_name || selectedGroup.group_id,
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

      <div className="mb-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa7b7]" />
          <input
            type="search"
            value={activeTab === 'posts' ? postSearch : commentSearch}
            onChange={(event) => {
              if (activeTab === 'posts') {
                setPostSearch(event.target.value);
              } else {
                setCommentSearch(event.target.value);
              }
            }}
            placeholder={
              activeTab === 'posts'
                ? t('facebookData.studio.searchPosts')
                : t('facebookData.studio.searchComments')
            }
            className="input-field h-10 w-full pl-10"
          />
        </label>
      </div>

      {activeTab === 'comments' && selectedPost && (
        <SelectedPostPreview
          post={selectedPost}
          onOpenLink={openExternalLink}
          onPreview={handlePreviewImage}
          onDelete={() => setPostPendingDelete(selectedPost)}
          deleting={deletingPostId === selectedPost.post_id}
          t={t}
        />
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
      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onOpenExternal={handleOpenPreviewExternal}
          t={t}
        />
      ) : null}
      <CrawlGroupModal
        open={showCrawlGroupModal}
        groupLink={crawlGroupLink}
        dateLock={crawlDateLock}
        crawling={crawlingGroup}
        onGroupLinkChange={setCrawlGroupLink}
        onDateLockChange={setCrawlDateLock}
        onClose={handleCloseCrawlGroupModal}
        onSubmit={handleCrawlGroup}
        t={t}
      />
      <CrawlSinglePostModal
        open={showCrawlSinglePostModal}
        postLink={crawlSinglePostLink}
        crawling={crawlingSinglePost}
        onPostLinkChange={setCrawlSinglePostLink}
        onClose={handleCloseCrawlSinglePostModal}
        onSubmit={handleCrawlSinglePost}
        t={t}
      />
      <DeletePostConfirmModal
        post={postPendingDelete}
        deleting={Boolean(deletingPostId)}
        onClose={() => {
          if (!deletingPostId) setPostPendingDelete(null);
        }}
        onConfirm={handleDeletePost}
        t={t}
      />
    </div>
  );
}

