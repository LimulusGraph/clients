// Installed entry point: the surrounding launcher uses the bundled Node runtime.
const { spawn } = require('node:child_process');
const { start } = require('./server.cjs');

async function main() {
  const host = await start({ port: Number(process.env.PORT || 0) });
  console.log(`Limulus: ${host.url}`);
  console.log('Keep this window open. Press Ctrl+C to stop Limulus.');
  let closing;
  const close = () => { closing ||= host.close(); return closing; };
  for (const signal of (process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'])) process.once(signal, () => close().then(() => process.exit()));
  if (process.env.LIMULUS_NO_BROWSER !== '1') {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', host.url] : [host.url];
    const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log(`Open ${host.url} in your browser.`));
    browser.on('exit', code => { if (code) console.log(`Open ${host.url} in your browser.`); });
  }
  return host;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
