import gzip
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import xarray as xr

from prepare_data import prepare


class ConversionTest(unittest.TestCase):
    def test_round_trip_coordinates_missing_months_and_series(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.nc'
            values = np.array([[[-30., 0.], [np.nan, 8.]], [[-40., 5.], [np.nan, np.nan]]])
            xr.Dataset(
                {'gwsc': (('time', 'lat', 'lon'), values, {'units': 'mm'}),
                 'gwsc_uncertainty': (('time', 'lat', 'lon'), np.where(np.isfinite(values), 7., np.nan), {'units': 'mm'})},
                coords={'time': np.array(['2002-04-01', '2002-06-01'], dtype='datetime64[D]'), 'lat': [10., -10.], 'lon': [350., 0.]},
                attrs={'id': 'C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc', 'summary': 'anomalies with respect to mean 2003-01 - 2022-12'},
            ).to_netcdf(source)
            prepare(source, root / 'output', chunk_size=2)
            manifest = json.loads((root / 'output/manifest.json').read_text())
            self.assertEqual(manifest['months'], ['2002-04', '2002-05', '2002-06'])
            self.assertEqual(manifest['available'], [True, False, True])
            self.assertEqual(manifest['cellCount'], 3)
            self.assertEqual(manifest['version'], 'v1.0')
            self.assertEqual(manifest['baselinePeriod'], '2003-01〜2022-12')
            cells = json.loads((root / 'output/cells.json').read_text())
            self.assertEqual(cells, [{'lon': -10., 'lat': 10.}, {'lon': 0., 'lat': 10.}, {'lon': 0., 'lat': -10.}])
            frame = np.frombuffer(gzip.decompress((root / 'output/frames/2002-04.bin.gz').read_bytes()), dtype='<f4')
            np.testing.assert_equal(frame, [-30., 0., 8., 7., 7., 7.])
            series = np.frombuffer(gzip.decompress((root / 'output/series/0.bin.gz').read_bytes()), dtype='<f4')
            np.testing.assert_equal(series[:6], [-30., np.nan, -40., 0., np.nan, 5.])
            self.assertFalse((root / 'output/frames/2002-05.bin.gz').exists())
            self.assertEqual(len(manifest['sourceSha256']), 64)

    def test_rejects_wrong_units(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.nc'
            xr.Dataset({'gwsc': (('time', 'lat', 'lon'), [[[1.]]], {'units': 'cm'}),
                        'gwsc_uncertainty': (('time', 'lat', 'lon'), [[[1.]]], {'units': 'mm'})},
                       coords={'time': np.array(['2002-04-01'], dtype='datetime64[D]'), 'lat': [0.], 'lon': [0.]}).to_netcdf(source)
            with self.assertRaisesRegex(ValueError, 'mm'):
                prepare(source, Path(directory) / 'output')


if __name__ == '__main__':
    unittest.main()
