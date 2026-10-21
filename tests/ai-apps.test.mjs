import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, setStorage, resetStorage } from './helpers.mjs';

let ctx;
let blockedPrefix;

// The redirect ends on a chrome-extension:// page. goto can report that as
// aborted, so the URL is checked after the navigation settles.
async function visit(page, url) {
  await page.goto(url).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(400);
}

const isBlockPage = (page) => page.url().startsWith(blockedPrefix);

before(async () => {
  ctx = await launch();
  blockedPrefix = `chrome-extension://${ctx.extensionId}/blocked/blocked.html#`;
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  for (const p of ctx.context.pages()) await p.close();
  await ctx.worker.evaluate(async () => {
    await syncRulesetEnabled(await getSettings());
    await syncDynamicRules();
  });
});

test('opening chatgpt.com shows the ByeAI page, and Go back works', async () => {
  await setStorage(ctx.worker, { totalBlocked: 0 });
  const page = await ctx.context.newPage();
  await visit(page, 'https://blog.example.com/post');
  await visit(page, 'https://chatgpt.com/');

  assert.ok(isBlockPage(page), page.url());
  assert.equal(page.url(), `${blockedPrefix}https://chatgpt.com/`);
  assert.equal(await page.textContent('h1'), 'ByeAI blocked chatgpt.com');
  assert.equal(await page.title(), 'ByeAI blocked chatgpt.com');
  assert.match(await page.textContent('.lead'), /This is an AI app, so ByeAI stopped it from loading\./);

  const { totalBlocked } = await ctx.worker.evaluate(() => chrome.storage.local.get('totalBlocked'));
  assert.ok(totalBlocked >= 1, 'the block page counts as a block');

  await page.click('#goBack');
  await page.waitForURL('https://blog.example.com/post');
});

test('Allow once loads the app in this tab only', async () => {
  const page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  assert.ok(isBlockPage(page));

  await page.click('#allowOnce');
  await page.waitForURL('https://chatgpt.com/');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__app === true), true, 'its own script runs');

  const other = await ctx.context.newPage();
  await visit(other, 'https://chatgpt.com/');
  assert.ok(isBlockPage(other), 'a new tab is blocked again');

  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, [], 'not saved as an allowed site');

  // Leaving the site ends "once".
  await visit(page, 'https://blog.example.com/post');
  await page.waitForTimeout(300);
  await visit(page, 'https://chatgpt.com/');
  assert.ok(isBlockPage(page), 'blocked again after leaving the site');
});

test('Allow this site saves it and the app loads', async () => {
  const page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  await page.click('#allowSite');
  await page.waitForURL('https://chatgpt.com/');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__app === true), true);

  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, ['chatgpt.com']);

  const other = await ctx.context.newPage();
  await visit(other, 'https://chatgpt.com/');
  assert.equal(other.url(), 'https://chatgpt.com/', 'other tabs load it too');
});

test('ByeAI off or AI assistants off: no block page', async () => {
  await setStorage(ctx.worker, { enabled: false });
  await ctx.worker.evaluate(() => syncDynamicRules());
  let page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  assert.equal(page.url(), 'https://chatgpt.com/');
  await page.close();

  await setStorage(ctx.worker, { enabled: true, features: { widgets: false, labeled: true } });
  await ctx.worker.evaluate(() => syncDynamicRules());
  page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  assert.equal(page.url(), 'https://chatgpt.com/');
});

test('an AI app embedded in another site is still blocked, without a block page', async () => {
  const page = await ctx.context.newPage();
  await visit(page, 'https://embed.example.com/');
  assert.equal(page.url(), 'https://embed.example.com/');
  assert.equal(await page.evaluate(() => window.__chatgptWidget === true), false);
  assert.equal(await page.textContent('#post'), 'A blog with an AI widget.');

  // Control: with ByeAI off the same widget runs, so the block above was ByeAI.
  await setStorage(ctx.worker, { enabled: false });
  await ctx.worker.evaluate(() => syncRulesetEnabled({ enabled: false, features: {} }));
  const off = await ctx.context.newPage();
  await visit(off, 'https://embed.example.com/');
  assert.equal(await off.evaluate(() => window.__chatgptWidget === true), true);
});

test('popup on an allowed AI app can block it again', async () => {
  await setStorage(ctx.worker, { allowedHosts: ['chatgpt.com'] });
  await ctx.worker.evaluate(() => syncDynamicRules());
  const app = await ctx.context.newPage();
  await visit(app, 'https://chatgpt.com/');
  assert.equal(app.url(), 'https://chatgpt.com/');

  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    chrome.tabs.query = async () => [tab];
    await refresh();
  });

  assert.equal(await popup.textContent('#statusPill'), 'Allowed');
  assert.equal(await popup.textContent('#allowBtnText'), 'Block this AI app again');
  assert.equal(await popup.$eval('#allowedNote', (el) => el.classList.contains('hidden')), false);
  assert.match(await popup.textContent('#allowedNote'), /You allowed this AI app/);
  assert.equal(await popup.$eval('#allowBtn', (b) => b.disabled), false);

  await popup.click('#allowBtn');
  await app.waitForURL((url) => url.href.startsWith(blockedPrefix));
  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, []);
  assert.equal(await popup.textContent('#allowBtnText'), 'Allow AI on this site');
});

test('popup on an AI app allowed once says so and can allow it for good', async () => {
  const page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  await page.click('#allowOnce');
  await page.waitForURL('https://chatgpt.com/');

  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
    chrome.tabs.query = async () => [tab];
    await refresh();
  });
  assert.equal(await popup.textContent('#statusPill'), 'Allowed once');
  assert.equal(await popup.textContent('#allowBtnText'), 'Allow AI on this site');

  await popup.click('#allowBtn');
  await popup.waitForTimeout(300);
  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, ['chatgpt.com']);
  assert.equal(await popup.textContent('#statusPill'), 'Allowed');
});
