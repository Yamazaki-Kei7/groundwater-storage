import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayback, type PlaybackState } from './playback';
import type { Frame } from './data';
import type { FrameLoader } from './frame-store';

const frame = (index: number): Frame => ({values: new Float32Array([index]), uncertainty: new Float32Array([1])});
function setup(load: FrameLoader, available = [true, true, true, true, true]) {
  const states: PlaybackState[] = [];
  const player = createPlayback({load, available, onChange: state => states.push(state), intervalMs: 200, maxBytes: 64, prefetchCount: 2});
  return { player, states, current: () => states.at(-1)! };
}

beforeEach(() => vi.useFakeTimers({toFake:['setTimeout', 'clearTimeout', 'performance']}));
afterEach(() => vi.useRealTimers());

describe('atomic monthly playback', () => {
  it('restarts at the first month when play is pressed while the final month is loading', async () => {
    const {player,current} = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)),100)));
    player.select(4); await vi.advanceTimersByTimeAsync(1); player.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(current()).toMatchObject({index:0,playing:true,loading:false});
    player.dispose();
  });

  it('keeps an intermediate requested month when play and speed change during loading', async () => {
    const {player,current} = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)),100)));
    player.select(2); await vi.advanceTimersByTimeAsync(1); player.play(); player.setSpeed(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(current()).toMatchObject({index:2,playing:true});
    await vi.advanceTimersByTimeAsync(99); expect(current().index).toBe(2);
    await vi.advanceTimersByTimeAsync(1); expect(current().index).toBe(3);
    player.dispose();
  });

  it('immediately restarts cancelled prefetches after a rapid round trip', async () => {
    const calls: number[] = [];
    const {player,current} = setup(index => {calls.push(index); return new Promise(resolve => setTimeout(() => resolve(frame(index)),100));});
    player.select(0); await vi.advanceTimersByTimeAsync(1);
    player.select(4); player.select(0); await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter(index=>index===1)).toHaveLength(2);
    expect(calls.filter(index=>index===2)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100); expect(current().index).toBe(0);
    player.dispose();
  });

  it('keeps the old date and values until the requested frame is ready', async () => {
    const { player, current } = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)), 100)));
    player.select(0);
    await vi.advanceTimersByTimeAsync(100);
    player.select(4);
    expect(current()).toMatchObject({index:0, requestedIndex:4, loading:true});
    expect(current().frame?.values[0]).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(current()).toMatchObject({index:4, requestedIndex:4, loading:false});
    expect(current().frame?.values[0]).toBe(4);
    player.dispose();
  });

  it('never commits an older response after a rapid slider change', async () => {
    const { player, current } = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)), index === 0 ? 500 : 30)));
    player.select(0);
    await vi.advanceTimersByTimeAsync(1);
    player.select(4);
    await vi.advanceTimersByTimeAsync(30);
    expect(current().index).toBe(4);
    await vi.advanceTimersByTimeAsync(500);
    expect(current().index).toBe(4);
    expect(current().frame?.values[0]).toBe(4);
    player.dispose();
  });

  it('overlaps loading with the display interval instead of adding both delays', async () => {
    const committed: { index: number; at: number }[] = [];
    let last = -1;
    const player = createPlayback({
      available:[true,true,true,true], intervalMs:200, maxBytes:64, prefetchCount:2,
      load:index => new Promise(resolve => setTimeout(() => resolve(frame(index)), 120)),
      onChange:state => { if (state.frame && state.index !== last) { last=state.index; committed.push({index:last, at:performance.now()}); } }
    });
    player.select(0);
    await vi.advanceTimersByTimeAsync(120);
    player.play();
    await vi.advanceTimersByTimeAsync(600);
    expect(committed).toEqual([{index:0,at:120},{index:1,at:320},{index:2,at:520},{index:3,at:720}]);
    player.dispose();
  });

  it('preserves missing months in playback without requesting their files', async () => {
    const requested: number[] = [];
    const {player,current,states} = setup(async index => {requested.push(index); return frame(index);}, [true,false,false,true]);
    player.select(0); await vi.advanceTimersByTimeAsync(0); player.play();
    await vi.advanceTimersByTimeAsync(200);
    expect(current()).toMatchObject({index:1,frame:null});
    await vi.advanceTimersByTimeAsync(200);
    expect(current()).toMatchObject({index:2,frame:null});
    await vi.advanceTimersByTimeAsync(200);
    expect(current()).toMatchObject({index:3,playing:false});
    expect(requested).toEqual([0,3]);
    expect(states.some(state => state.index === 1 && state.frame !== null)).toBe(false);
    player.dispose();
  });

  it('retains the displayed frame on failure and retries a failed prefetch', async () => {
    let fail = true;
    const {player,current} = setup(async index => {if(index === 1 && fail) throw new Error('offline'); return frame(index);});
    player.select(0); await vi.advanceTimersByTimeAsync(0);
    expect(current().error).toBe('');
    player.select(1); await vi.advanceTimersByTimeAsync(0);
    expect(current()).toMatchObject({index:0,requestedIndex:1,loading:false,playing:false,error:'offline'});
    expect(current().frame?.values[0]).toBe(0);
    fail = false; player.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(current()).toMatchObject({index:1,error:''});
    player.dispose();
  });

  it('pauses an overdue automatic load without a late advance', async () => {
    const {player,current} = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)), index === 1 ? 1000 : 0)));
    player.select(0); await vi.advanceTimersByTimeAsync(0); player.play();
    await vi.advanceTimersByTimeAsync(200);
    expect(current().loading).toBe(true);
    player.pause();
    expect(current()).toMatchObject({index:0,requestedIndex:0,loading:false,playing:false});
    await vi.advanceTimersByTimeAsync(1200);
    expect(current().index).toBe(0);
    player.dispose();
  });

  it('reschedules a speed change without skipping frames and restarts from the end', async () => {
    const {player,current} = setup(async index => frame(index), [true,true,true]);
    player.select(0); await vi.advanceTimersByTimeAsync(0); player.play();
    await vi.advanceTimersByTimeAsync(50); player.setSpeed(2);
    await vi.advanceTimersByTimeAsync(49); expect(current().index).toBe(0);
    await vi.advanceTimersByTimeAsync(1); expect(current().index).toBe(1);
    await vi.advanceTimersByTimeAsync(100); expect(current()).toMatchObject({index:2,playing:false});
    player.play(); await vi.advanceTimersByTimeAsync(0);
    expect(current()).toMatchObject({index:0,playing:true});
    player.dispose();
  });

  it('stops requests and state updates on disposal', async () => {
    const {player,states} = setup(index => new Promise(resolve => setTimeout(() => resolve(frame(index)),100)));
    player.select(0); await vi.advanceTimersByTimeAsync(1); player.dispose();
    const count = states.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toHaveLength(count);
  });
});
