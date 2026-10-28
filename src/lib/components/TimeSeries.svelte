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

<div class="chart-labels"><span>+{Math.ceil(limit)} mm</span><span>貯留量偏差 / 不確実性</span></div>
<button class="chart" aria-label="時系列グラフ。クリックで月を選択。キーボードでは下の月スライダーを使用" onclick={choose}>
  <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${months[index]}の偏差 ${displayValue(series.values[index])} mm`}>
    <line x1="0" x2={width} y1="0" y2="0" class="grid" />
    <line x1="0" x2={width} y1={height / 2} y2={height / 2} class="zero" />
    <line x1="0" x2={width} y1={height} y2={height} class="grid" />
    {#each upper.concat(lower) as path}<path d={path} class="uncertainty" />{/each}
    {#each paths as path}<path d={path} class="series" />{/each}
    <line x1={currentX} x2={currentX} y1="0" y2={height} class="cursor" />
    {#if Number.isFinite(series.values[index])}<circle cx={currentX} cy={currentY} r="4" fill="#f3fafc" />{/if}
  </svg>
</button>
<div class="chart-labels"><span>−{Math.ceil(limit)} mm</span><span>破線：値 ± 提供された不確実性</span></div>
<div class="chart-years"><span>{months[0]?.slice(0, 4)}</span><span>{months[Math.floor(months.length / 2)]?.slice(0, 4)}</span><span>{months.at(-1)?.slice(0, 4)}</span></div>

<style>
  .chart { display: block; width: 100%; background: transparent; border: 0; padding: 10px 0; cursor: crosshair; }
  svg { width: 100%; overflow: visible; }
  .chart-labels, .chart-years { display: flex; justify-content: space-between; color: #9baebd; font-size: 10px; font-variant-numeric: tabular-nums; }
  .chart-years { margin-top: 10px; }
  path { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
  .series { stroke: #5fcee9; stroke-width: 1.7; }
  .uncertainty { stroke: #6e899a; stroke-width: 1; stroke-dasharray: 3 3; opacity: .65; }
  .grid { stroke: #283f4d; stroke-dasharray: 3 5; }
  .zero { stroke: #4c6575; }
  .cursor { stroke: #e8f2f8; opacity: .6; stroke-dasharray: 4 4; }
</style>
