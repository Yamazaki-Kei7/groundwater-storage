# Groundwater Atlas

An English-language WebGIS with a minimal, light interface for exploring satellite-derived groundwater storage anomalies on an interactive globe and in monthly time series.

[Open the live site](https://yamazaki-kei7.github.io/groundwater-storage/)

The app uses SvelteKit 3, Svelte 5, Tailwind CSS 4, MapLibre GL JS 6, and deck.gl 9. It is prerendered and deployed as a static site; viewing the bundled groundwater data does not require a backend or CDS credentials.

## Exploring the map

- Drag to rotate the globe and scroll or pinch to zoom. Region presets cover the world, Japan, India, North America, Europe, and the Amazon.
- The initial view shows **3D columns with terrain enabled**, terrain exaggerated by **5×**, and the final month in the bundled record (**September 2023**).
- Switch between **3D columns** and **Surface**. Both modes use the globe projection; Surface uses flat colored cells and a top-down view for terrain comparison rather than a separate planar map.
- Step through calendar months or play the timeline at 0.5×, 1×, 2×, or 4× speed. Missing months remain in the timeline. Playback stops at the end; starting playback from the last month restarts from the beginning.
- Upcoming observations are prefetched, and recently decoded monthly frames are reused from an 8 MiB cache. When a month needs loading, the previous map, displayed date and chart cursor stay together until the new frame is ready. The slider and loading message identify the requested month; a failed load keeps the last successful display and offers Retry.
- Click a visible cell or enter latitude and longitude to select the nearest land grid cell. The detail panel shows its value, supplied uncertainty, and full time series. Click the chart to select a month.
- Export the selected cell's time series as CSV with the columns `month`, `gwsc_mm`, and `gwsc_uncertainty_mm`.
- Optionally fade cells where the absolute anomaly is less than or equal to the supplied uncertainty. This changes their appearance, not their values or CSV output.

### Terrain and display modes

**3D columns:** Mapterhorn elevation tiles provide raised terrain and hillshading. Terrain exaggeration ranges from 1× to 10×; 1× uses the source elevations without vertical exaggeration. Selecting a regional preset tilts the camera to 45°, while the world preset uses a top-down view. Column bases use the terrain elevation sampled at each cell center when available. Columns become narrower while terrain is enabled so that more relief remains visible.

Column height is the **absolute groundwater anomaly** multiplied by a separate visual scale, adjustable from 0.1 to 2.0 km per mm (default: 0.7 km per mm). Both positive and negative anomalies extend upward; color indicates the sign. Column height does not represent water level, groundwater depth, or terrain elevation.

**Surface:** The app disables raised terrain and overlays colored cells on hillshading. Groundwater opacity ranges from 0% to 100% (default: 55%); at 0%, the groundwater overlay is invisible. The terrain toggle controls hillshading in this mode and both hillshading and raised terrain in 3D mode.

Fine terrain detail does not increase the groundwater product's effective resolution of approximately 250–300 km. Use the overlay to explore geographic context, not to infer valley-scale groundwater conditions or a causal relationship with topography.

## Dataset and interpretation

The bundled data comes from [Copernicus C3S satellite groundwater storage](https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=overview), product **v1.0**. The following describes the repository's snapshot, generated on **2026-10-28**, rather than the provider's current catalog:

| Property | Bundled value |
| --- | --- |
| Calendar coverage | April 2002–September 2023 |
| Calendar months | 258 |
| Observed / missing months | 225 / 33 |
| Land grid cells | 59,018 |
| Grid spacing | 0.5° |
| Effective spatial resolution | Approximately 250–300 km |
| Reference mean | January 2003–December 2022 |
| Units | Millimeters of equivalent water height |
| Map color range | −200 to +200 mm |

Values are **groundwater storage anomalies relative to the reference mean**, not absolute groundwater volume or water-table depth. Blue indicates a positive anomaly and orange a negative anomaly. A positive value means more storage than the reference mean, not necessarily an increase from the previous month.

The map uses one color scale for the entire record. Conversion calculates the 98th percentile of absolute anomalies and rounds it up to a multiple of 50 mm, with a minimum limit of 50 mm. Values outside the range use the endpoint colors; the underlying values remain unchanged.

Uncertainty is taken from the product's `gwsc_uncertainty` variable. Dashed chart lines show value ± supplied uncertainty and do not imply a particular confidence level. Missing values remain `NaN` in the binary files, gaps in the chart, and empty CSV fields. Cells without a finite anomaly are not drawn. Missing months and dates beyond the bundled record are not interpolated or estimated, and the app does not automatically fetch new releases.

Source: Copernicus Climate Change Service (C3S) / ECMWF / GFZ, *C3S Globally Gridded Groundwater Storage Change*, v1.0. DOI: [10.5880/GFZ.C3S_GWSC_v1.0](https://doi.org/10.5880/GFZ.C3S_GWSC_v1.0). Data license: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See the [official product guide](https://confluence.ecmwf.int/x/sA0nJw) for methodology. The source is converted to Float32, arranged into monthly and cell-series layouts, and gzip-compressed for this app.

### Basemap and terrain sources

The basemap uses the Positron style from [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles / OpenStreetMap, with English place names where available and Latin-script names as a fallback. Terrain and hillshading use [Mapterhorn](https://mapterhorn.com/) Terrarium DEM tiles (512 px), loaded through its [TileJSON endpoint](https://tiles.mapterhorn.com/tilejson.json). See [Mapterhorn attribution](https://mapterhorn.com/attribution/) for elevation sources and terms. Basemap and terrain assets require external network access, including during local development.

## Local development

Use **Node.js 22.12 or later** and npm. A browser with WebGL2 and `DecompressionStream` support is required.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally `http://127.0.0.1:5173/`). Converted groundwater data is already included in `static/data/`; Python and CDS authentication are only needed to download or regenerate it.

Run the frontend tests and type checks:

```sh
npm test
npm run check
```

Build and preview with the GitHub Pages subpath:

```sh
BASE_PATH=/groundwater-storage npm run build
BASE_PATH=/groundwater-storage npm run preview
```

Open the preview URL with `/groundwater-storage/` appended (normally `http://127.0.0.1:4173/groundwater-storage/`). For hosting at the domain root, omit `BASE_PATH` from both commands. A nonempty base path must start with `/` and must not end with `/`.

SvelteKit configuration lives in the `sveltekit()` options in [vite.config.ts](vite.config.ts); this project does not use `svelte.config.js`. The root layout enables prerendering, and the static adapter writes pages and assets to `build/`, including a `404.html` fallback.

## Downloading and converting the official data

Python 3.13 is used in CI. Accept the dataset's terms in CDS and configure authentication according to the [CDS API setup instructions](https://cds.climate.copernicus.eu/how-to-api). The download script uses a project-root `.cdsapirc` if present; otherwise it uses the CDS client's normal configuration. `.cdsapirc` and `data-source/` are ignored by Git. Keep credentials outside `static/`.

Run these commands from the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/download_data.py
.venv/bin/python scripts/prepare_data.py data-source/C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc
.venv/bin/python scripts/validate_data.py data-source/C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

The downloader requests product v1.0, saves `data-source/groundwater-v1_0.zip`, and extracts the single NetCDF file. Use the actual downloaded filename if it differs from the example. To adopt a new product version, update the request in [scripts/download_data.py](scripts/download_data.py) to match the provider's API example, then convert and validate the new file.

The converter defaults to `static/data/` and 256 cells per series chunk. It accepts `--output` and `--chunk-size`; the validator accepts `--output` to check the same directory. When replacing an existing dataset, generate into a fresh directory and validate it before replacing `static/data/`, because conversion does not remove old frame or chunk files.

### Published data layout

| File | Contents |
| --- | --- |
| `manifest.json` | Calendar months, availability, grid and chunk sizes, color limit, source filename, SHA-256, and generation metadata |
| `cells.json` | Land cell coordinates in source grid order, with longitude normalized to [−180°, 180°) |
| `frames/YYYY-MM.bin.gz` | All cell anomalies for one observed month, followed by all cell uncertainties; no frame is generated for a missing month |
| `series/N.bin.gz` | Zero-based chunks of up to 256 cells, with each cell's full calendar series stored consecutively; all anomalies precede all uncertainties |

Binary values are little-endian Float32, with `NaN` for missing values, and each binary file is gzip-compressed. The bundled data directory is approximately **183 MiB**. The browser first loads the manifest and all cell coordinates, then fetches monthly frames as requested and the series chunk containing a selected cell. It does not download the entire dataset at startup.

Monthly loading prefetches the next two available observations and shares in-flight requests. Decoded monthly frames use a bounded least-recently-used cache; requests outside the current look-ahead window are cancelled. The 8 MiB budget covers cached value and uncertainty arrays, not total browser or GPU memory. Playback overlaps loading with the display interval and waits for late data without skipping calendar months. The map reuses grid geometry while the valid-cell mask stays the same, updating colors and heights independently; terrain sampling is invalidated by camera, elevation-source and terrain-setting changes.

[scripts/validate_data.py](scripts/validate_data.py) independently checks the source checksum, every published coordinate, month availability, and both variables across all cells and months in both binary layouts. It requires exact equality at Float32 precision, including missing-value masks. Source NetCDF files and credentials are not included in the static build.

## GitHub Pages deployment

Set the repository's **Settings → Pages → Source** to **GitHub Actions**. The [deployment workflow](.github/workflows/deploy.yml) runs on pushes to `main` and can also be started manually.

It installs dependencies, runs the Python unit tests, frontend tests, and Svelte/TypeScript checks, then builds and deploys `build/`. `BASE_PATH` is supplied by the Pages configuration action. Deployment uses the committed files in `static/data/`; it neither downloads the source dataset nor runs the full NetCDF validation. No CDS key is required in GitHub Actions.
