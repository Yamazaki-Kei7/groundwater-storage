import { describe, expect, it } from 'vitest';
import { createCellGeometry } from './cell-geometry';
import type { Frame } from './data';

const frame = (values: number[]): Frame => ({values:new Float32Array(values),uncertainty:new Float32Array(values.length)});
describe('stable cell geometry', () => {
  const cells = [{lon:10,lat:20},{lon:11,lat:20},{lon:12,lat:20}];
  it('reuses the identical geometry when values change but valid cells do not', () => {
    const geometry = createCellGeometry(cells);
    const first = geometry.forFrame(frame([1,0,-3]));
    expect(geometry.forFrame(frame([-5,10,0]))).toBe(first);
    expect(geometry.forFrame(null)).toBe(first);
    expect(geometry.forFrame(frame([3,2,1]))).toBe(first);
  });
  it('excludes missing cells and preserves original IDs across mask changes', () => {
    const geometry = createCellGeometry(cells);
    const first = geometry.forFrame(frame([1,NaN,0]));
    expect(first).toEqual([{lon:10,lat:20,index:0},{lon:12,lat:20,index:2}]);
    expect(geometry.forFrame(frame([-3,NaN,5]))).toBe(first);
    const changed = geometry.forFrame(frame([NaN,1,0]));
    expect(changed.map(cell => cell.index)).toEqual([1,2]);
    expect(changed[1]).toBe(first[1]);
    expect(geometry.forFrame(frame([NaN,NaN,NaN]))).toEqual([]);
  });
});
