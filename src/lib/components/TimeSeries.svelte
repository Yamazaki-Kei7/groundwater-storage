<script lang="ts">
  import { chartPaths, displayValue } from '#lib/data.ts';
  import type { Frame } from '#lib/data.ts';
  let { months, series, index, onchange }: { months: string[]; series: Frame; index: number; onchange: (index: number) => void } = $props();
  const width = 600, height = 170;
  let limit = $derived(Math.max(10, ...Array.from(series.values, (v, i) => Number.isFinite(v) ? Math.abs(v) + (Number.isFinite(series.uncertainty[i]) ? series.uncertainty[i] : 0) : 0)));
  let paths = $derived(chartPaths(series.values, width, height, limit));
  let upper = $derived(chartPaths(Array.from(series.values, (v, i) => v + series.uncertainty[i]), width, height, limit));
  let lower = $derived(chartPaths(Array.from(series.values, (v, i) => v - series.uncertainty[i]), width, height, limit));
  let currentX = $derived(index * width / Math.max(months.length - 1, 1));
  let currentY = $derived(height / 2 - series.values[index] * height / (2 * limit));
  function choose(event: MouseEvent) {
    const bounds = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (bounds) onchange(Math.max(0, Math.min(months.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (months.length - 1)))));
  }
</script>

<div class="chart-labels"><span>+{Math.ceil(limit)} mm</span><span>Anomaly</span></div>
<button class="chart" aria-label="Time series. Click to select a month, or use the observation month slider with the keyboard." onclick={choose}>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${months[index]} anomaly ${displayValue(series.values[index])} mm`}>
    <line x1="0" x2={width} y1="0" y2="0" class="grid" />
    <line x1="0" x2={width} y1={height / 2} y2={height / 2} class="zero" />
    <line x1="0" x2={width} y1={height} y2={height} class="grid" />
    {#each upper.concat(lower) as path}<path d={path} class="uncertainty" />{/each}
    {#each paths as path}<path d={path} class="series" />{/each}
    <line x1={currentX} x2={currentX} y1="0" y2={height} class="cursor" />
    {#if Number.isFinite(series.values[index])}<circle cx={currentX} cy={currentY} r="4" fill="#21647d" />{/if}
  </svg>
</button>
<div class="chart-labels"><span>−{Math.ceil(limit)} mm</span><span>Dashed: ± uncertainty</span></div>
<div class="chart-years"><span>{months[0]?.slice(0, 4)}</span><span>{months[Math.floor(months.length / 2)]?.slice(0, 4)}</span><span>{months.at(-1)?.slice(0, 4)}</span></div>

<style>
  .chart { display: block; width: 100%; background: transparent; border: 0; padding: 10px 0; cursor: crosshair; }
  svg { width: 100%; overflow: visible; }
  .chart-labels, .chart-years { display: flex; justify-content: space-between; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
  .chart-years { margin-top: 10px; }
  path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
  .series { stroke: var(--accent); stroke-width: 1.7; }
  .uncertainty { stroke: #84939c; stroke-width: 1; stroke-dasharray: 3 3; opacity: .65; }
  .grid { stroke: var(--border); stroke-dasharray: 3 5; }
  .zero { stroke: #bac4cb; }
  .cursor { stroke: #52636e; opacity: .6; stroke-dasharray: 4 4; }
</style>
