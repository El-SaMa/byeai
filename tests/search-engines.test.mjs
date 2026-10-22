import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage, isHidden } from './helpers.mjs';

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

test('Bing: Copilot answer, chat box and AI Mode tab hidden; results and tabs kept', async () => {
  const page = await open(ctx.context, 'https://www.bing.com/search?q=test');
  for (const id of ['#b_copilot_search_container', '#ai-answer-card', '#copans_container', '#b-scopeListItem-copilotsearch']) {
    assert.equal(await isHidden(page, id), true, `${id} should be hidden`);
  }
  for (const id of ['#b_results', '#result-1', '#weather-card', '#dictionary-card', '#b-scopeListItem-web', '#b-scopeListItem-images', '#images-tab', '#maps-tab']) {
    assert.equal(await isHidden(page, id), false, `${id} must stay visible`);
  }
});

test('Bing: allowed site shows Copilot again', async () => {
  const page = await open(ctx.context, 'https://www.bing.com/search?q=test');
  await setStorage(ctx.worker, { allowedHosts: ['bing.com'] });
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#copans_container'), false);
});

test('DuckDuckGo: Search Assist, its toolbar pill and Duck.ai entries hidden; results kept', async () => {
  const page = await open(ctx.context, 'https://duckduckgo.com/?q=test&ia=web');
  for (const id of ['#assist-card', '#assist-pill', '#assist-link', '#duckai-link', '#chat-form']) {
    assert.equal(await isHidden(page, id), true, `${id} should be hidden`);
  }
  for (const id of ['#result-1', '#result-2', '#weather-card', '#tab-all', '#tab-images']) {
    assert.equal(await isHidden(page, id), false, `${id} must stay visible`);
  }
});
