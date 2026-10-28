/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const source = fs.readFileSync('browser-helper/content.js', 'utf8');
const executable = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));

const fixture = `<!doctype html><html><body><h1>Consent</h1><button id="startApplicationButton">Start Application</button><script>
localStorage.setItem('accessToken','fixture-session');
document.querySelector('button').onclick=()=>{
 location.hash='/application-integrity-notice';
 document.body.innerHTML='<h1>Application notice</h1><div role="alert"></div><button disabled>Next</button><button data-test-id="integrity-notice-agree-button">I Agree</button>';
 document.querySelector('[data-test-id]').onclick=async()=>{
  await fetch('/application/api/application/create-application-and-skip-schedule',{method:'POST',body:JSON.stringify({jobId:'JOB-UK-123',scheduleId:'SCH-123'})});
  location.hash='/profile';
  document.body.innerHTML='<form><label>First Name<input name="firstName" required></label><label>Last Name<input name="lastName" required></label><button type="button">Next</button></form>';
  document.querySelector('button').onclick=()=>{location.hash='/assessment-consent';document.body.innerHTML='<h1>Assessment</h1><button>Start assessment</button>'};
 };
};</script></body></html>`;

for (const active of [true, false]) test(`managed browser ${active ? 'clicks I Agree and reaches assessment without a helper installation' : 'rejects a search-positive shift when Amazon application status is inactive'}`, { timeout: 30000 }, async t => {
  if (!executable) { t.skip('A local Chrome/Edge executable is required'); return; }
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    let applications = 0;
    let detailChecked = false;
    let consentClicked = false;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'www.jobsatamazon.co.uk') return route.abort();
      if (url.pathname === '/application/uk/') return route.fulfill({ contentType: 'text/html', body: fixture });
      if (url.pathname.includes('/csrf')) return route.fulfill({ json: { token: 'fixture' } });
      if (url.pathname === '/graphql') return route.fulfill({ json: { data: { searchScheduleCards: { scheduleCards: [{ scheduleId: 'SCH-123', jobId: 'JOB-UK-123', hireStartDate: '2099-01-01', laborDemandAvailableCount: 2 }] } } } });
      if (url.pathname.includes('get-schedule-details')) { detailChecked = true; assert.equal(route.request().headers().authorization, 'fixture-session'); return route.fulfill({ json: { scheduleId: 'SCH-123', jobId: 'JOB-UK-123', status: active ? 'ACTIVE' : 'INACTIVE' } }); }
      if (url.pathname.includes('create-application')) { applications++; consentClicked = true; return route.fulfill({ json: { applicationId: 'APP-123', jobScheduleSelected: { jobId: 'JOB-UK-123', scheduleId: 'SCH-123' } } }); }
      return route.fulfill({ status: 404, body: '' });
    });
    const launch = { jobId: 'JOB-UK-123', scheduleId: 'SCH-123', profile: { firstName: 'Test', lastName: 'Candidate', aiFormFillerEnabled: true, autoClickNextEnabled: true }, expiresAt: Date.now() + 60000 };
    await page.addInitScript({ content: `(function(managedLaunch){${source}\n})(${JSON.stringify(launch)});` });
    await page.goto('https://www.jobsatamazon.co.uk/application/uk/?jobId=JOB-UK-123&scheduleId=SCH-123#/consent');
    await page.waitForFunction(expected => document.querySelector('#amazon-monitor-helper-status')?.dataset.stage === expected, active ? 'assessment_ready' : 'shift_unavailable', { timeout: 20000 });
    assert.equal(detailChecked, true);
    assert.equal(applications, active ? 1 : 0);
    assert.equal(consentClicked, active);
    if (active) assert.match(page.url(), /assessment-consent/);
  } finally { await browser.close(); }
});
