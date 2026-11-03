import tempfile
from pathlib import Path
import unittest
from verify_web_package import validate_package


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ['package.json', 'server.cjs', 'launch.cjs', 'NODE-LICENSE.txt', 'bin/node', 'limulus', 'dist/assets/main.js',
                     'node_modules/@limulus/editor-core/package.json',
                     'node_modules/@limulus/node-host/package.json', 'bin/limulus-server-linux-x64']:
            filename = self.root / name
            filename.parent.mkdir(parents=True, exist_ok=True)
            filename.write_text('{}')
        (self.root / 'dist/index.html').write_text('<div id="root"></div><script src="/assets/main.js"></script>')

    def test_complete_package(self):
        self.assertEqual(validate_package(self.root), ['/assets/main.js'])

    def test_missing_host_dependency(self):
        (self.root / 'node_modules/@limulus/node-host/package.json').unlink()
        with self.assertRaisesRegex(ValueError, 'node-host'):
            validate_package(self.root)

    def test_missing_browser_asset(self):
        (self.root / 'dist/assets/main.js').unlink()
        with self.assertRaisesRegex(ValueError, 'main.js'):
            validate_package(self.root)

    def test_missing_backend(self):
        (self.root / 'bin/limulus-server-linux-x64').unlink()
        with self.assertRaisesRegex(ValueError, 'backend'):
            validate_package(self.root)

    def test_workspace_symlink(self):
        try:
            (self.root / 'workspace-link').symlink_to(self.root / 'dist', target_is_directory=True)
        except OSError:
            self.skipTest('Symlink creation is not permitted on this host')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            validate_package(self.root)


if __name__ == '__main__':
    unittest.main()
