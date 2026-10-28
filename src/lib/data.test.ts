import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrame, decodeSeries, chartPaths, loadBinary, nearestCell, normalizeLongitude, seriesCsv } from './data';

afterEach(() => vi.unstubAllGlobals());

describe('static gzip delivery', () => {
  it('accepts a response already decompressed by the HTTP client', async () => {
    const bytes = new Float32Array([-4, 3]).buffer;
    vi.stubGlobal('fetch', async () => new Response(bytes, {headers: {'Content-Encoding': 'gzip'}}));
    expect(await loadBinary('/frame.bin.gz')).toEqual(bytes);
  });
  it('decompresses a gzip file served without Content-Encoding', async () => {
    const bytes = new Float32Array([-4, 3]).buffer;
    const packed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    vi.stubGlobal('fetch', async () => new Response(packed));
    expect(await loadBinary('/frame.bin.gz')).toEqual(bytes);
  });
});

describe('scientific data integrity', () => {
  it('finds the nearest cell across the date line and rejects invalid coordinates', () => {
    expect(nearestCell([{lon: -179, lat: 10}, {lon: 170, lat: 10}], 179.8, 10)).toBe(0);
    expect(nearestCell([], 0, 0)).toBeNull();
    expect(nearestCell([{lon: 0, lat: 0}], NaN, 0)).toBeNull();
    expect(nearestCell([{lon: 0, lat: 0}], 0, 91)).toBeNull();
  });
  it('preserves negative anomalies, zero and missing values separately', () => {
    const frame = decodeFrame(new Float32Array([-30, 0, NaN, 5, 6, NaN]).buffer, 3);
    expect(frame.values[0]).toBe(-30);
    expect(frame.values[1]).toBe(0);
    expect(frame.values[2]).toBeNaN();
    expect(frame.uncertainty[0]).toBe(5);
  });
  it('rejects incomplete binary responses instead of mapping wrong cells', () => {
    expect(() => decodeFrame(new ArrayBuffer(8), 3)).toThrow();
  });
  it('normalizes longitudes around the date line', () => {
    expect(normalizeLongitude(350)).toBe(-10);
    expect(normalizeLongitude(-179.75)).toBe(-179.75);
    expect(normalizeLongitude(180)).toBe(-180);
  });
  it('reads cell-major series blocks with separate uncertainty plane', () => {
    const result = decodeSeries(new Float32Array([1, 2, -4, NaN, 5, 6, 7, 8]).buffer, 1, 2, 2);
    expect(Array.from(result.values).slice(0, 1)).toEqual([-4]);
    expect(result.values[1]).toBeNaN();
    expect(Array.from(result.uncertainty)).toEqual([7, 8]);
  });
  it('does not connect a line across missing months', () => {
    expect(chartPaths([10, NaN, -10, 0], 300, 100, 10)).toEqual(['M0,0', 'M200,100 L300,50']);
  });
  it('exports missing values as empty CSV fields and keeps the sign', () => {
    const csv = seriesCsv(['2002-04', '2002-05'], {values: new Float32Array([-4, NaN]), uncertainty: new Float32Array([3, NaN])});
    expect(csv).toContain('2002-04,-4,3');
    expect(csv).toContain('2002-05,,');
  });
});
