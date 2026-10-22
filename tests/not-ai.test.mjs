import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage, isHidden, coverOf, readShadow, clickNode, EMPTY_LIST } from './helpers.mjs';

// "Not AI, show this channel" on Community covers.

let ctx;

const HOME = 'https://www.youtube.com/feed/channels';
const WATCH = 'https://www.youtube.com/watch?v=dream';
const BUTTON = 'byeai-not-ai button';
const LIST = {
  version: 7,
  updatedAt: '2026-10-21T08:00:00Z',
  channels: [
    { p: 'youtube', id: 'UCdreamfactory00000000000', n: 'Dream Factory' },
    { p: 'youtube', id: '@DreamFactory', n: 'Dream Factory' },
    { p: 'youtube', id: '@SlopStudio', n: 'Slop Studio' },
  ],
};

const sent = () => ctx.oma.suggests.map((s) => JSON.parse(s.body));
const version = () => ctx.worker.evaluate(() => chrome.runtime.getManifest().version);
const shownList = () => ctx.worker.evaluate(() => globalThis.byeaiShownChannels.read());
const today = () => new Date().toISOString().slice(0, 10);
const visible = async (page) => {
  const b = await page.$(BUTTON);
  return Boolean(b) && (await b.isVisible());
};

async function useList(list = LIST) {
  ctx.oma.list = list;
  ctx.oma.etag = `"v${list.version}"`;
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'updated');
}

async function clickNotAi(page, selector) {
  await page.hover(selector);
  await page.waitForTimeout(150);
  await page.click(BUTTON);
  await page.waitForTimeout(500);
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

test('the button is only on Community covers', async () => {
  await useList();
  const page = await open(ctx.context, HOME);
  assert.equal(await coverOf(page, '#lab'), 'labeled');
  await page.hover('#lab');
  await page.waitForTimeout(150);
  assert.equal(await visible(page), false, 'not on a labeled cover');
  await page.hover('#r1');
  await page.waitForTimeout(150);
  assert.equal(await visible(page), false, 'not on a plain tile');

  await page.hover('#u1');
  await page.waitForTimeout(150);
  assert.equal(await visible(page), true);
  const button = page.locator(BUTTON);
  assert.equal(await button.textContent(), 'Not AI, show this channel');
  assert.match(await button.getAttribute('aria-label'), /Not AI, show this channel: Dream Factory/);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);
  assert.equal(await visible(page), false);
});

test('click shows every tile of the channel, saves it and survives reload', async () => {
  await useList();
  const page = await open(ctx.context, HOME);
  for (const id of ['#s1', '#s2', '#lk']) assert.equal(await coverOf(page, id), 'community', id);
  await clickNotAi(page, '#s1');

  for (const id of ['#s1', '#s2', '#lk']) assert.equal(await coverOf(page, id), '', id);
  assert.equal(await coverOf(page, '#u1'), 'community', 'other channels stay blurred');
  const list = await shownList();
  assert.deepEqual(list.map((c) => c.id), ['@slopstudio']);
  assert.equal(list[0].n, 'Slop Studio');

  const toast = await readShadow(page, 'byeai-toast');
  assert.ok(toast.texts.includes("Showing Slop Studio. Thanks, we'll review it."));
  assert.ok(toast.buttons.Undo);

  await page.reload();
  await page.waitForTimeout(700);
  assert.equal(await coverOf(page, '#s1'), '');
  assert.equal(await coverOf(page, '#u1'), 'community');
});

test('works on a watch page and survives reload', async () => {
  await useList();
  const watch = await open(ctx.context, WATCH);
  assert.equal(await coverOf(watch, '#movie_player'), 'community');
  await clickNotAi(watch, '#movie_player');
  assert.equal(await coverOf(watch, '#movie_player'), '');
  await watch.reload();
  await watch.waitForTimeout(700);
  assert.equal(await coverOf(watch, '#movie_player'), '');
});

test('one anonymous report with exactly the agreed body', async () => {
  await useList();
  const page = await open(ctx.context, HOME);
  await clickNotAi(page, '#s1');
  assert.equal(ctx.oma.suggests.length, 1);
  const req = ctx.oma.suggests[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.cookie, undefined);
  assert.deepEqual(sent()[0], { p: 'youtube', id: '@slopstudio', n: 'Slop Studio', why: 'not_ai', v: await version() });
  assert.deepEqual(Object.keys(sent()[0]), ['p', 'id', 'n', 'why', 'v']);

  // Same channel again within 30 days: no second report.
  const again = await ctx.worker.evaluate(() => notAi({ channel: { id: '@slopstudio', n: 'Slop Studio' } }));
  assert.equal(again.recent, true);
  assert.equal(ctx.oma.suggests.length, 1);
});

test('Community list off: nothing sent, the choice is still kept', async () => {
  await useList();
  await setStorage(ctx.worker, { communityEnabled: false });
  const page = await open(ctx.context, HOME);
  assert.equal(await coverOf(page, '#s1'), '');
  const reply = await ctx.worker.evaluate(() => notAi({ channel: { id: '@slopstudio', n: 'Slop Studio' } }));
  assert.equal(reply.off, true);
  assert.equal(ctx.oma.suggests.length, 0);
  assert.deepEqual((await shownList()).map((c) => c.id), ['@slopstudio']);
});

test('the daily limit of 20 is respected, the channel is still shown', async () => {
  await useList();
  await setStorage(ctx.worker, { suggestCount: { day: today(), count: 20 } });
  const page = await open(ctx.context, HOME);
  await clickNotAi(page, '#s1');
  assert.equal(await coverOf(page, '#s1'), '');
  assert.equal(ctx.oma.suggests.length, 0);
  const { notAiSent } = await ctx.worker.evaluate(() => chrome.storage.local.get('notAiSent'));
  assert.deepEqual(notAiSent, {}, 'not remembered, so a later day can send it');
});

test('Undo blurs the channel again and does not unsend', async () => {
  await useList();
  const page = await open(ctx.context, HOME);
  await clickNotAi(page, '#s1');
  const toast = await readShadow(page, 'byeai-toast');
  await clickNode(page, toast.buttons.Undo);
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#s1'), 'community');
  assert.equal(await coverOf(page, '#s2'), 'community');
  assert.deepEqual(await shownList(), []);
  assert.equal(ctx.oma.suggests.length, 1);
});

test('Options lists shown channels, Blur again restores the blur', async () => {
  await useList();
  const options = await ctx.context.newPage();
  await options.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await options.waitForTimeout(300);
  assert.equal(await options.isVisible('#emptyShown'), true);
  assert.equal(await options.textContent('#shown-channels h2'), 'Channels you chose to show');

  const page = await open(ctx.context, HOME);
  await clickNotAi(page, '#s1');
  await options.waitForTimeout(500);
  assert.equal(await options.isVisible('#emptyShown'), false);
  const rows = await options.$$eval('#shownList li', (lis) => lis.map((li) => li.textContent));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /Slop Studio/);

  await options.click('#shownList li button');
  await options.waitForTimeout(500);
  assert.deepEqual(await shownList(), []);
  assert.equal(await options.isVisible('#emptyShown'), true);
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#s1'), 'community');
});

test('your own Hide channel still wins over Not AI', async () => {
  await useList();
  const page = await open(ctx.context, HOME);
  await clickNotAi(page, '#s1');
  await ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.write([{ id: '@slopstudio', n: 'Slop Studio' }]));
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#s1'), true);
  assert.equal(await isHidden(page, '#s2'), true);
});
