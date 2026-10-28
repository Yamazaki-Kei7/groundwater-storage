<script lang="ts">
  import { onMount } from 'svelte';
  import { asset, resolve } from '$app/paths';
  import GroundwaterMap from '#lib/components/GroundwaterMap.svelte';
  import TimeSeries from '#lib/components/TimeSeries.svelte';
  import { displayValue, fetchJson, frameCells, loadFrame, loadSeries, nearestCell, seriesCsv } from '#lib/data.ts';
  import type { Cell, Frame, Manifest } from '#lib/data.ts';

  const dataRoot = asset('data/manifest.json').replace(/\/manifest\.json$/, '');
  const regions = [
    { name: '世界', lon: 15, lat: 15, zoom: 0.7 },
    { name: '日本', lon: 137, lat: 37, zoom: 4.3 },
    { name: 'インド', lon: 79, lat: 25, zoom: 3.8 },
    { name: '北米', lon: -105, lat: 37, zoom: 3 },
    { name: '欧州', lon: 12, lat: 49, zoom: 3.6 },
    { name: 'アマゾン', lon: -62, lat: -6, zoom: 3.6 }
  ];
  let manifest = $state<Manifest | null>(null);
  let cells = $state.raw<Cell[]>([]);
  let frame = $state.raw<Frame | null>(null);
  let series = $state.raw<Frame | null>(null);
  let monthIndex = $state(0);
  let selectedIndex = $state<number | null>(null);
  let regionIndex = $state(0);
  let flat = $state(false);
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
  let latitude = $state<number | undefined>(37);
  let longitude = $state<number | undefined>(137);
  let month = $derived(manifest?.months[monthIndex] ?? '—');
  let missing = $derived(!!manifest?.ready && !manifest.available[monthIndex]);
  let mapData = $derived(frameCells(cells, frame));
  let selected = $derived(selectedIndex === null ? null : cells[selectedIndex] ?? null);
  let selectedValue = $derived(selectedIndex === null ? undefined : frame?.values[selectedIndex]);
  let selectedUncertainty = $derived(selectedIndex === null ? undefined : frame?.uncertainty[selectedIndex]);
  let availableCount = $derived(manifest?.available.filter(Boolean).length ?? 0);

  onMount(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const metadata = await fetchJson<Manifest>(`${dataRoot}/manifest.json`, controller.signal);
        if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.months) || metadata.months.length !== metadata.available.length) throw new Error('データ形式を確認できません。');
        manifest = metadata;
        if (!metadata.ready) return;
        cells = await fetchJson<Cell[]>(`${dataRoot}/cells.json`, controller.signal);
        if (cells.length !== metadata.cellCount) throw new Error('格子数がメタデータと一致しません。');
        monthIndex = metadata.months.length - 1;
        ready = true;
      } catch (e) { if (!controller.signal.aborted) error = e instanceof Error ? e.message : 'データの読み込みに失敗しました。'; }
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
        .catch(e => { if (!controller.signal.aborted) { error = e instanceof Error ? e.message : '月別データの取得に失敗しました。'; playing = false; } })
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
      .catch(e => { if (!controller.signal.aborted) seriesError = e instanceof Error ? e.message : '時系列の取得に失敗しました。'; })
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
  <title>地下水の変化を、宇宙から。 | Groundwater Atlas</title>
  <meta name="description" content="GRACE・GRACE-FO衛星観測に基づく世界の地下水貯留量変化を、3D地図と月別時系列で探索するWebGIS。Copernicus C3Sの公式データを使用。" />
</svelte:head>

<div class="app-shell">
  <header class="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 lg:px-8">
    <a class="brand" href={resolve('/')} aria-label="Groundwater Atlas ホーム">
      <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true"><path d="M20 3C15 11 7 19 7 26a13 13 0 0 0 26 0C33 19 25 11 20 3Z" fill="none" stroke="#68d6e8" stroke-width="1.6"/><path d="M9 23c7-7 15 7 23 0M9 29c7-7 15 7 23 0" fill="none" stroke="#68d6e8" stroke-width="1.6"/></svg>
      <div><span class="brand-title">GROUNDWATER <b>ATLAS</b></span><span class="brand-caption">衛星で読み解く、地球の水の記憶</span></div>
    </a>
    <div class="flex items-center gap-4"><span class="satellite-tag hidden sm:flex"><span></span>GRACE / GRACE-FO</span><button class="quiet-button" onclick={() => about = !about} aria-expanded={about}>データについて <span aria-hidden="true">↗</span></button></div>
  </header>

  <main class="workspace">
    <aside class="sidebar">
      <div class="eyebrow"><span class="tiny-line"></span> GLOBAL WATER OBSERVATORY</div>
      <h1>地下水の変化を、<br /><span>宇宙から。</span></h1>
      <p class="intro">目に見えない地下の水。その増減を、<br class="hidden lg:block" />衛星重力観測からたどります。</p>
      <div class="dataset-summary">
        <div><span>観測開始</span><strong>{manifest?.months[0]?.replace('-', '.') ?? '2002.04'}</strong></div>
        <div><span>最新データ</span><strong>{manifest?.months.at(-1)?.replace('-', '.') ?? '—'}</strong></div>
        <div><span>観測月数</span><strong>{availableCount || '—'}<small>か月</small></strong></div>
      </div>

      <section class="control-section">
        <h2><span>01</span> 地域を探索</h2>
        <div class="region-grid">{#each regions as region, i}<button class:active={regionIndex === i} onclick={() => regionIndex = i}>{region.name}</button>{/each}</div>
      </section>
      <section class="control-section">
        <h2><span>02</span> 表示を調整</h2>
        <div class="flex items-center justify-between"><span class="field-label">データの表示</span><div class="segmented"><button class:active={!flat} onclick={() => flat = false} aria-pressed={!flat}>3D</button><button class:active={flat} onclick={() => flat = true} aria-pressed={flat}>2D</button></div></div>
        <label class="height-label" for="height">柱の高さ <span>{(height / 1000).toFixed(1)} km / mm</span></label>
        <input id="height" type="range" min="100" max="2000" step="100" bind:value={height} disabled={flat} />
        <p class="hint">高さは偏差の大きさを誇張した表現です。</p>
        <label class="checkbox-label"><input type="checkbox" bind:checked={soften} /><span>不確実性の大きいセルを薄くする<small>|偏差| ≤ 提供された不確実性</small></span></label>
      </section>
      <section class="legend-section">
        <div class="flex items-baseline justify-between"><h2>地下水貯留量の偏差</h2><span>mm 相当水高</span></div>
        <div class="legend-gradient"></div>
        <div class="legend-values"><span>−{manifest?.colorLimit ?? '…'}</span><span>0</span><span>+{manifest?.colorLimit ?? '…'}</span></div>
        <div class="legend-directions"><span>↓ 減少</span><span>増加 ↑</span></div>
        <p class="hint">全期間で共通の色尺度。端の色は範囲外も含みます。無色の場所はデータなし。</p>
      </section>
      <div class="sidebar-footer"><span class="source-mark">C3S</span><p>Copernicus Climate Change Service<br /><a href="https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=overview" target="_blank" rel="noreferrer">公式データを見る ↗</a></p></div>
    </aside>

    <div class="map-and-timeline">
      <section class="map-panel" aria-label="地下水貯留量の地図">
        <GroundwaterMap data={mapData} resolution={manifest?.resolution ?? 0.5} {height} {flat} colorLimit={manifest?.colorLimit ?? 300} {soften} {selected} region={regions[regionIndex]} onselect={i => selectedIndex = i} />
        <div class="map-topline"><span class="map-badge"><span class:busy={loading}></span>{loading ? 'データを読み込み中' : missing ? 'この月は観測データなし' : `地球儀 · ${flat ? '2D' : '3D'} · ${regions[regionIndex].name}`}</span><span class="map-date">{month.replace('-', ' / ')}</span></div>
        <div class="map-instruction">{selected ? '別のセルをクリックして比較' : 'セルをクリックして、その地点の変化をたどる'}<span>ドラッグで地球儀を回転 · スクロールで拡大・縮小</span></div>
        {#if error}<div class="notice" role="alert"><strong>データを読み込めません</strong><p>{error}</p><button onclick={() => ready ? retry += 1 : location.reload()}>再試行</button></div>
        {:else if manifest && !manifest.ready}<div class="notice"><strong>公式データを準備中です</strong><p>観測値が導入されると、地図と時系列を表示します。</p></div>
        {:else if missing}<div class="missing-notice"><span>NO OBSERVATION</span><strong>{month} は欠測月です</strong><p>前後の月を選ぶと観測値を表示します。</p></div>{/if}
        <div class="map-corner-note">{manifest?.resolution ?? 0.5}° GRID <span>·</span> 月次観測</div>
      </section>

      <section class="timeline" aria-label="月別時系列の操作">
        <div class="timeline-heading"><div><span class="eyebrow">TIME EXPLORER</span><h2>{month.replace('-', '年 ')}{month !== '—' ? '月' : ''}</h2></div><span class="timeline-status">{missing ? '欠測' : loading ? '読み込み中' : '月平均の偏差'}<span>基準：{manifest?.baselinePeriod ?? '…'} 平均</span></span></div>
        <div class="timeline-controls">
          <button class="play-button" onclick={togglePlay} disabled={!ready} aria-label={playing ? '時系列の再生を停止' : '時系列を再生'}>{playing ? 'Ⅱ' : '▶'}</button>
          <button class="step-button" onclick={() => selectMonth(monthIndex - 1)} disabled={!ready || monthIndex === 0} aria-label="前の月">‹</button>
          <div class="slider-wrap">
            <label class="sr-only" for="month">観測月</label><input id="month" type="range" min="0" max={Math.max(0, (manifest?.months.length ?? 1) - 1)} value={monthIndex} oninput={event => selectMonth(Number(event.currentTarget.value))} disabled={!ready} aria-valuetext={month} />
            <div class="availability" aria-hidden="true">{#each manifest?.available ?? [] as available}<span class:gap={!available}></span>{/each}</div>
            <div class="timeline-years"><span>{manifest?.months[0]?.slice(0, 4) ?? '2002'}</span><span>{manifest?.months[Math.floor((manifest?.months.length ?? 0) / 2)]?.slice(0, 4) ?? ''}</span><span>{manifest?.months.at(-1)?.slice(0, 4) ?? ''}</span></div>
          </div>
          <button class="step-button" onclick={() => selectMonth(monthIndex + 1)} disabled={!ready || monthIndex >= (manifest?.months.length ?? 1) - 1} aria-label="次の月">›</button>
          <label class="speed-label"><span class="sr-only">再生速度</span><select bind:value={speed}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        </div>
        <div class="timeline-foot"><span><i></i> 観測あり <i class="gap-key"></i> 欠測月</span><span>データ末尾は提供元の公開状況に従います</span></div>
      </section>
    </div>

    <aside class="detail-panel">
      <div class="detail-heading"><div><span class="eyebrow">LOCAL PERSPECTIVE</span><h2>地点の時系列</h2></div>{#if selected}<button class="quiet-button" onclick={() => selectedIndex = null} aria-label="地点選択を解除">×</button>{/if}</div>
      <form class="coordinate-form" onsubmit={selectCoordinates}>
        <div><label>緯度<input type="number" min="-90" max="90" step="any" required bind:value={latitude} /></label><label>経度<input type="number" min="-180" max="180" step="any" required bind:value={longitude} /></label></div>
        <button class="quiet-button" disabled={!ready}>座標から地点を選択</button>
        <p class="hint">最寄りの陸域格子を選びます。南緯・西経は負の値で入力。</p>
      </form>
      {#if selected}
        <p class="coordinates">{Math.abs(selected.lat).toFixed(2)}° {selected.lat < 0 ? 'S' : 'N'} &nbsp; {Math.abs(selected.lon).toFixed(2)}° {selected.lon < 0 ? 'W' : 'E'}</p>
        <div class="selected-value" class:negative={(selectedValue ?? 0) < 0}>{displayValue(selectedValue)}<span>mm</span></div>
        <p class="value-caption">{month} · 地下水貯留量の偏差</p>
        <div class="uncertainty-value">不確実性 <strong>{selectedUncertainty !== undefined && Number.isFinite(selectedUncertainty) ? selectedUncertainty.toFixed(1) : '—'} mm</strong></div>
        {#if seriesLoading}<p class="detail-message" role="status">全期間の変化を読み込んでいます…</p>
        {:else if seriesError}<p role="alert">{seriesError}</p><button class="quiet-button" onclick={() => retry += 1}>再試行</button>
        {:else if series && manifest}<TimeSeries months={manifest.months} {series} index={monthIndex} onchange={selectMonth} /><button class="export-button" onclick={downloadCsv}>この地点のCSVを保存 <span>↓</span></button>{/if}
        <p class="hint mt-4">空白は欠測です。グラフをクリックすると月を移動できます。CSVは元の偏差と不確実性を収録します。</p>
      {:else}
        <div class="selection-empty"><svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="23" fill="none" stroke="#385564"/><path d="M34 4v15m0 30v15M4 34h15m30 0h15" stroke="#71d3df"/><circle cx="34" cy="34" r="5" fill="#71d3df"/></svg><h3>気になる場所を選ぶ</h3><p>地図上の柱をクリックすると、<br />2002年からの変化を表示します。</p></div>
      {/if}
      <div class="reading-guide"><span class="eyebrow">HOW TO READ</span><h3>増えた水、減った水。</h3><p>青は基準期間より多く、橙は少ない状態。柱が高いほど、変化の幅が大きいことを表します。</p><div class="mini-bars" aria-hidden="true"><span class="orange" style="height:28px"></span><span class="orange" style="height:45px"></span><span class="orange" style="height:18px"></span><span class="blue" style="height:25px"></span><span class="blue" style="height:53px"></span><span class="blue" style="height:36px"></span></div><p class="hint">絶対的な地下水量・水位・地中深度ではありません。広域の変動を見るための推定データです。</p></div>
    </aside>
  </main>

  {#if about}
    <section class="about-panel" aria-label="データについて">
      <div class="flex justify-between gap-4"><h2>この地図のデータについて</h2><button class="quiet-button" onclick={() => about = false}>閉じる ×</button></div>
      <div class="about-grid"><div><h3>衛星重力から地下水を推定</h3><p>GRACE / GRACE-FOによる陸域の総水貯留量から、氷河・積雪・土壌水分・地表水の変化を差し引いたCopernicus C3S Level-4製品です。{manifest?.baselinePeriod ?? '提供元の基準期間'}の平均に対する偏差をmm相当水高で示します。</p></div><div><h3>解像度と不確実性</h3><p>格子間隔は{manifest?.resolution ?? 0.5}°ですが、実効的な空間解像度は約{manifest?.effectiveResolutionKm ?? '250–300'} kmです。地点の値も広域の推定を表します。不確実性は提供元の値をそのまま使用し、欠測を補間していません。</p></div><div><h3>出典・加工</h3><p>Copernicus Climate Change Service (C3S) / ECMWF / GFZ · {manifest?.version ?? 'v1.0'} · CC BY 4.0。NetCDFをFloat32に変換・圧縮して表示。最新月は{manifest?.months.at(-1) ?? '公式カタログを参照'}です。</p><a href="https://confluence.ecmwf.int/x/sA0nJw" target="_blank" rel="noreferrer">公式製品ガイド ↗</a><a href={`${dataRoot}/manifest.json`} target="_blank" rel="noreferrer">データの来歴・SHA256 ↗</a></div></div>
    </section>
  {/if}
  <footer class="app-footer"><span>GROUNDWATER ATLAS <span class="footer-divider">/</span> 地球の水を、長い時間軸で。</span><span>Copernicus C3S · CC BY 4.0 <span class="footer-divider">/</span> MapLibre & deck.gl</span></footer>
</div>
