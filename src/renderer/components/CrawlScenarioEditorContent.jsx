import React from 'react';
import { Info } from 'lucide-react';
import CrawlBrowserPreview from './CrawlBrowserPreview';
import CrawlWidgetPanel from './CrawlWidgetPanel';

export default function CrawlScenarioEditorContent({
  currentScenarioId,
  browserProfileId,
  targetUrl,
  defaultTargetUrl,
  browserProfileOptions,
  onBrowserProfileChange,
  activeViewport,
  active,
  designMode,
  onDesignModeChange,
  inspectorOpen,
  scenarioInfoOpen,
  onScenarioInfoToggle,
  ScenarioInfoPanelComponent,
  PanelSectionHeaderComponent,
  scenarioInfoProps,
  steps,
  selectedCrawlWidgetId,
  onSelectCrawlWidget,
  onUpdateCrawlSteps,
  onDeleteCrawlWidget,
  onToast,
}) {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-x-hidden">
      <div className={`grid min-h-0 min-w-0 overflow-x-hidden ${
        inspectorOpen
          ? 'grid-cols-[minmax(520px,1.25fr)_minmax(480px,1fr)]'
          : 'grid-cols-[minmax(520px,1.25fr)_minmax(360px,0.9fr)]'
      }`}>
        <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-[#2a2d34]">
          <CrawlBrowserPreview
            scenarioId={currentScenarioId}
            browserProfileId={browserProfileId}
            targetUrl={targetUrl || defaultTargetUrl}
            browserProfileOptions={browserProfileOptions}
            onBrowserProfileChange={onBrowserProfileChange}
            activeViewport={activeViewport}
            active={active}
            isCrawlMode
            designMode={designMode}
            onDesignModeChange={onDesignModeChange}
          />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-[#14161b]">
          <PanelSectionHeaderComponent
            icon={Info}
            title={scenarioInfoProps.title}
            onToggle={onScenarioInfoToggle}
            open={scenarioInfoOpen}
          />
          {scenarioInfoOpen && (
            <div className="shrink-0 border-b border-[#2a2d34] bg-[#15171d] p-3">
              <ScenarioInfoPanelComponent {...scenarioInfoProps} />
            </div>
          )}

          <CrawlWidgetPanel
            steps={steps}
            selectedWidgetId={selectedCrawlWidgetId}
            onSelectWidget={onSelectCrawlWidget}
            onUpdateSteps={onUpdateCrawlSteps}
            onDeleteWidget={onDeleteCrawlWidget}
            onToast={onToast}
          />
        </section>
      </div>
    </div>
  );
}
