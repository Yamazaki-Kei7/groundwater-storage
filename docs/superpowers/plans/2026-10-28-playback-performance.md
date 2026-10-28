# Monthly Playback Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce monthly playback latency and geometry regeneration while preserving scientific values and the globe/terrain UI.

**Architecture:** Keep the existing static monthly files. Separate immutable grid geometry from frame values, add a bounded frame store, and commit requested frames atomically on a playback deadline.

**Tech Stack:** Existing Svelte 5 / SvelteKit 3, TypeScript, MapLibre 6, deck.gl 9, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-playback-performance-design.md`

## Global Constraints

- Preserve Float32 values, uncertainty, missing months and NaN masks, cell IDs and CSV behavior.
- Preserve globe, terrain, Surface and 3D selection behavior; no new dependencies or services.
- No TypeScript any/unknown types or unnecessary classes.
- Work on `perf/monthly-playback`; the user approved execution of the concrete proposal. Keep changes reviewable in the shared checkout.

## Review Focus

- An older delayed response must not replace the final slider selection.
- A failed prefetch must remain retryable and must not interrupt playback of available frames.
- Cancelling one shared request must not abort another active consumer.
- Missing cells must neither draw nor pick, including after a previously valid month.
- Pause/speed changes during loading must not advance unexpectedly or skip months.

### Task 1: Bounded data cache

**Files:** create `src/lib/frame-store.ts`, `src/lib/frame-store.test.ts`.
**Interfaces:** `createFrameStore({load, maxBytes})` exposes `get(index, signal?)`, `peek(index)`, `retain(indices)`, `prefetch(index)`, `dispose()`; load returns `Promise<Frame>` and receives an AbortSignal.

- [x] Write and run failing tests for concurrent reuse, LRU eviction by bytes, independent cancellation, aborted stale completion, failure recovery and disposal.
- [x] Implement the bounded store; run the suite.

### Task 2: Stable rendering

**Files:** modify `src/lib/components/GroundwaterMap.svelte`, `src/routes/+page.svelte`; add focused frame accessor tests if helpers are extracted.
**Interfaces:** map consumes stable `cells: Cell[]`, `frame: Frame | null`, `selectedIndex: number | null`.

- [x] Measure the original browser behavior and save the benchmark scenario.
- [x] Use stable cells as PolygonLayer data and frame-dependent updateTriggers for colors/elevations; reject nonfinite values during picking.
- [x] Restrict terrain sampling to relevant changes, then verify the browser no longer regenerates geometry on ordinary month changes.

### Task 3: Atomic frame switching and playback

**Files:** create `src/lib/playback.ts` and tests; modify `src/routes/+page.svelte`.
**Interfaces:** a playback controller consumes an asynchronous frame loader and emits committed `{index, frame}` snapshots plus pending/error state; cancellation and timing stay independent of the view.

- [x] Write and run failing tests for delayed/reordered loads, missing months, retained display on error, pause/speed changes and non-accumulating deadlines.
- [x] Integrate bounded prefetch and atomic display commits; retain chart/slider/CSV correctness.
- [x] Run the suite, Svelte checks, production build and the same browser benchmark; exercise selection, missing months, failures and mobile layout.

### Task 4: Review and verification record

**Files:** update `README.md`, `docs/verification.md` and this plan.

- [x] Obtain an independent whole-change review and address material findings with regression coverage.
- [x] Record comparable timings and limitations, run final checks and summarize local changes.

## Execution ledger

- Baseline: clean main checkout; created `perf/monthly-playback`. Existing 14 tests pass.
- Ruling: execute in the current clean checkout on a dedicated branch to keep the authorized changes visible to the user; no worktree migration or additional approval round.
- Pre-flight: Task 1 provides Frame loading to Task 3. Task 2 consumes only committed frames from Task 3, so requested UI state cannot contaminate map values.
- Task 1 complete: bounded LRU, shared downloads, independent subscriber cancellation, stale completion rejection; 21 tests passed.
- Task 3 implemented before Task 2 integration to keep requested/displayed month semantics in one testable controller. Cache defaults: 8 MiB, two upcoming observed months, up to three concurrent monthly requests.
- Ruling: exclude individual missing cells from geometry instead of merely setting alpha to zero; transparent polygons could still affect picking/depth. `cell-geometry.ts` preserves the exact array while the finite-value mask is unchanged and rebuilds only when that mask changes.
- Tasks 2/3 complete: 31 tests and typecheck passed, identical browser benchmark showed no geometry regeneration or blank frames on month switches.
- Review fixes: initial Play during a final-month load now restarts at month zero; cancelled prefetches deduplicate against live store entries rather than a separately tracked Set. Both failures reproduced before fixes; added intermediate-month/speed-change coverage. 34 tests and typecheck passed.
- Browser regression passed source cell IDs/known values, CSV, missing recovery, delayed/error/retry atomicity, rapid selection, globe 3D/Surface picking, terrain exaggeration and mobile width. Test harness corrections: wait for sampled terrain bases to match the loaded DEM; allow scrollbar width in overflow assertions.
- Task 4 complete: review fixes independently confirmed. Final code passes 34 tests, Svelte checks and subpath production build. Production preview verified initial Play during loading and correct selected values/series. Entire 258-month playback completed in 51.750 s without missing/reordered months, additional geometry generation or runtime errors; measurements and caveats recorded in `docs/verification.md`.
- Keep the implementation on the local feature branch; deployment/integration was not requested.
