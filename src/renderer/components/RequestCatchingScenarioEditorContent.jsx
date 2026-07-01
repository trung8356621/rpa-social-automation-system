import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Database,
  Info,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Target,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import CrawlBrowserPreview from './CrawlBrowserPreview';
import RequestCatchingSearchBox, { matchesSearchQuery } from './RequestCatchingSearchBox';
import { parseFacebookGraphQLBatch } from '@shared/parseFacebookGraphQL.js';
import {
  buildFilterFromDiscovery,
  formatFilterSummary,
  hasActiveFilters,
} from '../utils/requestCatching';

const MAX_DISCOVERED = 80;

function mergeCrawledData(previous, incoming) {
  const items = Array.isArray(incoming) ? incoming : [];
  if (!items.length) return previous;

  const seen = new Set((previous || []).map((item) => JSON.stringify(item)));
  const next = [...(previous || [])];

  items.forEach((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(item);
  });

  return next;
}

function mergeDiscovered(previous, incoming) {
  const record = incoming && typeof incoming === 'object' ? incoming : null;
  if (!record?.id) return previous;

  const next = [record, ...(previous || []).filter((item) => item.id !== record.id)];
  return next.slice(0, MAX_DISCOVERED);
}

function hasSessionContent(crawledData = [], discovered = []) {
  return crawledData.length > 0 || discovered.length > 0;
}

function filterJsonPreview(preview, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle || !preview) return preview;

  try {
    const parsed = JSON.parse(preview);
    const walk = (value) => {
      if (typeof value === 'string') {
        return value.toLowerCase().includes(needle) ? value : undefined;
      }
      if (Array.isArray(value)) {
        const next = value.map(walk).filter((item) => item !== undefined);
        return next.length ? next : undefined;
      }
      if (value && typeof value === 'object') {
        const next = {};
        let hasMatch = false;
        Object.entries(value).forEach(([key, item]) => {
          if (key.toLowerCase().includes(needle)) {
            next[key] = item;
            hasMatch = true;
            return;
          }
          const filtered = walk(item);
          if (filtered !== undefined) {
            next[key] = filtered;
            hasMatch = true;
          }
        });
        return hasMatch ? next : undefined;
      }
      return undefined;
    };

    const filtered = walk(parsed);
    if (!filtered) return preview;
    return JSON.stringify(filtered, null, 2);
  } catch {
    return matchesSearchQuery(preview, query) ? preview : '';
  }
}

function ResultsPanels({
  t,
  filteredDiscovered,
  discovered,
  discoveredSearch,
  setDiscoveredSearch,
  selectedDiscoveryId,
  setSelectedDiscoveryId,
  selectedDiscovery,
  detailSearch,
  setDetailSearch,
  selectedDetailPreview,
  handleUseAsFilter,
  finalResultData,
  finalResultPreview,
  finalResultSearch,
  setFinalResultSearch,
  lastUpdatedAt,
  resultsEmptyMessage,
  discoveredEmptyMessage,
}) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.2fr)]">
      <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2a3144] bg-[#101217]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#2a3144] px-3 py-2 text-xs">
            <span className="font-medium text-[#c7d0dc]">
              {t('scenarioEditor.requestCatching.discoveredTitle', { count: filteredDiscovered.length })}
            </span>
          </div>
          <RequestCatchingSearchBox value={discoveredSearch} onChange={setDiscoveredSearch} />
          <div className="min-h-0 flex-1 overflow-auto">
            {!filteredDiscovered.length ? (
              <p className="p-3 text-[11px] text-[#8b97aa]">
                {discovered.length
                  ? t('scenarioEditor.requestCatching.discoveredNoMatch')
                  : discoveredEmptyMessage}
              </p>
            ) : (
              filteredDiscovered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedDiscoveryId(item.id)}
                  className={`flex w-full flex-col gap-0.5 border-b border-[#1d2129] px-3 py-2 text-left hover:bg-[#171a21] ${
                    selectedDiscoveryId === item.id ? 'bg-[#1a2230]' : ''
                  }`}
                >
                  <span className="truncate text-xs font-medium text-[#e4ebf5]">{item.label}</span>
                  <span className="truncate text-[10px] text-[#7f8da3]">
                    {t('scenarioEditor.requestCatching.discoveredMeta', {
                      count: item.objectCount || 0,
                      time: new Date(item.timestamp).toLocaleTimeString(),
                    })}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedDiscovery && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#2a3144] bg-[#101217]">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2a3144] px-3 py-2">
              <span className="truncate text-xs font-medium text-[#c7d0dc]">{selectedDiscovery.label}</span>
              <button
                type="button"
                onClick={handleUseAsFilter}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-[#2f6fed] px-2 text-[11px] font-semibold text-white hover:bg-[#4a82f0]"
              >
                <Target className="h-3.5 w-3.5" />
                {t('scenarioEditor.requestCatching.useAsFilter')}
              </button>
            </div>
            <RequestCatchingSearchBox value={detailSearch} onChange={setDetailSearch} />
            <pre className="min-h-0 flex-1 overflow-auto p-3 text-[10px] leading-relaxed text-[#d7e3f4]">
              {selectedDetailPreview || t('scenarioEditor.requestCatching.detailNoMatch')}
            </pre>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#2a3144] bg-[#101217]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#2a3144] px-3 py-2 text-xs">
          <span className="font-medium text-[#c7d0dc]">
            {t('scenarioEditor.requestCatching.finalResultTitle', { count: finalResultData.length })}
          </span>
          {lastUpdatedAt && (
            <span className="text-[#8b97aa]">
              {t('scenarioEditor.requestCatching.lastCapture', {
                time: new Date(lastUpdatedAt).toLocaleTimeString(),
              })}
            </span>
          )}
        </div>
        <RequestCatchingSearchBox value={finalResultSearch} onChange={setFinalResultSearch} />
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-[11px] leading-relaxed text-[#d7e3f4]">
          {finalResultData.length ? finalResultPreview : resultsEmptyMessage}
        </pre>
      </div>
    </div>
  );
}

export default function RequestCatchingScenarioEditorContent({
  currentScenarioId,
  browserProfileId,
  targetUrl,
  defaultTargetUrl,
  browserProfileOptions,
  onBrowserProfileChange,
  activeViewport,
  active,
  platform,
  scenarioInfoOpen,
  onScenarioInfoToggle,
  ScenarioInfoPanelComponent,
  PanelSectionHeaderComponent,
  scenarioInfoProps,
  scenarioMeta,
  onScenarioMetaChange,
  onExitRequestCatchingMode,
}) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState('capture');
  const [dumpChecked, setDumpChecked] = useState(false);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activePageUrl, setActivePageUrl] = useState('');
  const [crawledData, setCrawledData] = useState([]);
  const [discovered, setDiscovered] = useState([]);
  const [selectedDiscoveryId, setSelectedDiscoveryId] = useState('');
  const [lastCaptureAt, setLastCaptureAt] = useState(null);
  const [dumpPath, setDumpPath] = useState('');
  const [dumpUpdatedAt, setDumpUpdatedAt] = useState(null);
  const [loadingDump, setLoadingDump] = useState(false);
  const [discoveredSearch, setDiscoveredSearch] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [finalResultSearch, setFinalResultSearch] = useState('');

  const savedFilters = scenarioMeta?.request_catching?.filters || {};
  const hasFilters = hasActiveFilters(savedFilters);
  const resolvedTargetUrl = targetUrl || defaultTargetUrl || '';
  const hasLiveData = hasSessionContent(crawledData, discovered);

  const selectedDiscovery = useMemo(
    () => discovered.find((item) => item.id === selectedDiscoveryId) || null,
    [discovered, selectedDiscoveryId],
  );

  const filteredDiscovered = useMemo(() => {
    if (!discoveredSearch.trim()) return discovered;
    return discovered.filter((item) => {
      const haystack = [
        item.label,
        item.url,
        item.postDataPreview,
        JSON.stringify(item.requestHeaders || {}),
      ].join(' ');
      return matchesSearchQuery(haystack, discoveredSearch);
    });
  }, [discovered, discoveredSearch]);

  const allRawObjects = useMemo(() => {
    let raw = [...crawledData];
    discovered.forEach((record) => {
      if (Array.isArray(record?.items) && record.items.length) {
        raw = mergeCrawledData(raw, record.items);
      }
    });
    return raw;
  }, [crawledData, discovered]);

  const finalResultData = useMemo(
    () => parseFacebookGraphQLBatch(allRawObjects, { targetUrl: resolvedTargetUrl }),
    [allRawObjects, resolvedTargetUrl],
  );

  const finalResultPreview = useMemo(() => {
    const payload = {
      posts: finalResultData,
      post_count: finalResultData.length,
      comment_count: finalResultData.reduce((sum, post) => sum + (post.comments?.length || 0), 0),
      raw_object_count: allRawObjects.length,
      ...(viewMode === 'offline' && dumpPath ? { dump_path: dumpPath } : {}),
    };
    return filterJsonPreview(JSON.stringify(payload, null, 2), finalResultSearch);
  }, [allRawObjects.length, dumpPath, finalResultData, finalResultSearch, viewMode]);

  const selectedDetailPreview = useMemo(() => {
    if (!selectedDiscovery) return '';
    return filterJsonPreview(
      JSON.stringify(
        {
          label: selectedDiscovery.label,
          url: selectedDiscovery.url,
          objectCount: selectedDiscovery.objectCount,
          requestHeaders: selectedDiscovery.requestHeaders,
          postDataPreview: selectedDiscovery.postDataPreview,
          items: selectedDiscovery.items,
          responsePreview: selectedDiscovery.responsePreview,
        },
        null,
        2,
      ),
      detailSearch,
    );
  }, [detailSearch, selectedDiscovery]);

  const crawlMetaJson = useMemo(
    () => JSON.stringify(scenarioMeta?.crawl || {}),
    [scenarioMeta?.crawl],
  );
  const crawlMeta = useMemo(() => JSON.parse(crawlMetaJson), [crawlMetaJson]);
  const filtersJson = useMemo(() => JSON.stringify(savedFilters), [savedFilters]);

  const applySession = useCallback((session) => {
    const nextCrawled = Array.isArray(session?.crawledData) ? session.crawledData : [];
    const nextDiscovered = Array.isArray(session?.discovered) ? session.discovered : [];
    setCrawledData(nextCrawled);
    setDiscovered(nextDiscovered);
    setDumpPath(session?.dumpPath || '');
    setDumpUpdatedAt(session?.updatedAt || null);
    setSelectedDiscoveryId((current) => {
      if (current && nextDiscovered.some((item) => item.id === current)) return current;
      return nextDiscovered[0]?.id || '';
    });
    return session?.hasContent === true || hasSessionContent(nextCrawled, nextDiscovered);
  }, []);

  const loadDump = useCallback(async (options = {}) => {
    if (!currentScenarioId || !window.electronAPI?.loadRequestCatchingDump) {
      setDumpChecked(true);
      return false;
    }

    setLoadingDump(true);
    try {
      const session = await window.electronAPI.loadRequestCatchingDump(currentScenarioId);
      const hasContent = applySession(session);
      if (options.setViewMode !== false) {
        setViewMode(hasContent ? 'offline' : 'capture');
      }
      return hasContent;
    } finally {
      setLoadingDump(false);
      setDumpChecked(true);
    }
  }, [applySession, currentScenarioId]);

  useEffect(() => {
    setDumpChecked(false);
    loadDump().catch(() => setDumpChecked(true));
  }, [currentScenarioId, loadDump]);

  useEffect(() => {
    if (viewMode !== 'capture' || !window.electronAPI?.onRequestCatchingDiscovered) return undefined;

    const cleanup = window.electronAPI.onRequestCatchingDiscovered((payload) => {
      setDiscovered((prev) => mergeDiscovered(prev, payload));
      setSelectedDiscoveryId((current) => current || payload?.id || '');
      setRunning(true);
      setPaused(false);
    });

    return cleanup;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'capture' || !window.electronAPI?.onRequestCatchingCaptured) return undefined;

    const cleanup = window.electronAPI.onRequestCatchingCaptured((payload) => {
      setCrawledData((prev) => mergeCrawledData(prev, payload?.items));
      setLastCaptureAt(payload?.timestamp || new Date().toISOString());
      setRunning(true);
      setPaused(false);
    });

    return cleanup;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'capture' || !window.electronAPI?.onRequestCatchingReset) return undefined;

    const cleanup = window.electronAPI.onRequestCatchingReset((payload) => {
      setCrawledData([]);
      setDiscovered([]);
      setSelectedDiscoveryId('');
      setLastCaptureAt(null);
      setActivePageUrl(payload?.url || '');
      setRunning(true);
      setPaused(false);
    });

    return cleanup;
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'capture' || !active || !window.electronAPI?.setRequestCatchingAuto) return undefined;

    let cancelled = false;

    const syncAuto = async () => {
      const result = await window.electronAPI.setRequestCatchingAuto({
        enabled: true,
        paused,
        platform: platform || 'facebook',
        scenarioId: currentScenarioId,
        crawlMeta,
        requestCatchingFilters: savedFilters,
      });
      if (!cancelled) {
        setRunning(Boolean(result?.enabled) && !result?.paused);
      }
    };

    syncAuto().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [active, crawlMetaJson, currentScenarioId, filtersJson, paused, platform, viewMode]);

  useEffect(() => {
    if (viewMode !== 'capture' || !window.electronAPI?.setRequestCatchingAuto) return undefined;

    return () => {
      window.electronAPI?.setRequestCatchingAuto?.({ enabled: false }).catch(() => {});
      window.electronAPI?.stopRequestCatchingPreview?.().catch(() => {});
    };
  }, [viewMode]);

  const handleRefreshDump = () => {
    loadDump({ setViewMode: false }).catch(() => {});
  };

  const handleSwitchToOffline = async () => {
    if (!hasLiveData) return;

    try {
      if (currentScenarioId && window.electronAPI?.saveRequestCatchingDump) {
        const saved = await window.electronAPI.saveRequestCatchingDump({
          scenarioId: currentScenarioId,
          crawledData,
          discovered,
        });
        setDumpPath(saved?.dumpPath || dumpPath);
        setDumpUpdatedAt(saved?.updatedAt || new Date().toISOString());
      } else if (currentScenarioId && window.electronAPI?.getRequestCatchingDumpPath) {
        const paths = await window.electronAPI.getRequestCatchingDumpPath(currentScenarioId);
        setDumpPath(paths?.dumpPath || '');
      }
    } catch {
      // Keep in-memory data even if disk save fails.
    }

    setViewMode('offline');
    window.electronAPI?.setRequestCatchingAuto?.({ enabled: false }).catch(() => {});
    window.electronAPI?.detachCrawlPreview?.().catch(() => {});
  };

  const handleSwitchToCapture = () => {
    setViewMode('capture');
  };

  const handleStop = async () => {
    setPaused(true);
    try {
      await window.electronAPI?.setRequestCatchingAuto?.({
        enabled: true,
        paused: true,
        platform: platform || 'facebook',
        scenarioId: currentScenarioId,
        crawlMeta,
        requestCatchingFilters: savedFilters,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleClear = async () => {
    setCrawledData([]);
    setDiscovered([]);
    setSelectedDiscoveryId('');
    setLastCaptureAt(null);
    setDumpUpdatedAt(null);
    setDiscoveredSearch('');
    setDetailSearch('');
    setFinalResultSearch('');
    if (currentScenarioId && window.electronAPI?.clearRequestCatchingDump) {
      await window.electronAPI.clearRequestCatchingDump(currentScenarioId).catch(() => {});
      setDumpPath('');
    }
    if (viewMode === 'offline') {
      setViewMode('capture');
    }
  };

  const handleUseAsFilter = () => {
    if (!selectedDiscovery || !onScenarioMetaChange) return;
    onScenarioMetaChange({
      ...scenarioMeta,
      request_catching: {
        ...(scenarioMeta?.request_catching || {}),
        filters: buildFilterFromDiscovery(selectedDiscovery),
      },
    });
  };

  const handleClearFilter = () => {
    if (!onScenarioMetaChange) return;
    onScenarioMetaChange({
      ...scenarioMeta,
      request_catching: {
        ...(scenarioMeta?.request_catching || {}),
        filters: {},
      },
    });
  };

  const resultsPanels = (
    <ResultsPanels
      t={t}
      filteredDiscovered={filteredDiscovered}
      discovered={discovered}
      discoveredSearch={discoveredSearch}
      setDiscoveredSearch={setDiscoveredSearch}
      selectedDiscoveryId={selectedDiscoveryId}
      setSelectedDiscoveryId={setSelectedDiscoveryId}
      selectedDiscovery={selectedDiscovery}
      detailSearch={detailSearch}
      setDetailSearch={setDetailSearch}
      selectedDetailPreview={selectedDetailPreview}
      handleUseAsFilter={handleUseAsFilter}
      finalResultData={finalResultData}
      finalResultPreview={finalResultPreview}
      finalResultSearch={finalResultSearch}
      setFinalResultSearch={setFinalResultSearch}
      lastUpdatedAt={viewMode === 'offline' ? dumpUpdatedAt : lastCaptureAt}
      resultsEmptyMessage={
        viewMode === 'offline'
          ? t('scenarioEditor.requestCatching.resultsEmptyOffline')
          : t('scenarioEditor.requestCatching.resultsEmptyFiltered')
      }
      discoveredEmptyMessage={
        viewMode === 'offline'
          ? t('scenarioEditor.requestCatching.discoveredEmptyOffline')
          : t('scenarioEditor.requestCatching.discoveredEmpty')
      }
    />
  );

  const filterBanner = hasFilters ? (
    <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-[#2f6f4a] bg-[#142019] px-3 py-2 text-[11px]">
      <div className="min-w-0 truncate text-[#9fd4b4]">
        <Check className="mr-1 inline h-3.5 w-3.5" />
        {t('scenarioEditor.requestCatching.activeFilter', {
          filter: formatFilterSummary(savedFilters),
        })}
      </div>
      <button
        type="button"
        onClick={handleClearFilter}
        className="shrink-0 text-[#8b97aa] hover:text-white"
      >
        {t('scenarioEditor.requestCatching.clearFilter')}
      </button>
    </div>
  ) : (
    <p className="shrink-0 text-[11px] text-[#8b97aa]">
      {t('scenarioEditor.requestCatching.pickFilterHint')}
    </p>
  );

  if (!dumpChecked) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#14161b] p-6 text-sm text-[#8b97aa]">
        {t('scenarioEditor.requestCatching.loadingDump')}
      </div>
    );
  }

  if (viewMode === 'offline') {
    return (
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-x-hidden">
        <section className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-[#14161b] p-4">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#2a2d34] pb-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{t('scenarioEditor.requestCatching.offlineTitle')}</h3>
              <p className="mt-0.5 text-[11px] text-[#8b97aa]">
                {t('scenarioEditor.requestCatching.offlineSubtitle')}
              </p>
              {dumpPath && (
                <p className="mt-1 truncate text-[10px] text-[#6f7d92]" title={dumpPath}>
                  {t('scenarioEditor.requestCatching.dumpPath', { path: dumpPath })}
                </p>
              )}
              {dumpUpdatedAt && (
                <p className="text-[10px] text-[#6f7d92]">
                  {t('scenarioEditor.requestCatching.dumpUpdated', {
                    time: new Date(dumpUpdatedAt).toLocaleString(),
                  })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSwitchToCapture}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#3b4252] px-2.5 text-xs text-[#b8c5d6] hover:bg-[#242833]"
              >
                {t('scenarioEditor.requestCatching.switchToCapture')}
              </button>
              <button
                type="button"
                onClick={handleRefreshDump}
                disabled={loadingDump}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#3b4252] px-2.5 text-xs text-[#b8c5d6] hover:bg-[#242833] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingDump ? 'animate-spin' : ''}`} />
                {t('scenarioEditor.requestCatching.refreshDump')}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={!hasLiveData}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#3b4252] px-2.5 text-xs text-[#b8c5d6] hover:bg-[#242833] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('scenarioEditor.requestCatching.clear')}
              </button>
              <button
                type="button"
                onClick={onExitRequestCatchingMode}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#ff6b2c] px-3 text-xs font-semibold text-white hover:bg-[#ff824f]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('scenarioEditor.requestCatching.resetEditor')}
              </button>
            </div>
          </div>

          <PanelSectionHeaderComponent
            icon={Info}
            title={scenarioInfoProps.title}
            onToggle={onScenarioInfoToggle}
            open={scenarioInfoOpen}
          />
          {scenarioInfoOpen && (
            <div className="shrink-0 rounded-lg border border-[#2a3144] bg-[#15171d] p-3">
              <ScenarioInfoPanelComponent {...scenarioInfoProps} />
            </div>
          )}

          {filterBanner}
          {resultsPanels}
        </section>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-x-hidden">
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(520px,1.25fr)_minmax(360px,0.9fr)] overflow-x-hidden">
        <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-[#2a2d34]">
          <CrawlBrowserPreview
            scenarioId={currentScenarioId}
            browserProfileId={browserProfileId}
            targetUrl={resolvedTargetUrl}
            browserProfileOptions={browserProfileOptions}
            onBrowserProfileChange={onBrowserProfileChange}
            activeViewport={activeViewport}
            active={active}
            isCrawlMode={false}
            designMode={false}
          />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-[#14161b] p-4">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#2a2d34] pb-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{t('scenarioEditor.requestCatching.resultsTitle')}</h3>
              <p className="truncate text-[11px] text-[#8b97aa]">
                {paused
                  ? t('scenarioEditor.requestCatching.resultsPaused')
                  : running
                    ? t('scenarioEditor.requestCatching.resultsAutoListening')
                    : t('scenarioEditor.requestCatching.resultsWaitingLoad')}
              </p>
              {activePageUrl && (
                <p className="truncate text-[10px] text-[#6f7d92]" title={activePageUrl}>
                  {t('scenarioEditor.requestCatching.activePage', { url: activePageUrl })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {hasLiveData && (
                <button
                  type="button"
                  onClick={handleSwitchToOffline}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#2f6fed] bg-[#1a2540] px-2.5 text-xs text-[#9ec0ff] hover:bg-[#223058]"
                >
                  <Database className="h-3.5 w-3.5" />
                  {t('scenarioEditor.requestCatching.switchToOffline')}
                </button>
              )}
              <button
                type="button"
                onClick={handleClear}
                disabled={!hasLiveData}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#3b4252] px-2.5 text-xs text-[#b8c5d6] hover:bg-[#242833] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('scenarioEditor.requestCatching.clear')}
              </button>
              {running && !paused && (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#ff3b59] px-3 text-xs font-semibold text-white hover:bg-[#ff5670]"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {t('scenarioEditor.requestCatching.stop')}
                </button>
              )}
              <button
                type="button"
                onClick={onExitRequestCatchingMode}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#ff6b2c] px-3 text-xs font-semibold text-white hover:bg-[#ff824f]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('scenarioEditor.requestCatching.resetEditor')}
              </button>
            </div>
          </div>

          <PanelSectionHeaderComponent
            icon={Info}
            title={scenarioInfoProps.title}
            onToggle={onScenarioInfoToggle}
            open={scenarioInfoOpen}
          />
          {scenarioInfoOpen && (
            <div className="shrink-0 rounded-lg border border-[#2a3144] bg-[#15171d] p-3">
              <ScenarioInfoPanelComponent {...scenarioInfoProps} />
            </div>
          )}

          {filterBanner}
          {resultsPanels}
        </section>
      </div>
    </div>
  );
}
