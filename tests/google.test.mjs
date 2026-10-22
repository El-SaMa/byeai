import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launch, open, setStorage, resetStorage, isHidden, extensionPath } from './helpers.mjs';

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

// Opens `url` and returns the address the tab ends up on. ByeAI swaps in the
// Web view by cancelling the first load, so a cancelled goto is normal.
async function landed(url) {
  const page = await ctx.context.newPage();
  await page.goto(url).catch((err) => {
    if (!/ERR_ABORTED|interrupted/.test(err.message)) throw err;
  });
  await page.waitForTimeout(700);
  const final = page.url();
  await page.close();
  return final;
}

const DOMAINS = ['www.google.fi', 'www.google.co.uk', 'www.google.com.au', 'www.google.de'];

for (const host of DOMAINS) {
  test(`${host}: AI Overview, AI Mode and AI answers hidden; answer boxes and tabs kept`, async () => {
    const page = await open(ctx.context, `https://${host}/search?q=test&udm=14`);

    for (const id of ['#overview', '#ai-mode-item', '#paa-ai']) {
      assert.equal(await isHidden(page, id), true, `${id} should be hidden`);
    }
    for (const id of [
      '#currency',
      '#knowledge-currency__updatable-data-column',
      '#dictionary',
      '#calculator',
      '#sports',
      '#weather',
      '#map',
      '#map-link',
      '#answer-box',
      '#paa-normal',
      '#paa-plain',
      '#results',
      '#tab-all',
      '#tab-images',
      '#tab-news',
      '#tab-shopping',
      '#tab-maps',
    ]) {
      assert.equal(await isHidden(page, id), false, `${id} must stay visible`);
    }
  });
}

test('Google: no blank gap where an AI box was', async () => {
  const page = await open(ctx.context, 'https://www.google.fi/search?q=test&udm=14');
  assert.equal(await isHidden(page, '#overview-wrap'), true, 'wrapper of the AI Overview goes with it');
  assert.equal(await isHidden(page, '#lonely-wrap'), true, 'a wrapper that only held an AI box goes too');
  assert.equal(await isHidden(page, '#ai-mode-btn2'), true);
  assert.equal(await isHidden(page, '#mixed-wrap'), false, 'a wrapper with real content stays');
  assert.equal(await isHidden(page, '#mixed-keep'), false);
  // The page layout itself is never collapsed.
  assert.equal(await isHidden(page, '#rso'), false);
  assert.equal(await isHidden(page, '#center_col'), false);
});

test('Google: allowed site shows everything again', async () => {
  const page = await open(ctx.context, 'https://www.google.fi/search?q=test&udm=14');
  assert.equal(await isHidden(page, '#overview'), true);
  await setStorage(ctx.worker, { allowedHosts: ['google.fi'] });
  await page.waitForTimeout(500);
  assert.equal(await isHidden(page, '#overview'), false);
  assert.equal(await isHidden(page, '#ai-mode-item'), false);
  assert.equal(await isHidden(page, '#lonely-wrap'), false);
});

test('Google answer-box searches and other tabs are not rewritten', async () => {
  // The real page has its answer boxes here: no udm=14 (that would drop them),
  // and the AI parts are hidden by the page script instead.
  const rich = await open(ctx.context, 'https://www.google.com/search?q=100+usd+to+eur');
  assert.doesNotMatch(rich.url(), /udm=/);
  assert.equal(await isHidden(rich, '#overview'), true);
  assert.equal(await isHidden(rich, '#currency'), false);

  const images = await open(ctx.context, 'https://www.google.com/search?q=test&tbm=isch');
  assert.doesNotMatch(images.url(), /udm=/);
  assert.equal(await isHidden(images, '#tab-images'), false);
});

test('Web view (udm=14) is added to plain searches on every Google domain', async () => {
  for (const host of ['www.google.com', 'google.com', 'www.google.fi', 'www.google.co.uk', 'www.google.com.au', 'www.google.de', 'www.google.co.jp']) {
    const url = new URL(await landed(`https://${host}/search?q=how+do+volcanoes+form&hl=en`));
    assert.equal(url.searchParams.get('udm'), '14', host);
    assert.equal(url.searchParams.get('q'), 'how do volcanoes form', `${host} keeps the query`);
    assert.equal(url.searchParams.get('hl'), 'en', `${host} keeps other parameters`);
  }
});

test('AI Mode (udm=50) becomes the Web view', async () => {
  const url = new URL(await landed('https://www.google.fi/search?q=test&udm=50&aep=1'));
  assert.equal(url.searchParams.get('udm'), '14');
  assert.equal(url.searchParams.get('aep'), '1');
});

test('Images, News, Shopping, Videos and other tabs are never rewritten', async () => {
  const same = [
    'https://www.google.com/search?q=cat&tbm=isch',
    'https://www.google.com/search?q=cat&tbm=nws',
    'https://www.google.fi/search?q=cat&tbm=shop',
    'https://www.google.de/search?q=cat&tbm=vid',
    'https://www.google.com/search?q=cat&udm=2',
    'https://www.google.com/search?q=cat&udm=7',
    'https://www.google.com/search?q=cat&udm=12',
    'https://www.google.com/search?q=cat&udm=28',
    'https://www.google.com/maps/search/pizza',
    'https://news.google.com/search?q=cat',
    'https://maps.google.com/maps?q=cat',
    'https://www.google.com/finance/quote/AAPL:NASDAQ',
  ];
  for (const url of same) assert.equal(await landed(url), url, url);
});

test('searches for answer boxes keep the normal Google page', async () => {
  for (const q of ['100 usd to eur', '12*8+4', 'define serendipity', 'weather helsinki', 'liverpool score', 'time in tokyo', '5 km in miles']) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    assert.equal(await landed(url), url, q);
  }
});

test('answer-box detection: yes for widgets, no for ordinary searches', async () => {
  const wants = await ctx.worker.evaluate(() => {
    const yes = ['100 usd to eur', '12*8+4', '15% of 80', 'define serendipity', 'serendipity meaning', 'mitä tarkoittaa serendipiteetti', 'sää helsinki', 'weather helsinki', 'sääennuste', '5 km in miles', '10 kg to lb', 'time in tokyo', 'liverpool score', 'AAPL stock price', 'calculator', 'flip a coin', 'sqrt(49)', 'wetter berlin'];
    const no = ['how do volcanoes form', 'best pizza recipe', 'miten tulivuoret syntyvät', 'python tutorial', 'what is the capital of france', 'hotels in paris', 'best laptop 2025', 'nike air max 90', 'lasagne recipe', 'saana', ''];
    return {
      missed: yes.filter((q) => !globalThis.byeaiWantsAnswerBox(q)),
      wrong: no.filter((q) => globalThis.byeaiWantsAnswerBox(q)),
    };
  });
  assert.deepEqual(wants, { missed: [], wrong: [] });
});

test('network rule for Google AI fetches covers every google.* domain', () => {
  const rules = JSON.parse(readFileSync(path.join(extensionPath, 'rules', 'google-search.json'), 'utf8'));
  const rule = rules.find((r) => r.condition.regexFilter?.includes('folsrch'));
  assert.ok(rule, 'folsrch rule exists');
  const re = new RegExp(rule.condition.regexFilter);
  for (const host of ['google.com', 'www.google.com', 'www.google.fi', 'www.google.de', 'www.google.co.uk', 'www.google.com.au', 'www.google.co.jp', 'www.google.com.br']) {
    assert.ok(re.test(`https://${host}/async/folsrch?x=1`), host);
  }
  assert.ok(!re.test('https://www.google.com/search?q=test'), 'normal search is not blocked');
  assert.ok(!re.test('https://example.com/async/folsrch'), 'only Google');
});
