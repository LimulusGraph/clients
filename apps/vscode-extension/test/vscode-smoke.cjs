// Optional real Extension Development Host smoke test (invoked with --extensionTestsPath).
const assert = require('node:assert/strict');
const vscode = require('vscode');
exports.run = async function () {
  await vscode.workspace.getConfiguration('limulus').update('autoStart', false, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension('limulus-local.limulus');
  assert.ok(extension, 'Extension was not registered');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('limulus.newGraph'));
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Open a temporary test workspace');
  const uri = vscode.Uri.joinPath(folder.uri, 'smoke.lmg');
  await vscode.workspace.fs.writeFile(uri, Buffer.from('{"nodes":[],"edges":[]}\n'));
  await vscode.commands.executeCommand('vscode.openWith', uri, 'limulus.graph');
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
  assert.ok(tabs.some(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'limulus.graph'), 'Custom graph editor did not open');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  console.log('Limulus VS Code activation and custom editor smoke test passed.');
};
