import { describe, expect, it } from 'vitest';
import { createFrameStore } from './frame-store';
import type { Frame } from './data';

const frame = (value: number): Frame => ({ values: new Float32Array([value]), uncertainty: new Float32Array([2]) });

function deferredLoader() {
  const requests: { index: number; signal: AbortSignal; resolve: (value: Frame) => void; reject: (reason: Error) => void }[] = [];
  const load = (index: number, signal: AbortSignal) => new Promise<Frame>((resolve, reject) => {
    requests.push({ index, signal, resolve, reject });
  });
  return { load, requests };
}

describe('bounded decoded frame store', () => {
  it('shares in-flight downloads and decoded arrays for repeated months', async () => {
    const { load, requests } = deferredLoader();
    const store = createFrameStore({ load, maxBytes: 16 });
    const first = store.get(0), second = store.get(0);
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    const data = frame(-4);
    requests[0].resolve(data);
    expect(await first).toBe(data);
    expect(await second).toBe(data);
    expect(await store.get(0)).toBe(data);
    expect(requests).toHaveLength(1);
  });

  it('evicts the least recently read frame within a decoded byte budget', async () => {
    const store = createFrameStore({ load: async index => frame(index), maxBytes: 16 });
    await store.get(0); await store.get(1); await store.get(0); await store.get(2);
    expect(store.peek(0)?.values[0]).toBe(0);
    expect(store.peek(1)).toBeUndefined();
    expect(store.peek(2)?.values[0]).toBe(2);
  });

  it('returns an oversized frame without keeping it in the cache', async () => {
    const store = createFrameStore({ load: async () => frame(3), maxBytes: 4 });
    expect((await store.get(0)).values[0]).toBe(3);
    expect(store.peek(0)).toBeUndefined();
  });

  it('does not abort another consumer when one cancels a shared download', async () => {
    const { load, requests } = deferredLoader();
    const store = createFrameStore({ load, maxBytes: 16 });
    const controller = new AbortController();
    const cancelled = store.get(0, controller.signal);
    const active = store.get(0);
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort();
    await rejection;
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve(frame(7));
    expect((await active).values[0]).toBe(7);
  });

  it('discards a cancelled late response and allows a fresh request for that month', async () => {
    const { load, requests } = deferredLoader();
    const store = createFrameStore({ load, maxBytes: 16 });
    const controller = new AbortController();
    const first = store.get(0, controller.signal);
    const rejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    controller.abort(); await rejection;
    expect(requests[0].signal.aborted).toBe(true);
    const second = store.get(0);
    await Promise.resolve();
    requests[0].resolve(frame(99));
    requests[1].resolve(frame(2));
    expect((await second).values[0]).toBe(2);
    expect(store.peek(0)?.values[0]).toBe(2);
  });

  it('makes failed downloads retryable', async () => {
    let fail = true;
    const store = createFrameStore({ load: async () => { if (fail) throw new Error('offline'); return frame(1); }, maxBytes: 16 });
    await expect(store.get(0)).rejects.toThrow('offline');
    fail = false;
    expect((await store.get(0)).values[0]).toBe(1);
  });

  it('cancels obsolete prefetches without losing retained downloads', async () => {
    const { load, requests } = deferredLoader();
    const store = createFrameStore({ load, maxBytes: 16 });
    const obsolete = store.get(0), retained = store.get(1);
    const rejection = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    store.retain([1]);
    await rejection;
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve(frame(1));
    await retained;
    store.dispose();
    expect(store.peek(1)).toBeUndefined();
    await expect(store.get(1)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
