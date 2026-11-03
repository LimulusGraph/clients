"""Produce an installable local VSIX without requiring a publisher account or vsce."""
import json
import pathlib
import platform
import zipfile
from xml.sax.saxutils import escape

root = pathlib.Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text())
system = {'Darwin': 'darwin', 'Linux': 'linux', 'Windows': 'win32'}[platform.system()]
arch = {'arm64': 'arm64', 'aarch64': 'arm64', 'x86_64': 'x64', 'AMD64': 'x64', 'ARM64': 'arm64'}[platform.machine()]
binary = root / 'bin' / (f'limulus-server-{system}-{arch}' + ('.exe' if system == 'win32' else ''))
if not binary.exists() or not (root / 'dist/graph.js').exists():
    raise SystemExit('Run npm run build before packaging.')
target = f'{system}-{arch}'
icon = root / package['icon']
if not icon.is_file():
    raise SystemExit(f'Extension icon is missing: {icon}')
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
<Metadata><Identity Language="en-US" Id="limulus" Version="{package['version']}" Publisher="{package['publisher']}" TargetPlatform="{target}"/>
<DisplayName>{escape(package['displayName'])}</DisplayName><Description xml:space="preserve">{escape(package['description'])}</Description>
<Icon>extension/{escape(package['icon'])}</Icon>
<Tags>python,graph,data-science</Tags><Categories>Data Science,Visualization</Categories><GalleryFlags>Public</GalleryFlags>
<Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{package['engines']['vscode']}"/>
<Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
<Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true"/></Properties></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/>
<Assets><Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/{escape(package['icon'])}" Addressable="true"/>
<Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
<Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets>
</PackageManifest>'''
content_types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="exe" ContentType="application/octet-stream"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="py" ContentType="text/plain"/><Default Extension="LICENSE" ContentType="text/plain"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="xml" ContentType="text/xml"/><Default Extension="" ContentType="application/octet-stream"/></Types>'''
output = root / f"limulus-{package['version']}-{target}.vsix"
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('extension.vsixmanifest', manifest)
    archive.writestr('[Content_Types].xml', content_types)
    for file in [root / 'README.md', icon, binary, *sorted((root / 'src').glob('*.cjs')), *sorted((root / 'src').glob('*.py')), *sorted((root / 'vendor').glob('*')), *sorted((root / 'dist').glob('*'))]:
        if file.is_file():
            archive.write(file, 'extension/' + str(file.relative_to(root)))
    packaged = dict(package, name='limulus')
    packaged.pop('dependencies', None)
    archive.writestr('extension/package.json', json.dumps(packaged, indent=2))
    # Workspace packages must be real files, not symlinks outside the VSIX.
    for name in ['editor-core', 'node-host']:
        source = root.parent.parent / 'packages' / name
        for file in sorted(source.glob('*')):
            if file.is_file():
                archive.write(file, f'extension/node_modules/@limulus/{name}/' + file.name)
print(output)
