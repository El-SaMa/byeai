import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, resetStorage, setStorage } from './helpers.mjs';

let ctx;

before(async () => {
  ctx = await launch();
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  await ctx.worker.evaluate(() => chrome.storage.sync.remove('pausedUntil'));
  for (const p of ctx.context.pages()) await p.close();
});

const mine = {
  allowedHosts: ['a.com', 'b.org'],
  mediaAllowedHosts: ['c.net'],
  hiddenChannels: [{ id: '@spamchannel', n: 'Spam Channel' }, { id: 'UCabcdefghijklmnopqrstuv', n: 'Other', a: '@other' }],
  shownChannels: [{ id: '@goodchannel', n: 'Good Channel' }],
  showNotices: false,
  communityEnabled: true,
  communityAutoShare: true,
  features: { widgets: true, labeled: false },
};

const snapshot = () =>
  ctx.worker.evaluate(async () => {
    const hidden = await globalThis.byeaiHiddenChannels.read();
    const shown = await globalThis.byeaiShownChannels.read();
    const s = await chrome.storage.sync.get(['allowedHosts', 'mediaAllowedHosts', 'showNotices', 'communityEnabled', 'communityAutoShare', 'features', 'enabled']);
    return { ...s, hidden, shown };
  });

async function optionsPage() {
  const page = await ctx.context.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await page.waitForTimeout(300);
  return page;
}

async function importFile(page, content) {
  await page.setInputFiles('#importFile', {
    name: 'byeai-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)),
  });
  await page.waitForTimeout(500);
  return page.textContent('#importResult');
}

async function seed() {
  await setStorage(ctx.worker, {
    allowedHosts: mine.allowedHosts,
    mediaAllowedHosts: mine.mediaAllowedHosts,
    showNotices: mine.showNotices,
    communityAutoShare: mine.communityAutoShare,
    features: mine.features,
    // Counters and the downloaded list: never exported.
    totalBlocked: 4242,
    autoSharedCount: 7,
  });
  await ctx.worker.evaluate(async (m) => {
    await globalThis.byeaiHiddenChannels.write(m.hiddenChannels);
    await globalThis.byeaiShownChannels.write(m.shownChannels);
  }, mine);
}

test('export writes one JSON file with the lists and switches, no counters', async () => {
  await seed();
  const page = await optionsPage();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  assert.match(download.suggestedFilename(), /^byeai-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const text = readFileSync(await download.path(), 'utf8');
  const data = JSON.parse(text);

  assert.equal(data.app, 'byeai');
  assert.equal(data.format, 1);
  assert.deepEqual(data.allowedHosts, mine.allowedHosts);
  assert.deepEqual(data.mediaAllowedHosts, mine.mediaAllowedHosts);
  assert.deepEqual(data.hiddenChannels.map((c) => c.id), ['@spamchannel', 'UCabcdefghijklmnopqrstuv']);
  assert.deepEqual(data.shownChannels.map((c) => c.id), ['@goodchannel']);
  assert.deepEqual(data.switches, {
    enabled: true,
    showNotices: false,
    communityEnabled: true,
    communityAutoShare: true,
    features: { widgets: true, labeled: false },
  });
  assert.doesNotMatch(text, /4242|totalBlocked|autoSharedCount|community"|etag/);
});

test('round trip: export, wipe, import gives the same settings back', async () => {
  await seed();
  const before = await snapshot();
  const page = await optionsPage();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const file = readFileSync(await download.path(), 'utf8');

  await resetStorage(ctx.worker);
  await ctx.worker.evaluate(() => chrome.storage.sync.remove(['allowedHosts', 'mediaAllowedHosts']));
  const empty = await snapshot();
  assert.deepEqual(empty.hidden, []);

  const line = await importFile(page, file);
  assert.match(line, /^Imported: \d+ added or changed, \d+ skipped/);
  const after = await snapshot();
  assert.deepEqual(after, before);

  // The lists on the page show it right away.
  assert.equal(await page.locator('#allowedList li').count(), 3, 'a.com, b.org and the AI-video site c.net');
  assert.equal(await page.locator('#hiddenList li').count(), 2);
  assert.equal(await page.locator('#shownList li').count(), 1);
  // Counters were not touched by any of this.
  assert.equal((await ctx.worker.evaluate(() => chrome.storage.local.get('totalBlocked'))).totalBlocked, 4242);

  // Same file again: nothing duplicated.
  const again = await importFile(page, file);
  assert.match(again, /Imported: 0 added or changed, 6 skipped/);
  assert.deepEqual(await snapshot(), before);
});

test('import merges with what is already there and removes duplicates', async () => {
  await setStorage(ctx.worker, { allowedHosts: ['a.com', 'z.com'] });
  await ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.write([{ id: '@spamchannel', n: 'Spam Channel' }, { id: '@mine', n: 'Mine' }]));
  const page = await optionsPage();
  const line = await importFile(page, {
    app: 'byeai',
    format: 1,
    allowedHosts: ['A.com', 'www.b.org', 'b.org', 'a.com'],
    hiddenChannels: [{ id: '@SpamChannel', n: 'Spam again' }, { id: '@new', n: 'New one' }],
  });
  const s = await snapshot();
  assert.deepEqual(s.allowedHosts, ['a.com', 'z.com', 'b.org'], 'existing first, new at the end, no duplicates');
  assert.deepEqual(s.hidden.map((c) => c.id), ['@spamchannel', '@mine', '@new']);
  assert.equal(s.hidden[0].n, 'Spam Channel', 'what you have is not overwritten');
  assert.match(line, /Imported: 2 added or changed, 4 skipped/);
  // Allowed sites get their network rules.
  const rules = await ctx.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(rules.filter((r) => r.action.type === 'allow').length >= 3);
});

test('import switches: only real booleans are applied', async () => {
  const page = await optionsPage();
  await importFile(page, {
    app: 'byeai',
    format: 1,
    switches: { showNotices: false, communityEnabled: 'yes', enabled: 1, features: { widgets: false, labeled: 'x', bogus: true } },
  });
  const s = await snapshot();
  assert.equal(s.showNotices, false);
  assert.equal(s.communityEnabled, true, 'a string is not a switch');
  assert.equal(s.enabled, true);
  assert.deepEqual(s.features, { widgets: false, labeled: true });
});

test('import does not push out what you have: channel caps are respected', async () => {
  const full = Array.from({ length: 500 }, (_, i) => ({ id: `@keep${i}`, n: `Keep ${i}` }));
  await ctx.worker.evaluate((list) => globalThis.byeaiHiddenChannels.write(list), full);
  const page = await optionsPage();
  const line = await importFile(page, {
    app: 'byeai',
    format: 1,
    hiddenChannels: [{ id: '@extra1', n: 'Extra 1' }, { id: '@extra2', n: 'Extra 2' }],
  });
  const { hidden } = await snapshot();
  assert.equal(hidden.length, 500);
  assert.ok(hidden.every((c) => c.id.startsWith('@keep')), 'nothing old was dropped');
  assert.match(line, /Imported: 0 added or changed, 2 skipped/);
});

test('import does not push out what you have: the allowed list stays inside its sync item', async () => {
  const many = Array.from({ length: 400 }, (_, i) => `site-number-${i}-with-a-long-name.example.com`);
  const page = await optionsPage();
  await importFile(page, { app: 'byeai', format: 1, allowedHosts: many });
  const first = await snapshot();
  assert.ok(first.allowedHosts.length > 100 && first.allowedHosts.length < 400);
  assert.ok(JSON.stringify(first.allowedHosts).length < 8192, 'one sync item holds at most 8 KB');
  // Everything stored is something that was in the file, in order.
  assert.deepEqual(first.allowedHosts, many.slice(0, first.allowedHosts.length));

  const line = await importFile(page, { app: 'byeai', format: 1, allowedHosts: ['one-more.example.com'] });
  assert.match(line, /Imported: 0 added or changed, 1 skipped/);
  assert.deepEqual((await snapshot()).allowedHosts, first.allowedHosts);
});

test('bad files are rejected and nothing changes', async () => {
  await seed();
  const before = await snapshot();
  const page = await optionsPage();
  const bad = [
    'not json at all',
    '',
    '[]',
    '"byeai"',
    '{}',
    JSON.stringify({ app: 'other', format: 1, allowedHosts: ['evil.com'] }),
    JSON.stringify({ app: 'byeai', allowedHosts: ['evil.com'] }),
    JSON.stringify({ app: 'byeai', format: 99, allowedHosts: ['evil.com'] }),
    JSON.stringify({ app: 'byeai', format: 1, allowedHosts: 'evil.com' }),
    JSON.stringify({ app: 'byeai', format: 1, unrelated: [1, 2, 3] }),
  ];
  for (const content of bad) {
    const line = await importFile(page, content);
    assert.match(line, /not a ByeAI settings file\. Nothing was changed\./, content);
  }
  assert.deepEqual(await snapshot(), before);

  // Too big.
  const huge = JSON.stringify({ app: 'byeai', format: 1, allowedHosts: ['x.com'], pad: 'y'.repeat(1100 * 1024) });
  assert.match(await importFile(page, huge), /not a ByeAI settings file/);
  assert.deepEqual(await snapshot(), before);
});

test('invalid entries inside a good file are skipped, the rest is imported', async () => {
  const page = await optionsPage();
  const line = await importFile(page, {
    app: 'byeai',
    format: 1,
    allowedHosts: ['good.example.com', 'javascript:alert(1)', 'a b.com', '../etc', '', 42, null, 'nodots', 'x'.repeat(300) + '.com'],
    hiddenChannels: [{ id: '@fine', n: 'Fine' }, { id: 'not a channel' }, 'string', null, { n: 'No id' }],
  });
  const s = await snapshot();
  assert.deepEqual(s.allowedHosts, ['good.example.com']);
  assert.deepEqual(s.hidden.map((c) => c.id), ['@fine']);
  assert.match(line, /Imported: 2 added or changed, 12 skipped/);
});

test('export and import buttons are keyboard reachable with a visible focus ring', async () => {
  const page = await optionsPage();
  await page.focus('#exportBtn');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'importBtn');
  assert.notEqual(await page.$eval('#importBtn', (el) => getComputedStyle(el).outlineStyle), 'none');
  // The file input itself is hidden: the button opens it.
  assert.equal(await page.$eval('#importFile', (el) => el.hidden), true);
  assert.equal(await page.getAttribute('#importResult', 'role'), 'status');
});
