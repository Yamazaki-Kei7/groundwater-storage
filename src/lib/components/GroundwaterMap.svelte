<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Map as LibreMap, HillshadeLayerSpecification, RasterDEMSourceSpecification, SymbolLayerSpecification } from 'maplibre-gl';
  import { MapLibreOverlay } from '@deck.gl/maplibre';
  import { PolygonLayer, ScatterplotLayer } from '@deck.gl/layers';
  import type { PickingInfo } from '@deck.gl/core';
  import type { Cell, Frame, MapCell } from '#lib/data.ts';
  import { displayValue } from '#lib/data.ts';
  import { isGlobePositionVisible } from '#lib/globe.ts';
  import { createCellGeometry, type IndexedCell } from '#lib/cell-geometry.ts';
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
  // Fill colours blend from neutral toward the sign's colour as |value| nears the limit.
  const neutralColor = [139, 157, 167];
  const negativeColor = [240, 149, 79];
  const positiveColor = [54, 183, 229];
  let { cells, frame, resolution, height, flat, terrain, terrainExaggeration, waterOpacity, colorLimit, soften, selectedIndex, region, onselect }: {
    cells: Cell[]; frame: Frame | null; resolution: number; height: number; flat: boolean;
    terrain: boolean; terrainExaggeration: number; waterOpacity: number;
    colorLimit: number; soften: boolean; selectedIndex: number | null;
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
  let groundDirty = true;
  let selected = $derived(selectedIndex === null ? null : cells[selectedIndex] ?? null);
  let selectedValue = $derived(selectedIndex === null ? undefined : frame?.values[selectedIndex]);
  let geometry = $derived(createCellGeometry(cells));
  let data = $derived(geometry.forFrame(frame));
  // Selection can change while the camera and DEM remain idle; groundElevations marks a terrain refresh.
  let selectedGround = $derived.by(() => {
    void groundElevations;
    const elevation = map && terrain && !flat && selected ? map.queryTerrainElevation([selected.lon, selected.lat]) : null;
    return elevation !== null && Number.isFinite(elevation) ? elevation : 0;
  });

  function visibleCell({ object, viewport, coordinate, x, y }: PickingInfo<IndexedCell>): MapCell | null {
    const index = object?.index ?? -1;
    const value = frame?.values[index];
    if (!object || !frame || value === undefined || !Number.isFinite(value) || !viewport || !coordinate || coordinate.length < 3 || !coordinate.every(Number.isFinite)) return null;
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
    return { ...object, index, value, uncertainty: frame.uncertainty[index] };
  }

  function refreshGroundElevations() {
    if (!map || flat || !terrain || !groundDirty) return;
    groundDirty = false;
    const bounds = map.getBounds();
    const elevations = new Map<number, number>();
    let elevationsChanged = false;
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      // Globe bounds can extend past ±180°, while data longitudes are wrapped.
      if (!bounds.contains([cell.lon, cell.lat]) && !bounds.contains([cell.lon - 360, cell.lat]) && !bounds.contains([cell.lon + 360, cell.lat])) continue;
      // queryTerrainElevation already includes exaggeration. Sample the cell
      // center, so the entire column has a level base and its height stays |value|.
      const elevation = map.queryTerrainElevation([cell.lon, cell.lat]);
      if (elevation !== null && Number.isFinite(elevation)) {
        elevations.set(index, elevation);
        if (groundElevations.get(index) !== elevation) elevationsChanged = true;
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
          getTooltip: (info: PickingInfo<IndexedCell>) => {
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
        instance.on('moveend', () => { groundDirty = true; });
        instance.on('sourcedata', event => { if (event.sourceId === elevationSource) groundDirty = true; });
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
    groundDirty = true;
    map.setLayoutProperty(hillshadeId, 'visibility', terrain ? 'visible' : 'none');
    map.setTerrain(terrain && !flat ? { source: elevationSource, exaggeration: terrainExaggeration } : null);
    if (flat || !terrain) groundElevations = new Map();
  });

  $effect(() => {
    void cells;
    if (map && styleReady) untrack(() => { groundDirty = true; refreshGroundElevations(); });
  });

  $effect(() => {
    if (map && styleReady) map.jumpTo({ pitch: flat || map.getZoom() < 3 ? 0 : regionalPitch });
  });

  $effect(() => {
    if (!overlay) return;
    const half = resolution * (flat ? 0.5 : terrain ? 0.24 : 0.46);
    const baseAlpha = flat ? 255 * waterOpacity / 100 : 220;
    const currentFrame = frame;
    const selectedElevation = flat ? 0 : selectedGround + (selectedValue !== undefined && Number.isFinite(selectedValue) ? Math.abs(selectedValue) * height : 0);
    overlay.setProps({ layers: [
      new PolygonLayer<IndexedCell, OrderedLayerProps>({
        // Geometry and cell IDs stay fixed across months; only values change.
        id: 'groundwater', data, visible: currentFrame !== null, pickable: '3d', extruded: !flat,
        beforeId: beforeLabels,
        parameters: flat ? surfaceDepth : { depthBias: 0, depthBiasSlopeScale: 0 },
        getPolygon: (d) => {
          const base = flat ? 0 : groundElevations.get(d.index) ?? 0;
          return [[d.lon - half, d.lat - half, base], [d.lon + half, d.lat - half, base], [d.lon + half, d.lat + half, base], [d.lon - half, d.lat + half, base]];
        },
        getElevation: ({ index }) => {
          const value = currentFrame?.values[index];
          return value !== undefined && Number.isFinite(value) ? Math.abs(value) : 0;
        }, elevationScale: height,
        getFillColor: ({ index }) => {
          const value = currentFrame?.values[index];
          if (value === undefined || !Number.isFinite(value)) return [0, 0, 0, 0];
          const uncertainty = currentFrame?.uncertainty[index];
          const ratio = Math.min(Math.abs(value) / Math.max(colorLimit, 1), 1);
          const alpha = soften && uncertainty !== undefined && Number.isFinite(uncertainty) && Math.abs(value) <= uncertainty ? baseAlpha * 75 / 220 : baseAlpha;
          const target = value < 0 ? negativeColor : positiveColor;
          const blend = (i: number) => Math.round(neutralColor[i] + (target[i] - neutralColor[i]) * ratio);
          return [blend(0), blend(1), blend(2), alpha];
        },
        stroked: false, material: { ambient: 0.7, diffuse: 0.5, shininess: 12 },
        onClick: (info: PickingInfo<IndexedCell>) => { const object = visibleCell(info); if (object) onselect(object.index); },
        updateTriggers: {
          getElevation: [currentFrame], getFillColor: [currentFrame, colorLimit, soften, flat, waterOpacity],
          getPolygon: [resolution, flat, terrain, groundElevations]
        }
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
