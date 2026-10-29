/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { NextRequest } = require('next/server');

function load(name, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(key => dependencies[key] || require(key), mod, mod.exports);
  return mod.exports;
}
const copy = value => value == null ? value : structuredClone(value);
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, target]) => operator === '$ne' ? row[key] !== target : operator === '$lte' ? row[key] <= target : operator === '$gt' ? row[key] > target : false);
    }
    return row[key] === value;
  });
}
function database() {
  const collections = new Map();
  return { collection(name) {
    if (collections.has(name)) return collections.get(name);
    const rows = []; let singleActive = false;
    const duplicate = () => Object.assign(new Error('duplicate'), { code: 11000 });
    const c = {
      rows,
      async createIndex(_keys, options) { if (options?.partialFilterExpression?.active) singleActive = true; },
      async findOne(query) { return copy(rows.find(row => matches(row, query)) || null); },
      async insertOne(row) {
        if (rows.some(existing => existing._id === row._id || singleActive && existing.active && row.active)) throw duplicate();
        rows.push(copy(row));
      },
      async updateOne(query, update) { const row = rows.find(row => matches(row, query)); if (row) Object.assign(row, copy(update.$set)); return { matchedCount: Number(Boolean(row)) }; },
      async updateMany(query, update) { for (const row of rows.filter(row => matches(row, query))) Object.assign(row, copy(update.$set)); },
      async findOneAndUpdate(query, update, options) {
        let row = rows.find(row => matches(row, query));
        if (!row && options?.upsert) {
          if (rows.some(existing => existing._id === query._id)) throw duplicate();
          row = { _id: query._id }; rows.push(row);
        }
        if (!row) return null;
        Object.assign(row, copy(update.$set)); return copy(row);
      },
      find(query) { let result = rows.filter(row => matches(row, query)); return {
        sort() { result = result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return this; },
        limit(n) { result = result.slice(0, n); return this; }, async toArray() { return copy(result); },
      }; },
    };
    collections.set(name, c); return c;
  } };
}
const job = { id: 'JOB-UK-123', scheduleId: 'SCH-123', title: 'Warehouse', location: 'London', matchScore: 80 };
function setup() {
  const db = database();
  let launches = 0, closes = 0, stops = 0, authenticated = true;
  const prefs = { autoApplyEnabled: true, autoApplyMinScore: 70 };
  const snapshot = { id: 'browser-1', jobId: job.id, scheduleId: job.scheduleId, title: job.title, stage: 'running', message: 'Running', shiftReserved: false, updatedAt: new Date().toISOString() };
  const service = { getDb: async () => db, getStoredPreferences: async () => ({ ...prefs }),
    fetchAllUKHourlyJobs: async () => ({ jobs: [job] }), passesHardFilters: () => true, scoreJob: item => item.matchScore,
    handleAgentFallback: async () => Response.json({ profile: {} }),
    handleJobApplyFallback: async () => Response.json({ applyUrl: 'https://www.jobsatamazon.co.uk/application/uk/' }),
    markScheduleUnavailable() {},
  };
  const store = load('automation-store', { './uk-hourly-fallback': service });
  const browser = {
    startBrowserApplication: async () => { launches++; return { ...snapshot }; }, browserTask: () => ({ ...snapshot }),
    stopBrowserTask: async () => { stops++; snapshot.stage = 'stopped'; },
    closeBrowser: async () => { closes++; }, renewBrowserLease: async () => {},
  };
  const { AutomationWorker } = load('automation-worker', { './automation-store': store, './desktop-browser': browser, './uk-hourly-fallback': service,
    './worker-dashboard': { workerJobs: service.fetchAllUKHourlyJobs, prepareWorkerApplication: async () => ({ applyUrl: 'https://www.jobsatamazon.co.uk/application/uk/' }) },
  });
  const api = load('automation-api', { './automation-store': { ...store, automationDb: async () => db }, './tool-session': { authenticatedToolUser: () => authenticated ? 'test-user' : null } });
  return { db, store, api, prefs, snapshot, service, worker: new AutomationWorker(db), makeWorker: () => new AutomationWorker(db), launches: () => launches, closes: () => closes, stops: () => stops, setAuthenticated(value) { authenticated = value; } };
}

test('concurrent requests create one persistent task and refuse a second active shift', async () => {
  const p = setup(); await p.store.initializeAutomation(p.db);
  const result = await Promise.all([p.store.enqueueApplication(p.db, job, 'manual'), p.store.enqueueApplication(p.db, job, 'manual')]);
  assert.equal(result[0].id, result[1].id);
  assert.equal(p.db.collection('AutomationTask').rows.length, 1);
  await assert.rejects(p.store.enqueueApplication(p.db, { ...job, scheduleId: 'SCH-OTHER' }, 'manual'), /already running/);
});

test('persistent worker launches a saved 70% match without any dashboard requests and holds assessment for review', async () => {
  const p = setup(); await p.worker.start();
  await p.worker.cycle(); // discover and enqueue
  await p.worker.cycle(); // launch
  assert.equal(p.launches(), 1);
  p.snapshot.stage = 'assessment_ready'; p.snapshot.shiftReserved = true;
  await p.worker.cycle(); await p.worker.cycle();
  const saved = p.db.collection('AutomationTask').rows[0];
  assert.equal(saved.stage, 'assessment_ready'); assert.equal(saved.active, true); assert.equal(saved.shiftReserved, true);
  assert.equal(p.launches(), 1);
  await p.store.requestTaskStop(p.db, saved.id); await p.worker.cycle();
  assert.equal(p.stops(), 1); assert.equal(saved.active, false);
});

test('disabling automation between discovery and launch cancels the queued automatic task', async () => {
  const p = setup(); await p.worker.start(); await p.worker.cycle();
  p.prefs.autoApplyEnabled = false; await p.worker.cycle();
  assert.equal(p.launches(), 0); assert.equal(p.db.collection('AutomationTask').rows[0].stage, 'stopped');
});

test('minimum match score is respected and manual requests work while auto mode is disabled', async () => {
  const p = setup(); p.prefs.autoApplyMinScore = 90; await p.worker.start(); await p.worker.cycle();
  assert.equal(p.db.collection('AutomationTask').rows.length, 0);
  p.prefs.autoApplyEnabled = false;
  await p.store.enqueueApplication(p.db, job, 'manual'); await p.worker.cycle();
  assert.equal(p.launches(), 1);
});

test('a second worker is excluded; restart preserves uncertain progress without relaunching it', async () => {
  const p = setup(); await p.worker.start(); await p.worker.cycle(); await p.worker.cycle();
  await assert.rejects(p.makeWorker().start(), /already connected/);
  await p.worker.stop();
  const restarted = p.makeWorker(); await restarted.start(); await restarted.cycle();
  const task = p.db.collection('AutomationTask').rows[0];
  assert.equal(task.stage, 'interrupted'); assert.equal(task.active, true); assert.equal(p.launches(), 1);
  await p.store.requestTaskStop(p.db, task.id); await restarted.cycle();
  assert.equal(task.active, false);
});

test('queued cancellation never opens a browser and old attempts are not automatically replayed after restart', async () => {
  const p = setup(); await p.worker.start(); await p.worker.cycle();
  const task = p.db.collection('AutomationTask').rows[0];
  await p.store.requestTaskStop(p.db, task.id); await p.worker.stop();
  const restarted = p.makeWorker(); await restarted.start(); await restarted.cycle();
  assert.equal(p.launches(), 0); assert.equal(p.db.collection('AutomationTask').rows.length, 1); assert.equal(task.stage, 'stopped');
});

test('expired ownership closes the browser and stops subsequent worker cycles', async () => {
  const p = setup(); await p.worker.start();
  p.db.collection('AutomationWorker').rows[0].leaseUntil = new Date(0);
  await assert.rejects(p.worker.heartbeat(), /connection lost/);
  await p.worker.cycle(); assert.equal(p.closes(), 1); assert.equal(p.launches(), 0);
});

test('worker API rejects unauthenticated/offline launches, persists authenticated tasks, and reports offline status', async () => {
  const p = setup();
  const post = () => new NextRequest('https://dashboard.test/api/desktop', { method: 'POST', body: JSON.stringify(job) });
  p.setAuthenticated(false); assert.equal((await p.api.handleWorkerRequest(post())).status, 401);
  p.setAuthenticated(true); assert.equal((await p.api.handleWorkerRequest(post())).status, 503);
  await p.worker.start();
  const queued = await p.api.handleWorkerRequest(post()); assert.equal(queued.status, 202);
  const { task } = await queued.json(); assert.equal(task.stage, 'queued'); assert.equal('job' in task, false);
  const cancel = await p.api.handleWorkerRequest(new NextRequest(`https://dashboard.test/api/desktop?id=${task.id}`, { method: 'DELETE' }));
  assert.equal((await cancel.json()).task.stage, 'stopped');
  await p.worker.stop();
  const status = await (await p.api.handleWorkerRequest(new NextRequest('https://dashboard.test/api/desktop?capability=1'))).json();
  assert.equal(status.available, false); assert.equal(status.backgroundMonitoring, true);
});

test('expired manual requests fail without browser actions', async () => {
  const p = setup(); await p.worker.start(); await p.store.enqueueApplication(p.db, job, 'manual');
  p.db.collection('AutomationTask').rows[0].createdAt = new Date(Date.now() - 11 * 60_000).toISOString();
  await p.worker.cycle();
  assert.equal(p.launches(), 0); assert.equal(p.db.collection('AutomationTask').rows[0].stage, 'failed');
});
