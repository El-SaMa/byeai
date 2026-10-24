import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, resetStorage, isHidden, coverOf, EMPTY_LIST } from './helpers.mjs';

let ctx;

const SHORTS = 'https://www.youtube.com/results?search_query=ai+cat+story';
const LIST = (withVideos, version = 9) => ({
  version,
  updatedAt: '2026-10-25T08:00:00Z',
  channels: [
    {
      p: 'youtube',
      id: '@DreamFactory',
      n: 'Dream Factory',
      ...(withVideos ? { v: ['ComVideo001', 'ComVideo002', 'ComVideo003', 'ComVideo004', 'ComVideo005', 'bad id', 'short'] } : {}),
    },
  ],
});

async function useList(list) {
  ctx.oma.list = list;
  ctx.oma.etag = `"v${list.version}"`;
  ctx.oma.status = 200;
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'updated');
}

const panelCount = (page) => page.$$eval('byeai-cover-panel', (els) => els.length);
const coversIn = (page) => page.$$eval('[data-byeai-cover]', (els) => els.map((e) => e.id).sort());

// Panels sit over their tile: find the one over the tile and click a button.
async function panelClick(page, selector, act) {
  await page.evaluate(
    ({ sel, a }) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      for (const host of document.querySelectorAll('byeai-cover-panel')) {
        const h = host.getBoundingClientRect();
        if (Math.abs(h.left - r.left) < 3 && Math.abs(h.top - r.top) < 3) {
          host.shadowRoot.querySelector(`button[data-act="${a}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
          return;
        }
      }
      throw new Error('no panel over ' + sel);
    },
    { sel: selector, a: act }
  );
  await page.waitForTimeout(400);
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

test('v2 wrapper: a tagged Short gets exactly one cover and one panel, blurred, on the outer tile', async () => {
  const page = await open(ctx.context, SHORTS);
  assert.deepEqual(await coversIn(page), ['v2tag']);
  assert.equal(await coverOf(page, '#v2tag'), 'tagged');
  assert.equal(await coverOf(page, '#v2tag-in'), '');
  assert.equal(await panelCount(page), 1);
  assert.match(await page.$eval('#v2tag-in', (el) => getComputedStyle(el).filter), /blur/);
});

test('Community list with video ids covers Shorts of the channel, a list without them does not', async () => {
  await useList(LIST(true));
  let page = await open(ctx.context, SHORTS);
  assert.deepEqual(await coversIn(page), ['plain-in', 'reel', 'shelfitem', 'v2com', 'v2tag', 'watchtile']);
  assert.equal(await coverOf(page, '#v2com'), 'community');
  assert.equal(await coverOf(page, '#v2real'), '');
  assert.equal(await panelCount(page), 6, 'one panel per covered tile');
  await page.close();

  await useList(LIST(false, 10));
  page = await open(ctx.context, SHORTS);
  assert.deepEqual(await coversIn(page), ['v2tag'], 'only the tagged one');
});

test('Not AI on a Short tile shows the whole channel', async () => {
  await useList(LIST(true));
  const page = await open(ctx.context, SHORTS);
  await panelClick(page, '#v2com', 'notai');
  assert.equal(await coverOf(page, '#v2com'), '');
  assert.equal(await coverOf(page, '#plain-in'), '');
  const shown = await ctx.worker.evaluate(() => globalThis.byeaiShownChannels.read());
  assert.deepEqual(shown.map((c) => c.id), ['@dreamfactory']);
});

test('Hide channel on a Short tile hides the channel', async () => {
  await useList(LIST(true));
  const page = await open(ctx.context, SHORTS);
  await panelClick(page, '#v2com', 'hide');
  assert.equal(await isHidden(page, '#v2com'), true);
  assert.equal(await isHidden(page, '#plain-in'), true);
  assert.equal(await isHidden(page, '#v2real'), false);
  const hidden = await ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.read());
  assert.deepEqual(hidden.map((c) => c.id), ['@dreamfactory']);
});

test('video id storage: invalid ids dropped, 30 per channel, 20,000 in all, old lists unchanged', async () => {
  const id = (i) => `v${String(i).padStart(10, '0')}`;
  const channels = Array.from({ length: 700 }, (_, c) => ({
    p: 'youtube',
    id: `@chan${c}`,
    n: `Chan ${c}`,
    v: Array.from({ length: 40 }, (_, i) => id(c * 40 + i)),
  }));
  channels[0].v.push('bad id!', 'short', 42, null, id(0));
  const clean = await ctx.worker.evaluate((list) => cleanCommunity({ version: 1, channels: list }), channels);
  assert.equal(clean.channels.length, 700);
  assert.equal(clean.channels[0].v.length, 30);
  assert.ok(clean.channels[0].v.every((v) => /^[A-Za-z0-9_-]{11}$/.test(v)));
  assert.equal(clean.channels.reduce((n, c) => n + (c.v?.length || 0), 0), 20000);
  assert.equal(clean.channels[699].v, undefined, 'no ids kept once the cap is reached');
  const old = await ctx.worker.evaluate(() => cleanCommunity({ version: 1, channels: [{ p: 'youtube', id: '@a', n: 'A' }] }));
  assert.deepEqual(old.channels, [{ p: 'youtube', id: '@a', n: 'A' }]);
});
