"""Convert the official CF NetCDF to portable little-endian Float32 gzip files."""
import argparse
import gzip
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr


SOURCE_URL = 'https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')), encoding='utf-8')


def write_binary(path, values, uncertainty):
    payload = np.concatenate([values.ravel(), uncertainty.ravel()]).astype('<f4').tobytes()
    path.write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))


def prepare(source: Path, output: Path, chunk_size=256):
    if chunk_size < 1:
        raise ValueError('chunk_size must be positive')
    with xr.open_dataset(source, decode_cf=True) as ds:
        for variable in ('gwsc', 'gwsc_uncertainty'):
            if ds[variable].attrs.get('units') != 'mm':
                raise ValueError(f'{variable} must use mm units')
        values = ds.gwsc.transpose('time', 'lat', 'lon').to_numpy().astype('float32')
        uncertainty = ds.gwsc_uncertainty.transpose('time', 'lat', 'lon').to_numpy().astype('float32')
        values[~np.isfinite(values) | (np.abs(values) > 1e20)] = np.nan
        uncertainty[~np.isfinite(uncertainty) | (uncertainty < 0) | (uncertainty > 1e20)] = np.nan
        months = ds.time.to_numpy().astype('datetime64[M]')
        if len(set(months)) != len(months) or not np.all(months[:-1] < months[1:]):
            raise ValueError('time must contain unique ascending months')
        calendar = np.arange(months[0], months[-1] + np.timedelta64(1, 'M'), dtype='datetime64[M]')
        land = np.any(np.isfinite(values), axis=0)
        count = int(land.sum())
        if not count:
            raise ValueError('No valid groundwater cells')
        lon, lat = np.meshgrid(ds.lon.to_numpy(), ds.lat.to_numpy())
        cells = [{'lon': float((x + 180) % 360 - 180), 'lat': float(y)} for x, y in zip(lon[land], lat[land])]
        v = np.full((len(calendar), count), np.nan, dtype='float32')
        u = np.full_like(v, np.nan)
        positions = np.searchsorted(calendar, months)
        v[positions] = values[:, land]
        u[positions] = uncertainty[:, land]
        available = np.any(np.isfinite(v), axis=1)
        resolution = float(abs(np.diff(ds.lon.to_numpy()).mean())) if ds.sizes['lon'] > 1 else 0.5
        product_id = str(ds.attrs.get('id', source.name))
        version_match = re.search(r'_(v\d+(?:\.\d+)*)\.nc$', product_id)
        version = str(ds.attrs.get('product_version') or (version_match[1] if version_match else 'unspecified'))
        baseline = str(ds.attrs.get('summary', 'See source NetCDF metadata'))
        baseline_match = re.search(r'mean.*?(\d{4}-\d{2})\s*-\s*(\d{4}-\d{2})', baseline)
        baseline_period = f'{baseline_match[1]}〜{baseline_match[2]}' if baseline_match else '提供元メタデータを参照'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'frames').mkdir(exist_ok=True)
    (output / 'series').mkdir(exist_ok=True)
    names = [str(month) for month in calendar]
    for i, month in enumerate(names):
        if available[i]:
            write_binary(output / 'frames' / f'{month}.bin.gz', v[i], u[i])
    for chunk, start in enumerate(range(0, count, chunk_size)):
        write_binary(output / 'series' / f'{chunk}.bin.gz', v[:, start:start + chunk_size].T, u[:, start:start + chunk_size].T)
    write_json(output / 'cells.json', cells)
    with source.open('rb') as handle:
        checksum = hashlib.file_digest(handle, 'sha256').hexdigest()
    # A single global colour scale keeps all months visually comparable.
    limit = float(max(50, np.ceil(np.nanpercentile(np.abs(v), 98) / 50) * 50))
    manifest = {
        'schemaVersion': 1, 'ready': True, 'title': 'C3S Groundwater Storage Change',
        'sourceUrl': SOURCE_URL, 'version': version, 'units': 'mm', 'baseline': baseline, 'baselinePeriod': baseline_period,
        'resolution': resolution, 'effectiveResolutionKm': '250–300',
        'months': names, 'available': available.tolist(), 'cellCount': count,
        'seriesChunkSize': chunk_size, 'colorLimit': limit,
        'sourceSha256': checksum, 'sourceFile': source.name,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'license': 'CC-BY-4.0', 'encoding': 'gzip; little-endian float32; values then uncertainty',
    }
    # Publish the manifest last so an interrupted conversion is not advertised as ready.
    write_json(output / 'manifest.json', manifest)
    print(f'Converted {count} cells, {int(available.sum())}/{len(names)} months; SHA256 {checksum}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('static/data'))
    parser.add_argument('--chunk-size', type=int, default=256)
    args = parser.parse_args()
    prepare(args.source, args.output, args.chunk_size)
