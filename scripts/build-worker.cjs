/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.worker');
fs.mkdirSync(output, { recursive: true });
for (const name of ['automation-worker', 'automation-store', 'desktop-browser', 'uk-hourly-fallback']) {
  const source = fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } });
  fs.writeFileSync(path.join(output, name + '.js'), result.outputText);
}
console.log('PC worker built.');
