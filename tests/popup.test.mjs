import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launch, resetStorage, extensionPath } from './helpers.mjs';

let ctx;

// Opens the popup as if it was clicked while `pattern`'s tab was active.
async function popupFor(pattern) {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.evaluate(async (urlPattern) => {
    const [tab] = await chrome.tabs.query({ url: urlPattern });
    chrome.tabs.query = async () => [tab];
    await refresh();
  }, pattern);
  return popup;
}

before(async () => {
  ctx = await launch();
  await resetStorage(ctx.worker);
});

after(async () => {
  await ctx?.context.close();
});

test('popup shows the two rows with defaults and saves a toggle', async () => {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.waitForTimeout(300);

  const rows = await popup.$$eval('.feature', (els) =>
    els.map((el) => ({
      name: el.dataset.feature,
      label: el.querySelector('.feature-name').textContent,
      on: el.querySelector('input').checked,
    }))
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.on]),
    [
      ['widgets', true],
      ['labeled', true],
    ]
  );
  assert.ok(rows.every((r) => r.label.length > 0));

  await popup.click('.feature[data-feature="labeled"] .toggle');
  await popup.waitForTimeout(200);
  const features = await ctx.worker.evaluate(async () => (await chrome.storage.sync.get('features')).features);
  assert.equal(features.labeled, false);
  assert.equal(features.widgets, true);
});

test('turning off AI assistants disables the network rules', async () => {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.click('.feature[data-feature="widgets"] .toggle');
  await popup.waitForTimeout(300);
  let enabled = await ctx.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.deepEqual(enabled, []);

  await popup.click('.feature[data-feature="widgets"] .toggle');
  await popup.waitForTimeout(300);
  enabled = await ctx.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.equal(enabled.length, 3);
});

test('report link opens a GitHub issue without query strings', async () => {
  // A page with a token in its URL.
  const page = await ctx.context.newPage();
  await page.goto('https://example.com/page?token=secret');
  const popup = await popupFor('https://example.com/*');
  const opened = await popup.evaluate(() => {
    let url = '';
    chrome.tabs.create = (opts) => {
      url = opts.url;
    };
    document.getElementById('reportLink').click();
    return url;
  });
  await page.close();
  const target = new URL(opened);
  assert.equal(`${target.host}${target.pathname}`, 'github.com/El-SaMa/byeai/issues/new');
  assert.equal(target.searchParams.get('template'), 'missed-ai.yml');
  assert.equal(target.searchParams.get('title'), 'Missed AI on example.com');
  assert.equal(target.searchParams.get('page'), 'https://example.com/page');
  assert.doesNotMatch(opened, /secret/);
});

test('popup offers "show AI videos" only where something was blurred', async () => {
  await resetStorage(ctx.worker);
  const yt = await ctx.context.newPage();
  await yt.goto('https://www.youtube.com/');
  await yt.waitForTimeout(800);
  const plain = await ctx.context.newPage();
  await plain.goto('https://example.com/page');
  const other = await popupFor('https://example.com/*');
  assert.equal(await other.$eval('#mediaSiteBtn', (b) => b.hidden), true, 'nothing blurred, no link');
  await plain.close();

  const popup = await popupFor('https://www.youtube.com/*');
  assert.equal(await popup.$eval('#mediaSiteBtn', (b) => b.hidden), false);
  assert.match(await popup.textContent('#mediaSiteBtn'), /Show AI videos on youtube\.com/);

  await popup.click('#mediaSiteBtn');
  await popup.waitForTimeout(300);
  const synced = await ctx.worker.evaluate(() => chrome.storage.sync.get('mediaAllowedHosts'));
  assert.deepEqual(synced.mediaAllowedHosts, ['youtube.com']);
  assert.match(await popup.textContent('#mediaSiteBtn'), /Blur AI videos on youtube\.com again/);
  await yt.close();
});

test('blocking a site again reloads its tab; allowing offers the reload bar', async () => {
  const page = await ctx.context.newPage();
  await page.goto('https://blog.example.com/post');
  const popup = await popupFor('https://blog.example.com/*');
  await popup.evaluate(() => {
    window.__reloads = [];
    chrome.tabs.reload = (id) => window.__reloads.push(id);
  });

  await popup.click('#allowBtn');
  await popup.waitForTimeout(200);
  let seen = await popup.evaluate(() => ({ reloads: window.__reloads.length, bar: !document.getElementById('reloadBanner').classList.contains('hidden') }));
  assert.deepEqual(seen, { reloads: 0, bar: true });

  await popup.click('#allowBtn');
  await popup.waitForTimeout(200);
  seen = await popup.evaluate(() => ({ reloads: window.__reloads.length, bar: !document.getElementById('reloadBanner').classList.contains('hidden') }));
  assert.deepEqual(seen, { reloads: 1, bar: false });
  await page.close();
});

test('"Something looks wrong" opens the Site broken form for this host, no query string', async () => {
  const page = await ctx.context.newPage();
  await page.goto('https://example.com/page?token=secret#frag');
  const popup = await popupFor('https://example.com/*');
  const opened = await popup.evaluate(() => {
    let url = '';
    chrome.tabs.create = (opts) => {
      url = opts.url;
    };
    document.getElementById('wrongBtn').click();
    return url;
  });
  await page.close();
  const target = new URL(opened);
  assert.equal(`${target.host}${target.pathname}`, 'github.com/El-SaMa/byeai/issues/new');
  assert.equal(target.searchParams.get('template'), 'broke-site.yml');
  assert.equal(target.searchParams.get('title'), 'Site broken: example.com');
  assert.equal(target.searchParams.get('page'), 'https://example.com/page');
  assert.equal(target.searchParams.get('version'), JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8')).version);
  assert.doesNotMatch(opened, /secret|frag/);
});

test('"What ByeAI sends" box: closed by default, opens with the keyboard, same text in Options', async () => {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.waitForTimeout(300);
  assert.equal(await popup.$eval('#sendsBox', (el) => el.open), false);
  assert.equal(await popup.isVisible('#sendsBox p'), false);
  await popup.focus('#sendsBox summary');
  await popup.keyboard.press('Enter');
  assert.equal(await popup.$eval('#sendsBox', (el) => el.open), true);
  const text = (await popup.textContent('#sendsBox p')).trim();
  assert.match(text, /^Nothing about your browsing\./);
  assert.match(text, /Community list/);
  assert.match(text, /Suggest or Not AI/);
  assert.match(text, /name and id\.$/);
  assert.notEqual(await popup.$eval('#sendsBox summary', (el) => getComputedStyle(el).cursor), 'default');

  const options = await ctx.context.newPage();
  await options.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await options.waitForTimeout(300);
  assert.equal((await options.textContent('.sends-line span')).trim(), text);
  assert.equal((await options.textContent('.sends-line strong')).trim(), 'What ByeAI sends');
});

test('popup new rows fit in right-to-left languages', async () => {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.evaluate(() => {
    document.documentElement.dir = 'rtl';
    document.getElementById('sendsBox').open = true;
  });
  const overflow = await popup.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false);
  const box = await popup.$eval('#pauseBox', (el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
  assert.equal(box, true);
});
