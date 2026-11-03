"""Wrap the complete, runtime-bundled web archive in a native installer."""
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parent.parent
system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'win32'}[platform.system()]
arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64', 'AMD64': 'x64', 'ARM64': 'arm64'}[platform.machine()]
version = json.loads((root / 'package.json').read_text())['version']
archive = root / 'artifacts' / f'limulus-web-{system}-{arch}.tar.gz'
if not archive.is_file():
    raise SystemExit('Run npm run package:web first.')


def executable(filename, text):
    filename.parent.mkdir(parents=True, exist_ok=True)
    filename.write_text(text)
    filename.chmod(0o755)


with tempfile.TemporaryDirectory(prefix='limulus-installer-') as temporary:
    staging = Path(temporary)
    with tarfile.open(archive) as package:
        package.extractall(staging, filter='data')
    payload = staging / 'payload'
    if system == 'darwin':
        app = payload / 'Applications/Limulus.app'
        resources = app / 'Contents/Resources'
        resources.mkdir(parents=True)
        shutil.move(staging / 'limulus-web', resources / 'limulus-web')
        executable(resources / 'Launch Limulus.command', '#!/bin/sh\nAPP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$APP_ROOT/limulus-web/limulus"\n')
        executable(app / 'Contents/MacOS/Limulus', '#!/bin/sh\nAPP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)\nexec /usr/bin/open -a Terminal "$APP_ROOT/Launch Limulus.command"\n')
        with (app / 'Contents/Info.plist').open('wb') as output:
            plistlib.dump({'CFBundleIdentifier': 'org.limulusgraph.limulus', 'CFBundleName': 'Limulus',
                          'CFBundleExecutable': 'Limulus', 'CFBundlePackageType': 'APPL',
                          'CFBundleShortVersionString': version, 'CFBundleVersion': version,
                          'LSMinimumSystemVersion': '13.0'}, output)
        installer = root / 'artifacts' / f'limulus-{version}-darwin-{arch}.pkg'
        command = ['pkgbuild', '--root', str(payload), '--identifier', 'org.limulusgraph.limulus',
                   '--version', version, '--install-location', '/']
        if os.environ.get('MACOS_INSTALLER_IDENTITY'):
            command += ['--sign', os.environ['MACOS_INSTALLER_IDENTITY']]
        subprocess.run(command + [str(installer)], check=True)
    elif system == 'win32':
        application = staging / 'limulus-web'
        inno = os.environ.get('ISCC') or shutil.which('ISCC.exe')
        if not inno:
            candidate = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Inno Setup 6/ISCC.exe'
            if candidate.is_file():
                inno = str(candidate)
        if not inno:
            raise SystemExit('Install Inno Setup 6 or set ISCC to its compiler path.')
        output_name = f'limulus-{version}-win32-{arch}-setup'
        architecture = 'arm64' if arch == 'arm64' else 'x64compatible'
        definition = staging / 'limulus.iss'
        definition.write_text(f'''[Setup]
AppId=LimulusGraph.Limulus
AppName=Limulus
AppVersion={version}
DefaultDirName={{localappdata}}\\Programs\\Limulus
DefaultGroupName=Limulus
PrivilegesRequired=lowest
MinVersion=10.0
ArchitecturesAllowed={architecture}
ArchitecturesInstallIn64BitMode={architecture}
OutputDir={root / 'artifacts'}
OutputBaseFilename={output_name}
Compression=lzma2
SolidCompression=yes
UninstallDisplayName=Limulus
[Files]
Source: "{application}\\*"; DestDir: "{{app}}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{{group}}\\Limulus"; Filename: "{{app}}\\bin\\node.exe"; Parameters: """{{app}}\\launch.cjs"""; WorkingDir: "{{userdocs}}"
Name: "{{group}}\\Uninstall Limulus"; Filename: "{{uninstallexe}}"
''', encoding='utf-8')
        subprocess.run([inno, str(definition)], check=True)
        installer = root / 'artifacts' / f'{output_name}.exe'
    else:
        application = payload / 'opt/limulus'
        application.parent.mkdir(parents=True)
        shutil.move(staging / 'limulus-web', application)
        executable(payload / 'usr/bin/limulus', '#!/bin/sh\nexec /opt/limulus/limulus "$@"\n')
        desktop = payload / 'usr/share/applications/limulus.desktop'
        desktop.parent.mkdir(parents=True)
        desktop.write_text('[Desktop Entry]\nType=Application\nName=Limulus\nComment=Visual Python experiments\nExec=/usr/bin/limulus\nIcon=limulus\nTerminal=true\nCategories=Development;Science;\n')
        icon = payload / 'usr/share/pixmaps/limulus.jpg'
        icon.parent.mkdir(parents=True)
        shutil.copy2(root / 'apps/vscode-extension/logo.jpg', icon)
        control = payload / 'DEBIAN/control'
        control.parent.mkdir()
        deb_arch = {'x64': 'amd64', 'arm64': 'arm64'}[arch]
        control.write_text(f'Package: limulus\nVersion: {version}\nArchitecture: {deb_arch}\nMaintainer: LimulusGraph\nDepends: python3, python3-venv, xdg-utils, libc6 (>= 2.28), libstdc++6\nSection: science\nPriority: optional\nDescription: Visual Python experiments in a local browser workspace\n Includes the Node.js runtime and the Limulus execution backend.\n')
        installer = root / 'artifacts' / f'limulus-{version}-linux-{arch}.deb'
        subprocess.run(['dpkg-deb', '--root-owner-group', '--build', str(payload), str(installer)], check=True)
    print(installer)
