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
