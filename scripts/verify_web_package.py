"""Verify a standalone clients archive outside both checkouts, then smoke-test it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import signal
import subprocess
import tarfile
import tempfile
import threading
import urllib.request
import shutil
import zipfile
import stat


def validate_package(root):
    required = [
        'package.json', 'server.cjs', 'launch.cjs', 'NODE-LICENSE.txt', 'dist/index.html',
        'node_modules/@limulus/editor-core/package.json',
        'node_modules/@limulus/node-host/package.json',
    ]
    for name in required:
        if not (root / name).is_file():
            raise ValueError(f'Archive is missing {name}')
    node = root / 'bin' / ('node.exe' if (root / 'bin/node.exe').exists() else 'node')
    launcher = root / ('limulus.cmd' if node.suffix == '.exe' else 'limulus')
    if not node.is_file() or not launcher.is_file():
        raise ValueError('Archive is missing its bundled Node runtime or launcher')
    if not list((root / 'bin').glob('limulus-server-*')):
        raise ValueError('Archive is missing the execution backend')
    for filename in root.rglob('*'):
        if filename.is_symlink():
            raise ValueError(f'Archive contains a symlink: {filename.relative_to(root)}')
    html = (root / 'dist/index.html').read_text(encoding='utf-8')
    assets = re.findall(r'(?:src|href)="(/assets/[^"?#]+)', html)
    if not assets:
        raise ValueError('Browser entry point contains no built assets')
    for asset in assets:
        if not (root / 'dist' / asset.lstrip('/')).is_file():
            raise ValueError(f'Archive is missing browser asset {asset}')
    return assets


def smoke_test(root, assets):
    env = dict(os.environ, PORT='0', LIMULUS_NO_BROWSER='1')
    # The archive must use its own backend and packages, never an installed checkout.
    for name in ['NODE_PATH', 'NODE_OPTIONS', 'LIMULUS_SERVER_PATH']:
        env.pop(name, None)
    node = root / 'bin' / ('node.exe' if os.name == 'nt' else 'node')
    process = subprocess.Popen([str(node), 'launch.cjs'], cwd=root, env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               start_new_session=os.name != 'nt',
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    lines = queue.Queue()
    def collect():
        for line in process.stdout:
            lines.put(line)
        lines.put(None)
    threading.Thread(target=collect, daemon=True).start()
    project = None
    try:
        line = lines.get(timeout=30)
        if line is None or not re.fullmatch(r'Limulus: http://127\.0\.0\.1:\d+\n', line):
            raise RuntimeError(f'Packaged host failed to start: {line}')
        url = line.strip().removeprefix('Limulus: ')
        def post(operation, value):
            request = urllib.request.Request(url + '/api/' + operation,
                        data=json.dumps(value).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read().decode()
        with urllib.request.urlopen(url, timeout=10) as response:
            assert 'id="root"' in response.read().decode(), 'Editor page did not load'
        for asset in assets:
            with urllib.request.urlopen(url + asset, timeout=10) as response:
                assert response.read(), f'Empty asset: {asset}'
        initial = json.loads(post('new', {}))
        project = initial['path']
        graph = json.loads(post('edit', {'path': project, 'graph': initial['graph'], 'action': {'type': 'add'}}))['graph']
        node_id = graph['nodes'][0]['id']
        post('source', {'path': project, 'graph': graph, 'id': node_id, 'code': "print('limulus-cloud-smoke-ok')\n"})
        def run(mode):
            stream = post('run', {'path': project, 'graph': graph, 'mode': mode, 'id': node_id})
            events = [json.loads(line[5:].strip()) for line in stream.splitlines() if line.startswith('data:')]
            assert events and events[-1].get('kind') == 'completed' and events[-1].get('success'), stream
            return events
        events = run('all')
        assert any('limulus-cloud-smoke-ok' in event.get('text', '') for event in events), events
        run('reset')
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=False)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if project:
            directory = Path(project).parent
            if directory.name.startswith('limulus-web-'):
                shutil.rmtree(directory)


def verify_extension(clients, node, static_only):
    archives = list((clients / 'artifacts').glob('*.vsix'))
    if len(archives) != 1:
        raise ValueError('Expected exactly one native VSIX in artifacts/')
    with tempfile.TemporaryDirectory(prefix='limulus-vsix-check-') as temporary:
        with zipfile.ZipFile(archives[0]) as package:
            for member in package.infolist():
                if stat.S_ISLNK(member.external_attr >> 16):
                    raise ValueError('VSIX must not contain workspace symlinks')
                destination = Path(temporary, member.filename).resolve()
                if not destination.is_relative_to(Path(temporary).resolve()):
                    raise ValueError('Invalid VSIX path')
                package.extract(member, temporary)
                if destination.is_file() and os.name != 'nt':
                    destination.chmod((member.external_attr >> 16) & 0o777 or 0o644)
        extension = Path(temporary) / 'extension'
        manifest = json.loads((extension / 'package.json').read_text())
        assert manifest['name'] == 'limulus'
        graph_language = next(language for language in manifest['contributes']['languages']
                              if '.lmg' in language.get('extensions', []))
        for theme in ['light', 'dark']:
            icon = (extension / graph_language['icon'][theme]).read_bytes()
            assert icon[:8] == b'\x89PNG\r\n\x1a\n' and icon[25] == 6, 'Expected an RGBA PNG file icon'
        for filename in ['dist/graph.js', 'dist/graph.css', 'dist/preview.js', 'src/preview_parser.py']:
            assert (extension / filename).is_file(), filename
        code = """
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? {} : original.call(this, name, ...args); };
require('./src/extension.cjs');
Module._load = original;
"""
        if not static_only:
            code += """
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Runtime } = require('./src/runtime.cjs');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'limulus-vsix-run-'));
  const runtime = new Runtime(process.cwd(), () => ({}), { append() {}, appendLine() {} });
  try {
    await fs.writeFile(path.join(directory, '1.py'), "print('vsix-runtime-ok')\\n");
    const project = path.join(directory, 'graph.lmg');
    await fs.writeFile(project, JSON.stringify({nodes:[{id:'1',data:{scriptPath:'1.py'}}],edges:[]}));
    const events = [];
    await runtime.run(project, '', 'all', event => events.push(event));
    if (!events.some(event => event.text?.includes('vsix-runtime-ok')) || !events.at(-1).success) throw new Error(JSON.stringify(events));
  } finally { await runtime.dispose(); await fs.rm(directory, {recursive:true,force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
"""
        env = dict(os.environ)
        for name in ['NODE_PATH', 'NODE_OPTIONS', 'LIMULUS_SERVER_PATH']:
            env.pop(name, None)
        subprocess.run([str(node), '-e', code], cwd=extension, env=env, check=True, timeout=120)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clients', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--server', type=Path)
    parser.add_argument('--static-only', action='store_true', help='Inspect archive without starting network listeners (local sandbox only)')
    args = parser.parse_args()
    clients = args.clients.resolve()
    archives = list((clients / 'artifacts').glob('limulus-web-*.tar.gz'))
    if len(archives) != 1:
        parser.error('Expected exactly one freshly built native web archive')
    archive = archives[0]
    with tempfile.TemporaryDirectory(prefix='limulus-release-check-') as temporary:
        with tarfile.open(archive) as package:
            package.extractall(temporary, filter='data')
        root = Path(temporary) / 'limulus-web'
        assets = validate_package(root)
        # This subprocess resolves packages from the extracted tree, with no npm install.
        env = dict(os.environ)
        for name in ['NODE_PATH', 'NODE_OPTIONS']:
            env.pop(name, None)
        subprocess.run([str(root / 'bin' / ('node.exe' if os.name == 'nt' else 'node')), '-e', "require('./server.cjs'); require('@limulus/editor-core/graph'); require('@limulus/node-host/runtime');"], cwd=root, env=env, check=True)
        if not args.static_only:
            smoke_test(root, assets)
        verify_extension(clients, root / 'bin' / ('node.exe' if os.name == 'nt' else 'node'), args.static_only)
    server = (args.server or clients.parent / 'server').resolve()
    def revision(directory):
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=directory, text=True).strip()
    (clients / 'artifacts' / ('BUILD-' + archive.name.removeprefix('limulus-web-').removesuffix('.tar.gz') + '.txt')).write_text(
        f'Server: {revision(server)}\nClients: {revision(clients)}\nArchive: {archive.name}\n', encoding='utf-8')
    for artifact in (clients / 'artifacts').iterdir():
        if artifact.is_file() and artifact.suffix != '.sha256':
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            Path(str(artifact) + '.sha256').write_text(f'{digest}  {artifact.name}\n', encoding='utf-8')
    print(f'Verified {archive.name}' + (' (static checks only)' if args.static_only else ' including live Python execution'))


if __name__ == '__main__':
    main()
