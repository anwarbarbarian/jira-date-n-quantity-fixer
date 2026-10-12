'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const requiredFiles = new Set([
  'background.js',
  'dashboard.html',
  'dashboard.js',
  'dashboard.css',
  ...(manifest.content_scripts?.[0]?.js || [])
]);

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function checkSyntax(filePath) {
  const absolute = path.join(root, filePath);
  if (!fs.existsSync(absolute)) {
    fail(`Missing file referenced by the extension: ${filePath}`);
    return;
  }

  if (!filePath.endsWith('.js')) return;

  try {
    const source = fs.readFileSync(absolute, 'utf8');
    // Service worker uses importScripts; validate each imported file individually.
    if (filePath === 'background.js') {
      for (const match of source.matchAll(/importScripts\(\s*([\s\S]*?)\s*\);/g)) {
        const block = match[1];
        for (const imported of block.matchAll(/'([^']+\.js)'/g)) {
          checkSyntax(imported[1]);
        }
      }
    }
    new Function(source);
  } catch (error) {
    fail(`${filePath} has a syntax error: ${error.message}`);
  }
}

console.log('Validating JIRA Due Date and Quantity Fixer extension...');
console.log(`Manifest version: ${manifest.version}`);

for (const file of requiredFiles) {
  checkSyntax(file);
}

if (manifest.background?.service_worker) {
  checkSyntax(manifest.background.service_worker);
}

if (failures === 0) {
  console.log(`PASS: ${requiredFiles.size} referenced files exist and parsed successfully.`);
  process.exit(0);
}

process.exit(1);
