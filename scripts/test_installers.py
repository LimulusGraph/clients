"""Inspect native installer definitions without invoking platform build tools."""
import json
import os
from pathlib import Path
import runpy
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch


class InstallerTests(unittest.TestCase):
    def build(self, system, machine, inspect):
        with tempfile.TemporaryDirectory(prefix='limulus installer paths ') as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            script = root / 'scripts/package-installer.py'
            shutil.copy2(Path(__file__).with_name('package-installer.py'), script)
            (root / 'package.json').write_text(json.dumps({'version': '1.2.3'}))
            (root / 'artifacts').mkdir()
            payload = root / 'limulus-web'
            (payload / 'bin').mkdir(parents=True)
            (payload / 'bin/node.exe').write_text('runtime fixture')
            (payload / 'launch.cjs').write_text('launcher fixture')
            logo = root / 'apps/vscode-extension/logo.jpg'
            logo.parent.mkdir(parents=True)
            logo.write_bytes(b'fixture')
            target = {'Windows': 'win32-x64', 'Linux': 'linux-x64', 'Darwin': 'darwin-arm64'}[system]
            with tarfile.open(root / 'artifacts' / f'limulus-web-{target}.tar.gz', 'w:gz') as archive:
                archive.add(payload, arcname='limulus-web')
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                inspect(command)
            with patch('platform.system', return_value=system), patch('platform.machine', return_value=machine), patch('shutil.which', return_value='ISCC.exe'), patch('subprocess.run', side_effect=run), patch.dict(os.environ, {'MACOS_INSTALLER_IDENTITY': '', 'ISCC': 'ISCC.exe'}):
                runpy.run_path(str(script), run_name='__main__')
            self.assertEqual(len(calls), 1)

    def test_windows_installer_uses_bundled_runtime_and_per_user_shortcut(self):
        def inspect(command):
            definition = Path(command[1]).read_text()
            self.assertIn('PrivilegesRequired=lowest', definition)
            self.assertIn('ArchitecturesAllowed=x64compatible', definition)
            self.assertIn('Filename: "{app}\\bin\\node.exe"', definition)
            self.assertIn('Parameters: """{app}\\launch.cjs"""', definition)
            self.assertIn('recursesubdirs', definition)
        self.build('Windows', 'AMD64', inspect)

    def test_linux_installer_contains_runtime_and_declares_python(self):
        def inspect(command):
            payload = Path(command[-2])
            self.assertTrue((payload / 'opt/limulus/launch.cjs').is_file())
            self.assertIn('/opt/limulus/limulus', (payload / 'usr/bin/limulus').read_text())
            self.assertIn('python3-venv', (payload / 'DEBIAN/control').read_text())
        self.build('Linux', 'x86_64', inspect)

    def test_macos_installer_has_application_and_terminal_launcher(self):
        def inspect(command):
            payload = Path(command[command.index('--root') + 1])
            app = payload / 'Applications/Limulus.app/Contents'
            self.assertTrue((app / 'Resources/limulus-web/launch.cjs').is_file())
            self.assertIn('Launch Limulus.command', (app / 'MacOS/Limulus').read_text())
        self.build('Darwin', 'arm64', inspect)


if __name__ == '__main__':
    unittest.main()
