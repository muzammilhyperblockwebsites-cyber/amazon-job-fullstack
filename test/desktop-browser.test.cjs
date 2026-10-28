/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/lib/desktop-browser.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
const { acceptedApplication, desktopCapability } = mod.exports;
test('shift acceptance requires a successful Amazon application response with the exact job and schedule', () => {
  const data = { applicationId: 'APP-123', jobScheduleSelected: { jobId: 'JOB-UK-123', scheduleId: 'SCH-123' } };
  assert.equal(acceptedApplication(data, 'JOB-UK-123', 'SCH-123'), 'APP-123');
  assert.equal(acceptedApplication({ data }, 'JOB-UK-123', 'SCH-123'), 'APP-123');
  for (const value of [{ scheduleCount: 10 }, { applicationId: 'APP-123' }, { ...data, errorCode: 'SELECTED_SCHEDULE_NOT_AVAILABLE' }, { ...data, jobScheduleSelected: { jobId: 'JOB-UK-123', scheduleId: 'OTHER' } }]) assert.equal(acceptedApplication(value, 'JOB-UK-123', 'SCH-123'), null);
});
test('a serverless hosted dashboard cannot claim to open a desktop browser', () => {
  const original = process.env.VERCEL;
  try { process.env.VERCEL = '1'; assert.equal(desktopCapability().available, false); assert.match(desktopCapability().message, /desktop tool/); }
  finally { if (original === undefined) delete process.env.VERCEL; else process.env.VERCEL = original; }
});

test('hosted capability and progress endpoints load without importing the desktop browser driver', async () => {
  const original = process.env.VERCEL;
  const cloudModule = { exports: {} };
  let driverImports = 0;
  try {
    process.env.VERCEL = '1';
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'playwright-core') { driverImports++; throw new Error('Desktop browser driver is unavailable on this cloud host'); }
      return require(name);
    }, cloudModule, cloudModule.exports);
    assert.equal(cloudModule.exports.desktopCapability().available, false);
    assert.ok(Array.isArray(cloudModule.exports.browserTasks()));
    await assert.rejects(cloudModule.exports.startBrowserApplication({}), /desktop tool/);
    assert.equal(driverImports, 0);
  } finally { if (original === undefined) delete process.env.VERCEL; else process.env.VERCEL = original; }
});
