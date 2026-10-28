/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const client = compile('src/lib/application-launch.ts');
const helper = fs.readFileSync('browser-helper/content.js', 'utf8');

function setup(installed = true) {
  const dom = new JSDOM('', { url: 'https://amazon-job-apply.vercel.app/', runScripts: 'outside-only' });
  const w = dom.window;
  const stored = new Map();
  const requests = [];
  w.crypto.randomUUID = crypto.randomUUID;
  w.postMessage = data => w.dispatchEvent(new w.MessageEvent('message', { source: w, origin: w.location.origin, data }));
  w.GM_setValue = (key, value) => stored.set(key, value);
  w.GM_getValue = key => stored.get(key);
  w.GM_deleteValue = key => stored.delete(key);
  if (installed) w.eval(helper);
  const exports = {};
  new w.Function('require', 'exports', client)(() => ({ readApiResponse: async response => {
    const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
  } }), exports);
  w.fetch = async (url, init) => {
    requests.push([url, init]);
    if (url === '/api/agent') return Response.json({ profile: { firstName: 'Test', lastName: 'Candidate', phone: '07000000000', postcode: 'SW1A 1AA', cvBase64: 'data:application/pdf;base64,JVBERi0=', amazonPassword: 'must-not-transfer' } });
    return Response.json({ scheduleId: 'SCH-123', applyUrl: 'https://www.jobsatamazon.co.uk/application/uk/?jobId=JOB-UK-123#/consent?scheduleId=SCH-123' });
  };
  const tab = { closed: false, opener: {}, location: { href: '' }, close() { this.closed = true; } };
  return { dom, w, stored, requests, tab, launch: exports.launchApplication };
}
const job = { id: 'JOB-UK-123', scheduleId: 'SCH-123', title: 'Warehouse Associate', location: 'London' };

test('click pipeline verifies availability and hands off profile/CV locally before navigation', async () => {
  const p = setup();
  try {
    await p.launch(job, p.tab);
    assert.equal(p.requests[0][0], '/api/agent');
    assert.equal(p.requests[1][0], '/api/jobs/apply');
    assert.equal(p.tab.opener, null);
    assert.equal(p.tab.closed, false);
    assert.match(p.tab.location.href, /agmLaunch=/);
    assert.doesNotMatch(p.tab.location.href, /Candidate|base64|SW1A/);
    const entry = [...p.stored.values()][0];
    assert.equal(entry.scheduleId, 'SCH-123');
    assert.equal(entry.profile.firstName, 'Test');
    assert.match(entry.profile.cvBase64, /^data:application\/pdf/);
    assert.equal(entry.profile.amazonPassword, undefined);
  } finally { p.dom.window.close(); }
});

test('expired shift rejection closes the blank tab and never navigates', async () => {
  const p = setup();
  try {
    const fetch = p.w.fetch;
    p.w.fetch = async (url, init) => url === '/api/jobs/apply' ? Response.json({ error: 'Shift expired' }, { status: 409 }) : fetch(url, init);
    await assert.rejects(p.launch(job, p.tab), /expired/);
    assert.equal(p.tab.closed, true);
    assert.equal(p.tab.location.href, '');
    assert.equal(p.stored.size, 0);
  } finally { p.dom.window.close(); }
});

test('missing helper and blocked pop-ups produce actionable errors without starting an application', async () => {
  const p = setup(false);
  try {
    await assert.rejects(p.launch(job, null), /pop-ups/);
    let timeout;
    p.w.setTimeout = callback => { timeout = callback; return 1; };
    const pending = p.launch(job, p.tab);
    const rejected = assert.rejects(pending, /Install or update/);
    timeout();
    await rejected;
    assert.equal(p.requests.length, 0);
    assert.equal(p.tab.closed, true);
  } finally { p.dom.window.close(); }
});
