import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { extensionPath } from './helpers.mjs';

const read = (p) => readFileSync(path.join(extensionPath, p), 'utf8');
const locales = readdirSync(path.join(extensionPath, '_locales'));
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));

test('every locale has the same keys', () => {
  const en = Object.keys(messages.en).sort();
  for (const l of locales) assert.deepEqual(Object.keys(messages[l]).sort(), en, l);
});

test('every key used in pages and scripts exists', () => {
  const sources = [
    'popup/popup.html',
    'options/options.html',
    'popup/popup.js',
    'options/options.js',
    'content/ai-content.js',
    'background/service-worker.js',
    'blocked/blocked.html',
    'blocked/blocked.js',
    'content/notice.js',
  ].map(read);
  const used = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/data-i18n="(\w+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      m[1].split(',').forEach((pair) => used.add(pair.split(':')[1].trim()));
    }
    for (const m of src.matchAll(/\b(?:t|msg|getMessage)\('(\w+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !messages.en[k]);
  assert.deepEqual(missing, []);
});

test('no long dashes in user-facing text', () => {
  for (const l of locales) {
    for (const [k, v] of Object.entries(messages[l])) assert.ok(!v.message.includes('—'), `${l}.${k}`);
  }
});

test('manifest asks only for what it needs', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.permissions.sort(), [
    'declarativeNetRequest',
    'declarativeNetRequestFeedback',
    'storage',
    'webNavigation',
  ]);
});
