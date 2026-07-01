import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Code2,
  ExternalLink,
  Globe,
  Loader2,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { resolveVariableTemplate } from '@shared/variableTemplate.js';

function readBounds(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function normalizePreviewUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export default function CrawlBrowserPreview({
  scenarioId,
  browserProfileId,
  targetUrl,
  scenarioVariables = [],
  browserProfileOptions = [],
  onBrowserProfileChange,
  activeViewport,
  active = true,
  isCrawlMode = false,
  designMode = false,
  onDesignModeChange,
}) {
  const { t } = useTranslation();
  const hostRef = useRef(null);
  const findInputRef = useRef(null);
  const targetUrlRef = useRef(targetUrl || '');
  const [urlInput, setUrlInput] = useState(targetUrl || '');
  const [state, setState] = useState({
    attached: false,
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  });
  const [busy, setBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState('');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState({ matches: 0, activeMatchOrdinal: 0 });

  const syncState = useCallback(async () => {
    if (!window.electronAPI?.getCrawlPreviewState) return;
    try {
      const next = await window.electronAPI.getCrawlPreviewState();
      setState(next || { attached: false });
      if (typeof next?.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
    } catch {
      // Ignore polling errors.
    }
  }, []);

  const pushBounds = useCallback(async () => {
    if (!window.electronAPI?.setCrawlPreviewBounds) return;
    const bounds = readBounds(hostRef.current);
    if (!bounds) return;
    await window.electronAPI.setCrawlPreviewBounds(bounds);
  }, []);

  const attachPreview = useCallback(async () => {
    if (!window.electronAPI?.attachCrawlPreview) return;
    setAttaching(true);
    setError('');
    try {
      const bounds = readBounds(hostRef.current);
      const next = await window.electronAPI.attachCrawlPreview({
        scenarioId: scenarioId || null,
        browserProfileId: browserProfileId || null,
        url: targetUrlRef.current || 'about:blank',
        bounds,
      });
      setState(next || { attached: true });
      if (typeof next?.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
      if (next?.url) setUrlInput(next.url);
      else if (targetUrlRef.current) setUrlInput(targetUrlRef.current);
    } catch (err) {
      setError(err.message || t('scenarioEditor.crawlPreview.attachFailed'));
      setState((current) => ({ ...current, attached: false }));
    } finally {
      setAttaching(false);
    }
  }, [browserProfileId, scenarioId, t]);

  const runPreviewAction = useCallback(async (action, payload) => {
    if (!window.electronAPI?.[action]) return;
    setBusy(true);
    setError('');
    try {
      const next = await window.electronAPI[action](payload);
      setState(next || state);
      if (typeof next?.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
      if (next?.url) setUrlInput(next.url);
    } catch (err) {
      setError(err.message || t('scenarioEditor.crawlPreview.actionFailed'));
    } finally {
      setBusy(false);
    }
  }, [state, t]);

  useEffect(() => {
    targetUrlRef.current = targetUrl || '';
    setUrlInput(targetUrl || '');
  }, [targetUrl]);

  useEffect(() => {
    if (!active) {
      window.electronAPI?.detachCrawlPreview?.().catch(() => {});
      setState((current) => ({ ...current, attached: false }));
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      await attachPreview();
    }, 80);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, attachPreview]);

  useEffect(() => {
    if (!window.electronAPI?.onCrawlPreviewState) return undefined;
    return window.electronAPI.onCrawlPreviewState((next) => {
      if (!next) return;
      setState((current) => ({ ...current, ...next }));
      if (typeof next.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
    });
  }, []);

  const resolvedTargetUrl = useMemo(
    () => resolveVariableTemplate(targetUrl || '', scenarioVariables),
    [scenarioVariables, targetUrl],
  );

  useEffect(() => {
    if (!state.attached || !resolvedTargetUrl || !window.electronAPI?.navigateCrawlPreview) return undefined;

    const desiredUrl = normalizePreviewUrl(resolvedTargetUrl);
    const currentUrl = normalizePreviewUrl(state.url);
    if (!desiredUrl || desiredUrl === currentUrl) return undefined;

    const timer = setTimeout(() => {
      window.electronAPI.navigateCrawlPreview({
        url: targetUrl,
        scenarioId: scenarioId || null,
      }).then((next) => {
        if (next?.url) setUrlInput(next.url);
        if (next) setState(next);
      }).catch((err) => {
        setError(err?.message || t('scenarioEditor.crawlPreview.actionFailed'));
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [resolvedTargetUrl, scenarioId, state.attached, state.url, t, targetUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const observer = new ResizeObserver(() => {
      pushBounds().catch(() => {});
    });
    observer.observe(host);

    const handleScroll = () => {
      pushBounds().catch(() => {});
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [pushBounds]);

  useEffect(() => {
    if (!isCrawlMode || !window.electronAPI?.setCrawlDesignMode) return undefined;

    window.electronAPI.setCrawlDesignMode({
      enabled: designMode && active,
    }).catch(() => {});

    if (!designMode) {
      window.electronAPI.clearCrawlHighlight?.().catch(() => {});
    }

    return undefined;
  }, [active, designMode, isCrawlMode]);

  useEffect(() => {
    if (!state.attached) return undefined;
    syncState().catch(() => {});
    const timer = setInterval(() => {
      syncState().catch(() => {});
    }, 800);
    return () => clearInterval(timer);
  }, [state.attached, syncState]);

  useEffect(() => () => {
    window.electronAPI?.detachCrawlPreview?.().catch(() => {});
  }, []);

  const handleNavigate = async (event) => {
    event.preventDefault();
    await runPreviewAction('navigateCrawlPreview', {
      url: urlInput,
      scenarioId: scenarioId || null,
    });
  };

  const handleOpenExternal = async () => {
    const url = state.url || urlInput;
    if (!url || !window.electronAPI?.openCrawlPreviewExternal) return;
    await window.electronAPI.openCrawlPreviewExternal(url);
  };

  const handleToggleDesign = () => {
    onDesignModeChange?.(!designMode);
  };

  const handleOpenDevTools = async () => {
    if (!window.electronAPI?.openCrawlDevTools) return;
    await window.electronAPI.openCrawlDevTools();
  };

  const handleZoomIn = async () => {
    if (!window.electronAPI?.zoomInCrawlPreview) return;
    const next = await window.electronAPI.zoomInCrawlPreview();
    if (typeof next?.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
  };

  const handleZoomOut = async () => {
    if (!window.electronAPI?.zoomOutCrawlPreview) return;
    const next = await window.electronAPI.zoomOutCrawlPreview();
    if (typeof next?.zoomFactor === 'number') setZoomFactor(next.zoomFactor);
  };

  const closeFindBar = useCallback(async () => {
    setFindOpen(false);
    setFindQuery('');
    setFindResult({ matches: 0, activeMatchOrdinal: 0 });
    await window.electronAPI?.stopFindInCrawlPreview?.().catch(() => {});
  }, []);

  const openFindBar = useCallback(() => {
    if (!state.attached) return;
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [state.attached]);

  const runFind = useCallback(async ({ forward = true, findNext = false } = {}) => {
    if (!window.electronAPI?.findInCrawlPreview || !state.attached) return;
    const text = findQuery.trim();
    if (!text) {
      await closeFindBar();
      return;
    }
    const result = await window.electronAPI.findInCrawlPreview({ text, forward, findNext });
    setFindResult({
      matches: result?.matches ?? 0,
      activeMatchOrdinal: result?.activeMatchOrdinal ?? 0,
    });
  }, [closeFindBar, findQuery, state.attached]);

  useEffect(() => {
    if (!active || !state.attached) return undefined;

    const handleKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (String(event.key).toLowerCase() !== 'f') return;
      event.preventDefault();
      openFindBar();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, openFindBar, state.attached]);

  useEffect(() => {
    if (!window.electronAPI?.onCrawlOpenFindBar) return undefined;
    return window.electronAPI.onCrawlOpenFindBar(() => {
      openFindBar();
    });
  }, [openFindBar]);

  useEffect(() => {
    if (!findOpen || !findQuery.trim()) return undefined;
    const timer = setTimeout(() => {
      runFind({ forward: true, findNext: false }).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [findOpen, findQuery, runFind]);

  useEffect(() => {
    if (!state.attached) {
      closeFindBar().catch(() => {});
    }
  }, [closeFindBar, state.attached]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-[#2a2d34] px-3 py-2">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 shrink-0 text-[#7288ff]" />
          <select
            value={browserProfileId || ''}
            onChange={(event) => onBrowserProfileChange?.(event.target.value || null)}
            className="select-field h-7 min-w-0 flex-1 text-xs"
          >
            <option value="">{t('scenarioEditor.guestProfile')}</option>
            {browserProfileOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.display_name}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-[11px] text-[#7e8da5]">
            {activeViewport?.width} x {activeViewport?.height}
          </span>
        </div>

        <form onSubmit={handleNavigate} className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!state.canGoBack || busy}
            onClick={() => runPreviewAction('backCrawlPreview')}
            className="icon-button h-8 w-8 disabled:opacity-40"
            title={t('scenarioEditor.crawlPreview.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!state.canGoForward || busy}
            onClick={() => runPreviewAction('forwardCrawlPreview')}
            className="icon-button h-8 w-8 disabled:opacity-40"
            title={t('scenarioEditor.crawlPreview.forward')}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runPreviewAction('reloadCrawlPreview')}
            className="icon-button h-8 w-8"
            title={t('scenarioEditor.crawlPreview.reload')}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            className="input-field h-8 min-w-0 flex-1 text-xs"
            placeholder={t('scenarioEditor.crawlPreview.urlPlaceholder')}
          />
          <button type="submit" disabled={busy} className="btn-secondary h-8 px-2.5 text-xs">
            {t('scenarioEditor.crawlPreview.go')}
          </button>
          <button
            type="button"
            disabled={!state.url}
            onClick={handleOpenExternal}
            className="icon-button h-8 w-8"
            title={t('scenarioEditor.crawlPreview.openExternal')}
          >
            <ExternalLink className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!state.attached}
            onClick={openFindBar}
            className="icon-button h-8 w-8 disabled:opacity-40"
            title={t('scenarioEditor.crawlPreview.find')}
          >
            <Search className="h-4 w-4" />
          </button>
          {isCrawlMode && (
            <>
              <button
                type="button"
                onClick={handleToggleDesign}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
                  designMode
                    ? 'border border-[#635bff] bg-[#2a2550] text-[#c8c4ff]'
                    : 'border border-[#3c465c] bg-[#15171d] text-[#c7d0dc] hover:bg-[#243047]'
                }`}
                title={t('scenarioEditor.designMode')}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                {t('scenarioEditor.designMode')}
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={!state.attached || zoomFactor <= 0.5}
                className="icon-button h-8 w-8 disabled:opacity-40"
                title={t('scenarioEditor.crawlPreview.zoomOut')}
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[42px] text-center text-[10px] tabular-nums text-[#8b97aa]">
                {Math.round(zoomFactor * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={!state.attached || zoomFactor >= 3}
                className="icon-button h-8 w-8 disabled:opacity-40"
                title={t('scenarioEditor.crawlPreview.zoomIn')}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleOpenDevTools}
                className="icon-button h-8 w-8"
                title={t('scenarioEditor.openDevTools')}
              >
                <Code2 className="h-4 w-4" />
              </button>
            </>
          )}
        </form>

        {state.title ? (
          <p className="truncate text-[11px] text-[#8b97aa]">{state.title}</p>
        ) : null}
        {error ? (
          <p className="text-[11px] text-[#ff8fa0]">{error}</p>
        ) : null}

        {findOpen && (
          <div className="flex items-center gap-1 rounded-md border border-[#3c465c] bg-[#15171d] p-1">
            <Search className="ml-1 h-3.5 w-3.5 shrink-0 text-[#8b97aa]" />
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  runFind({
                    forward: !event.shiftKey,
                    findNext: Boolean(findQuery.trim()),
                  }).catch(() => {});
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFindBar().catch(() => {});
                }
              }}
              className="input-field h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus:ring-0"
              placeholder={t('scenarioEditor.crawlPreview.findPlaceholder')}
            />
            <span className="min-w-[72px] shrink-0 px-1 text-[10px] tabular-nums text-[#8b97aa]">
              {findQuery.trim() && findResult.matches === 0
                ? t('scenarioEditor.crawlPreview.findNoMatches')
                : findResult.matches > 0
                  ? t('scenarioEditor.crawlPreview.findMatchCount', {
                    current: findResult.activeMatchOrdinal,
                    total: findResult.matches,
                  })
                  : ''}
            </span>
            <button
              type="button"
              onClick={() => runFind({ forward: false, findNext: true }).catch(() => {})}
              className="icon-button h-7 w-7"
              title={t('scenarioEditor.crawlPreview.findPrev')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => runFind({ forward: true, findNext: true }).catch(() => {})}
              className="icon-button h-7 w-7"
              title={t('scenarioEditor.crawlPreview.findNext')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => closeFindBar().catch(() => {})}
              className="icon-button h-7 w-7"
              title={t('scenarioEditor.crawlPreview.findClose')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-[#0b0d12]">
        <div
          ref={hostRef}
          className="absolute inset-0 overflow-hidden rounded-sm border border-[#2a2d34] bg-[#101217]"
        >
          {!state.attached && !attaching && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <Globe className="mb-3 h-10 w-10 text-[#4e586b]" />
              <p className="text-sm font-semibold text-white">{t('scenarioEditor.crawlPreview.emptyTitle')}</p>
              <p className="mt-1 text-xs text-[#7e8da5]">{t('scenarioEditor.crawlPreview.emptyHint')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
