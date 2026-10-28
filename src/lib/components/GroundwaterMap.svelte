<script lang="ts">
  import { onMount } from 'svelte';
  import type { Map as LibreMap } from 'maplibre-gl';
  import { MapboxOverlay } from '@deck.gl/mapbox';
  import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
  import type { PickingInfo } from '@deck.gl/core';
  import type { Cell, MapCell } from '#lib/data.ts';
  import { displayValue } from '#lib/data.ts';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

  type Region = { lon: number; lat: number; zoom: number };
  let { data, resolution, height, flat, colorLimit, soften, selected, region, onselect }: {
    data: MapCell[]; resolution: number; height: number; flat: boolean;
    colorLimit: number; soften: boolean; selected: Cell | null;
    region: Region; onselect: (index: number) => void;
  } = $props();
  let container: HTMLDivElement;
  let map = $state.raw<LibreMap | null>(null);
  let overlay = $state.raw<MapboxOverlay | null>(null);
  let failure = $state('');
  let previousRegion: Region | null = null;

  onMount(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, NavigationControl, ScaleControl, setWorkerUrl }) => {
      if (disposed) return;
      try {
        setWorkerUrl(workerUrl);
        const instance = new Map({
          container,
          style: 'https://tiles.openfreemap.org/styles/dark',
          center: [region.lon, region.lat], zoom: region.zoom,
          pitch: flat ? 0 : 45, bearing: 0, minZoom: 0, maxZoom: 9,
          maxPitch: 70, renderWorldCopies: false, canvasContextAttributes: { antialias: true }
        });
        const deck = new MapboxOverlay({
          interleaved: false,
          getTooltip: ({ object }: PickingInfo<MapCell>) => object ? {
            text: `${object.lat.toFixed(2)}°, ${object.lon.toFixed(2)}°\n貯留量偏差 ${displayValue(object.value)} mm\n不確実性 ${Number.isFinite(object.uncertainty) ? object.uncertainty.toFixed(1) : '—'} mm\nクリックして時系列を表示`,
            style: { backgroundColor: '#122332', color: '#f4f9fc', fontSize: '12px', padding: '12px', borderRadius: '8px' }
          } : null,
          onError: () => { failure = '3D描画に失敗しました。ページを再読み込みするか、WebGL対応ブラウザーで開いてください。'; }
        });
        instance.addControl(deck);
        instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
        instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
        instance.on('error', () => { failure = '背景地図を読み込めませんでした。ネットワーク接続をご確認ください。'; });
        map = instance;
        overlay = deck;
      } catch {
        failure = '地図を開始できません。WebGLが有効なブラウザーで開いてください。';
      }
    }).catch(() => { failure = '地図の読み込みに失敗しました。ページを再読み込みしてください。'; });
    return () => { disposed = true; map?.remove(); };
  });

  $effect(() => {
    if (!overlay) return;
    const half = resolution * 0.46;
    overlay.setProps({ layers: [
      new PolygonLayer<MapCell>({
        id: 'groundwater', data, pickable: true, extruded: !flat,
        getPolygon: (d) => [[d.lon - half, d.lat - half], [d.lon + half, d.lat - half], [d.lon + half, d.lat + half], [d.lon - half, d.lat + half]],
        getElevation: (d) => Math.abs(d.value), elevationScale: height,
        getFillColor: (d) => {
          const ratio = Math.min(Math.abs(d.value) / Math.max(colorLimit, 1), 1);
          const target = d.value < 0 ? [240, 149, 79] : [54, 183, 229];
          const neutral = [139, 157, 167];
          const alpha = soften && Number.isFinite(d.uncertainty) && Math.abs(d.value) <= d.uncertainty ? 75 : 220;
          return [0, 1, 2].map(i => Math.round(neutral[i] + (target[i] - neutral[i]) * ratio)).concat(alpha) as [number, number, number, number];
        },
        stroked: false, material: { ambient: 0.7, diffuse: 0.5, shininess: 12 },
        onClick: ({ object }: PickingInfo<MapCell>) => { if (object) onselect(object.index); },
        updateTriggers: { getFillColor: [colorLimit, soften], getPolygon: [resolution] }
      }),
      new ScatterplotLayer<Cell>({
        id: 'selected-cell', data: selected ? [selected] : [],
        getPosition: d => [d.lon, d.lat], getRadius: 8, radiusUnits: 'pixels',
        filled: false, stroked: true, getLineColor: [255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
        parameters: { depthCompare: 'always' }
      })
    ] });
  });

  $effect(() => {
    if (!map) return;
    const pitch = flat ? 0 : 45;
    if (previousRegion !== region) {
      previousRegion = region;
      // Commit preset movement immediately so a simultaneous mode change cannot cancel it.
      map.jumpTo({ center: [region.lon, region.lat], zoom: region.zoom, pitch });
    } else {
      map.easeTo({ pitch, duration: 600 });
    }
  });
</script>

<div class="map-canvas" bind:this={container} aria-label="地下水貯留量変化の3D地図"></div>
{#if failure}
  <div class="map-error" role="alert">{failure}<button onclick={() => location.reload()}>再読み込み</button></div>
{/if}

<style>
  .map-canvas { position: absolute; inset: 0; z-index: 0; }
  .map-error { position: absolute; inset: auto 16px 38px; z-index: 3; background: #402d21; padding: 12px; border: 1px solid #f09a56; font-size: 12px; border-radius: 8px; }
  .map-error button { margin-left: 12px; text-decoration: underline; }
</style>
