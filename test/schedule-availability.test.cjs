/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/uk-hourly-fallback.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(database) {
  delete globalThis._mongoClientPromise;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === './hosted-job-feed') return require('../src/lib/hosted-job-feed.ts');
    if (name === 'mongodb') return { MongoClient: class { async connect() { if (database) return { db: () => database }; throw new Error('No database in tests'); } } };
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

test('CV survives profile updates and a new server instance without pretending assessment progress', async () => {
  let record;
  const database = { collection: () => ({
    async findOne() { return record; },
    async updateOne(_filter, update) { record = update.$set; },
    find() { return { sort() { return this; }, limit() { return this; }, async toArray() { return []; } }; },
  }) };
  const request = { method: 'PUT' };
  let service = load(database);
  const cvBase64 = 'data:application/pdf;base64,JVBERi0=';
  assert.equal((await service.handleAgentFallback(request, JSON.stringify({ firstName: 'Original', cvFileName: 'CV.pdf', cvBase64 }))).status, 200);
  service = load(database);
  await service.handleAgentFallback(request, JSON.stringify({ firstName: 'Updated', cvBase64: '' }));
  const result = await (await service.handleAgentFallback({ method: 'GET' })).json();
  assert.equal(result.profile.firstName, 'Updated');
  assert.equal(result.profile.cvBase64, cvBase64);
  assert.equal(result.profile.hasCv, true);
  assert.deepEqual(result.logs, []);
});

test('monitoring a 100% match does not fabricate an application or assessment result', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = api([live]);
    await service.handlePreferencesRequest({ method: 'PATCH' }, JSON.stringify({ autoApplyEnabled: true, keywords: ['Warehouse Associate'] }));
    const result = await (await service.handleMonitorFallback({ nextUrl: new URL('https://example.invalid/api/monitor') })).json();
    assert.equal(result.bestMatchJob.matchScore, 100);
    assert.equal(result.autoApplied, 0);
    const agent = await (await service.handleAgentFallback({ method: 'GET' })).json();
    assert.deepEqual(agent.logs, []);
  } finally { global.fetch = original; }
});

test('a schedule rejected by the signed-in application service is excluded even if public search stays positive', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = api([live, { ...live, scheduleId: 'alternative', laborDemandAvailableCount: 1 }]);
    assert.equal((await service.fetchAllUKHourlyJobs()).jobs[0].scheduleId, 'live');
    service.markScheduleUnavailable(jobId, 'live');
    assert.equal((await service.fetchAllUKHourlyJobs()).jobs[0].scheduleId, 'alternative');
  } finally { global.fetch = original; globalThis.rejectedAmazonSchedules?.clear(); }
});

test('old-job cleanup archives before deleting, preserves profiles and confirmed applications, and skips verification errors', async () => {
  const original = global.fetch;
  const archived = [], deleted = [], legacyArchive = [];
  const records = [
    { _id: 'corporate', jobId: '12345' },
    { _id: 'expired', jobId: 'JOB-UK-EXPIRED' },
    { _id: 'live', jobId },
    { _id: 'confirmed', jobId: 'JOB-UK-CONFIRMED', applicationId: 'APP-CONFIRMED' },
    { _id: 'unverified', jobId: 'JOB-UK-ERROR' },
  ];
  const db = { collection(name) {
    if (name === 'AvailabilityControl') return { findOne: async () => null };
    if (name === 'AppliedJob') return {
      find(query) { assert.equal(query.jobId.$ne, '__CANDIDATE_PROFILE__'); return { toArray: async () => records }; },
      async deleteOne(query) { assert.ok(archived.some(row => row._id === query._id)); deleted.push(query._id); return { deletedCount: 1 }; },
    };
    if (name === 'ArchivedJob') return { async replaceOne(_filter, row) { archived.push(row); } };
    if (name === 'Job') return { find() { return { toArray: async () => [{ _id: 'legacy', jobId: '12345' }] }; }, async deleteMany() { assert.equal(legacyArchive.length, 1); return { deletedCount: 1 }; } };
    if (name === 'ArchivedLegacyJob') return { async bulkWrite(ops) { legacyArchive.push(...ops); } };
    throw new Error('Unexpected collection: ' + name);
  } };
  try {
    const service = load(db);
    global.fetch = async (url, init) => {
      if (String(url).includes('/csrf')) return Response.json({ token: 'test' });
      const requestedJob = JSON.parse(init.body).variables.searchScheduleRequest.jobId;
      if (requestedJob === 'JOB-UK-ERROR') throw new Error('API unavailable');
      return Response.json({ data: { searchScheduleCards: { scheduleCards: requestedJob === jobId ? [live] : [] } } });
    };
    const result = await service.removeUnavailableStoredJobs();
    assert.deepEqual(result, { removed: 2, kept: 2, unverified: 1, removedLegacyJobs: 1 });
    assert.deepEqual(deleted, ['corporate', 'expired']);
    assert.equal(archived.length, 2);
  } finally { global.fetch = original; }
});

test('one failed schedule lookup does not discard other verified active jobs or claim complete coverage', async () => {
  const original = global.fetch;
  try {
    const service = load();
    const upstream = api([live], [{ jobId }, { jobId: 'JOB-UK-FAILED' }]);
    global.fetch = async (url, init) => {
      if (init?.body && JSON.parse(init.body).variables?.searchScheduleRequest?.jobId === 'JOB-UK-FAILED') return Response.json({ errors: [{ message: 'Temporarily unavailable' }] });
      return upstream(url, init);
    };
    const result = await service.fetchAllUKHourlyJobs();
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].scheduleId, 'live');
    assert.equal(result.unverifiedJobs, 1);
    assert.equal((await service.fetchAllUKHourlyJobs()).unverifiedJobs, 1);
    const response = await service.handleJobsFallback({ nextUrl: new URL('https://example.invalid/api/jobs') });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.jobFeed.complete, false);
    assert.match(body.availabilityWarning, /verified active jobs only/);
  } finally { global.fetch = original; }
});

test('total schedule service failure remains an error and does not become an empty live feed', async () => {
  const original = global.fetch;
  try {
    const service = load();
    const upstream = api([live]);
    global.fetch = async (url, init) => init?.body && JSON.parse(init.body).operationName === 'searchScheduleCards' ? Response.json({ errors: [{ message: 'Unavailable' }] }) : upstream(url, init);
    await assert.rejects(service.fetchAllUKHourlyJobs(), /could not be verified/);
  } finally { global.fetch = original; }
});

test('stats stays available during an Amazon outage without claiming zero live jobs or a successful check', async () => {
  const original = global.fetch;
  try {
    const service = load();
    global.fetch = async () => Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 });
    const response = await service.handleStatsFallback({ method: 'GET', nextUrl: new URL('https://example.invalid/api/stats') });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.totalJobs, null); assert.equal(data.matchingJobs, null);
    assert.equal(data.lastChecked, null); assert.equal(data.isMonitoring, false);
    assert.equal(data.jobFeed.available, false); assert.equal(data.jobFeed.stale, true);
    assert.match(data.availabilityError, /403/);
  } finally { global.fetch = original; }
});

test('Amazon denial creates a shared cooldown instead of repeating token and search requests', async () => {
  const original = global.fetch;
  let paused, calls = 0;
  const db = { collection: () => ({ findOne: async () => paused || null, updateOne: async (_filter, update) => { paused = update.$set; } }) };
  try {
    global.fetch = async url => { calls++; return String(url).includes('/csrf') ? Response.json({ token: 'fixture' }) : Response.json({ errors: [{ errorType: 'WAFForbiddenException' }] }, { status: 403 }); };
    await assert.rejects(load(db).fetchAllUKHourlyJobs(), /403/);
    assert.equal(calls, 2);
    await assert.rejects(load(db).fetchAllUKHourlyJobs(), /paused/);
    assert.equal(calls, 2);
  } finally { global.fetch = original; }
});

test('local worker dashboard uses the hosted feed for monitoring and stats without calling Amazon directly', async () => {
  const original = global.fetch;
  const keys = ['VERCEL', 'AUTOMATION_MODE', 'WORKER_DASHBOARD_URL'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.VERCEL; process.env.AUTOMATION_MODE = 'worker'; process.env.WORKER_DASHBOARD_URL = 'https://dashboard.test';
    let calls = 0;
    global.fetch = async url => {
      calls++; assert.equal(new URL(url).origin, 'https://dashboard.test');
      return Response.json({ source: 'live', totalPages: 1, jobs: [{ id: jobId, scheduleId: 'live', title: 'Warehouse', location: 'London' }], jobFeed: { provider: 'jobsatamazon.co.uk', stale: false, fetchedAt: new Date().toISOString() } });
    };
    const service = load();
    const request = { method: 'GET', nextUrl: new URL('http://localhost/api/stats') };
    const monitor = await service.handleMonitorFallback(request);
    const stats = await service.handleStatsFallback(request);
    assert.equal(monitor.status, 200); assert.equal(stats.status, 200);
    assert.equal((await monitor.json()).totalJobs, 1); assert.equal((await stats.json()).totalJobs, 1);
    assert.equal(calls, 1);
    process.env.VERCEL = '1';
    const officialApi = api([live]);
    global.fetch = async (url, init) => { assert.equal(new URL(url).hostname, 'www.jobsatamazon.co.uk'); return officialApi(url, init); };
    assert.equal((await load().fetchAllUKHourlyJobs()).jobs.length, 1);
  } finally {
    global.fetch = original;
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});
