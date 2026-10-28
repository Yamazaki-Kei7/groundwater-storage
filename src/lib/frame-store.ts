import type { Frame } from './data';

export type FrameLoader = (index: number, signal: AbortSignal) => Promise<Frame>;
type PendingFrame = { controller: AbortController; promise: Promise<Frame>; readers: number };
const aborted = () => new DOMException('Frame request cancelled.', 'AbortError');

/** Shares decoded frames and in-flight requests; the budget excludes active callers' references. */
export function createFrameStore({ load, maxBytes }: { load: FrameLoader; maxBytes: number }) {
  const cache = new Map<number, Frame>();
  const pending = new Map<number, PendingFrame>();
  let bytes = 0;
  let disposed = false;
  const size = (frame: Frame) => frame.values.byteLength + frame.uncertainty.byteLength;

  function peek(index: number): Frame | undefined {
    const frame = cache.get(index);
    if (frame) { cache.delete(index); cache.set(index, frame); }
    return frame;
  }

  function cancel(index: number, entry: PendingFrame) {
    if (pending.get(index) === entry) pending.delete(index);
    entry.controller.abort();
  }

  function get(index: number, signal?: AbortSignal): Promise<Frame> {
    if (disposed || signal?.aborted) return Promise.reject(aborted());
    const cached = peek(index);
    if (cached) return Promise.resolve(cached);
    let entry = pending.get(index);
    if (!entry) {
      const controller = new AbortController();
      let rejectAbort: () => void = () => {};
      const cancellation = new Promise<Frame>((_resolve, reject) => {
        rejectAbort = () => reject(aborted());
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      const promise = Promise.race([
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return load(index, controller.signal); }),
        cancellation
      ]).then(frame => {
        controller.signal.throwIfAborted();
        const frameBytes = size(frame);
        if (frameBytes <= maxBytes) {
          while (bytes + frameBytes > maxBytes && cache.size) {
            const oldest = cache.entries().next().value;
            if (!oldest) break;
            bytes -= size(oldest[1]);
            cache.delete(oldest[0]);
          }
          cache.set(index, frame);
          bytes += frameBytes;
        }
        return frame;
      }).finally(() => {
        controller.signal.removeEventListener('abort', rejectAbort);
        if (pending.get(index)?.controller === controller) pending.delete(index);
      });
      entry = { controller, promise, readers: 0 };
      pending.set(index, entry);
    }
    const request = entry;
    request.readers++;
    return new Promise<Frame>((resolve, reject) => {
      let settled = false;
      const release = () => {
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        request.readers--;
        if (!request.readers && pending.get(index) === request) cancel(index, request);
      };
      const onAbort = () => { if (!settled) { release(); reject(aborted()); } };
      signal?.addEventListener('abort', onAbort, { once: true });
      request.promise.then(
        frame => { if (!settled) { release(); resolve(frame); } },
        error => { if (!settled) { release(); reject(error); } }
      );
    });
  }

  function retain(indices: readonly number[]) {
    const keep = new Set(indices);
    for (const [index, entry] of pending) if (!keep.has(index)) cancel(index, entry);
  }

  function prefetch(index: number) {
    if (disposed || cache.has(index) || pending.has(index)) return;
    // A speculative failure is retried by the next foreground get().
    void get(index).catch(() => {});
  }

  function dispose() {
    disposed = true;
    retain([]);
    cache.clear();
    bytes = 0;
  }

  return { get, peek, retain, prefetch, dispose };
}
