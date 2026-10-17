import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, resetStorage } from './helpers.mjs';

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
