/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('src/app/api/stream/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('stream emits matching new shifts, avoids duplicate alerts, and cancels its poll timer', async () => {
  let jobs = [{ id: 'JOB-UK-1', scheduleId: 'SCH-1', title: 'Warehouse Associate' }];
  let interval;
  let cleared = false;
  const service = {
    fetchAllUKHourlyJobs: async () => ({ jobs, fetchedAt: '2026-10-28T12:00:00Z' }),
    getStoredPreferences: async () => ({ autoApplyEnabled: true }),
    passesHardFilters: job => job.title.includes('Warehouse'),
    scoreJob: () => 100,
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled)(
    () => service, mod, mod.exports,
    callback => { interval = callback; return 1; }, () => { cleared = true; }
  );
  const controller = new AbortController();
  const response = await mod.exports.GET({ signal: controller.signal });
  const reader = response.body.getReader();
  const read = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).slice(6));
  assert.equal((await read()).type, 'connected');
  assert.equal((await read()).type, 'heartbeat');
  const fresh = await read();
  assert.equal(fresh.type, 'new_jobs');
  assert.equal(fresh.jobs[0].matchScore, 100);
  await flush();
  interval(); await flush();
  assert.equal((await read()).type, 'heartbeat');
  jobs = [...jobs, { id: 'JOB-UK-2', scheduleId: 'SCH-2', title: 'Warehouse Associate' }, { id: 'JOB-UK-3', scheduleId: 'SCH-3', title: 'Other role' }];
  interval(); await flush();
  assert.equal((await read()).type, 'heartbeat');
  const next = await read();
  assert.equal(next.jobs.length, 1);
  assert.equal(next.jobs[0].id, 'JOB-UK-2');
  await reader.cancel();
  assert.equal(cleared, true);
  controller.abort();
});
