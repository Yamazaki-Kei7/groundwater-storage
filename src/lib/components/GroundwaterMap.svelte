<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Map as LibreMap, HillshadeLayerSpecification, RasterDEMSourceSpecification, SymbolLayerSpecification } from 'maplibre-gl';
  import { MapLibreOverlay } from '@deck.gl/maplibre';
  import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
  import type { PickingInfo } from '@deck.gl/core';
  import type { Cell, MapCell } from '#lib/data.ts';
  import { displayValue } from '#lib/data.ts';
  import { isGlobePositionVisible } from '#lib/globe.ts';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

  type Region = { lon: number; lat: number; zoom: number };
  type OrderedLayerProps = { beforeId?: string };
  const hillshadeSource = 'mapterhorn-dem';
  const elevationSource = 'mapterhorn-elevation';
  const hillshadeId = 'mapterhorn-hillshade';
  const regionalPitch = 45;
  const englishLabel: NonNullable<SymbolLayerSpecification['layout']>['text-field'] =
    ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ''];
  const demSource: RasterDEMSourceSpecification = {
    type: 'raster-dem', url: 'https://tiles.mapterhorn.com/tilejson.json',
    encoding: 'terrarium', tileSize: 512,
    attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>'
  };
  // In luma's WebGL backend these map to polygonOffset(factor, units).
  // A constant depth bias keeps surface cells above the globe's finer mesh,
  // without disabling far-side occlusion or changing the data's elevation.
  const surfaceDepth = { depthBias: 0, depthBiasSlopeScale: -100 };
  let { data, resolution, height, flat, terrain, terrainExaggeration, waterOpacity, colorLimit, soften, selected, region, onselect }: {
    data: MapCell[]; resolution: number; height: number; flat: boolean;
    terrain: boolean; terrainExaggeration: number; waterOpacity: number;
    colorLimit: number; soften: boolean; selected: Cell | null;
    region: Region; onselect: (index: number) => void;
  } = $props();
  let container: HTMLDivElement;
  let map = $state.raw<LibreMap | null>(null);
  let overlay = $state.raw<MapLibreOverlay | null>(null);
  let failure = $state('');
  let terrainFailure = $state('');
  let styleReady = $state(false);
  let beforeLabels = $state<string | undefined>();
  let groundElevations = $state.raw<ReadonlyMap<number, number>>(new Map());
  let selectedGround = $state(0);
  let selectedCell = $derived(selected && data.find(cell => cell.lon === selected.lon && cell.lat === selected.lat));

  function visibleCell({ object, viewport, coordinate, x, y }: PickingInfo<MapCell>): MapCell | null {
    if (!object || !viewport || !coordinate || coordinate.length < 3 || !coordinate.every(Number.isFinite)) return null;
    // Picking has its own framebuffer, without the basemap's globe depth.
    // Use the actual hit, since a visible column top can have hidden lower sides.
    const position: [number, number, number] = [coordinate[0], coordinate[1], Math.max(0, coordinate[2])];
    if (!isGlobePositionVisible(viewport, position)) return null;
    if (map?.getTerrain()) {
      // MapLibre unprojects onto its terrain surface; deck's picking buffer
      // contains only columns. Reject a column hit behind that surface.
      const ground = map.unproject([x, y]);
      const elevation = map.queryTerrainElevation(ground);
      if (elevation !== null && Number.isFinite(elevation)) {
        const camera = viewport.cameraPosition;
        const distance = (point: [number, number, number]) => Math.hypot(...viewport.projectPosition(point).map((value, i) => value - camera[i]));
        const surfaceDistance = distance([ground.lng, ground.lat, elevation]);
        // Allow approximately one pixel for picking and DEM interpolation error.
        if (distance(position) > surfaceDistance * (1 + 1 / Math.max(viewport.height, 1))) return null;
      }
    }
    return object;
  }

  function refreshGroundElevations() {
    if (!map || flat || !terrain) return;
    const bounds = map.getBounds();
    const selectedElevation = selected ? map.queryTerrainElevation([selected.lon, selected.lat]) : null;
    selectedGround = selectedElevation !== null && Number.isFinite(selectedElevation) ? selectedElevation : 0;
    const elevations = new Map<number, number>();
    let elevationsChanged = false;
    for (const cell of data) {
      // Globe bounds can extend past ±180°, while data longitudes are wrapped.
      if (![cell.lon, cell.lon - 360, cell.lon + 360].some(lon => bounds.contains([lon, cell.lat]))) continue;
      // queryTerrainElevation already includes exaggeration. Sample the cell
      // center, so the entire column has a level base and its height stays |value|.
      const elevation = map.queryTerrainElevation([cell.lon, cell.lat]);
      if (elevation !== null && Number.isFinite(elevation)) {
        elevations.set(cell.index, elevation);
        if (groundElevations.get(cell.index) !== elevation) elevationsChanged = true;
      }
    }
    // An update repaints the map and fires idle again; avoid a render loop.
    if (elevationsChanged || elevations.size !== groundElevations.size) {
      groundElevations = elevations;
    }
  }

  onMount(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, NavigationControl, ScaleControl, setWorkerUrl }) => {
      if (disposed) return;
      try {
        setWorkerUrl(workerUrl);
        const instance = new Map({
          container,
          style: 'https://tiles.openfreemap.org/styles/positron',
          transformStyle: (_previous, next) => {
            // Keep geographic labels above both the relief and the water cells.
            const labelIndex = next.layers.findIndex(layer => layer.type === 'symbol');
            beforeLabels = next.layers[labelIndex]?.id;
            const layers = [...next.layers];
            const hillshade: HillshadeLayerSpecification = {
              id: hillshadeId, type: 'hillshade', source: hillshadeSource,
              layout: { visibility: terrain ? 'visible' : 'none' },
              paint: {
                'hillshade-exaggeration': 0.75,
                'hillshade-illumination-anchor': 'map',
                'hillshade-shadow-color': '#68767a',
                'hillshade-highlight-color': '#ffffff',
                'hillshade-accent-color': '#a7b0af'
              }
            };
            layers.splice(labelIndex < 0 ? layers.length : labelIndex, 0, hillshade);
            return {
              ...next, projection: { type: 'globe' },
              // Terrain and hillshade need separate caches for correct rendering.
              sources: { ...next.sources, [hillshadeSource]: { ...demSource }, [elevationSource]: { ...demSource } },
              layers: layers.map(layer => {
                if (layer.type === 'background') return { ...layer, paint: { ...layer.paint, 'background-color': '#f5f6f5' } };
                if (layer.type === 'symbol') {
                  const textField = layer.layout?.['text-field'];
                  return { ...layer,
                    layout: {
                      ...layer.layout,
                      ...(textField && JSON.stringify(textField).includes('name') ? { 'text-field': englishLabel } : {})
                    },
                    paint: { ...layer.paint, 'text-color': '#4b5560', 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
                  };
                }
                return layer;
              })
            };
          },
          center: [region.lon, region.lat], zoom: region.zoom,
          // The globe camera uses sea level; keep deck.gl's camera origin aligned.
          centerClampedToGround: false,
          pitch: 0, bearing: 0, minZoom: 0, maxZoom: 9,
          maxPitch: 70, renderWorldCopies: false, canvasContextAttributes: { antialias: true }
        });
        const deck = new MapLibreOverlay({
          // Share the globe's depth buffer so far-side columns stay behind the Earth.
          interleaved: true,
          getTooltip: (info: PickingInfo<MapCell>) => {
            const object = visibleCell(info);
            return object ? {
              text: `${object.lat.toFixed(2)}°, ${object.lon.toFixed(2)}°\nStorage anomaly ${displayValue(object.value)} mm\nUncertainty ${Number.isFinite(object.uncertainty) ? object.uncertainty.toFixed(1) : '—'} mm`,
              style: { backgroundColor: '#ffffff', color: '#25313b', fontSize: '12px', padding: '10px', borderRadius: '6px', border: '1px solid #dce2e5' }
            } : null;
          },
          onError: () => { failure = 'Unable to render 3D. Reload the page or use a WebGL-compatible browser.'; }
        });
        instance.addControl(deck);
        instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
        instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
        instance.on('style.load', () => { styleReady = true; });
        instance.on('idle', refreshGroundElevations);
        instance.on('error', event => {
          if (('sourceId' in event && (event.sourceId === hillshadeSource || event.sourceId === elevationSource)) || event.error.message.includes('mapterhorn.com')) {
            terrainFailure = 'Unable to load terrain. Groundwater data is still available.';
          } else {
            failure = 'Unable to load the basemap. Check your connection.';
          }
        });
        map = instance;
        overlay = deck;
      } catch {
        failure = 'Unable to start the map. Enable WebGL in your browser.';
      }
    }).catch(() => { failure = 'Unable to load the map. Reload the page.'; });
    return () => { disposed = true; map?.remove(); };
  });

  $effect(() => {
    if (!map || !styleReady) return;
    map.setLayoutProperty(hillshadeId, 'visibility', terrain ? 'visible' : 'none');
    map.setTerrain(terrain && !flat ? { source: elevationSource, exaggeration: terrainExaggeration } : null);
    if (flat || !terrain) { groundElevations = new Map(); selectedGround = 0; }
  });

  $effect(() => {
    if (map && styleReady) map.jumpTo({ pitch: flat || map.getZoom() < 3 ? 0 : regionalPitch });
  });

  $effect(() => {
    if (!overlay) return;
    const half = resolution * (flat ? 0.5 : terrain ? 0.24 : 0.46);
    const baseAlpha = flat ? 255 * waterOpacity / 100 : 220;
    const selectedElevation = flat ? 0 : selectedGround + (selectedCell ? Math.abs(selectedCell.value) * height : 0);
    overlay.setProps({ layers: [
      new PolygonLayer<MapCell, OrderedLayerProps>({
        id: 'groundwater', data, pickable: '3d', extruded: !flat,
        beforeId: beforeLabels,
        parameters: flat ? surfaceDepth : { depthBias: 0, depthBiasSlopeScale: 0 },
        getPolygon: (d) => {
          const base = flat ? 0 : groundElevations.get(d.index) ?? 0;
          return [[d.lon - half, d.lat - half, base], [d.lon + half, d.lat - half, base], [d.lon + half, d.lat + half, base], [d.lon - half, d.lat + half, base]];
        },
        getElevation: (d) => Math.abs(d.value), elevationScale: height,
        getFillColor: (d) => {
          const ratio = Math.min(Math.abs(d.value) / Math.max(colorLimit, 1), 1);
          const target = d.value < 0 ? [240, 149, 79] : [54, 183, 229];
          const neutral = [139, 157, 167];
          const alpha = soften && Number.isFinite(d.uncertainty) && Math.abs(d.value) <= d.uncertainty ? baseAlpha * 75 / 220 : baseAlpha;
          return [0, 1, 2].map(i => Math.round(neutral[i] + (target[i] - neutral[i]) * ratio)).concat(alpha) as [number, number, number, number];
        },
        stroked: false, material: { ambient: 0.7, diffuse: 0.5, shininess: 12 },
        onClick: (info: PickingInfo<MapCell>) => { const object = visibleCell(info); if (object) onselect(object.index); },
        updateTriggers: { getFillColor: [colorLimit, soften, flat, waterOpacity], getPolygon: [resolution, flat, terrain, groundElevations] }
      }),
      new ScatterplotLayer<Cell, OrderedLayerProps>({
        id: 'selected-cell', data: selected ? [selected] : [],
        beforeId: beforeLabels,
        getPosition: d => [d.lon, d.lat, selectedElevation], getRadius: 8, radiusUnits: 'pixels',
        filled: false, stroked: true, getLineColor: [37, 49, 59], lineWidthUnits: 'pixels', getLineWidth: 2,
        parameters: { depthCompare: 'less-equal', ...surfaceDepth },
        updateTriggers: { getPosition: [selectedElevation] }
      })
    ] });
  });

  $effect(() => {
    if (!map) return;
    map.jumpTo({ center: [region.lon, region.lat], zoom: region.zoom, pitch: untrack(() => flat) || region.zoom < 3 ? 0 : regionalPitch, bearing: 0 });
  });
</script>

<div class="map-canvas" bind:this={container} aria-label="Globe showing groundwater storage changes"></div>
{#if failure || (terrain && terrainFailure)}
  <div class="map-error" role="alert">{failure || terrainFailure}<button onclick={() => location.reload()}>Reload</button></div>
{/if}

<style>
  .map-canvas { position: absolute; inset: 0; z-index: 0; }
  .map-error { position: absolute; inset: auto 16px 38px; z-index: 3; background: #fff8ee; padding: 12px; color: #75431c; border: 1px solid #dfb688; font-size: 12px; border-radius: 8px; }
  .map-error button { margin-left: 12px; text-decoration: underline; }
</style>
