/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const root = path.resolve(__dirname, '..');
process.chdir(root);
loadEnvConfig(root);
require('../.worker/automation-worker.js').runWorker().catch(error => {
  console.error(error.message);
  process.exit(1);
});
