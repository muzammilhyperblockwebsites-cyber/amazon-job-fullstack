/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/lib/worker-dashboard.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const job = { id: 'JOB-UK-123', scheduleId: 'SCH-123', title: 'Warehouse', location: 'London' };
const liveFeed = jobs => ({ source: 'live', jobs, totalPages: 1, jobFeed: { provider: 'jobsatamazon.co.uk', stale: false, fetchedAt: new Date().toISOString() } });

async function setup(run) {
  const fetch = global.fetch;
  const names = ['WORKER_DASHBOARD_URL', 'TOOL_LOGIN_EMAIL', 'TOOL_LOGIN_PASSWORD'];
  const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.WORKER_DASHBOARD_URL = 'https://dashboard.test';
  process.env.TOOL_LOGIN_EMAIL = 'fixture-user'; process.env.TOOL_LOGIN_PASSWORD = 'fixture-password';
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name === './uk-hourly-fallback' ? {
    fetchAllUKHourlyJobs() { throw new Error('PC public API must not be used when the dashboard is configured'); },
    handleJobApplyFallback() { throw new Error('Preparation must use the dashboard'); },
  } : require(name), mod, mod.exports);
  try { await run(mod.exports); }
  finally { global.fetch = fetch; for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name]; } }
}

test('worker obtains paginated, fresh verified shifts from the configured dashboard', async () => setup(async api => {
  const calls = [];
  global.fetch = async url => { calls.push(String(url)); return Response.json({ ...liveFeed([job]), totalPages: 2 }); };
  const result = await api.workerJobs();
  assert.equal(result.jobs.length, 2); assert.equal(calls.length, 2);
  assert.match(calls[0], /https:\/\/dashboard.test\/api\/jobs\?filterOverride=1/);
  assert.match(calls[1], /page=2/);
}));

test('stale, unverified and failed cloud feeds never become successful empty polling cycles', async () => setup(async api => {
  for (const data of [
    { ...liveFeed([job]), source: 'db' },
    { ...liveFeed([job]), jobFeed: { ...liveFeed([]).jobFeed, stale: true } },
    { ...liveFeed([job]), jobFeed: { ...liveFeed([]).jobFeed, fetchedAt: '2000-01-01' } },
    liveFeed([{ ...job, scheduleId: '' }]),
  ]) {
    global.fetch = async () => Response.json(data);
    await assert.rejects(api.workerJobs(), /verified/);
  }
  global.fetch = async () => Response.json({ error: 'Amazon unavailable' }, { status: 503 });
  await assert.rejects(api.workerJobs(), /Amazon unavailable/);
}));

test('preparation authenticates, renews an expired session, and requires the exact selected shift', async () => setup(async api => {
  let logins = 0, prepares = 0;
  global.fetch = async (url, init) => {
    assert.equal(init.redirect, 'error');
    if (String(url).endsWith('/api/auth')) {
      logins++; assert.equal(JSON.parse(init.body).email, 'fixture-user');
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': 'amazon_monitor_session=fixture; HttpOnly; Path=/' } });
    }
    prepares++; assert.equal(init.headers.Cookie, 'amazon_monitor_session=fixture');
    assert.deepEqual(JSON.parse(init.body), job);
    if (prepares === 1) return Response.json({ error: 'Session expired' }, { status: 401 });
    return Response.json({ jobId: job.id, scheduleId: prepares === 2 ? job.scheduleId : 'WRONG', applyUrl: 'https://www.jobsatamazon.co.uk/application/uk/' });
  };
  assert.equal((await api.prepareWorkerApplication(job)).scheduleId, job.scheduleId);
  assert.equal(logins, 2); assert.equal(prepares, 2);
  await assert.rejects(api.prepareWorkerApplication(job), /different job or shift/);
}));
