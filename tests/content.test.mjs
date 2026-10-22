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

test('YouTube feed: labeled and AI-tagged tiles are covered, others are not', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/');
  assert.equal(await coverOf(page, '#labeled'), 'labeled');
  assert.equal(await coverOf(page, '#tagged'), 'tagged');
  assert.equal(await coverOf(page, '#plain'), '');
  assert.equal(await coverOf(page, '#news'), '', 'a title mentioning "AI info" is not a label');
  assert.equal(await coverOf(page, '#broad'), '', '#ai and "made with AI" are too broad');

  // YouTube covers carry the action panel, not the ::after note.
  assert.equal(await page.$eval('#labeled', (el) => getComputedStyle(el, '::after').display), 'none');
  assert.equal(await coverOf(page, '#glued'), 'tagged', 'tag is not glued to the next line');
});

test('turning off AI videos and images removes covers live', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/');
  await setStorage(ctx.worker, { features: { widgets: true, labeled: false } });
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#tagged'), '');
  assert.equal(await coverOf(page, '#labeled'), '');

  await setStorage(ctx.worker, { features: { widgets: true, labeled: true } });
  await page.waitForTimeout(400);
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

  await page.click('#movie_player', { position: { x: 300, y: 100 }, force: true }).catch(() => {});
  assert.equal(await coverOf(page, '#movie_player'), 'labeled', 'a click on the cover does not reveal');
  await page.click('byeai-cover-panel button[data-act="show"]');
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#movie_player'), '');
  assert.equal(await page.$eval('video', (v) => v.paused), false, 'Show video resumes playback');
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

test('X: Grok buttons hidden, tweet text untouched, #midjourney covered', async () => {
  const page = await open(ctx.context, 'https://x.com/home');
  assert.equal(await isHidden(page, '#grok-nav'), true);
  assert.equal(await isHidden(page, '#grok-actions'), true);
  assert.equal(await isHidden(page, '#t2 a'), false, 'a "Grok" link inside tweet text stays');
  assert.equal(await coverOf(page, '#t1'), 'tagged');
  assert.equal(await coverOf(page, '#t3'), '');
});

test('AI assistants switch off shows AI buttons again without reload', async () => {
  const page = await open(ctx.context, 'https://x.com/home');
  await setStorage(ctx.worker, { features: { widgets: false, labeled: true } });
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

test('Amazon: Rufus and the AI review summary hidden, real reviews kept', async () => {
  const page = await open(ctx.context, 'https://www.amazon.com/');
  assert.equal(await isHidden(page, '#nav-rufus-disco'), true);
  assert.equal(await isHidden(page, '#rufus-btn'), true);
  assert.equal(await isHidden(page, '#ai-summary'), true);
  assert.equal(await isHidden(page, '#reviews'), false);
});

test('show AI videos on one site keeps the rest blocked', async () => {
  const page = await open(ctx.context, 'https://www.instagram.com/');
  assert.equal(await coverOf(page, '#ai'), 'labeled');
  await setStorage(ctx.worker, { mediaAllowedHosts: ['instagram.com'] });
  await page.waitForTimeout(400);
  assert.equal(await coverOf(page, '#ai'), '');
  assert.equal(await isHidden(page, '#meta-ai'), true, 'AI buttons stay hidden');

  const yt = await open(ctx.context, 'https://www.youtube.com/');
  assert.equal(await coverOf(yt, '#labeled'), 'labeled', 'other sites still blur');
});

test('settings changed on another device apply here', async () => {
  const page = await open(ctx.context, 'https://x.com/home');
  assert.equal(await isHidden(page, '#grok-nav'), true);
  // A write straight to sync storage is what Chrome does when another device changes it.
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ allowedHosts: ['x.com'] }));
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#grok-nav'), false);
  const rules = await ctx.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.ok(rules.some((r) => r.action.type === 'allow' && (r.condition.initiatorDomains || []).some((d) => d === 'x.com')));
});

test('settings from 1.1 move to sync once', async () => {
  await ctx.worker.evaluate(() =>
    chrome.storage.local.set({ allowedHosts: ['old.example'], enabled: true, syncMigrated: false })
  );
  await ctx.worker.evaluate(() => migrateToSync());
  const synced = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  const local = await ctx.worker.evaluate(() => chrome.storage.local.get(['allowedHosts', 'syncMigrated']));
  assert.ok(synced.allowedHosts.includes('old.example'));
  assert.equal(local.allowedHosts, undefined);
  assert.equal(local.syncMigrated, true);
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

test('total counter does not lose blocks that arrive together', async () => {
  await setStorage(ctx.worker, { totalBlocked: 0 });
  const page = await open(ctx.context, 'https://www.youtube.com/');
  await page.waitForTimeout(500);
  const { totalBlocked } = await ctx.worker.evaluate(() => chrome.storage.local.get('totalBlocked'));
  const covered = await page.$$eval('[data-byeai-cover]', (els) => els.length);
  assert.ok(covered >= 3);
  assert.ok(totalBlocked >= covered, `total ${totalBlocked} < covered ${covered}`);
});
