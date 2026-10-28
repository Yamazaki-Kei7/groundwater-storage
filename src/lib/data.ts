export type Cell = { lon: number; lat: number };
export type Frame = { values: Float32Array; uncertainty: Float32Array };
export type MapCell = Cell & { index: number; value: number; uncertainty: number };
export type Manifest = {
  schemaVersion: number;
  ready: boolean;
  title: string;
  sourceUrl: string;
  version: string;
  units: string;
  baseline: string;
  baselinePeriod: string;
  resolution: number;
  effectiveResolutionKm: string;
  months: string[];
  available: boolean[];
  cellCount: number;
  seriesChunkSize: number;
  colorLimit: number;
  sourceSha256?: string;
  generatedAt?: string;
};

export const normalizeLongitude = (lon: number): number => ((lon + 180) % 360 + 360) % 360 - 180;

export function nearestCell(cells: Cell[], lon: number, lat: number): number | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const radians = Math.PI / 180;
  let nearest: number | null = null;
  let minimum = Infinity;
  cells.forEach((cell, i) => {
    const distance = Math.sin((cell.lat - lat) * radians / 2) ** 2
      + Math.cos(lat * radians) * Math.cos(cell.lat * radians) * Math.sin((cell.lon - lon) * radians / 2) ** 2;
    if (distance < minimum) { minimum = distance; nearest = i; }
  });
  return nearest;
}

export function decodeFrame(buffer: ArrayBuffer, cellCount: number): Frame {
  if (buffer.byteLength !== cellCount * 2 * 4) throw new Error('データの長さが格子数と一致しません。');
  const view = new DataView(buffer);
  const values = new Float32Array(cellCount);
  const uncertainty = new Float32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    values[i] = view.getFloat32(i * 4, true);
    uncertainty[i] = view.getFloat32((i + cellCount) * 4, true);
  }
  return { values, uncertainty };
}

export function decodeSeries(buffer: ArrayBuffer, localIndex: number, chunkCells: number, monthCount: number): Frame {
  const decoded = decodeFrame(buffer, chunkCells * monthCount);
  if (localIndex < 0 || localIndex >= chunkCells) throw new Error('地点インデックスが範囲外です。');
  const start = localIndex * monthCount;
  return { values: decoded.values.slice(start, start + monthCount), uncertainty: decoded.uncertainty.slice(start, start + monthCount) };
}

export function frameCells(cells: Cell[], frame: Frame | null): MapCell[] {
  if (!frame) return [];
  return cells.flatMap((cell, index) => Number.isFinite(frame.values[index])
    ? [{ ...cell, index, value: frame.values[index], uncertainty: frame.uncertainty[index] }] : []);
}

export function chartPaths(values: ArrayLike<number>, width: number, height: number, limit: number): string[] {
  const paths: string[] = [];
  let current = '';
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) { if (current) paths.push(current); current = ''; continue; }
    const x = i * width / Math.max(values.length - 1, 1);
    const y = height / 2 - values[i] * height / (2 * Math.max(limit, 1));
    current += `${current ? ' L' : 'M'}${x},${y}`;
  }
  if (current) paths.push(current);
  return paths;
}

export function seriesCsv(months: string[], frame: Frame): string {
  const field = (n: number): string => Number.isFinite(n) ? String(n) : '';
  return ['month,gwsc_mm,gwsc_uncertainty_mm', ...months.map((month, i) => `${month},${field(frame.values[i])},${field(frame.uncertainty[i])}`)].join('\n');
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（HTTP ${response.status}）。`);
  return response.json() as Promise<T>;
}

export async function loadBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`データを取得できません（HTTP ${response.status}）。`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Vite sends Content-Encoding: gzip; Pages can serve the gzip file itself.
  // Inspect the delivered bytes to avoid decompressing an already decoded response.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) return buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function loadFrame(root: string, month: string, count: number, signal?: AbortSignal): Promise<Frame> {
  return decodeFrame(await loadBinary(`${root}/frames/${month}.bin.gz`, signal), count);
}

export async function loadSeries(root: string, index: number, manifest: Manifest, signal?: AbortSignal): Promise<Frame> {
  const chunk = Math.floor(index / manifest.seriesChunkSize);
  const chunkCells = Math.min(manifest.seriesChunkSize, manifest.cellCount - chunk * manifest.seriesChunkSize);
  return decodeSeries(await loadBinary(`${root}/series/${chunk}.bin.gz`, signal), index % manifest.seriesChunkSize, chunkCells, manifest.months.length);
}

export const displayValue = (n: number | undefined): string => n !== undefined && Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(1)}` : '—';
