"""Check native installer payloads and run the installed application in CI."""
import argparse
from pathlib import Path
import os
import subprocess
import tempfile
from verify_web_package import validate_package, smoke_test


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--static-only', action='store_true')
    args = parser.parse_args()
    clients = Path(__file__).resolve().parent.parent
    suffix = '.exe' if os.name == 'nt' else '.pkg' if __import__('sys').platform == 'darwin' else '.deb'
    installers = list((clients / 'artifacts').glob('*' + suffix))
    if len(installers) != 1:
        parser.error('Expected exactly one native installer')
    with tempfile.TemporaryDirectory(prefix='limulus-install-check-') as temporary:
        destination = Path(temporary) / 'installed'
        if suffix == '.pkg':
            subprocess.run(['pkgutil', '--expand-full', str(installers[0]), str(destination)], check=True)
        elif suffix == '.deb':
            subprocess.run(['dpkg-deb', '--extract', str(installers[0]), str(destination)], check=True)
        else:
            subprocess.run([str(installers[0]), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', f'/DIR={destination}'], check=True, timeout=120)
        try:
            entries = list(destination.rglob('launch.cjs'))
            if len(entries) != 1:
                raise ValueError('Installer did not contain exactly one standalone application')
            application = entries[0].parent
            assets = validate_package(application)
            if not args.static_only:
                smoke_test(application, assets)
        finally:
            if suffix == '.exe' and (destination / 'unins000.exe').is_file():
                subprocess.run([str(destination / 'unins000.exe'), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], check=True, timeout=120)
        print(f'Verified installer: {installers[0].name}')


if __name__ == '__main__':
    main()
