/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/uk-hourly-fallback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load() {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'mongodb') return { MongoClient: class { async connect() { throw new Error('No database in tests'); } } };
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}
const jobId = 'JOB-UK-123';
const live = { jobId, scheduleId: 'live', laborDemandAvailableCount: 2, hireStartDate: '2099-01-01' };
function api(cards, jobs = [{ jobId, scheduleCount: 9 }]) {
  return async (url, init) => {
    if (String(url).includes('/csrf')) return Response.json({ token: 'test' });
    const body = JSON.parse(init.body);
    return body.operationName === 'searchScheduleCards'
      ? Response.json({ data: { searchScheduleCards: { scheduleCards: cards } } })
      : Response.json({ data: { searchJobCardsByLocation: { jobCards: jobs } } });
  };
}

test('feed verifies schedules and excludes expired, full and unknown availability', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = api([
      { ...live, scheduleId: 'expired', hireStartDate: '2000-01-01' },
      { ...live, scheduleId: 'full', laborDemandAvailableCount: 0 },
      { scheduleId: 'unknown' }, live,
    ]);
    const result = await service.fetchAllUKHourlyJobs();
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].scheduleId, 'live');
    global.fetch = api([]);
    assert.equal((await load().fetchAllUKHourlyJobs()).jobs.length, 0);
  } finally { global.fetch = original; }
});

test('fresh apply check rejects a schedule withdrawn after the feed loaded', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = api([live]);
    await service.fetchAllUKHourlyJobs();
    global.fetch = api([{ ...live, scheduleId: 'replacement' }]);
    const result = await service.handleJobApplyFallback(
      { nextUrl: new URL('https://example.invalid/api/jobs/apply') },
      JSON.stringify({ jobId, scheduleId: 'live' })
    );
    assert.equal(result.status, 409);
    assert.match((await result.json()).error, /expired|no longer available/);
  } finally { global.fetch = original; }
});

test('schedule errors do not reuse cached availability or pretend malformed responses are empty', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = api([live]);
    await service.fetchSchedulesForJob(jobId);
    global.fetch = async () => Response.json({ errors: [{ message: 'unavailable' }] });
    await assert.rejects(service.fetchSchedulesForJob(jobId, true), /could not be verified/);
    const result = await service.handleJobApplyFallback(
      { nextUrl: new URL('https://example.invalid/api/jobs/apply') },
      JSON.stringify({ jobId, scheduleId: 'live' })
    );
    assert.equal(result.status, 503);
  } finally { global.fetch = original; }
});
