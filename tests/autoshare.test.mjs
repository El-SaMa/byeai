import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage, coverOf, EMPTY_LIST } from './helpers.mjs';

// "Help the Community automatically": YouTube's own AI label on a watch
// page sends that channel to the Community list, if the setting is on.

let ctx;

const LABELED = 'https://www.youtube.com/watch?v=labeled';
const LABELED2 = 'https://www.youtube.com/watch?v=labeled2';
const TAGGED = 'https://www.youtube.com/watch?v=tagged';
const UNLABELED = 'https://www.youtube.com/watch?v=dream';
const NO_OWNER = 'https://www.youtube.com/watch?v=test';
const HOME = 'https://www.youtube.com/feed/channels';
const DAY = 24 * 60 * 60 * 1000;

const sent = () => ctx.oma.suggests.map((s) => JSON.parse(s.body));
const version = () => ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
const local = (keys) => ctx.worker.evaluate((k) => chrome.storage.local.get(k), keys);
const today = () => new Date().toISOString().slice(0, 10);

async function visit(url) {
  const page = await open(ctx.context, url);
  await page.waitForTimeout(400);
  return page;
}

async function options() {
  const page = await ctx.context.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await page.waitForTimeout(300);
  return page;
}

// Calls the worker directly, as a YouTube tab would.
const direct = (message) =>
  ctx.worker.evaluate((m) => autoShare(m, { url: 'https://www.youtube.com/watch?v=x' }), message);

before(async () => {
  ctx = await launch();
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  Object.assign(ctx.oma, { list: EMPTY_LIST, etag: '"v0"', status: 200, suggestStatus: 202, listRequests: [], suggests: [] });
  for (const p of ctx.context.pages()) await p.close();
});

test('off by default: a labeled watch page sends nothing', async () => {
  await ctx.worker.evaluate(() => chrome.storage.sync.remove('communityAutoShare'));
  const page = await visit(LABELED);
  assert.equal(await coverOf(page, '#movie_player'), 'labeled');
  assert.equal(ctx.oma.suggests.length, 0);

  const opts = await options();
  assert.equal(await opts.isChecked('#communityAutoShare'), false);
  assert.equal(await opts.isDisabled('#communityAutoShare'), false);
});

test('on: one labeled suggestion per channel, nothing more within 30 days', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true });
  const page = await visit(LABELED);
  assert.equal(ctx.oma.suggests.length, 1);
  const req = ctx.oma.suggests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.cookie, undefined);
  assert.deepEqual(sent()[0], { p: 'youtube', id: '@pixeldreams', n: 'Pixel Dreams', why: 'labeled', v: await version() });

  await page.reload();
  await page.waitForTimeout(1000);
  await visit(LABELED);
  assert.equal(ctx.oma.suggests.length, 1, 'reload and second visit send nothing');

  await visit(LABELED2);
  assert.equal(ctx.oma.suggests.length, 2);
  assert.deepEqual(sent()[1], { p: 'youtube', id: 'UCsynthlab0000000000000', n: 'Synth Lab', why: 'labeled', v: await version() });

  const { autoShared, autoSharedCount } = await local(['autoShared', 'autoSharedCount']);
  assert.deepEqual(Object.keys(autoShared).sort(), ['@pixeldreams', 'UCsynthlab0000000000000']);
  assert.equal(autoSharedCount, 2);

  // After 30 days the channel can be sent again.
  await setStorage(ctx.worker, { autoShared: { ...autoShared, '@pixeldreams': Date.now() - 31 * DAY } });
  await visit(LABELED);
  assert.equal(ctx.oma.suggests.length, 3);
});

test('tags, comments, unlabeled pages and hiding send nothing', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true });
  const tagged = await visit(TAGGED);
  assert.equal(await coverOf(tagged, '#t1'), 'tagged');
  await visit(UNLABELED);
  await visit(NO_OWNER);

  const home = await visit(HOME);
  await home.hover('#s1');
  await home.waitForTimeout(100);
  await home.click('byeai-hide-channel button');
  await home.waitForTimeout(400);
  assert.equal(ctx.oma.suggests.length, 0);
});

test('a channel already in the Community list is never sent', async () => {
  ctx.oma.list = { version: 3, updatedAt: '2026-10-21T08:00:00Z', channels: [{ p: 'youtube', id: '@PixelDreams', n: 'Pixel Dreams' }] };
  ctx.oma.etag = '"v3"';
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'updated');
  await setStorage(ctx.worker, { communityAutoShare: true });

  await visit(LABELED);
  assert.equal(ctx.oma.suggests.length, 0);
  // The worker checks too, whatever the page says.
  assert.equal((await direct({ id: '@pixeldreams', n: 'Pixel Dreams' })).listed, true);
  assert.equal(ctx.oma.suggests.length, 0);
});

test('Community list off or AI videos off: nothing sent, setting disabled', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true, communityEnabled: false });
  const opts = await options();
  assert.equal(await opts.isDisabled('#communityAutoShare'), true);
  await visit(LABELED);
  assert.equal((await direct({ id: '@pixeldreams', n: 'Pixel Dreams' })).ok, false);
  assert.equal(ctx.oma.suggests.length, 0);

  await setStorage(ctx.worker, { communityEnabled: true, features: { widgets: true, labeled: false } });
  await opts.waitForTimeout(300);
  assert.equal(await opts.isDisabled('#communityAutoShare'), true, 'updates live');
  await visit(LABELED);
  assert.equal((await direct({ id: '@pixeldreams', n: 'Pixel Dreams' })).ok, false);
  assert.equal(ctx.oma.suggests.length, 0);

  await setStorage(ctx.worker, { features: { widgets: true, labeled: true } });
  await opts.waitForTimeout(300);
  assert.equal(await opts.isDisabled('#communityAutoShare'), false);
});

test('allowed site: nothing sent', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true, allowedHosts: ['youtube.com'] });
  await visit(LABELED);
  assert.equal((await direct({ id: '@pixeldreams', n: 'Pixel Dreams' })).ok, false);
  assert.equal(ctx.oma.suggests.length, 0);
});

test('the daily limit of 20 is shared with manual suggestions', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true, suggestCount: { day: today(), count: 19 } });
  await visit(LABELED);
  assert.equal(ctx.oma.suggests.length, 1, 'the 20th goes out');

  const manual = await ctx.worker.evaluate(() => suggestChannel({ id: '@slopstudio', n: 'Slop Studio', why: 'manual' }));
  assert.equal(manual.limit, true);

  await visit(LABELED2);
  assert.equal(ctx.oma.suggests.length, 1, 'automatic stops at the limit too');
  // Not remembered, so it can go out another day.
  const { autoShared } = await local('autoShared');
  assert.deepEqual(Object.keys(autoShared), ['@pixeldreams']);
});

test('remembers at most 1000 channels, oldest dropped', async () => {
  await setStorage(ctx.worker, { communityAutoShare: true });
  const now = Date.now();
  const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`@old${i}`, now - DAY + i]));
  await setStorage(ctx.worker, { autoShared: many });
  assert.equal((await direct({ id: '@pixeldreams', n: 'Pixel Dreams' })).ok, true);
  const { autoShared } = await local('autoShared');
  assert.equal(Object.keys(autoShared).length, 1000);
  assert.equal('@old0' in autoShared, false);
  assert.equal('@pixeldreams' in autoShared, true);
});

test('options: counter line updates after an automatic share', async () => {
  const opts = await options();
  assert.equal(await opts.textContent('#autoShareCount'), 'Channels shared automatically: 0');
  await opts.check('#communityAutoShare');
  await opts.waitForTimeout(200);
  assert.equal(await ctx.worker.evaluate(() => chrome.storage.sync.get('communityAutoShare').then((d) => d.communityAutoShare)), true);

  await visit(LABELED);
  await opts.waitForTimeout(300);
  assert.equal(await opts.textContent('#autoShareCount'), 'Channels shared automatically: 1');
});
