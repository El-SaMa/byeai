import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage, isHidden, coverOf } from './helpers.mjs';

let ctx;

before(async () => {
  ctx = await launch();
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  for (const p of ctx.context.pages()) await p.close();
});

test('YouTube feed: labeled tile is covered, plain tiles are not', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/');
  assert.equal(await coverOf(page, '#labeled'), 'labeled');
  assert.equal(await coverOf(page, '#plain'), '');
  assert.equal(await coverOf(page, '#news'), '', 'a title mentioning "AI info" is not a label');
  assert.equal(await coverOf(page, '#tagged'), '', 'strict mode is off by default');

  const note = await page.$eval('#labeled', (el) => getComputedStyle(el, '::after').content);
  assert.match(note, /Click to show/);
});

test('strict mode covers hashtag posts and turns off live', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/');
  await setStorage(ctx.worker, { features: { widgets: true, buttons: true, labeled: true, strict: true } });
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#tagged'), 'strict');
  assert.equal(await coverOf(page, '#news'), '');

  await setStorage(ctx.worker, { features: { widgets: true, buttons: true, labeled: true, strict: false } });
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#tagged'), '');
  assert.equal(await coverOf(page, '#labeled'), 'labeled');
});

test('YouTube watch: player is covered and kept paused, Ask button hidden', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/watch?v=test');
  assert.equal(await coverOf(page, '#movie_player'), 'labeled');
  assert.equal(await page.$eval('video', (v) => v.paused), true);

  await page.evaluate(() => document.querySelector('video').play().catch(() => {}));
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('video', (v) => v.paused), true, 'site autoplay is paused again');

  assert.equal(await isHidden(page, 'button[aria-label="Ask"]'), true);
  assert.equal(await isHidden(page, 'button[aria-label="Share"]'), false);

  await page.click('#movie_player');
  assert.equal(await coverOf(page, '#movie_player'), '');
  await page.evaluate(() => document.querySelector('video').play());
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('video', (v) => v.paused), false, 'revealed video plays');
});

test('YouTube watch: an "AI-generated" filter chip does not cover the player', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/watch?v=plain');
  assert.equal(await coverOf(page, '#movie_player'), '');
});

test('click reveals one item without following its link, and it stays revealed', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  assert.equal(await coverOf(page, '#ai'), 'labeled');
  assert.equal(await coverOf(page, '#real'), '');

  await page.click('#ai');
  assert.equal(page.url(), 'https://www.instagram.com/');
  assert.equal(await coverOf(page, '#ai'), '');

  await page.evaluate(() => document.getElementById('late').append(document.createElement('div')));
  await page.waitForTimeout(500);
  assert.equal(await coverOf(page, '#ai'), '');
  assert.equal(await isHidden(page, '#meta-ai'), true);
});

test('label added later is caught by the observer', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  await page.evaluate(() => {
    const a = document.createElement('article');
    a.id = 'new';
    a.innerHTML = '<img style="width:470px;height:300px;display:block"><span>AI info</span>';
    document.body.append(a);
  });
  await page.waitForTimeout(600);
  assert.equal(await coverOf(page, '#new'), 'labeled');
});

test('recycled card loses its cover when the label goes away', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  await page.evaluate(() => {
    const label = [...document.querySelectorAll('#ai span')].find((s) => s.textContent === 'AI info');
    label.textContent = 'Paris, France';
  });
  await page.waitForTimeout(600);
  assert.equal(await coverOf(page, '#ai'), '');
});

test('TikTok: AI video covered and paused, normal video keeps playing', async () => {
  const page = await open(ctx.context, 'https://www.tiktok.com/foryou');
  assert.equal(await coverOf(page, '#ai'), 'labeled');
  assert.equal(await page.$eval('#ai video', (v) => v.paused), true);
  assert.equal(await page.$eval('#real video', (v) => v.paused), false);
});

test('X: Grok buttons hidden, tweet text untouched, strict catches #midjourney', async () => {
  const page = await open(ctx.context, 'https://x.com/home');
  assert.equal(await isHidden(page, '#grok-nav'), true);
  assert.equal(await isHidden(page, '#grok-actions'), true);
  assert.equal(await isHidden(page, '#t2 a'), false, 'a "Grok" link inside tweet text stays');
  assert.equal(await coverOf(page, '#t1'), '');

  await setStorage(ctx.worker, { features: { widgets: true, buttons: true, labeled: true, strict: true } });
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#t1'), 'strict');
  assert.equal(await coverOf(page, '#t3'), '');
});

test('AI buttons toggle off shows them again without reload', async () => {
  const page = await open(ctx.context, 'https://x.com/home');
  await setStorage(ctx.worker, { features: { widgets: true, buttons: false, labeled: true, strict: false } });
  await page.waitForTimeout(400);
  assert.equal(await isHidden(page, '#grok-nav'), false);
  assert.equal(await isHidden(page, '#grok-actions'), false);
});

test('generic site: captioned figure covered, menus and horoscopes left alone', async () => {
  const page = await open(ctx.context, 'https://blog.example.com/post');
  assert.equal(await coverOf(page, '#fig'), 'labeled');
  assert.equal(await coverOf(page, '#photo'), '');
  assert.equal(await isHidden(page, '#tag'), false);
  assert.equal(await isHidden(page, '#horoscope'), false);
  assert.equal(await isHidden(page, '#ask-ai'), true);
});

test('Google: Gemini button hidden, late AI overview hidden by script', async () => {
  const page = await open(ctx.context, 'https://www.google.com/search?q=test&udm=14');
  assert.equal(await isHidden(page, '#gemini-btn'), true);
  assert.equal(await isHidden(page, '#ov1'), true);
  await page.waitForTimeout(1200);
  assert.equal(await page.$eval('#late-ov', (el) => el.dataset.byeaiHidden || ''), 'widgets');
});

test('Amazon: Rufus hidden', async () => {
  const page = await open(ctx.context, 'https://www.amazon.com/');
  assert.equal(await isHidden(page, '#nav-rufus-disco'), true);
  assert.equal(await isHidden(page, '#rufus-btn'), true);
});

test('chat widget script is blocked and its shell hidden', async () => {
  const page = await open(ctx.context, 'https://shop.example.com/');
  assert.equal(await page.evaluate(() => window.__intercom === true), false);
  assert.equal(await isHidden(page, '#intercom-container'), true);
});

test('allowed site and master switch turn everything off', async () => {
  await setStorage(ctx.worker, { allowedHosts: ['instagram.com'] });
  let page = await open(ctx.context, 'https://www.instagram.com/');
  assert.equal(await coverOf(page, '#ai'), '');
  assert.equal(await isHidden(page, '#meta-ai'), false);

  await resetStorage(ctx.worker);
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#ai'), 'labeled', 'blocking again applies live');

  await setStorage(ctx.worker, { enabled: false });
  page = await open(ctx.context, 'https://x.com/home');
  assert.equal(await isHidden(page, '#grok-nav'), false);
});

test('popup counts each category for the tab', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  const state = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    return chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: tab.id });
  });
  assert.equal(state.pageByCategory.labeled, 1);
  assert.equal(state.pageByCategory.buttons, 1);
  assert.ok(state.pageBlocked >= 2);
  await page.close();
});
