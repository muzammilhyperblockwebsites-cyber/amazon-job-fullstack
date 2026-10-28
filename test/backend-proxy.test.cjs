/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/backend-proxy.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const proxyModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, proxyModule, proxyModule.exports);
const { backendProxy } = proxyModule.exports;
process.env.APP_URL = 'https://frontend.example.invalid';
process.env.BACKEND_URL = 'https://backend.example.invalid';
process.env.BACKEND_API_KEY = 'server-only-test-key';
const request = pathname => ({ method: 'GET', nextUrl: new URL('https://frontend.example.invalid' + pathname), headers: new Headers(), signal: new AbortController().signal });

test('missing Heroku route becomes a readable JSON error instead of a JSON parser exception', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('<!DOCTYPE html><title>Error</title>', { status: 404, headers: { 'content-type': 'text/html' } });
  try { const result = await backendProxy(request('/api/agent')); assert.equal(result.status, 502); assert.match((await result.json()).error, /Heroku backend is missing this route/); }
  finally { global.fetch = original; }
});
test('old corporate-job backend cannot populate the hourly feed or live count', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({ totalJobs: 276 });
    assert.equal((await backendProxy(request('/api/stats'))).status, 502);
    global.fetch = async () => Response.json({ jobFeed: { provider: 'jobsatamazon.co.uk' }, jobs: [{ id: '10578983', title: 'Value Engineering Manager', applyUrl: 'https://www.amazon.jobs/en-gb/jobs/10578983' }] });
    assert.equal((await backendProxy(request('/api/jobs'))).status, 502);
  } finally { global.fetch = original; }
});
test('verified hourly results pass through without exposing the server key', async () => {
  const original = global.fetch;
  global.fetch = async (_url, init) => {
    assert.equal(init.headers.get('x-backend-key'), 'server-only-test-key');
    return Response.json({ jobFeed: { provider: 'jobsatamazon.co.uk' }, total: 1, jobs: [{ id: 'JOB-UK-0000000203', title: 'Delivery Station Warehouse Associate', applyUrl: 'https://www.jobsatamazon.co.uk/app#/jobDetail?jobId=JOB-UK-0000000203' }] });
  };
  try { const result = await backendProxy(request('/api/jobs')); assert.equal(result.status, 200); assert.equal((await result.json()).total, 1); assert.equal(result.headers.get('x-backend-key'), null); }
  finally { global.fetch = original; }
});
