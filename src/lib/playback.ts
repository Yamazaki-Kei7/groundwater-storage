import type { Frame } from './data';
import { createFrameStore, type FrameLoader } from './frame-store';

export type PlaybackState = {
  index: number; requestedIndex: number; frame: Frame | null;
  loading: boolean; playing: boolean; error: string;
};

export const emptyPlayback: PlaybackState = {
  index: -1, requestedIndex: -1, frame: null, loading: false, playing: false, error: ''
};

export function createPlayback({ available, load, onChange, intervalMs = 800, maxBytes = 8 * 1024 * 1024, prefetchCount = 2 }: {
  available: readonly boolean[]; load: FrameLoader; onChange: (state: PlaybackState) => void;
  intervalMs?: number; maxBytes?: number; prefetchCount?: number;
}) {
  const store = createFrameStore({ load, maxBytes });
  let state = { ...emptyPlayback };
  let speed = 1;
  let displayedAt = 0;
  let disposed = false;
  let automatic = false;
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function update(patch: Partial<PlaybackState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    onChange(state);
  }

  function clearTimer() { clearTimeout(timer); timer = undefined; }

  function schedule() {
    clearTimer();
    if (!state.playing || state.loading || disposed || state.index < 0) return;
    if (state.index >= available.length - 1) { update({ playing: false }); return; }
    const wait = Math.max(0, displayedAt + intervalMs / speed - performance.now());
    timer = setTimeout(() => request(state.index + 1, true), wait);
  }

  function request(index: number, auto = false) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= available.length) return;
    clearTimer();
    active?.abort();
    const controller = new AbortController();
    active = controller;
    automatic = auto;
    const upcoming: number[] = [];
    for (let next = index + 1; next < available.length && upcoming.length < prefetchCount; next++) {
      if (available[next]) upcoming.push(next);
    }
    store.retain([index, ...upcoming]);
    update({ requestedIndex: index, loading: true, error: '' });

    const commit = (frame: Frame | null) => {
      if (disposed || controller.signal.aborted) return;
      active = null;
      displayedAt = performance.now();
      update({ index, frame, loading: false });
      schedule();
    };
    const cached = store.peek(index);
    if (!available[index]) commit(null);
    else if (cached) commit(cached);
    else void store.get(index, controller.signal).then(commit).catch(error => {
      if (disposed || controller.signal.aborted) return;
      active = null;
      update({ loading: false, playing: false, error: error instanceof Error ? error.message : 'Unable to load monthly data.' });
    });

    for (const next of upcoming) store.prefetch(next);
  }

  function pause() {
    clearTimer();
    if (automatic && state.loading) {
      active?.abort(); active = null;
      store.retain([]);
      update({ playing: false, loading: false, requestedIndex: state.index });
    } else update({ playing: false });
  }

  function select(index: number) { pause(); request(index); }

  function play() {
    if (disposed || !available.length) return;
    update({ playing: true, error: '' });
    displayedAt = performance.now();
    if (state.requestedIndex === available.length - 1 || (!state.loading && state.index < 0)) request(0, true);
    else schedule();
  }

  function setSpeed(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value === speed) return;
    speed = value;
    schedule();
  }

  function dispose() {
    disposed = true;
    clearTimer();
    active?.abort();
    store.dispose();
  }

  return { select, play, pause, setSpeed, retry: () => select(state.requestedIndex), dispose };
}
