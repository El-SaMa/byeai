// Live check: loads the unpacked extension and opens real search pages.
// NOT part of the test suite (it needs the network and the sites change).
//
//   node scripts/live-check.mjs            # headless
//   node scripts/live-check.mjs --headed   # watch it
//   node scripts/live-check.mjs --dump     # also print what AI-like elements are still visible
//   node scripts/live-check.mjs --only=bing   # only pages whose name contains this
//
// For every page it prints: did the address stay right, is the AI hidden,
// and are the useful widgets (dictionary, converter, results...) still there.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const extensionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const headed = process.argv.includes('--headed');
const dump = process.argv.includes('--dump');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

// Anything that looks like search AI and is still on screen counts as a miss.
const AI_SELECTORS = [
  '[data-attnms]', '[data-attrid="VisualDigestGeneratedDescription"]', '[jscontroller="Elkdbc"]',
  '[jsname="YrZdPb"][data-evn]', '.oGdvd', '[jscontroller="DyTeib"]', '.plR5qb', '.olrp5b', 'a[href*="udm=50"]',
  'cib-serp', '[data-priority="GenerativeSearch"]', '#b_copilot', '[id*="b_results_chat"]', '.b_genConvBubble',
  'a[href*="/chat" i][href*="bing.com" i]', 'a[href*="copilot.microsoft.com"]', '#b-scopeListItem-conv', '#b_sydConvCont',
  '#b_copilot_search_container', '#copans_container', '.gs_aidisc', 'a[href*="/copilotsearch"]',
  '[data-testid*="duckassist" i]', '[data-testid*="duckchat" i]', '[data-testid*="ai-chat" i]', 'a[href*="duck.ai"]',
  'a[href*="ia=chat"]', '[data-testid*="aichat" i]', '[data-tile-type="duckassist"]', '[data-assist-icon-trigger]',
];
// Headings that should not be visible when the AI box is gone.
const AI_HEADING = /^(AI Overviews?|AI Mode|Copilot|DuckAssist|Search Assist|Tekoälyn luoma yleiskatsaus|KI-Übersicht|Tekoälytila)$/i;

// Plain searches go to the Web view (udm=14). Answer-box searches keep Google's normal page.
const web = (u) => u.searchParams.get('udm') === '14';
const normal = (u) => u.searchParams.get('udm') !== '14';

const CASES = [
  {
    name: 'google.com web search',
    url: 'https://www.google.com/search?q=how+do+volcanoes+form',
    expectUrl: web,
    widgets: [['results', '#search a h3, #rso a h3']],
  },
  {
    name: 'google.fi web search',
    url: 'https://www.google.fi/search?q=miten+tulivuoret+syntyvat',
    expectUrl: web,
    widgets: [['results', '#search a h3, #rso a h3']],
  },
  {
    name: 'google.com currency',
    url: 'https://www.google.com/search?q=100+usd+to+eur',
    expectUrl: normal,
    widgets: [['converter', '#knowledge-currency__updatable-data-column, [data-attrid*="currency" i], [id*="currency"]']],
  },
  {
    name: 'google.fi currency',
    url: 'https://www.google.fi/search?q=100+usd+to+eur',
    expectUrl: normal,
    widgets: [['converter', '#knowledge-currency__updatable-data-column, [data-attrid*="currency" i], [id*="currency"]']],
  },
  {
    name: 'google.com dictionary',
    url: 'https://www.google.com/search?q=define+serendipity',
    expectUrl: normal,
    widgets: [['dictionary', '[data-dobid], .lr_container, [data-attrid*="definition" i], [jsname="r5Nvmf"]']],
  },
  {
    name: 'google.fi dictionary',
    url: 'https://www.google.fi/search?q=mit%C3%A4+tarkoittaa+serendipiteetti',
    expectUrl: normal,
    widgets: [['results', '#search a h3, #rso a h3']],
  },
  {
    name: 'google.com calculator',
    url: 'https://www.google.com/search?q=12*8%2B4',
    expectUrl: normal,
    widgets: [['calculator', '#cwos, #cwmcwd, [aria-label="Calculator" i], [data-attrid*="calc" i]']],
  },
  {
    name: 'google.com AI Mode link',
    url: 'https://www.google.com/search?q=how+do+volcanoes+form&udm=50',
    expectUrl: web,
    widgets: [['results', '#search a h3, #rso a h3']],
  },
  {
    name: 'google.com images tab',
    url: 'https://www.google.com/search?q=cat&tbm=isch',
    expectUrl: (u) => u.searchParams.get('udm') !== '14' && (u.searchParams.get('tbm') === 'isch' || u.searchParams.get('udm') === '2'),
    widgets: [['images', 'img']],
  },
  {
    name: 'google.com news tab',
    url: 'https://www.google.com/search?q=finland&tbm=nws',
    expectUrl: (u) => u.searchParams.get('udm') !== '14' && (u.searchParams.get('tbm') === 'nws' || u.searchParams.get('udm') === '12'),
    widgets: [['news', 'a h3, [role="heading"]']],
  },
  {
    name: 'bing.com search',
    url: 'https://www.bing.com/search?q=how+do+volcanoes+form',
    expectUrl: () => true,
    widgets: [['results', '#b_results .b_algo']],
  },
  {
    name: 'duckduckgo.com search',
    url: 'https://duckduckgo.com/?q=how+do+volcanoes+form&ia=web',
    expectUrl: () => true,
    widgets: [['results', '.react-results--main li, [data-testid="result"]']],
  },
  {
    name: 'youtube.com "ai cat story"',
    url: 'https://www.youtube.com/results?search_query=ai+cat+story',
    expectUrl: () => true,
    widgets: [['video list', 'ytd-video-renderer, ytd-rich-item-renderer, ytd-item-section-renderer']],
    youtube: true,
  },
];

// EU visitors get a cookie wall first. Reject everything and go on.
async function consent(page) {
  const label = /^(reject all|hylkää kaikki|alles ablehnen|refuser tout|tout refuser|decline all)$/i;
  for (const frame of page.frames()) {
    const button = frame.getByRole('button', { name: label }).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

async function inspect(page, c) {
  return page.evaluate(
    ({ aiSelectors, headingSource, widgets, youtube }) => {
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      const leaks = [];
      for (const sel of aiSelectors) {
        let list = [];
        try {
          list = [...document.querySelectorAll(sel)];
        } catch (_) {
          continue;
        }
        // Count it only when it is really on screen and ByeAI did not hide it.
        const visible = list.filter((el) => shown(el) && !el.closest('[data-byeai-hidden]'));
        if (visible.length) leaks.push(`${sel} x${visible.length}`);
      }
      const heading = new RegExp(headingSource, 'i');
      document.querySelectorAll('h1, h2, h3, [role="heading"], a, button, span').forEach((el) => {
        if (el.children.length > 1) return;
        const text = (el.textContent || '').trim();
        if (text.length < 40 && heading.test(text) && shown(el) && !el.closest('[data-byeai-hidden]')) leaks.push(`text "${text}"`);
      });
      const found = widgets.map(([label, sel]) => {
        let els = [];
        try {
          els = [...document.querySelectorAll(sel)];
        } catch (_) {
          // bad selector
        }
        const ok = els.filter(shown);
        const byAi = els.filter((el) => el.closest('[data-byeai-hidden]'));
        return { label, present: els.length, visible: ok.length, hiddenByByeAI: byAi.length };
      });
      return {
        title: document.title,
        hiddenCount: document.querySelectorAll('[data-byeai-hidden]').length,
        covered: youtube ? document.querySelectorAll('[data-byeai-cover]').length : 0,
        flag: document.documentElement.getAttribute('data-byeai-active'),
        leaks,
        found,
        blocked: /unusual traffic|captcha|before you continue|ennen kuin jatkat/i.test(document.body?.innerText?.slice(0, 2000) || ''),
      };
    },
    { aiSelectors: AI_SELECTORS, headingSource: AI_HEADING.source, widgets: c.widgets, youtube: Boolean(c.youtube) }
  );
}

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: !headed,
  locale: 'en-US',
  // Search engines treat "HeadlessChrome" and automation flags as a bot and show a captcha.
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--disable-blink-features=AutomationControlled',
  ],
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
await context.pages()[0]?.waitForTimeout(500);
for (const p of context.pages()) if (p.url().includes('options.html')) await p.close();

// Same cookie wall as above, once, so the first search is not mistaken for a bot.
{
  const warm = await context.newPage();
  await warm.goto('https://www.google.com/ncr', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await warm.waitForTimeout(2000);
  await consent(warm);
  // One ordinary search first: Google is far quicker to ask for a captcha on the very first one.
  await warm.goto('https://www.google.com/search?q=hello&udm=14', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await warm.waitForTimeout(4000);
  await consent(warm);
  await warm.close();
}

const rows = [];
for (const c of CASES.filter((x) => !only || x.name.includes(only))) {
  const row = { case: c.name, url: '-', ai: '-', widget: '-', note: '' };
  const page = await context.newPage();
  try {
    // The first request is cancelled when ByeAI swaps in the Web view (udm=14): expected.
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
      if (!/ERR_ABORTED/.test(err.message)) throw err;
    });
    await page.waitForTimeout(2500);
    if (await consent(page)) row.note += 'consent rejected; ';
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const final = new URL(page.url());
    const r = await inspect(page, c);
    row.url = c.expectUrl(final) ? 'ok' : 'FAIL';
    if (row.url === 'FAIL') row.note += `ended at ${final.href.slice(0, 100)}; `;
    if (r.blocked) row.note += 'site shows a captcha or wall; ';
    row.ai = r.leaks.length ? `FAIL (${r.leaks.length})` : `ok (${r.hiddenCount} hidden)`;
    if (c.youtube) row.ai = r.covered ? `ok (${r.covered} covered)` : 'n/a (none covered)';
    row.widget = r.found
      .map((w) => (w.visible ? `ok ${w.label}` : w.hiddenByByeAI ? `FAIL ${w.label} hidden by ByeAI` : `absent ${w.label}`))
      .join(', ');
    if (r.found.some((w) => w.hiddenByByeAI && !w.visible)) row.widget = row.widget.replace('absent', 'FAIL');
    if (r.leaks.length && dump) row.note += `leaks: ${r.leaks.join('; ')}; `;
    if (final.pathname.startsWith('/sorry')) row.note += 'Google asked for a captcha; ';
    if (!final.hostname.includes(new URL(c.url).hostname.replace(/^www\./, ''))) row.note += `ended on ${final.hostname}; `;
    if (r.flag !== '1') row.note += `byeai flag=${r.flag}; `;
  } catch (err) {
    row.note += `error: ${String(err.message).split('\n')[0]}`;
  }
  rows.push(row);
  await page.close();
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
await context.close();

const cols = ['case', 'url', 'ai', 'widget', 'note'];
const heads = { case: 'Page', url: 'URL', ai: 'AI hidden?', widget: 'Useful widgets visible?', note: 'Notes' };
const width = Object.fromEntries(cols.map((k) => [k, Math.max(heads[k].length, ...rows.map((r) => String(r[k]).length))]));
const line = (r) => cols.map((k) => String(r[k]).padEnd(width[k])).join(' | ');
console.log(line(heads));
console.log(cols.map((k) => '-'.repeat(width[k])).join('-+-'));
rows.forEach((r) => console.log(line(r)));
const failed = rows.filter((r) => /FAIL/.test(`${r.url} ${r.ai} ${r.widget}`));
console.log(`\n${rows.length - failed.length}/${rows.length} pages without a failure.`);
process.exitCode = failed.length ? 1 : 0;
