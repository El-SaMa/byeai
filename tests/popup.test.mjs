import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, resetStorage } from './helpers.mjs';

let ctx;

before(async () => {
  ctx = await launch();
  await resetStorage(ctx.worker);
});

after(async () => {
  await ctx?.context.close();
});

test('popup shows the three rows with defaults and saves a toggle', async () => {
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
      ['buttons', true],
      ['labeled', true],
    ]
  );
  assert.ok(rows.every((r) => r.label.length > 0));

  await popup.click('.feature[data-feature="labeled"] .toggle');
  await popup.waitForTimeout(200);
  const features = await ctx.worker.evaluate(async () => (await chrome.storage.local.get('features')).features);
  assert.equal(features.labeled, false);
  assert.equal(features.buttons, true);
});

test('turning off chatbots and AI search disables the network rules', async () => {
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
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.waitForTimeout(200);
  const opened = await popup.evaluate(() => {
    let url = '';
    chrome.tabs.create = (opts) => {
      url = opts.url;
    };
    // Pretend the popup belongs to a page with a token in its URL.
    state = { ...state, hostname: 'example.com', url: 'https://example.com/page?token=secret' };
    document.getElementById('reportLink').click();
    return url;
  });
  const target = new URL(opened);
  const body = target.searchParams.get('body') || '';
  assert.equal(`${target.host}${target.pathname}`, 'github.com/El-SaMa/byeai/issues/new');
  assert.equal(target.searchParams.get('title'), 'Missed AI on example.com');
  assert.match(body, /https:\/\/example\.com\/page/);
  assert.doesNotMatch(body, /secret/);
});
