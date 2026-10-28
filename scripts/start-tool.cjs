/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:3111';
async function ready() {
  try {
    const response = await fetch(url + '/api/desktop?capability=1', { signal: AbortSignal.timeout(2000) });
    return (await response.json()).service === 'amazon-job-monitor';
  } catch { return false; }
}
(async () => {
  if (!fs.existsSync(path.join(root, 'node_modules/next'))) throw new Error('Run npm ci in this folder once, then open the tool again.');
  if (!await ready()) {
    const folder = path.join(root, '.amazon-session'); fs.mkdirSync(folder, { recursive: true });
    const log = fs.openSync(path.join(folder, 'tool.log'), 'a');
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run dev -- -p 3111 -H 127.0.0.1'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    child.unref(); fs.closeSync(log);
    let found = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await ready()) { found = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!found) throw new Error('The desktop tool could not start. See .amazon-session/tool.log.');
  }
  execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start "" "' + url + '"'], { windowsHide: true });
  console.log('Desktop tool ready: ' + url + '\nNo extension or userscript installation is needed.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
