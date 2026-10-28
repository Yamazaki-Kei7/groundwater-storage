"""Independently compare every published value with the source NetCDF."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
import xarray as xr


def validate(source: Path, output: Path):
    manifest = json.loads((output / 'manifest.json').read_text())
    cells = json.loads((output / 'cells.json').read_text())
    count = manifest['cellCount']
    months = manifest['months']
    values = np.full((len(months), count), np.nan, dtype='float32')
    errors = np.full_like(values, np.nan)
    with source.open('rb') as handle:
        assert hashlib.file_digest(handle, 'sha256').hexdigest() == manifest['sourceSha256']
    with xr.open_dataset(source) as ds:
        raw = ds.gwsc.transpose('time', 'lat', 'lon').values
        raw_u = ds.gwsc_uncertainty.transpose('time', 'lat', 'lon').values
        valid = np.isfinite(raw) & (np.abs(raw) < 1e20)
        rows, columns = np.where(valid.any(axis=0))
        assert count == len(cells) == len(rows)
        for cell, row, column in zip(cells, rows, columns):
            assert cell['lat'] == float(ds.lat.values[row])
            lon = float(ds.lon.values[column])
            assert cell['lon'] == lon - 360 if lon >= 180 else cell['lon'] == lon
        for source_i, month in enumerate(ds.time.values.astype('datetime64[M]').astype(str)):
            target_i = months.index(month)
            v = raw[source_i, rows, columns].astype('float32')
            u = raw_u[source_i, rows, columns].astype('float32')
            v[~np.isfinite(v) | (np.abs(v) > 1e20)] = np.nan
            u[~np.isfinite(u) | (u < 0) | (u > 1e20)] = np.nan
            values[target_i] = v
            errors[target_i] = u
    for i, month in enumerate(months):
        expected_available = bool(np.isfinite(values[i]).any())
        assert manifest['available'][i] == expected_available
        path = output / 'frames' / f'{month}.bin.gz'
        if not expected_available:
            assert not path.exists(), f'Unexpected frame for missing month {month}'
            continue
        frame = np.frombuffer(gzip.decompress(path.read_bytes()), dtype='<f4').reshape(2, count)
        np.testing.assert_array_equal(frame[0], values[i])
        np.testing.assert_array_equal(frame[1], errors[i])
    size = manifest['seriesChunkSize']
    for chunk, start in enumerate(range(0, count, size)):
        chunk_count = min(size, count - start)
        series = np.frombuffer(gzip.decompress((output / 'series' / f'{chunk}.bin.gz').read_bytes()), dtype='<f4').reshape(2, chunk_count, len(months))
        np.testing.assert_array_equal(series[0], values[:, start:start + size].T)
        np.testing.assert_array_equal(series[1], errors[:, start:start + size].T)
    print(json.dumps({'cells': count, 'calendarMonths': len(months), 'observedMonths': sum(manifest['available']),
                      'missingMonths': manifest['available'].count(False), 'valuesComparedPerLayout': int(values.size * 2),
                      'comparison': 'exact float32 equality including NaN masks', 'sourceSha256': manifest['sourceSha256']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('static/data'))
    args = parser.parse_args()
    validate(args.source, args.output)
