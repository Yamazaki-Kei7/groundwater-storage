"""Download the complete official C3S GWSC record with a local CDS config."""
import os
from pathlib import Path
import zipfile

import cdsapi


def main():
    config = Path('.cdsapirc').resolve()
    if config.is_file():
        os.environ['CDSAPI_RC'] = str(config)
    target = Path('data-source')
    target.mkdir(exist_ok=True)
    archive = target / 'groundwater-v1_0.zip'
    client = cdsapi.Client(quiet=True)
    client.retrieve('satellite-groundwater-storage', {
        'variable': ['gravity_based_groundwater_storage_change'],
        'version': ['v1_0'],
    }, str(archive))
    with zipfile.ZipFile(archive) as zipped:
        files = [item for item in zipped.infolist() if item.filename.endswith('.nc')]
        if len(files) != 1:
            raise ValueError('Expected one NetCDF in official archive')
        item = files[0]
        destination = target / Path(item.filename).name
        with zipped.open(item) as src, destination.open('wb') as dst:
            import shutil
            shutil.copyfileobj(src, dst)
    print(f'Downloaded {destination}')


if __name__ == '__main__':
    main()
