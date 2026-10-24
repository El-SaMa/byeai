import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launch, open, setStorage, resetStorage, isHidden, extensionPath } from './helpers.mjs';

// Regression tests from the 1.4.1 competitor-research pass: answer boxes,
// results never hidden, flash-free hiding, sync quotas, rule limits, SPA leaks.

let ctx;
let blockedPrefix;
const manifest = JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));

before(async () => {
  ctx = await launch();
  blockedPrefix = `chrome-extension://${ctx.extensionId}/blocked/blocked.html#`;
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  await ctx.worker.evaluate(() => Promise.all([chrome.storage.sync.remove('pausedUntil'), chrome.alarms.clear('byeai-resume')]));
  for (const p of ctx.context.pages()) await p.close();
  await ctx.worker.evaluate(async () => {
    await syncRulesetEnabled(await getSettings());
    await syncDynamicRules();
  });
});

// Opens `url` and returns where the tab ends up (ByeAI swaps in the Web view by cancelling the first load).
async function landed(url) {
  const page = await ctx.context.newPage();
  await page.goto(url).catch((err) => {
    if (!/ERR_ABORTED|interrupted/.test(err.message)) throw err;
  });
  await page.waitForTimeout(500);
  const final = page.url();
  await page.close();
  return final;
}

async function visit(page, url) {
  await page.goto(url).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- 1. answer boxes

const ANSWER_BOXES = {
  speedtest: ['speed test', 'internet speed test', 'nopeustesti'],
  crypto_stocks: ['bitcoin price', 'btc usd', 'ethereum price', 'AAPL stock price', 'tesla stock', 'nasdaq', 'dow jones', 'exchange rate usd eur'],
  sports: ['liverpool score', 'liverpool vs arsenal', 'arsenal schedule', 'premier league standings', 'lakers fixtures', 'sarjataulukko'],
  dictionary: ['define serendipity', 'serendipity meaning', 'serendipity synonyms', 'dictionary serendipity', 'mitä tarkoittaa serendipiteetti'],
  spelling: ['spell check recieve', 'how to spell necessary'],
  units: ['5 km in miles', 'celsius to fahrenheit', 'how many cups in a quart', 'how many days in a year', '10 kg to lb'],
  timers: ['timer 5 minutes', 'set a timer for 10 minutes', 'stopwatch', 'ajastin'],
  time_date: ['time in tokyo', 'what time is it in paris', 'what day is it', 'date today', 'time zone converter', 'days until christmas'],
  flights: ['flights to helsinki', 'flight status', 'lennot helsinki'],
  translate: ['translate hello to finnish', 'hello in spanish', 'käännä hello'],
  maps: ['pizza near me', 'directions to oslo', 'map of finland', 'nearest pharmacy', 'google maps'],
  lyrics: ['bohemian rhapsody lyrics', 'songtext bohemian rhapsody'],
  tracking: ['track my package', 'ups tracking number', '1Z999AA10123456784', 'RB123456789FI', '123456789012'],
  holidays_sun: ['public holidays 2026', 'holidays in finland', 'sunrise helsinki', 'sunset time', 'auringonlasku helsinki'],
};

const ORDINARY = [
  'how do volcanoes form', 'best pizza recipe', 'miten tulivuoret syntyvät', 'python tutorial', 'what is the capital of france',
  'hotels in paris', 'best laptop 2025', 'nike air max 90', 'lasagne recipe', 'saana', 'how to learn guitar', 'why is the sky blue',
  'who invented the telephone', 'react hooks explained', 'best running shoes for flat feet', 'how many people live in france',
  'history of the roman empire', 'node crypto module', 'map reduce java tutorial', 'my ip camera setup', 'how many calories in a banana',
  'what is photosynthesis', 'buy a house in spain',
];

test('answer boxes: every kind of Google widget search is recognised, ordinary searches are not', async () => {
  const result = await ctx.worker.evaluate(
    ({ boxes, ordinary }) => ({
      missed: Object.entries(boxes).flatMap(([kind, qs]) => qs.filter((q) => !globalThis.byeaiWantsAnswerBox(q)).map((q) => `${kind}: ${q}`)),
      wrong: ordinary.filter((q) => globalThis.byeaiWantsAnswerBox(q)),
    }),
    { boxes: ANSWER_BOXES, ordinary: ORDINARY }
  );
  assert.deepEqual(result, { missed: [], wrong: [] });
});

test('answer boxes: a search for each kind is not rewritten, ordinary ones still get the Web view', async () => {
  for (const qs of Object.values(ANSWER_BOXES)) {
    const q = qs[0];
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
    assert.equal(await landed(url), url, `${q} keeps Google's widget`);
  }
  for (const q of ['how do volcanoes form', 'best pizza recipe']) {
    const final = new URL(await landed(`https://www.google.com/search?q=${encodeURIComponent(q)}`));
    assert.equal(final.searchParams.get('udm'), '14', q);
    assert.equal(final.searchParams.get('q'), q);
  }
});

// ---------------------------------------------------------------- 2. results never hidden

test('results container is never hidden: Google AI box shares its parents with the results', async () => {
  const page = await open(ctx.context, 'https://www.google.com/search?q=shared&udm=14');
  assert.equal(await isHidden(page, '#ai-direct'), true, 'AI box next to results is hidden');
  assert.equal(await isHidden(page, '#ai-boxed'), true);
  assert.equal(await isHidden(page, '#ai-wrap'), true, 'its own wrapper goes too');
  for (const id of ['#outer', '#center_col', '#rso', '#plain-parent', '#r1', '#r2', '#r3']) {
    assert.equal(await isHidden(page, id), false, `${id} must stay visible (#outer even matches an AI class)`);
  }
  assert.equal(await page.$eval('#r2', (el) => el.dataset.byeaiHidden || ''), '');
});

test('results container is never hidden: Bing Copilot shares a wrapper with the results', async () => {
  const page = await open(ctx.context, 'https://www.bing.com/search?q=shared');
  assert.equal(await isHidden(page, '#b_copilot_search_container'), true);
  assert.equal(await isHidden(page, '#ai-answer-card'), true);
  for (const id of ['#b_content', '#shared', '#b_results', '#result-1', '#result-2']) {
    assert.equal(await isHidden(page, id), false, `${id} must stay visible`);
  }
});

test('results container is never hidden: DuckDuckGo Assist shares a wrapper with the results', async () => {
  const page = await open(ctx.context, 'https://duckduckgo.com/?q=shared&ia=web');
  assert.equal(await isHidden(page, '#assist-box'), true);
  for (const id of ['#page', 'ol.react-results--main', '#result-1', '#result-2']) {
    assert.equal(await isHidden(page, id), false, `${id} must stay visible`);
  }
});

// ---------------------------------------------------------------- 3. no blank gaps

test('no blank gaps: wrappers collapse on Google, Bing and DuckDuckGo, result containers do not', async () => {
  const google = await open(ctx.context, 'https://www.google.fi/search?q=test&udm=14');
  assert.equal(await isHidden(google, '#overview-wrap'), true, 'AI Overview wrapper');
  assert.equal(await isHidden(google, '#lonely-wrap'), true, 'AI Mode block wrapper');
  assert.equal(await isHidden(google, '#mixed-wrap'), false, 'a wrapper with real content stays');
  assert.equal(await isHidden(google, '#rso'), false);
  assert.equal(await isHidden(google, '#results'), false);

  const bing = await open(ctx.context, 'https://www.bing.com/search?q=test');
  assert.equal(await isHidden(bing, '#b_topw'), true, 'Copilot answer wrapper');
  assert.equal(await isHidden(bing, '#b_results'), false);

  const ddg = await open(ctx.context, 'https://duckduckgo.com/?q=shared&ia=web');
  assert.equal(await isHidden(ddg, '#assist-wrap'), true, 'Assist wrapper that only held the box');
  assert.equal(await isHidden(ddg, '#assist-card-wrap ul'), true, 'Assist list that only held the box');
  assert.equal(await isHidden(ddg, 'ol.react-results--main'), false);
});

// ---------------------------------------------------------------- 4. no flash

test('hiding CSS is injected by the manifest at document_start, not only by a script', () => {
  const css = (file) => manifest.content_scripts.filter((c) => (c.css || []).includes(file));
  for (const file of ['content/google-search.css', 'content/content.css']) {
    const [entry] = css(file);
    assert.ok(entry, file);
    assert.equal(entry.run_at, 'document_start', file);
    assert.ok(entry.matches.includes('https://*/*'), `${file} reaches Google`);
  }
  const [engines] = css('content/search-ai.css');
  assert.equal(engines.run_at, 'document_start');
  for (const host of ['bing.com', 'duckduckgo.com', 'search.brave.com', 'ecosia.org']) {
    assert.ok(engines.matches.some((m) => m.includes(host)), host);
  }
});

test('Bing and DuckDuckGo AI boxes are hidden as soon as the DOM is there (CSS, no script delay)', async () => {
  for (const [url, ids] of [
    ['https://www.bing.com/search?q=test', ['#copans_container', '#b_copilot_search_container']],
    ['https://duckduckgo.com/?q=test&ia=web', ['#assist-card', '#chat-form']],
  ]) {
    const page = await ctx.context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // No waiting: the script passes run 300 to 400 ms after a change. CSS is already there.
    for (const id of ids) assert.equal(await isHidden(page, id), true, `${url} ${id}`);
  }
});

// ---------------------------------------------------------------- 5. other tabs, 6. AI Mode

test('Images, Videos, News and every other udm tab are never rewritten', async () => {
  const same = [
    'https://www.google.com/search?q=cat&udm=2',
    'https://www.google.com/search?q=cat&udm=7',
    'https://www.google.com/search?q=cat&udm=12',
    'https://www.google.com/search?q=cat&udm=28',
    'https://www.google.com/search?q=cat&udm=39',
    'https://www.google.com/search?q=cat&udm=44',
    'https://www.google.com/search?q=cat&tbm=isch',
    'https://www.google.com/search?q=cat&tbm=isch&udm=2',
    'https://www.google.com/search?q=cat&udm=14',
  ];
  for (const url of same) assert.equal(await landed(url), url, url);
});

test('AI Mode (udm=50) goes to the Web view with the same query, once, no loop', async () => {
  const url = new URL(await landed('https://www.google.com/search?q=how+do+volcanoes+form&udm=50&hl=en'));
  assert.equal(url.searchParams.get('udm'), '14');
  assert.equal(url.searchParams.get('q'), 'how do volcanoes form');
  assert.equal(url.searchParams.get('hl'), 'en');
  // The Web view is left alone (that is what stops a loop).
  assert.equal(await landed(url.toString()), url.toString());
});

test('AI Mode (udm=50) stays when you allowed AI on Google', async () => {
  await setStorage(ctx.worker, { allowedHosts: ['google.com'] });
  const url = 'https://www.google.com/search?q=test&udm=50';
  assert.equal(await landed(url), url);
});

// ---------------------------------------------------------------- 7. block page

test('block page: web accessible, redirect rule points at the extension, a link click also lands on it', async () => {
  const war = manifest.web_accessible_resources.find((r) => r.resources.includes('blocked/blocked.html'));
  assert.ok(war, 'blocked.html is web accessible');
  assert.ok(war.matches.includes('<all_urls>'), 'for every site that can link to an AI app');

  const rule = await ctx.worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).find((r) => r.action.type === 'redirect'));
  assert.ok(rule, 'redirect rule exists');
  assert.equal(rule.action.redirect.regexSubstitution, `chrome-extension://${ctx.extensionId}/blocked/blocked.html#\\0`);

  const page = await ctx.context.newPage();
  await visit(page, 'https://blog.example.com/post');
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.id = 'go';
    a.href = 'https://chatgpt.com/';
    a.textContent = 'ChatGPT';
    document.body.append(a);
  });
  await page.click('#go').catch(() => {});
  await page.waitForTimeout(600);
  assert.equal(page.url(), `${blockedPrefix}https://chatgpt.com/`, 'link click');

  await page.click('#allowSite');
  await page.waitForURL('https://chatgpt.com/');
  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, ['chatgpt.com'], 'Allow site');
});

// ---------------------------------------------------------------- 13. AI app coverage

const AI_HOSTS = [
  'gemini.google.com', 'copilot.microsoft.com', 'grok.com', 'kimi.com', 'kimi.ai', 'www.perplexity.ai', 'claude.ai',
  'chat.deepseek.com', 'chat.mistral.ai', 'meta.ai', 'www.meta.ai', 'chatgpt.com', 'chat.openai.com', 'character.ai',
  'beta.character.ai', 'poe.com', 'you.com', 'huggingface.co',
];

test('AI app list covers the big assistants, with or without www and subdomains', async () => {
  const missed = await ctx.worker.evaluate((hosts) => hosts.filter((h) => !globalThis.byeaiIsAiApp(h)), AI_HOSTS);
  assert.deepEqual(missed, []);
  assert.equal(await ctx.worker.evaluate(() => globalThis.byeaiIsAiApp('kimi.company.example')), false);
  assert.equal(await ctx.worker.evaluate(() => globalThis.byeaiIsAiApp('notkimi.com')), false);
});

test('the newer assistants get the block page, and Allow this site lets one through', async () => {
  for (const url of ['https://kimi.com/', 'https://www.kimi.ai/', 'https://huggingface.co/chat', 'https://gemini.google.com/app', 'https://copilot.microsoft.com/']) {
    const page = await ctx.context.newPage();
    await visit(page, url);
    assert.equal(page.url(), `${blockedPrefix}${url}`, url);
    if (url.includes('kimi.com')) {
      await page.click('#allowSite');
      await page.waitForURL('https://kimi.com/');
      const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
      assert.deepEqual(allowedHosts, ['kimi.com']);
    }
    await page.close();
  }
});

// ---------------------------------------------------------------- 8. sync quota

// Everything ByeAI keeps in sync, as the sizes Chrome counts.
async function syncUse() {
  return ctx.worker.evaluate(async () => {
    const all = await chrome.storage.sync.get(null);
    const sizes = Object.entries(all).map(([k, v]) => [k, k.length + JSON.stringify(v).length]);
    return {
      total: sizes.reduce((n, [, size]) => n + size, 0),
      biggest: Math.max(0, ...sizes.map(([, size]) => size)),
      items: sizes.length,
    };
  });
}

function bigImport(channels, hosts, long = false) {
  const pad = (n, len) => String(n).padStart(len, '0');
  return {
    app: 'byeai',
    format: 1,
    hiddenChannels: Array.from({ length: channels }, (_, i) =>
      long ? { id: `@${'h'.repeat(80)}${pad(i, 6)}`, n: `${'N'.repeat(54)}${pad(i, 6)}`, a: `UC${pad(i, 22)}` } : { id: `UC${pad(i, 22)}`, n: `Channel ${i}` }),
    shownChannels: Array.from({ length: channels }, (_, i) =>
      long ? { id: `@${'s'.repeat(80)}${pad(i, 6)}`, n: `${'M'.repeat(54)}${pad(i, 6)}`, a: `UC${pad(i + 50000, 22)}` } : { id: `UC${pad(i + 50000, 22)}`, n: `Shown ${i}` }),
    allowedHosts: Array.from({ length: hosts }, (_, i) => `allowed${i}.example.com`),
    mediaAllowedHosts: Array.from({ length: hosts }, (_, i) => `media${i}.example.com`),
  };
}

test('sync quota: importing 3,000 channels and 2,000 hosts stays inside every limit, in few writes', async () => {
  const reply = await ctx.worker.evaluate(async (data) => {
    // Count writes: Chrome allows 120 a minute.
    globalThis.__syncSets = 0;
    const set = chrome.storage.sync.set.bind(chrome.storage.sync);
    chrome.storage.sync.set = (...args) => {
      globalThis.__syncSets += 1;
      return set(...args);
    };
    try {
      return { reply: await importSettings(data), n: globalThis.__syncSets };
    } finally {
      chrome.storage.sync.set = set;
    }
  }, bigImport(3000, 2000)).then((r) => ({ ...r.reply, sets: r.n }));
  assert.equal(reply.ok, true);
  assert.ok(reply.sets <= 8, `${reply.sets} writes`);
  const use = await syncUse();
  assert.ok(use.biggest < 8192, `biggest item ${use.biggest}`);
  assert.ok(use.total < 102400, `total ${use.total}`);
  assert.ok(use.items < 512, `${use.items} items`);
  const kept = await ctx.worker.evaluate(async () => ({
    hidden: (await byeaiHiddenChannels.read()).length,
    shown: (await byeaiShownChannels.read()).length,
    hosts: (await getSettings()).allowedHosts.length,
  }));
  assert.ok(kept.hidden > 0 && kept.hidden <= 500, `hidden ${kept.hidden}`);
  assert.ok(kept.shown > 0 && kept.shown <= 200, `shown ${kept.shown}`);
  assert.ok(kept.hosts > 100, `hosts ${kept.hosts}`);
  assert.equal(reply.skipped > 0, true, 'what did not fit is reported as skipped');
});

test('sync quota: the longest possible entries in every list never break the total', async () => {
  const reply = await ctx.worker.evaluate((data) => importSettings(data).catch((e) => ({ ok: false, error: String(e) })), bigImport(600, 600, true));
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const use = await syncUse();
  assert.ok(use.biggest < 8192, `biggest item ${use.biggest}`);
  assert.ok(use.total < 102400, `total ${use.total}`);
  // A later write still works.
  await ctx.worker.evaluate(() => hideChannel({ id: 'UCaaaaaaaaaaaaaaaaaaaaaaaa', n: 'Late' }));
  const hidden = await ctx.worker.evaluate(() => byeaiHiddenChannels.read());
  assert.equal(hidden.at(-1).id, 'UCaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('sync quota: a write that does not fit is reported, not swallowed', async () => {
  // A host name close to the 253 character limit does not fit next to a full list.
  const long = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.example.com`;
  const hosts = Array.from({ length: 600 }, (_, i) => `a${i}.example.com`);
  const filled = await ctx.worker.evaluate(async (all) => (await importSettings({ app: 'byeai', format: 1, allowedHosts: all })).ok, hosts);
  assert.equal(filled, true);
  const direct = await ctx.worker.evaluate((h) => toggleAllowSite(h, true).then(() => 'saved', (e) => String(e)), long);
  assert.match(direct, /syncFull/);
  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.ok(!allowedHosts.includes(long));
  // Through the message handler the page gets an error back, which the popup shows.
  const media = await ctx.worker.evaluate(async (h) => {
    const filler = [];
    while (JSON.stringify(filler).length < 6800) filler.push(`m${filler.length}.example.com`);
    await saveSettings({ mediaAllowedHosts: filler });
    return toggleMediaSite(h, true).then(() => 'saved', (e) => String(e));
  }, long);
  assert.match(media, /syncFull/);
  // Removing is always allowed.
  assert.ok(await ctx.worker.evaluate(() => toggleAllowSite('a0.example.com', false).then(() => true)));
});

test('sync quota: import that Chrome refuses reports it', async () => {
  const reply = await ctx.worker.evaluate(async (data) => {
    const set = chrome.storage.sync.set.bind(chrome.storage.sync);
    chrome.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    try {
      // The same wrapper the message handler puts around importSettings.
      return await importSettings(data).catch(() => ({ ok: false, error: 'sync' }));
    } finally {
      chrome.storage.sync.set = set;
    }
  }, bigImport(5, 5));
  assert.equal(reply.ok, false);
  assert.equal(reply.error, 'sync');
});

// ---------------------------------------------------------------- 9. pause

test('pause: an expired pause is lifted when the popup asks for the state, not only by the alarm', async () => {
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ enabled: false, pausedUntil: Date.now() - 1000 }));
  const state = await ctx.worker.evaluate(() => getPopupState(-1));
  assert.equal(state.enabled, true);
  assert.equal(state.paused, false);
  const { pausedUntil, enabled } = await ctx.worker.evaluate(() => chrome.storage.sync.get({ pausedUntil: -1, enabled: false }));
  assert.deepEqual([enabled, pausedUntil], [true, 0]);
  assert.equal(await ctx.worker.evaluate(() => chrome.alarms.get('byeai-resume')), undefined, 'alarm only cleans up');
});

test('pause: the end is an absolute time (the alarm only mirrors it)', async () => {
  await ctx.worker.evaluate(() => pauseFor('hour'));
  const { pausedUntil } = await ctx.worker.evaluate(() => chrome.storage.sync.get('pausedUntil'));
  assert.ok(pausedUntil > Date.now() + 59 * 60 * 1000 && pausedUntil < Date.now() + 61 * 60 * 1000);
  assert.equal(await ctx.worker.evaluate(() => isPaused({ enabled: false, pausedUntil: Date.now() - 1 })), false);
  assert.equal(await ctx.worker.evaluate(() => isPaused({ enabled: false, pausedUntil: Date.now() + 5000 })), true);
});

// ---------------------------------------------------------------- 10. DNR limits

test('rules: allowed sites get one rule each with unique ids, even when old hash ids would collide', async () => {
  // These two names had the same id when ids came from a hash of the host.
  const hosts = ['site8308.example.com', 'site10495.example.com', ...Array.from({ length: 250 }, (_, i) => `h${i}.example.org`)];
  await setStorage(ctx.worker, { allowedHosts: hosts });
  await ctx.worker.evaluate(() => syncDynamicRules());
  const rules = await ctx.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  const allow = rules.filter((r) => r.action.type === 'allow');
  assert.equal(allow.length, hosts.length);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'all ids unique');
  const covered = new Set(allow.flatMap((r) => r.condition.initiatorDomains));
  assert.ok(covered.has('site8308.example.com') && covered.has('site10495.example.com'));
  assert.ok(rules.length < 5000, 'far below the 5,000 dynamic rule limit');
});

test('rules: a refused rule update is caught and the next one still runs', async () => {
  const result = await ctx.worker.evaluate(async () => {
    const real = chrome.declarativeNetRequest.updateDynamicRules.bind(chrome.declarativeNetRequest);
    chrome.declarativeNetRequest.updateDynamicRules = () => Promise.reject(new Error('Rule limit exceeded'));
    const warn = console.warn;
    console.warn = () => {};
    try {
      await syncDynamicRules(); // must not throw
    } finally {
      chrome.declarativeNetRequest.updateDynamicRules = real;
      console.warn = warn;
    }
    await syncDynamicRules();
    return (await chrome.declarativeNetRequest.getDynamicRules()).length;
  });
  assert.ok(result >= 1, 'the AI app page rule is back');
});

test('Allow once: the session rules go when the tab navigates away or closes', async () => {
  const rules = () => ctx.worker.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length);
  const waitFor = async (fn, want) => {
    for (let i = 0; i < 30; i += 1) {
      if ((await fn()) === want) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  const page = await ctx.context.newPage();
  await visit(page, 'https://chatgpt.com/');
  await page.click('#allowOnce');
  await page.waitForURL('https://chatgpt.com/');
  assert.equal(await rules(), 2);
  await visit(page, 'https://blog.example.com/post');
  assert.ok(await waitFor(rules, 0), 'navigating away removes them');

  const second = await ctx.context.newPage();
  await visit(second, 'https://chatgpt.com/');
  await second.click('#allowOnce');
  await second.waitForURL('https://chatgpt.com/');
  assert.equal(await rules(), 2);
  await second.close();
  assert.ok(await waitFor(rules, 0), 'closing the tab removes them');
  assert.deepEqual(await ctx.worker.evaluate(() => getOnceHosts()), {});
});

test('Allow once: a refused session rule update leaves the block page usable', async () => {
  const ok = await ctx.worker.evaluate(async () => {
    const real = chrome.declarativeNetRequest.updateSessionRules.bind(chrome.declarativeNetRequest);
    chrome.declarativeNetRequest.updateSessionRules = (opts) => (opts.addRules ? Promise.reject(new Error('Rule limit exceeded')) : real(opts));
    const warn = console.warn;
    console.warn = () => {};
    try {
      return await allowOnce(12345, 'https://chatgpt.com/');
    } finally {
      chrome.declarativeNetRequest.updateSessionRules = real;
      console.warn = warn;
    }
  });
  assert.equal(ok, false);
  assert.deepEqual(await ctx.worker.evaluate(() => getOnceHosts()), {});
});

// ---------------------------------------------------------------- 11. YouTube SPA

// Content scripts live in their own JavaScript world. Counting happens there,
// so the counters are put in through DevTools, in tests only.
async function isolatedWorld(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  let contextId = 0;
  // The world of ByeAI's content scripts is the isolated one that has the extension and `byeai`.
  for (const c of contexts.filter((x) => x.auxData?.type === 'isolated')) {
    const { result } = await cdp.send('Runtime.evaluate', {
      contextId: c.id,
      expression: 'Boolean(globalThis.chrome?.runtime?.id && globalThis.byeai && globalThis.byeai.channels)',
      returnByValue: true,
    });
    if (result.value === true) contextId = c.id;
  }
  assert.ok(contextId, 'content script world found');
  const run = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { contextId, expression, returnByValue: true });
    assert.ok(!exceptionDetails, JSON.stringify(exceptionDetails));
    return result.value;
  };
  return { run, cdp };
}

const COUNTERS = `(() => {
  if (!window.__byeaiCount) {
    const n = (window.__byeaiCount = { listeners: 0, observers: 0, intervals: 0 });
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (...a) { n.listeners += 1; return add.apply(this, a); };
    const observe = MutationObserver.prototype.observe;
    MutationObserver.prototype.observe = function (...a) { n.observers += 1; return observe.apply(this, a); };
    const si = window.setInterval;
    window.setInterval = function (...a) { n.intervals += 1; return si.apply(this, a); };
  }
  return JSON.stringify(window.__byeaiCount);
})()`;

test('YouTube SPA: ten navigations add no listeners, observers or timers', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/');
  const world = await isolatedWorld(page);
  await world.run(COUNTERS);
  // The counters really count in this world: a listener added now shows up.
  await world.run("document.addEventListener('byeai-probe', () => {})");
  assert.equal(JSON.parse(await world.run('JSON.stringify(window.__byeaiCount)')).listeners, 1);

  const navigate = (i) =>
    page.evaluate((n) => {
      history.pushState({}, '', `/?page=${n}`);
      // A new batch of tiles, as the real feed would load.
      for (let k = 0; k < 3; k += 1) {
        const tile = document.querySelector('#plain').cloneNode(true);
        tile.removeAttribute('id');
        document.body.append(tile);
      }
      document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));
    }, i);

  // The first round may create lazy things once (buttons, panels). Then it must stay flat.
  await navigate(0);
  await page.waitForTimeout(500);
  const before = JSON.parse(await world.run('JSON.stringify(window.__byeaiCount)'));
  for (let i = 1; i <= 10; i += 1) {
    await navigate(i);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const after = JSON.parse(await world.run('JSON.stringify(window.__byeaiCount)'));
  assert.deepEqual(after, before, 'counters did not move');
  assert.equal(await page.$eval('#labeled', (el) => el.dataset.byeaiCover), 'labeled', 'covers still work');
  await world.cdp.detach();
});

// ---------------------------------------------------------------- 12. bfcache

test('back/forward cache: coming back re-reads settings and keeps covered players paused', async () => {
  const page = await open(ctx.context, 'https://www.youtube.com/watch?v=test');
  const world = await isolatedWorld(page);
  await world.run(`(() => {
    window.__reads = 0;
    const get = chrome.storage.sync.get.bind(chrome.storage.sync);
    chrome.storage.sync.get = (...a) => { window.__reads += 1; return get(...a); };
  })()`);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
  await page.waitForTimeout(200);
  assert.equal(await world.run('window.__reads'), 0, 'a normal show does not re-read');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForTimeout(400);
  assert.ok((await world.run('window.__reads')) >= 1, 'a restored page re-reads its settings');
  assert.equal(await page.$eval('#movie_player', (el) => el.dataset.byeaiCover), 'labeled');
  assert.equal(await page.$eval('video', (v) => v.paused), true);
  await world.cdp.detach();
});
