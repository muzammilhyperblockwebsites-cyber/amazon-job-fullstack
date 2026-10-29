/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('browser-helper/content.js', 'utf8');
const id = '12345678-1234-1234-1234-123456789abc';
const profile = { firstName: 'Test', lastName: 'Candidate', phone: '07000000000', postcode: 'SW1A 1AA', over18: true, declarationsConfirmed: true };
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

async function page(html, hash = '/profile', extras = {}, managedOptions) {
  const dom = new JSDOM(html, { url: `https://www.jobsatamazon.co.uk/application/uk/?jobId=JOB-UK-123&scheduleId=SCH-123#${hash}?agmLaunch=${id}`, runScripts: 'outside-only' });
  const w = dom.window;
  let interval;
  let now = Date.now();
  let requests = 0;
  w.Date.now = () => now;
  w.HTMLElement.prototype.getClientRects = function () { return [{ width: 10, height: 10 }]; };
  w.GM_getValue = () => ({ jobId: 'JOB-UK-123', scheduleId: 'SCH-123', profile: { ...profile, ...extras }, expiresAt: now + 60000 });
  w.GM_deleteValue = () => {};
  w.setInterval = fn => { interval = fn; };
  w.fetch = async url => {
    requests++;
    return { ok: true, json: async () => String(url).includes('/csrf') ? { token: 'test' } : { data: { searchScheduleCards: { scheduleCards: [{ scheduleId: 'SCH-123', jobId: 'JOB-UK-123', laborDemandAvailableCount: 1, hireStartDate: '2099-01-01' }] } } } };
  };
  if (managedOptions) {
    w.document.querySelector('button')?.addEventListener('click', () => { w.clicked = true; });
    if (managedOptions.renewedUntil) w.sessionStorage.setItem('agm-worker-lease:lease-test', String(managedOptions.renewedUntil));
    w.eval(`(function(managedLaunch){${source}\n})(${JSON.stringify({ ...w.GM_getValue(), leaseId: 'lease-test', ...managedOptions })});`);
  } else w.eval(source);
  await flush();
  return { w, dom, requests: () => requests, async tick() { now += 2000; interval?.(); await flush(); } };
}

test('worker lease expiry prevents form edits and clicks, while a renewed lease survives navigation', async () => {
  const html = '<input name="firstName"><button type="button">Next</button>';
  const expired = await page(html, '/profile', {}, { leaseExpiresAt: Date.now() - 1000 });
  const renewed = await page(html, '/profile', {}, { leaseExpiresAt: Date.now() - 1000, renewedUntil: Date.now() + 60000 });
  try {
    assert.equal(expired.w.clicked, undefined);
    assert.equal(expired.w.document.querySelector('input').value, '');
    assert.equal(expired.w.document.querySelector('aside').dataset.stage, 'stopped');
    assert.equal(renewed.w.clicked, true);
    assert.equal(renewed.w.document.querySelector('input').value, 'Test');
  } finally { expired.dom.window.close(); renewed.dom.window.close(); }
});

test('helper fills saved fields, uses normal Next, and stops when assessment is reached', async () => {
  const p = await page('<form><label>First Name<input name="firstName" required></label><label>Last Name<input name="lastName" required></label><button type="button">Next</button></form>');
  try {
    assert.equal(p.w.document.querySelector('[name="firstName"]').value, 'Test');
    assert.equal(p.w.document.querySelector('[name="lastName"]').value, 'Candidate');
    let clicks = 0;
    p.w.document.querySelector('button').addEventListener('click', () => { clicks++; p.w.location.hash = '/assessment-consent'; });
    // The first control has already been clicked once; a newly rendered step can continue.
    p.w.location.hash = '/address';
    await p.tick();
    assert.equal(clicks, 1);
    await p.tick();
    assert.equal(clicks, 1);
    assert.match(p.w.document.querySelector('aside').textContent, /Assessment reached/);
  } finally { p.dom.window.close(); }
});

test('unknown required fields block progression and manual corrections are preserved', async () => {
  const p = await page('<form><input name="firstName" value="My correction"><input name="unknown" required><button>Next</button></form>');
  try {
    assert.equal(p.w.document.querySelector('[name="firstName"]').value, 'My correction');
    assert.match(p.w.document.querySelector('aside').textContent, /required fields/);
    assert.equal(p.requests(), 0);
  } finally { p.dom.window.close(); }
});

test('helper does not repeat a click on a stalled page or overwrite an active application', async () => {
  const p = await page('<button type="button">Next</button>');
  try {
    let clicks = 0;
    p.w.document.querySelector('button').addEventListener('click', () => clicks++);
    await p.tick(); await p.tick();
    assert.equal(clicks, 0);
    p.w.location.hash = '/profile?jobId=JOB-UK-OTHER';
    await p.tick();
    assert.match(p.w.document.querySelector('aside').textContent, /different job/);
  } finally { p.dom.window.close(); }
});

test('eligibility radio answers require confirmed saved declarations', async () => {
  const html = '<fieldset><legend>Are you at least 18 years old?</legend><label>Yes<input type="radio" name="age" value="yes"></label><label>No<input type="radio" name="age" value="no"></label></fieldset>';
  const p = await page(html);
  const unconfirmed = await page(html, '/eligibility', { declarationsConfirmed: false });
  try {
    assert.equal(p.w.document.querySelector('[value="yes"]').checked, true);
    assert.equal(unconfirmed.w.document.querySelector('input:checked'), null);
  } finally { p.dom.window.close(); unconfirmed.dom.window.close(); }
});

test('login, CAPTCHA, final submit and assessment pages pause before automatic actions', async () => {
  for (const [html, hash, message] of [
    ['<input type="password"><button>Continue</button>', '/login', /sign-in/],
    ['<iframe src="https://example.invalid/captcha"></iframe><button>Continue</button>', '/profile', /CAPTCHA/],
    ['<button>Submit application</button><button>Continue</button>', '/review', /Final application step/],
    ['<input name="firstName"><button>Start assessment</button>', '/assessment-consent', /Assessment reached/],
  ]) {
    const p = await page(html, hash);
    try { assert.match(p.w.document.querySelector('aside').textContent, message); assert.equal(p.requests(), 0); }
    finally { p.dom.window.close(); }
  }
});

test('fresh shift verification happens before starting an application', async () => {
  const p = await page('<button id="startApplicationButton">Start application</button>', '/consent');
  try {
    assert.equal(p.requests(), 2);
    assert.match(p.w.document.querySelector('aside').textContent, /continuing towards assessment/);
  } finally { p.dom.window.close(); }
});

test('a CV is attached as an actual file through the file input change event', async () => {
  const p = await page('<label>CV / Resume<input type="file" name="resume"></label>', '/profile', { cvFileName: 'Test.pdf', cvBase64: 'data:application/pdf;base64,JVBERi0=' });
  try {
    // jsdom lacks DataTransfer; supply its minimal interface and retry the paused tick.
    p.w.DataTransfer = class {
      constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    };
    const input = p.w.document.querySelector('input');
    let selected;
    let changes = 0;
    Object.defineProperty(input, 'files', { get: () => selected || [], set: files => { selected = files; } });
    input.addEventListener('change', () => changes++);
    await p.tick(); await p.tick();
    assert.equal(selected[0].name, 'Test.pdf');
    assert.equal(selected[0].type, 'application/pdf');
    assert.equal(changes, 1);
  } finally { p.dom.window.close(); }
});

test('userscript package contains the same reviewed helper source', () => {
  assert.ok(fs.readFileSync('public/amazon-uk-auto-agree.user.js', 'utf8').endsWith(source));
  const manifest = JSON.parse(fs.readFileSync('browser-helper/manifest.json', 'utf8'));
  assert.equal(manifest.version, '4.0.0');
  assert.deepEqual(manifest.permissions, ['storage']);
});
