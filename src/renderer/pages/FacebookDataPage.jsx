import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Copy, ExternalLink, ImageIcon, Loader2, MessagesSquare, Play, RefreshCw, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from '../i18n';
import { buildCsvContent } from '../utils/exportTableCsv';
import { showToast } from '../slices/uiSlice';
import { fetchSettings } from '../slices/settingsSlice';
import { startLocalCampaign } from '../slices/executionSlice';
import { parseFacebookMediaUrls } from '../../shared/facebookMediaExtract.js';
import {
  buildFacebookCommentCrawlVariables,
  buildFacebookGroupCrawlVariables,
  FACEBOOK_CRAWL_GROUP_PROFILE_ID,
  FACEBOOK_CRAWL_SETTINGS,
  parseFacebookGroupLink,
  parseFacebookPostLink,
  readFacebookCrawlLaunchOptions,
  readVariableSampleValue,
} from '../../shared/facebookCrawlConfig.js';

const THUMB_CLASS = 'h-12 w-12 shrink-0 rounded border border-[#2e3b4e] object-cover bg-[#151f2d]';
const MAX_VISIBLE_THUMBS = 4;

const PLATFORM_OPTIONS = [
  { id: 'facebook', labelKey: 'facebookData.studio.platforms.facebook' },
];

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return '0';
  return String(Math.floor(count));
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
  const hasLocal = Boolean(String(localPath || '').trim());
  if (hasLocal) {
    return (
      <LocalMediaThumb relativePath={localPath} alt={alt} onPreview={onPreview} />
    );
  }

  const remoteUrls = parseFacebookMediaUrls(mediaValue);
  const visibleRemote = remoteUrls.slice(0, max);
  const hiddenCount = Math.max(0, remoteUrls.length - visibleRemote.length);

  if (!remoteUrls.length) return '—';

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

function iconActionButtonClassName() {
  return 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#2f3a4d] text-[#9eb4d6] hover:border-[#3f6fd6] hover:text-[#c7ddff]';
}

function AuthorCell({ name, authorLink, onOpenLink, t }) {
  const displayName = name || '—';
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
  const selectedPostIdRef = useRef('');

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
  const [crawlGroupLink, setCrawlGroupLink] = useState('');
  const [crawlingPostId, setCrawlingPostId] = useState('');
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
    selectedPostIdRef.current = selectedPost?.post_id || '';
  }, [selectedPost?.post_id]);

  const groupCrawlScenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || '').trim();
  const commentCrawlScenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.commentScenarioId] || '').trim();

  useEffect(() => {
    if (!liveStatus?.executionId) return;

    const terminalTypes = new Set(['execution:completed', 'execution:failed']);
    if (!terminalTypes.has(liveStatus.type)) return;

    const scenarioId = String(liveStatus.scenarioId || '').trim();
    const isGroupCrawl = groupCrawlScenarioId && scenarioId === groupCrawlScenarioId;
    const isCommentCrawl = commentCrawlScenarioId && scenarioId === commentCrawlScenarioId;
    if (!isGroupCrawl && !isCommentCrawl) return;

    const handledKey = `${liveStatus.executionId}:${liveStatus.type}`;
    if (lastHandledExecutionRef.current === handledKey) return;
    lastHandledExecutionRef.current = handledKey;

    const refreshCrawledData = async () => {
      await loadGroups();
      await loadPosts();

      const targetPostId = pendingCrawlRef.current?.postId || selectedPostIdRef.current;
      if (targetPostId && (isCommentCrawl || selectedPostIdRef.current === targetPostId)) {
        await loadComments(targetPostId);
      }

      pendingCrawlRef.current = null;

      if (liveStatus.type === 'execution:completed') {
        dispatch(showToast({
          type: 'success',
          message: t('facebookData.toast.crawlDataRefreshed'),
        }));
      }
    };

    refreshCrawledData();
  }, [
    commentCrawlScenarioId,
    dispatch,
    groupCrawlScenarioId,
    liveStatus,
    loadComments,
    loadGroups,
    loadPosts,
    t,
  ]);

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
      let lastDate = '';
      if (window.electronAPI?.getVariableProfileSamples) {
        const samples = await window.electronAPI.getVariableProfileSamples(FACEBOOK_CRAWL_GROUP_PROFILE_ID);
        lastDate = readVariableSampleValue(samples, 'last_date');
      }

      const runtimeVariables = buildFacebookGroupCrawlVariables({
        groupId: parsed.group_id,
        lastDate,
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
  }, [crawlGroupLink, dispatch, settings, t]);

  const handleCrawlComments = useCallback(async (row) => {
    const scenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.commentScenarioId] || '').trim();
    if (!scenarioId) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlCommentsNoScenario') }));
      return;
    }

    const postLink = String(row?.post_link || '').trim()
      || (row?.group_id && row?.post_id
        ? `https://www.facebook.com/groups/${row.group_id}/posts/${row.post_id}/`
        : '');
    if (!postLink) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlCommentsNoLink') }));
      return;
    }

    const parsed = parseFacebookPostLink(postLink);
    if (!parsed.group_id || !parsed.post_id) {
      dispatch(showToast({ type: 'error', message: t('facebookData.toast.crawlCommentsInvalidLink') }));
      return;
    }

    setCrawlingPostId(row.post_id);
    try {
      const runtimeVariables = buildFacebookCommentCrawlVariables({
        postLink,
        groupId: parsed.group_id,
        postId: parsed.post_id,
      });
      const launchOptions = readFacebookCrawlLaunchOptions(settings);
      pendingCrawlRef.current = { kind: 'comments', scenarioId, postId: row.post_id };

      const result = await dispatch(startLocalCampaign({
        scenarioId,
        runtimeVariables,
        ...launchOptions,
      }));
      if (result.meta.requestStatus === 'fulfilled') {
        dispatch(showToast({ type: 'info', message: t('facebookData.toast.crawlCommentsStarted') }));
      } else {
        dispatch(showToast({
          type: 'error',
          message: result.payload || t('executions.toast.runFailed'),
        }));
      }
    } finally {
      setCrawlingPostId('');
    }
  }, [dispatch, settings, t]);

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
              title={t('facebookData.studio.crawlComments')}
              aria-label={t('facebookData.studio.crawlComments')}
              disabled={crawlingPostId === row.post_id}
              onClick={(event) => {
                event.stopPropagation();
                handleCrawlComments(row);
              }}
              className={iconActionButtonClassName()}
            >
              {crawlingPostId === row.post_id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <MessagesSquare className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : '—'
      ),
      accessor: (row) => row.post_link || '',
    },
    {
      key: 'post_date',
      label: t('facebookData.studio.columns.postDate'),
      render: (row) => row.post_date || '—',
      accessor: (row) => row.post_date || '',
    },
    {
      key: 'crawled_at',
      label: t('facebookData.studio.columns.crawledAt'),
      render: (row) => formatDate(row.crawled_at, dateLocale),
      accessor: (row) => formatDate(row.crawled_at, dateLocale),
    },
  ]), [copyPostLink, crawlingPostId, dateLocale, handleCrawlComments, handlePreviewImage, openExternalLink, t]);

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
          <label className="flex min-w-[220px] flex-1 items-center gap-2">
            <span className="sr-only">{t('facebookData.studio.crawlGroupLink')}</span>
            <input
              type="url"
              value={crawlGroupLink}
              onChange={(event) => setCrawlGroupLink(event.target.value)}
              placeholder={t('facebookData.studio.crawlGroupLinkPlaceholder')}
              className="input-field h-10 min-w-0 flex-1"
            />
          </label>
          <button
            type="button"
            onClick={handleCrawlGroup}
            disabled={crawlingGroup || !String(crawlGroupLink || '').trim()}
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

      {String(crawlGroupLink || '').trim() ? (
        <p className="mb-3 text-xs text-[#9aa7b7]">
          {t('facebookData.studio.crawlGroupLinkHint', {
            groupId: parseFacebookGroupLink(crawlGroupLink).group_id || '—',
          })}
        </p>
      ) : null}

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
      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onOpenExternal={handleOpenPreviewExternal}
          t={t}
        />
      ) : null}
    </div>
  );
}
