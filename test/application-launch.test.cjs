/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const code = ts.transpileModule(fs.readFileSync('src/lib/application-launch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const job = { id: 'JOB-UK-123', scheduleId: 'SCH-123', title: 'Warehouse Associate', location: 'London' };
function setup(response) {
  const dom = new JSDOM('', { url: 'http://127.0.0.1:3111', runScripts: 'outside-only' });
  const calls = [];
  const w = dom.window;
  // There is no browser extension, GM_* storage, popup or helper postMessage bridge.
  w.open = () => { throw new Error('A popup must not be required'); };
  w.postMessage = () => { throw new Error('An extension bridge must not be required'); };
  w.fetch = async (url, init) => { calls.push([url, init]); return response; };
  const exports = {};
  new w.Function('require', 'exports', code)(() => ({ readApiResponse: async res => {
    const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
  } }), exports);
  return { dom, w, calls, launch: exports.launchApplication };
}
test('Apply starts the built-in browser without popups, extensions, scripts or client profile transfer', async () => {
  const p = setup(Response.json({ task: { id: 'task-123' }, message: 'Amazon browser opened' }, { status: 202 }));
  try {
    let refreshed = false;
    p.w.addEventListener('application-progress-refresh', () => { refreshed = true; });
    assert.equal(await p.launch(job), 'Amazon browser opened');
    assert.equal(p.calls.length, 1);
    assert.equal(p.calls[0][0], '/api/desktop');
    assert.deepEqual(JSON.parse(p.calls[0][1].body), job);
    assert.equal(refreshed, true);
  } finally { p.dom.window.close(); }
});
test('unavailable shift and hosted-server errors are surfaced without opening a normal tab', async () => {
  for (const error of ['Shift unavailable', 'Open the desktop tool to launch its Amazon browser']) {
    const p = setup(Response.json({ error }, { status: 503 }));
    try { await assert.rejects(p.launch(job), new RegExp(error)); assert.equal(p.calls.length, 1); }
    finally { p.dom.window.close(); }
  }
});
