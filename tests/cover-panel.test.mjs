import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, resetStorage, isHidden, coverOf, readShadow, EMPTY_LIST } from './helpers.mjs';

// The action panel on YouTube covers: Show video, Hide channel, Not AI, Next video.

let ctx;

const FEED = 'https://www.youtube.com/';
const CHANNELS = 'https://www.youtube.com/feed/channels';
const WATCH = 'https://www.youtube.com/watch?v=dream';
const LABELED_WATCH = 'https://www.youtube.com/watch?v=test';
const LIST = {
  version: 9,
  updatedAt: '2026-10-22T08:00:00Z',
  channels: [
    { p: 'youtube', id: 'UCdreamfactory00000000000', n: 'Dream Factory' },
    { p: 'youtube', id: '@DreamFactory', n: 'Dream Factory' },
    { p: 'youtube', id: '@SlopStudio', n: 'Slop Studio' },
  ],
};

const panel = (id) => `byeai-cover-panel[data-card="${id}"]`;
const btn = (id, act) => `${panel(id)} button[data-act="${act}"]`;
const ready = (page, id) => page.waitForSelector(panel(id), { state: 'attached' });
// The panel's buttons once they have settled (same list twice in a row).
const acts = async (page, id) => {
  await ready(page, id);
  const read = () => page.$eval(panel(id), (h) => [...h.shadowRoot.querySelectorAll('button')].map((b) => b.dataset.act));
  let last = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const now = await read();
    if (now.length && now.join() === last.join()) return now;
    last = now;
  }
  return last;
};
const text = async (page, id) => {
  await ready(page, id);
  return page.$eval(panel(id), (h) => h.shadowRoot.querySelector('.scrim').textContent);
};
// Waits until the panel's text matches, so a panel still filling in does not fail the test.
async function hasText(page, id, re) {
  await ready(page, id);
  await page
    .waitForFunction(
      ([sel, src, flags]) => new RegExp(src, flags).test(document.querySelector(sel)?.shadowRoot?.querySelector('.scrim')?.textContent || ''),
      [panel(id), re.source, re.flags],
      { timeout: 5000 }
    )
    .catch(() => {});
  return text(page, id);
}
const hiddenList = () => ctx.worker.evaluate(() => globalThis.byeaiHiddenChannels.read());

async function useList() {
  ctx.oma.list = LIST;
  ctx.oma.etag = `"v${LIST.version}"`;
  assert.equal(await ctx.worker.evaluate(() => refreshCommunity(true)), 'updated');
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

test('every cover has a panel with the right title and reason', async () => {
  await useList();
  const feed = await open(ctx.context, FEED);
  assert.match(await hasText(feed, 'labeled', /AI video hidden/), /AI video hidden/);
  assert.match(await hasText(feed, 'labeled', /YouTube labels it as AI/), /YouTube labels it as AI/);
  assert.match(await hasText(feed, 'tagged', /Tagged as AI by the creator/), /Tagged as AI by the creator/);
  assert.equal(await feed.$(panel('plain')), null, 'plain tiles get no panel');

  const channels = await open(ctx.context, CHANNELS);
  assert.match(await hasText(channels, 'u1', /On the ByeAI Community list/), /On the ByeAI Community list/);
  assert.match(await hasText(channels, 'lab', /YouTube labels it as AI/), /YouTube labels it as AI/);
});

test('buttons per cover type: Not AI only on Community covers', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  assert.deepEqual(await acts(page, 'u1'), ['show', 'hide', 'notai']);
  assert.deepEqual(await acts(page, 'lab'), ['show', 'hide']);
  const labels = await page.$$eval(`${panel('u1')} button`, (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(labels, ['Show video', 'Hide channel', 'Not AI']);

  // Tiles without a channel link cannot hide a channel.
  const feed = await open(ctx.context, FEED);
  assert.deepEqual(await acts(feed, 'labeled'), ['show']);
});

test('Show video reveals only that card, and a click on the cover does nothing', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  const box = await page.$eval('#u1', (el) => el.getBoundingClientRect().toJSON());
  // The corner of the cover, away from the buttons.
  await page.mouse.click(box.left + 6, box.top + 6);
  assert.equal(page.url(), CHANNELS, 'did not open the video');
  assert.equal(await coverOf(page, '#u1'), 'community', 'a stray click does not reveal');

  await page.click(btn('u1', 'show'));
  assert.equal(await coverOf(page, '#u1'), '');
  assert.equal(page.url(), CHANNELS);
  assert.equal(await coverOf(page, '#s1'), 'community', 'other covers stay');
  assert.equal(await coverOf(page, '#lab'), 'labeled');
  assert.equal(await page.$(panel('u1')), null, 'its panel is gone');
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#u1'), '', 'it stays revealed');
});

test('Hide channel hides every tile of the channel and shows the toast with Undo', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  await page.click(btn('s1', 'hide'));
  await page.waitForTimeout(400);
  for (const id of ['#s1', '#s2', '#lk']) assert.equal(await isHidden(page, id), true, id);
  assert.equal(await isHidden(page, '#u1'), false);
  assert.equal(await coverOf(page, '#u1'), 'community');
  assert.deepEqual((await hiddenList()).map((c) => c.id), ['@slopstudio']);
  const toast = await readShadow(page, 'byeai-toast');
  assert.ok(toast.texts.includes('Hidden Slop Studio'));
  assert.ok(toast.buttons.Undo);
  assert.equal(await page.$(panel('s1')), null, 'no panel over a hidden tile');
});

test('the old hover button is not on covered tiles', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  await page.hover('#r1');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('byeai-hide-channel')).display), 'block');
  await page.focus('#lab a[href="/@LabelChan"]');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('byeai-hide-channel')).display), 'none');
});

test('player cover: video paused and kept paused, Show video plays it', async () => {
  const page = await open(ctx.context, LABELED_WATCH);
  assert.equal(await coverOf(page, '#movie_player'), 'labeled');
  assert.equal(await page.$eval('video', (v) => v.paused), true);
  await page.evaluate(() => document.querySelector('video').play().catch(() => {}));
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('video', (v) => v.paused), true, 'autoplay is paused again');
  assert.equal(await page.$eval('video', (v) => v.muted), true, 'sound state untouched');

  assert.deepEqual(await acts(page, 'movie_player'), ['show', 'next']);
  assert.match(await hasText(page, 'movie_player', /YouTube labels it as AI/), /YouTube labels it as AI/);
  await page.click(btn('movie_player', 'show'));
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#movie_player'), '');
  assert.equal(await page.$eval('video', (v) => v.paused), false, 'playback resumed');
});

test('Next video clicks the YouTube next button, and is absent without one', async () => {
  const page = await open(ctx.context, LABELED_WATCH);
  await page.click(btn('movie_player', 'next'));
  assert.equal(await page.evaluate(() => window.__next), 1);
  assert.equal(await coverOf(page, '#movie_player'), 'labeled', 'the cover stays until YouTube moves on');

  await page.evaluate(() => (document.querySelector('.ytp-next-button').style.display = 'none'));
  await page.waitForTimeout(700);
  assert.deepEqual(await acts(page, 'movie_player'), ['show']);
});

test('Hide channel on the player hides the channel and goes to the next video', async () => {
  await useList();
  const page = await open(ctx.context, WATCH);
  assert.equal(await coverOf(page, '#movie_player'), 'community');
  assert.deepEqual(await acts(page, 'movie_player'), ['show', 'next', 'hide', 'notai']);
  await page.click(btn('movie_player', 'hide'));
  await page.waitForTimeout(400);
  assert.deepEqual((await hiddenList()).map((c) => c.id), ['@dreamfactory']);
  assert.equal(await page.evaluate(() => window.__next), 1);
});

test('panel sizes: full, compact and tiny tiles all fit', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  const fits = async (id) => {
    await page.waitForTimeout(700);
    return page.evaluate((cardId) => {
      const card = document.getElementById(cardId).getBoundingClientRect();
      const host = document.querySelector(`byeai-cover-panel[data-card="${cardId}"]`);
      const box = host.shadowRoot.querySelector('.panel').getBoundingClientRect();
      return {
        size: host.dataset.size,
        inside: box.left >= card.left - 1 && box.right <= card.right + 1 && box.top >= card.top - 1 && box.bottom <= card.bottom + 1,
        buttons: [...host.shadowRoot.querySelectorAll('button')].map((b) => b.textContent.trim()),
      };
    }, id);
  };
  const resize = (id, w, h) =>
    page.evaluate(([i, ww, hh]) => {
      const el = document.getElementById(i);
      el.style.setProperty('width', `${ww}px`);
      el.style.setProperty('height', `${hh}px`);
    }, [id, w, h]);

  await resize('u1', 360, 200);
  let r = await fits('u1');
  assert.equal(r.size, 'full');
  assert.ok(r.inside, '360x200');
  assert.deepEqual(r.buttons, ['Show video', 'Hide channel', 'Not AI']);

  await resize('u1', 250, 140);
  r = await fits('u1');
  assert.equal(r.size, 'compact');
  assert.ok(r.inside, '250x140');

  await resize('u1', 168, 94);
  r = await fits('u1');
  assert.equal(r.size, 'mini');
  assert.ok(r.inside, '168x94');
  assert.deepEqual(r.buttons, ['Show', ''], 'only Show and the hide icon');

  await resize('u1', 160, 90);
  r = await fits('u1');
  assert.ok(r.inside, '160x90');
});

test('mix and playlist panel items get only Show and the hide icon', async () => {
  await useList();
  const page = await open(ctx.context, WATCH);
  assert.equal(await coverOf(page, '#m1'), 'community');
  assert.deepEqual(await acts(page, 'm1'), ['show', 'hide']);
  assert.equal(await page.$eval(panel('m1'), (h) => h.dataset.size), 'mini');
  await page.click(btn('m1', 'show'));
  assert.equal(await coverOf(page, '#m1'), '');
  assert.equal(await coverOf(page, '#movie_player'), 'community', 'the player stays covered');
});

test('keyboard: Tab from the tile reaches the buttons, Enter activates, Tab moves on', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  await page.focus('#lab a[href="/@LabelChan"]');
  await page.keyboard.press('Tab');
  const active = () =>
    page.evaluate(() => {
      const host = document.activeElement;
      return host.tagName + ':' + (host.shadowRoot?.activeElement?.dataset.act || '');
    });
  assert.equal(await active(), 'BYEAI-COVER-PANEL:show');
  await page.keyboard.press('Tab');
  assert.equal(await active(), 'BYEAI-COVER-PANEL:hide');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await active(), 'BYEAI-COVER-PANEL:show');

  // Last button (Hide on a labeled tile): Tab leaves for what comes after the tile.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('ytd-rich-item-renderer, ytm-shorts-lockup-view-model')?.id), 'short1');

  // Enter on Show reveals.
  await page.focus('#lab a[href="/@LabelChan"]');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await coverOf(page, '#lab'), '');
  assert.equal(page.url(), CHANNELS);
});

test('keyboard: Enter on Hide channel hides it', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  await page.focus('#s1 button[aria-label="Action menu"]');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  assert.equal(await isHidden(page, '#s2'), true);
});

test('Community list off: its panels go away, others stay', async () => {
  await useList();
  const page = await open(ctx.context, CHANNELS);
  assert.ok(await page.$(panel('u1')));
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ communityEnabled: false }));
  await page.waitForTimeout(600);
  assert.equal(await page.$(panel('u1')), null);
  assert.ok(await page.$(panel('lab')), 'the labeled cover keeps its panel');
});

test('other sites keep the note and click to show', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  assert.match(await page.$eval('#ai', (el) => getComputedStyle(el, '::after').content), /Click to show/);
  assert.equal(await page.$('byeai-cover-panel'), null);
});
