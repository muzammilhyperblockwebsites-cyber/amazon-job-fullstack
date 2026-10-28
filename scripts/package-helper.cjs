/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const header = `// ==UserScript==
// @name         Amazon UK Application Helper
// @namespace    https://amazon-job-apply.vercel.app/
// @version      4.0.0
// @description  Fill saved candidate details and continue to assessment using Amazon's normal controls.
// @match        https://www.jobsatamazon.co.uk/*
// @match        https://jobsatamazon.co.uk/*
// @match        https://amazon-job-apply.vercel.app/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

`;
fs.writeFileSync(path.join(root, 'public/amazon-uk-auto-agree.user.js'), header + fs.readFileSync(path.join(root, 'browser-helper/content.js'), 'utf8'));
execFileSync('tar', ['-a', '-c', '-f', path.join(root, 'public/amazon-auto-agree-extension.zip'), '-C', path.join(root, 'browser-helper'), 'manifest.json', 'content.js', 'README.txt']);
console.log('Packaged extension and userscript v4.0.0');
