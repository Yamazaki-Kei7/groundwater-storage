import { describe, expect, it } from 'vitest';
import { _GlobeViewport as GlobeViewport } from '@deck.gl/core';
import { isGlobePositionVisible } from './globe';

describe('globe picking occlusion', () => {
  const viewport = new GlobeViewport({ width: 800, height: 600, longitude: 15, latitude: 15, zoom: 0.7 });

  it('accepts the visible surface and elevated columns', () => {
    expect(isGlobePositionVisible(viewport, [15, 15, 0])).toBe(true);
    expect(isGlobePositionVisible(viewport, [15, 15, 200000])).toBe(true);
  });

  it('rejects the antipode and far-side cells found by the picking buffer', () => {
    expect(isGlobePositionVisible(viewport, [-165, -15, 0])).toBe(false);
    expect(isGlobePositionVisible(viewport, [-104.75, 20.25, 200000])).toBe(false);
    expect(isGlobePositionVisible(viewport, [98.25, 2.25, 0])).toBe(false);
  });

  it('keeps a tall column selectable when its top clears the horizon', () => {
    expect(isGlobePositionVisible(viewport, [98.25, 2.25, 200000])).toBe(true);
  });

  it('rejects a hidden lower side even when the same column top is visible', () => {
    expect(isGlobePositionVisible(viewport, [-70.25, -4.75, 164886])).toBe(true);
    expect(isGlobePositionVisible(viewport, [-70.25, -4.75, 16488])).toBe(false);
  });

  it('uses the actual camera after rotation and tilt', () => {
    const rotated = new GlobeViewport({ width: 800, height: 600, longitude: -105, latitude: 37, zoom: 3, pitch: 45, bearing: 30 });
    expect(isGlobePositionVisible(rotated, [-105, 37, 0])).toBe(true);
    expect(isGlobePositionVisible(rotated, [75, -37, 0])).toBe(false);
  });
});
