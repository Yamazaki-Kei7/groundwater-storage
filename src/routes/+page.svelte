<script lang="ts">
  import { onMount } from 'svelte';
  import { asset, resolve } from '$app/paths';
  import GroundwaterMap from '#lib/components/GroundwaterMap.svelte';
  import TimeSeries from '#lib/components/TimeSeries.svelte';
  import { displayValue, fetchJson, frameCells, loadFrame, loadSeries, nearestCell, seriesCsv } from '#lib/data.ts';
  import type { Cell, Frame, Manifest } from '#lib/data.ts';

  const dataRoot = asset('data/manifest.json').replace(/\/manifest\.json$/, '');
  const regions = [
    { name: 'World', lon: 15, lat: 15, zoom: 0.7 },
    { name: 'Japan', lon: 137, lat: 37, zoom: 4.3 },
    { name: 'India', lon: 79, lat: 25, zoom: 3.8 },
    { name: 'North America', lon: -105, lat: 37, zoom: 3 },
    { name: 'Europe', lon: 12, lat: 49, zoom: 3.6 },
    { name: 'Amazon', lon: -62, lat: -6, zoom: 3.6 }
  ];
  let manifest = $state<Manifest | null>(null);
  let cells = $state.raw<Cell[]>([]);
  let frame = $state.raw<Frame | null>(null);
  let series = $state.raw<Frame | null>(null);
  let monthIndex = $state(0);
  let selectedIndex = $state<number | null>(null);
  let regionIndex = $state(0);
  let flat = $state(false);
  let terrain = $state(true);
  let terrainExaggeration = $state(5);
  let waterOpacity = $state(55);
  let height = $state(700);
  let soften = $state(false);
  let playing = $state(false);
  let speed = $state(1);
  let loading = $state(false);
  let seriesLoading = $state(false);
  let error = $state('');
  let seriesError = $state('');
  let ready = $state(false);
  let retry = $state(0);
  let about = $state(false);
  let settingsOpen = $state(false);
  let latitude = $state<number | undefined>(37);
  let longitude = $state<number | undefined>(137);
  let month = $derived(manifest?.months[monthIndex] ?? '—');
  let missing = $derived(!!manifest?.ready && !manifest.available[monthIndex]);
  let mapData = $derived(frameCells(cells, frame));
  let selected = $derived(selectedIndex === null ? null : cells[selectedIndex] ?? null);
  let selectedValue = $derived(selectedIndex === null ? undefined : frame?.values[selectedIndex]);
  let selectedUncertainty = $derived(selectedIndex === null ? undefined : frame?.uncertainty[selectedIndex]);

  onMount(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const metadata = await fetchJson<Manifest>(`${dataRoot}/manifest.json`, controller.signal);
        if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.months) || metadata.months.length !== metadata.available.length) throw new Error('Invalid data format.');
        manifest = metadata;
        if (!metadata.ready) return;
        cells = await fetchJson<Cell[]>(`${dataRoot}/cells.json`, controller.signal);
        if (cells.length !== metadata.cellCount) throw new Error('Grid count does not match the metadata.');
        monthIndex = metadata.months.length - 1;
        ready = true;
      } catch (e) { if (!controller.signal.aborted) error = e instanceof Error ? e.message : 'Unable to load data.'; }
    })();
    return () => controller.abort();
  });

  $effect(() => {
    const metadata = manifest;
    const requested = monthIndex;
    void retry;
    if (!ready || !metadata) return;
    const controller = new AbortController();
    frame = null; error = ''; loading = !!metadata.available[requested];
    if (metadata.available[requested]) {
      void loadFrame(dataRoot, metadata.months[requested], metadata.cellCount, controller.signal)
        .then(result => { if (!controller.signal.aborted) frame = result; })
        .catch(e => { if (!controller.signal.aborted) { error = e instanceof Error ? e.message : 'Unable to load monthly data.'; playing = false; } })
        .finally(() => { if (!controller.signal.aborted) loading = false; });
    }
    return () => controller.abort();
  });

  $effect(() => {
    const metadata = manifest, index = selectedIndex;
    void retry;
    series = null; seriesError = '';
    if (!metadata || index === null) return;
    const controller = new AbortController();
    seriesLoading = true;
    void loadSeries(dataRoot, index, metadata, controller.signal)
      .then(result => { if (!controller.signal.aborted) series = result; })
      .catch(e => { if (!controller.signal.aborted) seriesError = e instanceof Error ? e.message : 'Unable to load the time series.'; })
      .finally(() => { if (!controller.signal.aborted) seriesLoading = false; });
    return () => controller.abort();
  });

  $effect(() => {
    if (!playing || loading || !manifest) return;
    const last = manifest.months.length - 1;
    const current = monthIndex;
    const timer = setTimeout(() => { if (current >= last) playing = false; else monthIndex = current + 1; }, 800 / speed);
    return () => clearTimeout(timer);
  });

  function selectMonth(index: number) { playing = false; monthIndex = index; }
  function selectCoordinates(event: SubmitEvent) {
    event.preventDefault();
    if (latitude === undefined || longitude === undefined) return;
    selectedIndex = nearestCell(cells, longitude, latitude);
  }
  function togglePlay() { if (!playing && monthIndex === (manifest?.months.length ?? 0) - 1) monthIndex = 0; playing = !playing; }
  function downloadCsv() {
    if (!series || !manifest || !selected) return;
    const url = URL.createObjectURL(new Blob([seriesCsv(manifest.months, series)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `gwsc_${selected.lat}_${selected.lon}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<svelte:head>
  <link rel="icon" type="image/svg+xml" href={asset('favicon.svg')} />
  <title>Groundwater Atlas</title>
  <meta name="description" content="Explore global groundwater storage changes with a 3D map and monthly time series, using official Copernicus C3S data." />
</svelte:head>

<div class="app-shell">
  <header class="app-header">
    <a class="brand" href={resolve('/')} aria-label="Groundwater Atlas home"><h1>Groundwater Atlas</h1></a>
    <button class="quiet-button" onclick={() => about = !about} aria-expanded={about} aria-controls="about-data">About the data</button>
  </header>

  {#if about}
    <section id="about-data" class="about-panel" aria-label="About the data">
      <div class="flex justify-between gap-4"><h2>About the data</h2><button class="quiet-button" onclick={() => about = false}>Close ×</button></div>
      <div class="about-grid">
        <div><h3>Groundwater estimates</h3><p>Copernicus C3S estimates groundwater storage from GRACE / GRACE-FO observations, subtracting changes in glaciers, snow, soil moisture and surface water. Values are anomalies relative to the {manifest?.baselinePeriod ?? 'reference period'} mean, in millimetres of equivalent water height.</p></div>
        <div><h3>Resolution &amp; uncertainty</h3><p>The grid spacing is {manifest?.resolution ?? 0.5}°, with an effective resolution of approximately {manifest?.effectiveResolutionKm ?? '250–300'} km. Point values represent regional estimates. Uncertainty comes from the source data; missing months are not interpolated.</p></div>
        <div><h3>Source</h3><p>Copernicus Climate Change Service (C3S) / ECMWF / GFZ · {manifest?.version ?? 'v1.0'} · CC BY 4.0. Latest month: {manifest?.months.at(-1) ?? '—'}.</p><a href="https://confluence.ecmwf.int/x/sA0nJw" target="_blank" rel="noreferrer">Product guide ↗</a><a href={`${dataRoot}/manifest.json`} target="_blank" rel="noreferrer">Data provenance ↗</a></div>
      </div>
      <p class="terrain-source-note">Terrain: <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noreferrer">Mapterhorn ↗</a>. Column height represents the magnitude of the anomaly, not water level or depth. Terrain height is exaggerated separately. “Fade uncertain cells” reduces opacity where |anomaly| ≤ uncertainty. The colour scale is fixed across all months; end colours include values beyond the limits.</p>
    </section>
  {/if}

  <main class="workspace">
    <aside class="sidebar" aria-label="Map settings">
      <button class="settings-toggle" type="button" aria-expanded={settingsOpen} aria-controls="map-settings" onclick={() => settingsOpen = !settingsOpen}>
        <span>Map settings</span><span aria-hidden="true">{settingsOpen ? '−' : '+'}</span>
      </button>
      <div id="map-settings" class="settings-content" class:settings-open={settingsOpen}>
        <section class="control-section">
          <h2><label for="region">Region</label></h2>
          <select id="region" class="region-select" bind:value={regionIndex}>
            {#each regions as region, i}
              <option value={i}>{region.name}</option>
            {/each}
          </select>
        </section>
        <section class="control-section">
          <h2>Display</h2>
          <div class="segmented"><button class:active={flat} onclick={() => flat = true} aria-pressed={flat}>Surface</button><button class:active={!flat} onclick={() => flat = false} aria-pressed={!flat}>3D columns</button></div>
          <label class="checkbox-label"><input type="checkbox" bind:checked={terrain} /><span>Show terrain</span></label>
          {#if flat}
            <label class="height-label" for="water-opacity">Opacity <span>{waterOpacity}%</span></label>
            <input id="water-opacity" type="range" min="0" max="100" step="5" bind:value={waterOpacity} />
          {:else}
            <label class="height-label" for="terrain-exaggeration">Terrain height <span>{terrainExaggeration}×</span></label>
            <input id="terrain-exaggeration" type="range" min="1" max="10" step="1" bind:value={terrainExaggeration} disabled={!terrain} />
            <label class="height-label" for="height">Column height <span>{(height / 1000).toFixed(1)} km / mm</span></label>
            <input id="height" type="range" min="100" max="2000" step="100" bind:value={height} />
          {/if}
          <label class="checkbox-label"><input type="checkbox" bind:checked={soften} /><span>Fade uncertain cells</span></label>
        </section>
      </div>
      <section class="legend-section">
        <div class="flex items-baseline justify-between"><h2>Storage anomaly</h2><span>mm water equivalent</span></div>
        <div class="legend-gradient"></div>
        <div class="legend-values"><span>−{manifest?.colorLimit ?? '…'}</span><span>0</span><span>+{manifest?.colorLimit ?? '…'}</span></div>
        <div class="legend-directions"><span>Below baseline</span><span>Above baseline</span></div>
      </section>
    </aside>

    <div class="map-and-timeline">
      <section class="map-panel" aria-label="Groundwater storage map">
        <GroundwaterMap data={mapData} resolution={manifest?.resolution ?? 0.5} {height} {flat} {terrain} {terrainExaggeration} {waterOpacity} colorLimit={manifest?.colorLimit ?? 300} {soften} {selected} region={regions[regionIndex]} onselect={i => selectedIndex = i} />
        {#if loading}<span class="map-badge" role="status">Loading…</span>{/if}
        {#if error}<div class="notice" role="alert"><strong>Unable to load data</strong><p>{error}</p><button onclick={() => ready ? retry += 1 : location.reload()}>Retry</button></div>
        {:else if manifest && !manifest.ready}<div class="notice"><strong>Data is being prepared</strong><p>The map and time series will appear when data is available.</p></div>
        {:else if missing}<div class="missing-notice"><strong>No data for {month}</strong><p>Select another month to view observations.</p></div>{/if}
      </section>

      <section class="timeline" aria-label="Monthly timeline controls">
        <div class="timeline-heading"><h2>{month}</h2><span class="timeline-status">Baseline: {manifest?.baselinePeriod ?? '…'}</span></div>
        <div class="timeline-controls">
          <button class="play-button" onclick={togglePlay} disabled={!ready} aria-label={playing ? 'Pause time series' : 'Play time series'}>{playing ? 'Ⅱ' : '▶'}</button>
          <button class="step-button" onclick={() => selectMonth(monthIndex - 1)} disabled={!ready || monthIndex === 0} aria-label="Previous month">‹</button>
          <div class="slider-wrap">
            <label class="sr-only" for="month">Observation month</label><input id="month" type="range" min="0" max={Math.max(0, (manifest?.months.length ?? 1) - 1)} value={monthIndex} oninput={event => selectMonth(Number(event.currentTarget.value))} disabled={!ready} aria-valuetext={month} />
            <div class="availability" aria-hidden="true">{#each manifest?.available ?? [] as available}<span class:gap={!available}></span>{/each}</div>
            <div class="timeline-years"><span>{manifest?.months[0]?.slice(0, 4) ?? '2002'}</span><span>{manifest?.months[Math.floor((manifest?.months.length ?? 0) / 2)]?.slice(0, 4) ?? ''}</span><span>{manifest?.months.at(-1)?.slice(0, 4) ?? ''}</span></div>
          </div>
          <button class="step-button" onclick={() => selectMonth(monthIndex + 1)} disabled={!ready || monthIndex >= (manifest?.months.length ?? 1) - 1} aria-label="Next month">›</button>
          <label class="speed-label"><span class="sr-only">Playback speed</span><select bind:value={speed}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        </div>
        <div class="timeline-foot"><span><i></i> Available <i class="gap-key"></i> No data</span></div>
      </section>
    </div>

    <aside class="detail-panel">
      <div class="detail-heading"><h2>Location</h2>{#if selected}<button class="quiet-button" onclick={() => selectedIndex = null} aria-label="Clear location">×</button>{/if}</div>
      <form class="coordinate-form" onsubmit={selectCoordinates}>
        <div><label>Latitude<input type="number" min="-90" max="90" step="any" required bind:value={latitude} /></label><label>Longitude<input type="number" min="-180" max="180" step="any" required bind:value={longitude} /></label></div>
        <button class="quiet-button" disabled={!ready}>Show location</button>
      </form>
      {#if selected}
        <p class="coordinates">{Math.abs(selected.lat).toFixed(2)}° {selected.lat < 0 ? 'S' : 'N'} &nbsp; {Math.abs(selected.lon).toFixed(2)}° {selected.lon < 0 ? 'W' : 'E'}</p>
        <div class="selected-value" class:negative={(selectedValue ?? 0) < 0}>{displayValue(selectedValue)}<span>mm</span></div>
        <p class="value-caption">{month} · Storage anomaly</p>
        <div class="uncertainty-value">Uncertainty <strong>{selectedUncertainty !== undefined && Number.isFinite(selectedUncertainty) ? selectedUncertainty.toFixed(1) : '—'} mm</strong></div>
        {#if seriesLoading}<p class="detail-message" role="status">Loading time series…</p>
        {:else if seriesError}<p role="alert">{seriesError}</p><button class="quiet-button" onclick={() => retry += 1}>Retry</button>
        {:else if series && manifest}<TimeSeries months={manifest.months} {series} index={monthIndex} onchange={selectMonth} /><button class="export-button" onclick={downloadCsv}>Download CSV <span>↓</span></button>{/if}
      {:else}
        <p class="selection-empty">Select a location on the map</p>
      {/if}
    </aside>
  </main>

  <footer class="app-footer"><a href="https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=overview" target="_blank" rel="noreferrer">Copernicus C3S · CC BY 4.0 ↗</a></footer>
</div>
