---
name: Fix Record Window & Timeline
overview: "Fix three issues in the recorder: (1) Chromium record window still on top after page loads, (2) timeline shifted because screenshot timer starts before page load causing wrong time_offset anchors, (3) preview image can grow to cover the playback control bar."
todos:
  - id: fix-ontop
    content: "RecorderService.js: add delayed _releaseBrowserTopMost() retry 1s after goto to handle Chromium reasserting topmost after first paint"
    status: completed
  - id: fix-timeline
    content: "RecorderService.js: move screenshot timer start and reset startTime/lastEventTime to after page.goto domcontentloaded"
    status: completed
  - id: fix-preview-height
    content: "ScenarioEditor.jsx: add min-h-0 overflow-hidden to monitor wrapper and shrink-0 to control bar div"
    status: completed
isProject: false
---

# Fix Record Window, Timeline Drift & Preview Height

## Issue 1 — Record Window Still On Top

**File:** [`src/main/rpa/RecorderService.js`](src/main/rpa/RecorderService.js) (~line 167)

`_releaseBrowserTopMost` is already called 3 times, but Chromium re-asserts the topmost flag after its first paint and after navigation completes. Fix: add a 1-second delayed retry after the last release (post-`domcontentloaded`).

```167:168:src/main/rpa/RecorderService.js
await this._releaseBrowserTopMost();
await this.page.evaluate(this._getInjectionScript()).catch(() => {});
```

Change to call `_releaseBrowserTopMost` once more with a 1-second delay after goto, so:
```javascript
await this._releaseBrowserTopMost();
// Chromium re-asserts topmost after first paint; release again after render settles
setTimeout(() => this._releaseBrowserTopMost().catch(() => {}), 1000);
await this.page.evaluate(this._getInjectionScript()).catch(() => {});
```

---

## Issue 2 — Timeline Drift (startTime Before Page Loads)

**File:** [`src/main/rpa/RecorderService.js`](src/main/rpa/RecorderService.js) (~lines 84, 159–166)

**Root cause:** `startTime` and `lastEventTime` are set at line 84 — before Puppeteer even launches the browser. The screenshot timer also starts at line 159 — before `page.goto`. This means:
- Captured frames 1–N cover the blank/loading period
- The first user action's `time_offset` is something like 8000ms (URL load time included)
- But `delay_ms` in saved steps is hardcoded 300ms, so timeline keyframes cluster at the start while `time_offset`-anchored preview frames are 8+ seconds in

**Fix:** Move the screenshot timer and reset `startTime`/`lastEventTime` to **after** `domcontentloaded`:

```javascript
// REMOVE from current position (line 159–161):
this._screenshotTimer = setInterval(() => { ... }, 250);

await this.page.goto(safeScenario.target_url, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
// ADD after goto:
this.startTime = Date.now();        // reset anchor to post-load
this.lastEventTime = this.startTime;
this._screenshotTimer = setInterval(() => {
  this._lastScreenshotPromise = this._takeScreenshot();
}, 250);
```

This ensures:
- No blank/loading frames pollute the manifest
- `time_offset` values for user actions are relative to page-ready, matching normal `delay_ms` ranges
- `manifestDuration` and step `time_offset` are on the same clock

---

## Issue 3 — Preview Image Covers Control Bar

**File:** [`src/renderer/components/ScenarioEditor.jsx`](src/renderer/components/ScenarioEditor.jsx) (~lines 1255, 1269)

`ProgramMonitor` has `flex-none` and `aspect-video` — its height is derived from width (up to 720px wide → up to 405px tall). The monitor wrapper has `flex-1` but no `min-h-0`, so it can overflow and push the control bar out of view.

Two targeted changes:

1. **Monitor wrapper (line 1255):** add `min-h-0 overflow-hidden` so flex shrinking works correctly:
```jsx
// Before:
<div className="mx-auto flex w-full max-w-[720px] flex-1 items-center">
// After:
<div className="mx-auto flex w-full max-w-[720px] min-h-0 flex-1 items-center overflow-hidden">
```

2. **Control bar (line 1269):** add `shrink-0` so it is never compressed or pushed off:
```jsx
// Before:
<div className="mt-3 flex items-center justify-between">
// After:
<div className="mt-3 flex shrink-0 items-center justify-between">
```
