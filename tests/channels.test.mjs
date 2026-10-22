import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage, isHidden, coverOf, readShadow, clickNode, EMPTY_LIST } from './helpers.mjs';

let ctx;

const HOME = 'https://www.youtube.com/feed/channels';
const SEARCH = 'https://www.youtube.com/results?search_query=cats';
const WATCH = 'https://www.youtube.com/watch?v=dream';
const COMMUNITY = {
  version: 7,
  updatedAt: '2026-10-21T08:00:00Z',
  channels: [
    { p: 'youtube', id: 'UCdreamfactory00000000000', n: 'Dream Factory' },
    { p: 'youtube', id: '@DreamFactory', n: 'Dream Factory' },
  ],
};

const buttonShown = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('byeai-hide-channel');
    return Boolean(host) && getComputedStyle(host).display !== 'none';
  });

const hiddenList = () => ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.read());
const storedList = () => ctx.worker.evaluate(() => chrome.storage.local.get('community').then((d) => d.community));

async function useList(list) {
  ctx.oma.list = list;
  ctx.oma.etag = `"v${list.version}"`;
  ctx.oma.status = 200;
  const result = await ctx.worker.evaluate(() => refreshCommunity(true));
  assert.equal(result, 'updated');
}

async function hideFromTile(page, selector) {
  await page.hover(selector);
  await page.waitForTimeout(100);
  await page.click('byeai-hide-channel button');
  await page.waitForTimeout(300);
}

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

test('hide button shows on hover over a tile with a channel, not on one without', async () => {
  const page = await open(ctx.context, HOME);
  assert.equal(await buttonShown(page), false);
  await page.hover('#s1');
  assert.equal(await buttonShown(page), true);
  const label = await page.$eval('byeai-hide-channel', (h) => h.shadowRoot.querySelector('button').getAttribute('aria-label'));
  assert.equal(label, 'Hide channel: Slop Studio');

  // Sits over the thumbnail, in its top corner.
  const [btn, img] = await Promise.all([
    page.$eval('byeai-hide-channel', (h) => h.getBoundingClientRect().toJSON()),
    page.$eval('#s1 img', (i) => i.getBoundingClientRect().toJSON()),
  ]);
  assert.ok(btn.left >= img.left && btn.right <= img.right && Math.abs(btn.top - img.top - 8) < 2);

  await page.hover('#short1');
  assert.equal(await buttonShown(page), false, 'no channel link, no button');
});

test('keyboard: Tab from the tile reaches the hide button, then the next tile', async () => {
  const page = await open(ctx.context, HOME);
  await page.focus('#s1 button[aria-label="Action menu"]');
  assert.equal(await buttonShown(page), true, 'focus shows the button');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BYEAI-HIDE-CHANNEL');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('ytd-rich-item-renderer')?.id), 's2');
});

test('hiding a channel removes all its tiles, also ones added later, without opening the video', async () => {
  const page = await open(ctx.context, HOME);
  await hideFromTile(page, '#s1');
  assert.equal(page.url(), HOME, 'the click did not open the video');
  for (const id of ['#s1', '#s2', '#lk']) assert.equal(await isHidden(page, id), true, id);
  assert.equal(await isHidden(page, '#r1'), false);
  assert.equal(await isHidden(page, '#u1'), false);

  const toast = await readShadow(page, 'byeai-toast');
  assert.equal(toast.mode, 'closed');
  assert.ok(toast.texts.includes('Hidden Slop Studio'));
  assert.ok(toast.buttons.Undo && toast.buttons['Suggest as AI channel']);

  const list = await hiddenList();
  assert.deepEqual(list, [{ id: '@slopstudio', n: 'Slop Studio' }]);

  await page.evaluate(() => {
    const t = document.createElement('ytd-rich-item-renderer');
    t.id = 'late';
    t.innerHTML = '<a href="/watch?v=late"><img alt=""></a><ytd-channel-name><a href="/@SlopStudio">Slop Studio</a></ytd-channel-name>';
    document.getElementById('grid').append(t);
  });
  await page.waitForTimeout(300);
  assert.equal(await isHidden(page, '#late'), true);

  // Recycled tile: the channel link changes, the tile shows again.
  await page.evaluate(() => document.querySelector('#s2 ytd-channel-name a').setAttribute('href', '/@RealBaker'));
  await page.waitForTimeout(300);
  assert.equal(await isHidden(page, '#s2'), false);

  // Other YouTube pages: search and the watch page sidebar.
  const search = await open(ctx.context, SEARCH);
  assert.equal(await isHidden(search, '#v1'), true);
  assert.equal(await isHidden(search, '#v2'), false);
  const watch = await open(ctx.context, WATCH);
  assert.equal(await isHidden(watch, '#c1'), true);
});

test('Undo brings the channel back', async () => {
  const page = await open(ctx.context, HOME);
  await hideFromTile(page, '#s1');
  const toast = await readShadow(page, 'byeai-toast');
  await clickNode(page, toast.buttons.Undo);
  await page.waitForTimeout(400);
  assert.equal(await isHidden(page, '#s1'), false);
  assert.equal(await isHidden(page, '#s2'), false);
  assert.deepEqual(await hiddenList(), []);
});

test('watch page: Hide channel button next to the channel', async () => {
  const page = await open(ctx.context, WATCH);
  const host = await page.$eval('byeai-watch-channel', (h) => ({
    text: h.shadowRoot.querySelector('button').textContent,
    display: getComputedStyle(h).display,
    left: h.getBoundingClientRect().left,
  }));
  const sub = await page.$eval('#subscribe', (b) => b.getBoundingClientRect().right);
  assert.equal(host.display, 'block');
  assert.equal(host.text, 'Hide channel');
  assert.ok(host.left >= sub, 'after the Subscribe button');

  await page.click('byeai-watch-channel button');
  await page.waitForTimeout(300);
  assert.deepEqual((await hiddenList()).map((c) => c.id), ['@dreamfactory']);
  assert.equal(await page.$eval('byeai-watch-channel', (h) => h.shadowRoot.querySelector('button').textContent), 'Unhide channel');
});

test('options page lists hidden channels and Unhide shows them again', async () => {
  const yt = await open(ctx.context, HOME);
  await hideFromTile(yt, '#s1');

  const options = await ctx.context.newPage();
  await options.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await options.waitForTimeout(300);
  assert.equal(await options.isVisible('#emptyHidden'), false);
  const rows = await options.$$eval('#hiddenList li', (lis) => lis.map((li) => li.textContent));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /Slop Studio · @slopstudio/);

  await options.click('#hiddenList li button');
  await options.waitForTimeout(400);
  assert.equal(await options.isVisible('#emptyHidden'), true);
  assert.equal(await isHidden(yt, '#s1'), false, 'unhidden live in the open tab');
});

test('a long hidden list stays under the sync size limits', async () => {
  const sizes = await ctx.worker.evaluate(async () => {
    const store = globalThis.byeaiHiddenChannels;
    const list = Array.from({ length: 600 }, (_, i) => ({ id: `@channel${i}`, n: `Channel number ${i} `.repeat(6) }));
    await store.write(list);
    const data = await chrome.storage.sync.get(null);
    const keys = Object.keys(data).filter(store.isKey);
    const read = await store.read();
    return {
      count: read.length,
      first: read[0].id,
      last: read[read.length - 1].id,
      max: Math.max(...keys.map((k) => k.length + new TextEncoder().encode(JSON.stringify(data[k])).length)),
    };
  });
  assert.equal(sizes.count, 500);
  assert.equal(sizes.first, '@channel100', 'oldest dropped first');
  assert.equal(sizes.last, '@channel599');
  assert.ok(sizes.max < 8192, `chunk of ${sizes.max} bytes`);
});

test('Community list channels get the community cover, click reveals', async () => {
  await useList(COMMUNITY);
  const page = await open(ctx.context, HOME);
  assert.equal(await coverOf(page, '#u1'), 'community');
  assert.equal(await coverOf(page, '#r1'), '');
  const note = await page.$eval('#u1', (el) => getComputedStyle(el, '::after').content);
  assert.match(note, /In the ByeAI Community list/);

  await page.click('#u1');
  assert.equal(page.url(), HOME);
  assert.equal(await coverOf(page, '#u1'), '');

  const watch = await open(ctx.context, WATCH);
  assert.equal(await coverOf(watch, '#movie_player'), 'community');
  // Mix / playlist panel items carry only the channel name, no link.
  assert.equal(await coverOf(watch, '#m1'), 'community');
  assert.equal(await coverOf(watch, '#m2'), '');
});

test('hidden channels win over the Community list', async () => {
  await useList(COMMUNITY);
  await ctx.worker.evaluate(() =>
    globalThis.byeaiHiddenChannels.write([{ id: 'UCdreamfactory00000000000', n: 'Dream Factory' }])
  );
  const page = await open(ctx.context, HOME);
  assert.equal(await isHidden(page, '#u1'), true);
  assert.equal(await coverOf(page, '#u1'), '');
});

test('Community list off: no covers, no downloads, no alarm', async () => {
  await useList(COMMUNITY);
  const page = await open(ctx.context, HOME);
  assert.equal(await coverOf(page, '#u1'), 'community');
  assert.ok(await ctx.worker.evaluate(() => chrome.alarms.get('byeai-community')), 'daily alarm while on');

  const options = await ctx.context.newPage();
  await options.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await options.uncheck('#communityEnabled');
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#u1'), '');

  ctx.oma.listRequests = [];
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'off');
  assert.equal(ctx.oma.listRequests.length, 0);
  assert.equal(await ctx.worker.evaluate(() => chrome.alarms.get('byeai-community')), undefined);

  // Personal hidden channels keep working.
  await hideFromTile(page, '#s1');
  assert.equal(await isHidden(page, '#s1'), true);

  await options.check('#communityEnabled');
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#u1'), 'community');
  assert.ok(await ctx.worker.evaluate(() => chrome.alarms.get('byeai-community')));
});

test('list download: plain GET, sends If-None-Match, keeps the old list on errors', async () => {
  await useList(COMMUNITY);
  const req = ctx.oma.listRequests.at(-1);
  assert.equal(req.method, 'GET');
  assert.equal(req.headers.cookie, undefined);
  const stored = await storedList();
  assert.equal(stored.version, 7);
  assert.equal(stored.etag, '"v7"');
  assert.equal(stored.channels.length, 2);
  assert.equal(stored.channels[1].id, '@dreamfactory');

  // Not modified.
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'same');
  assert.equal(ctx.oma.listRequests.at(-1).headers['if-none-match'], '"v7"');

  // Server error and broken JSON keep what we had.
  ctx.oma.status = 500;
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'error');
  assert.equal(ctx.oma.listRequests.at(-1).headers['if-none-match'], '"v7"');
  assert.equal((await storedList()).channels.length, 2);

  ctx.oma.status = 200;
  ctx.oma.etag = '"broken"';
  ctx.oma.list = { nope: true };
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'error');
  assert.equal((await storedList()).version, 7);

  // Fresh list: no second download within the day.
  const before = ctx.oma.listRequests.length;
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity()), 'fresh');
  assert.equal(ctx.oma.listRequests.length, before);
});

test('bundled list is used until the first download', async () => {
  await ctx.worker.evaluate(() => chrome.storage.local.remove('community'));
  const list = await ctx.worker.evaluate(() => readCommunity());
  assert.equal(list.version, 0);
  assert.deepEqual(list.channels, []);
  assert.equal(list.fetchedAt, 0);
});

test('suggest sends only after the click, exactly the documented JSON, without cookies', async () => {
  await ctx.context.addCookies([{ name: 'sid', value: 'secret', domain: 'oma.lanetti.fi', path: '/', secure: true }]);
  const page = await open(ctx.context, HOME);
  await hideFromTile(page, '#s1');
  assert.equal(ctx.oma.suggests.length, 0, 'nothing sent when hiding');

  const toast = await readShadow(page, 'byeai-toast');
  await clickNode(page, toast.buttons['Suggest as AI channel']);
  await page.waitForTimeout(500);

  assert.equal(ctx.oma.suggests.length, 1);
  const sent = ctx.oma.suggests[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.cookie, undefined);
  assert.match(sent.headers['content-type'], /application\/json/);
  const version = await ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
  assert.deepEqual(JSON.parse(sent.body), { p: 'youtube', id: '@slopstudio', n: 'Slop Studio', why: 'manual', v: version });

  const after = await readShadow(page, 'byeai-toast');
  assert.ok(after.texts.includes('Thanks, suggestion sent'));
  await ctx.context.clearCookies();
});

test('suggest reason is "labeled" when YouTube labeled the channel as AI, failures say so', async () => {
  ctx.oma.suggestStatus = 500;
  const page = await open(ctx.context, HOME);
  assert.equal(await coverOf(page, '#lab'), 'labeled');
  await page.click('#lab');
  await hideFromTile(page, '#lab');
  const toast = await readShadow(page, 'byeai-toast');
  await clickNode(page, toast.buttons['Suggest as AI channel']);
  await page.waitForTimeout(500);
  assert.equal(JSON.parse(ctx.oma.suggests[0].body).why, 'labeled');
  assert.ok((await readShadow(page, 'byeai-toast')).texts.includes('Could not send, try later'));
});

test('no more than 20 suggestions a day', async () => {
  const day = new Date().toISOString().slice(0, 10);
  await setStorage(ctx.worker, { suggestCount: { day, count: 20 } });
  const result = await ctx.worker.evaluate(() => suggestChannel({ id: '@slopstudio', n: 'Slop Studio', why: 'manual' }));
  assert.equal(result.ok, false);
  assert.equal(ctx.oma.suggests.length, 0);
});

test('turning off AI videos and images turns off hidden channels and Community covers', async () => {
  await useList(COMMUNITY);
  await ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.write([{ id: '@slopstudio', n: 'Slop Studio' }]));
  const page = await open(ctx.context, HOME);
  assert.equal(await isHidden(page, '#s1'), true);
  assert.equal(await coverOf(page, '#u1'), 'community');

  await setStorage(ctx.worker, { features: { widgets: true, labeled: false } });
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#s1'), false);
  assert.equal(await coverOf(page, '#u1'), '');
  await page.hover('#r1');
  assert.equal(await buttonShown(page), false);
  assert.equal(await ctx.worker.evaluate(() => chrome.alarms.get('byeai-community')), undefined);

  await setStorage(ctx.worker, { features: { widgets: true, labeled: true } });
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#s1'), true);
  assert.equal(await coverOf(page, '#u1'), 'community');
});
