import React from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  FolderOpen,
  Info,
  Keyboard,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Square,
  Timer,
  Trash2,
} from 'lucide-react';

export default function StandardScenarioEditorContent({
  inspectorOpen,
  setInspectorOpen,
  timelineOpen,
  setTimelineOpen,
  scenarioInfoOpen,
  setScenarioInfoOpen,
  stepEditorOpen,
  setStepEditorOpen,
  globalWidgetsOpen,
  setGlobalWidgetsOpen,
  showGlobalWidgets,
  GlobalWidgetsPanelComponent,
  globalWidgetsProps,
  PanelSectionHeaderComponent,
  ActionIconBarComponent,
  IconOnlyComponent,
  ProgramMonitorComponent,
  StepCardComponent,
  StepEditPanelComponent,
  TimelineComponent,
  ScenarioInfoPanelComponent,
  scenarioInfoProps,
  t,
  browserProfileId,
  browserProfileOptions,
  onBrowserProfileChange,
  activeViewport,
  platform,
  targetUrl,
  selectedStep,
  hasSteps,
  recording,
  previewPlaying,
  currentFrameUrl,
  previewCurrentTime,
  totalTime,
  recordStatus,
  previewFrames,
  formatSeconds,
  describeStep,
  handleSeek,
  handleRun,
  steps,
  addStep,
  selectedStepIndex,
  selectedStepIndexes,
  handleSelectStep,
  handleStepContextMenu,
  handleDeleteStep,
  handleDeleteSelectedSteps,
  handleUpdateStep,
  stepContextMenu,
  setStepContextMenu,
  scenarioVariables,
  selectingTrim,
  setSelectingTrim,
  pendingTrimRange,
  setPendingTrimRange,
  normalizeTrimRanges,
  handleAutoTrim,
  handleSavePendingTrim,
}) {
  return (
    <div className={`grid min-h-0 min-w-0 flex-1 overflow-x-hidden ${timelineOpen ? 'grid-rows-[minmax(0,1fr)_190px]' : 'grid-rows-[minmax(0,1fr)]'}`}>
      <div className={`grid min-h-0 min-w-0 overflow-x-hidden ${
        inspectorOpen
          ? 'grid-cols-[minmax(420px,1fr)_minmax(480px,1.1fr)]'
          : 'grid-cols-[minmax(420px,1fr)_minmax(360px,0.9fr)]'
      }`}>
        <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-[#2a2d34]">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-[#2a2d34] px-3">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <Code2 className="h-3.5 w-3.5 shrink-0 text-[#7288ff]" />
              <select
                value={browserProfileId || ''}
                onChange={(event) => onBrowserProfileChange(event.target.value || null)}
                className="select-field h-7 min-w-0 flex-1 text-xs"
              >
                <option value="">Guest (không lưu profile)</option>
                {browserProfileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.display_name}
                  </option>
                ))}
              </select>
            </label>
            <span className="shrink-0 text-[11px] text-[#7e8da5]">RES: {activeViewport.width} x {activeViewport.height}</span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center overflow-hidden">
              <ProgramMonitorComponent
                platform={platform}
                selectedStep={selectedStep}
                targetUrl={targetUrl}
                hasSteps={hasSteps}
                recording={recording}
                previewPlaying={previewPlaying}
                currentFrameUrl={currentFrameUrl}
                currentTime={previewCurrentTime}
                frameCount={previewFrames.length}
              />
            </div>

            <div className="mt-3 flex shrink-0 items-center justify-between">
              <span className="rounded border border-[#2f3541] bg-[#0b0d12] px-3 py-1.5 text-xs font-semibold text-[#9eb2d0]">
                {recording
                  ? `REC ${formatSeconds(recordStatus?.elapsedMs || 0)} | ${recordStatus?.eventsCount || 0} events`
                  : `${formatSeconds(previewCurrentTime)} / ${formatSeconds(totalTime || 20000)}`}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => handleSeek(Math.max(0, previewCurrentTime - 1000))} className="icon-button">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={!hasSteps || recording}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-[#635bff] text-white shadow-lg shadow-[#635bff]/25 disabled:cursor-not-allowed disabled:bg-[#3a4050] disabled:text-[#7e8da5] disabled:shadow-none"
                >
                  {previewPlaying ? <Square className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                </button>
                <button type="button" onClick={() => handleSeek(Math.min(totalTime, previewCurrentTime + 1000))} className="icon-button">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <IconOnlyComponent icon={Eye} label="Hiển thị overlay" />
            </div>
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-[#14161b]">
          <PanelSectionHeaderComponent
            icon={Info}
            title={scenarioInfoProps.title}
            onToggle={() => setScenarioInfoOpen((current) => !current)}
            open={scenarioInfoOpen}
          />
          {scenarioInfoOpen && (
            <div className="shrink-0 border-b border-[#2a2d34] bg-[#15171d] p-3">
              <ScenarioInfoPanelComponent {...scenarioInfoProps} />
            </div>
          )}

          <div className={`grid min-h-0 flex-1 ${inspectorOpen ? 'grid-cols-[40px_minmax(0,1fr)_minmax(260px,300px)]' : 'grid-cols-[40px_minmax(0,1fr)]'}`}>
            <ActionIconBarComponent onAddStep={addStep} />

            <div className="flex min-h-0 min-w-0 flex-col">
              <PanelSectionHeaderComponent
                icon={FolderOpen}
                title="List scenario steps"
                trailing={(
                  <div className="flex items-center gap-2">
                    <span className="text-[#7e8da5]">{steps.length} steps</span>
                    {!inspectorOpen && (
                      <button
                        type="button"
                        onClick={() => setInspectorOpen(true)}
                        className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-0.5 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]"
                      >
                        <PanelRightOpen className="h-3 w-3" />
                        {t('scenarioEditor.step.editTitle')}
                      </button>
                    )}
                  </div>
                )}
              />

              <div
                className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                onClick={() => setStepContextMenu?.(null)}
              >
                {steps.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <FolderOpen className="mb-3 h-12 w-12 text-[#4e586b]" />
                    <p className="text-sm font-semibold text-white">Chưa có bước nào</p>
                    <p className="mt-1 text-xs text-[#7e8da5]">Bấm Record hoặc icon bên trái để thêm bước.</p>
                  </div>
                ) : (
                  steps.map((step, idx) => (
                    <StepCardComponent
                      key={step.id || idx}
                      step={step}
                      index={idx}
                      isSelected={idx === selectedStepIndex}
                      isMultiSelected={selectedStepIndexes?.has(idx)}
                      onSelect={handleSelectStep}
                      onContextMenu={handleStepContextMenu}
                      onDelete={handleDeleteStep}
                      onUpdate={(updates) => handleUpdateStep(idx, updates)}
                    />
                  ))
                )}
              </div>
              {stepContextMenu && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-[80] cursor-default"
                    onClick={() => setStepContextMenu?.(null)}
                    aria-label="Close step menu"
                  />
                  <div
                    className="fixed z-[90] w-44 overflow-hidden rounded-md border border-[#344054] bg-[#151922] py-1 shadow-2xl"
                    style={{ left: stepContextMenu.x, top: stepContextMenu.y }}
                  >
                    <button
                      type="button"
                      onClick={handleDeleteSelectedSteps}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-[#ff9aaa] hover:bg-[#2a1f28]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete {selectedStepIndexes?.size || 1} step{(selectedStepIndexes?.size || 1) > 1 ? 's' : ''}
                    </button>
                  </div>
                </>
              )}
            </div>

            {inspectorOpen && (
              <div className="flex min-h-0 min-w-0 flex-col border-l border-[#2a2d34] bg-[#15171d]">
                {showGlobalWidgets && GlobalWidgetsPanelComponent && (
                  <>
                    <PanelSectionHeaderComponent
                      icon={Keyboard}
                      title={t('scenarioEditor.globalWidgets.title')}
                      onToggle={() => setGlobalWidgetsOpen((current) => !current)}
                      open={globalWidgetsOpen}
                    />
                    {globalWidgetsOpen && (
                      <div className="shrink-0 border-b border-[#2a2d34] p-3">
                        <GlobalWidgetsPanelComponent {...globalWidgetsProps} />
                      </div>
                    )}
                  </>
                )}
                <PanelSectionHeaderComponent
                  icon={MousePointer2}
                  title={t('scenarioEditor.step.editTitle')}
                  onToggle={() => setStepEditorOpen((current) => !current)}
                  open={stepEditorOpen}
                  trailing={(
                    <div className="flex items-center gap-2">
                      <span className="max-w-[100px] truncate text-[10px] font-normal normal-case text-[#68758a]">
                        {selectedStep ? describeStep(selectedStep.action_type, {}, t) : t('scenarioEditor.step.noneSelected')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectorOpen(false)}
                        className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-0.5 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]"
                      >
                        <PanelRightClose className="h-3 w-3" />
                        {t('scenarioEditor.step.hideForm')}
                      </button>
                    </div>
                  )}
                />
                {stepEditorOpen && (
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <StepEditPanelComponent
                      selectedStep={selectedStep}
                      variables={scenarioVariables}
                      onStepChange={(updates) => {
                        if (selectedStepIndex === null) return;
                        handleUpdateStep(selectedStepIndex, updates);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {timelineOpen ? (
        <section className="min-w-0 overflow-x-hidden border-t border-[#2a2d34] bg-[#14161b]">
          <PanelSectionHeaderComponent
            icon={Timer}
            title="Timeline keyframes"
            trailing={(
              <div className="max-w-[min(100%,720px)] overflow-x-auto">
                <div className="flex w-max items-center gap-2">
                  <button type="button" onClick={handleAutoTrim} disabled={!hasSteps} className="rounded border border-[#3c465c] px-2 py-1 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047] disabled:cursor-not-allowed disabled:opacity-40">
                    Auto Trim
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectingTrim((current) => !current);
                      setPendingTrimRange(null);
                    }}
                    disabled={!hasSteps}
                    className={`rounded border px-2 py-1 text-[10px] font-normal normal-case disabled:cursor-not-allowed disabled:opacity-40 ${
                      selectingTrim ? 'border-[#635bff] bg-[#2a2550] text-[#c8c4ff]' : 'border-[#3c465c] text-[#c7d0dc] hover:bg-[#243047]'
                    }`}
                  >
                    Chọn vùng xóa
                  </button>
                  {pendingTrimRange && Math.abs(pendingTrimRange.end_ms - pendingTrimRange.start_ms) >= 100 && (
                    <button type="button" onClick={handleSavePendingTrim} className="rounded border border-[#635bff] bg-[#2a2550] px-2 py-1 text-[10px] font-normal normal-case text-[#c8c4ff] hover:bg-[#342f66]">
                      Xóa vùng đã chọn
                    </button>
                  )}
                  <span className="whitespace-nowrap text-[10px] font-normal normal-case text-[#7e8da5]">KEYFRAME KIM CƯƠNG = HÀNH ĐỘNG</span>
                  <button type="button" onClick={() => setTimelineOpen(false)} className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-1 text-[10px] font-normal normal-case text-[#c7d0dc] hover:bg-[#243047]">
                    <ChevronDown className="h-3 w-3" />
                    Ẩn timeline
                  </button>
                </div>
              </div>
            )}
          />
          <div className="overflow-x-auto px-4 pb-3 pt-3">
            <div className="h-24 min-w-[640px]">
              <TimelineComponent
                steps={steps}
                currentTime={previewCurrentTime}
                totalTime={totalTime || 20000}
                onSeek={handleSeek}
                selectingTrim={selectingTrim}
                pendingTrimRange={pendingTrimRange}
                onTrimRangeChange={(range) => setPendingTrimRange(normalizeTrimRanges([range], totalTime || 20000)[0] || null)}
              />
            </div>
          </div>
        </section>
      ) : (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-[#2a2d34] bg-[#14161b] px-3">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase text-[#7288ff]">
            <Timer className="h-3.5 w-3.5" />
            Timeline keyframes
          </span>
          <button type="button" onClick={() => setTimelineOpen(true)} className="inline-flex items-center gap-1 rounded border border-[#3c465c] px-2 py-1 text-[10px] text-[#c7d0dc] hover:bg-[#243047]">
            <ChevronRight className="h-3 w-3 rotate-[-90deg]" />
            Hiện timeline
          </button>
        </div>
      )}
    </div>
  );
}
