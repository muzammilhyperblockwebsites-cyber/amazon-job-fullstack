/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEnvConfig } = require('@next/env');
const root = path.resolve(__dirname, '..');
process.chdir(root);
loadEnvConfig(root);
(async () => {
  const { automationDb, workerStatus } = require('../.worker/automation-store.js');
  const db = await automationDb();
  if ((await workerStatus(db)).available) { console.log('A PC worker is already connected.'); process.exit(0); }
  const folder = path.join(root, '.amazon-session'); fs.mkdirSync(folder, { recursive: true });
  const log = fs.openSync(path.join(folder, 'worker.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'scripts/run-worker.cjs')], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
  });
  child.unref(); fs.closeSync(log);
  fs.writeFileSync(path.join(folder, 'worker.pid'), String(child.pid));
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if ((await workerStatus(db)).available) {
      console.log('PC worker connected in the background. Status is visible on the Vercel dashboard.');
      process.exit(0);
    }
  }
  throw new Error('Worker did not connect. See .amazon-session/worker.log.');
})().catch(error => { console.error(error.message); process.exit(1); });
