import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
export const extensionPath = path.join(root, '..', 'extension');
const fixture = (name) => readFileSync(path.join(root, 'fixtures', name), 'utf8');

// Fake sites. Content scripts only care about the URL, so we serve local
// fixtures under the real hostnames.
export const PAGES = {
  'https://www.youtube.com/': 'youtube-feed.html',
  'https://www.youtube.com/results?search_query=ai+cat+story': 'youtube-shorts.html',
  'https://www.youtube.com/watch?v=test': 'youtube-watch.html',
  'https://www.youtube.com/watch?v=plain': 'youtube-watch-plain.html',
  'https://www.youtube.com/feed/channels': 'youtube-channels.html',
  'https://www.youtube.com/results?search_query=cats': 'youtube-search.html',
  'https://www.youtube.com/watch?v=dream': 'youtube-watch-channel.html',
  'https://www.youtube.com/watch?v=labeled': 'youtube-watch-labeled.html',
  'https://www.youtube.com/watch?v=labeled2': 'youtube-watch-labeled2.html',
  'https://www.youtube.com/watch?v=tagged': 'youtube-watch-tagged.html',
  'https://x.com/home': 'x.html',
  'https://www.instagram.com/': 'instagram.html',
  'https://www.tiktok.com/foryou': 'tiktok.html',
  'https://www.google.com/search?q=test&udm=14': 'google.html',
  'https://www.google.fi/search?q=test&udm=14': 'google-answers.html',
  'https://www.google.co.uk/search?q=test&udm=14': 'google-answers.html',
  'https://www.google.com.au/search?q=test&udm=14': 'google-answers.html',
  'https://www.google.de/search?q=test&udm=14': 'google-answers.html',
  // Answer-box and other-tab searches keep Google's normal page: no udm=14 added.
  'https://www.google.com/search?q=100+usd+to+eur': 'google-answers.html',
  'https://www.google.com/search?q=test&tbm=isch': 'google-answers.html',
  'https://www.google.com/search?q=shared&udm=14': 'google-shared.html',
  'https://www.bing.com/search?q=shared': 'bing-shared.html',
  'https://duckduckgo.com/?q=shared&ia=web': 'duckduckgo-shared.html',
  'https://www.bing.com/search?q=test': 'bing-search.html',
  'https://duckduckgo.com/?q=test&ia=web': 'duckduckgo-search.html',
  'https://www.amazon.com/': 'amazon.html',
  'https://blog.example.com/post': 'generic.html',
  'https://shop.example.com/': 'widget.html',
  'https://chatgpt.com/': 'ai-app.html',
  'https://embed.example.com/': 'ai-embed.html',
  'https://net.example.com/': 'widget-network.html',
};

// Scripts that leave a mark on the page when they run.
const SCRIPTS = {
  'https://chatgpt.com/app.js': 'window.__app = true;',
  'https://chatgpt.com/widget.js': 'window.__chatgptWidget = true;',
};

// Fake ByeAI Community API on oma.lanetti.fi. Tests change it and read
// what the extension sent.
export const EMPTY_LIST = { version: 0, updatedAt: '2026-10-21T00:00:00Z', channels: [] };
function communityApi() {
  return { list: EMPTY_LIST, etag: '"v0"', status: 200, suggestStatus: 202, listRequests: [], suggests: [] };
}

async function serveCommunity(api, route) {
  const req = route.request();
  const url = new URL(req.url());
  if (url.pathname === '/api/byeai/community/v1/list') {
    api.listRequests.push({ method: req.method(), headers: await req.allHeaders() });
    if (api.status !== 200) return route.fulfill({ status: api.status, body: 'oops' });
    if (req.headers()['if-none-match'] === api.etag) return route.fulfill({ status: 304, headers: { ETag: api.etag } });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: api.etag }, body: JSON.stringify(api.list) });
  }
  if (url.pathname === '/api/byeai/community/v1/suggest') {
    api.suggests.push({ method: req.method(), headers: await req.allHeaders(), body: req.postData() });
    return route.fulfill({ status: api.suggestStatus, contentType: 'application/json', body: '{"ok":true}' });
  }
  return route.fulfill({ status: 404, body: '' });
}

export async function launch() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const oma = communityApi();
  await context.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    if (new URL(url).hostname === 'oma.lanetti.fi') return serveCommunity(oma, route);
    if (new URL(url).hostname === 'widget.intercom.io') {
      return route.fulfill({ contentType: 'text/javascript', body: 'window.__intercom = true;' });
    }
    // Holds up parsing, so blocks happen well before DOMContentLoaded.
    if (new URL(url).hostname === 'slow.example.com') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill({ contentType: 'text/javascript', body: 'window.__slow = true;' });
    }
    if (SCRIPTS[url]) return route.fulfill({ contentType: 'text/javascript', body: SCRIPTS[url] });
    const file = PAGES[url];
    if (file) return route.fulfill({ contentType: 'text/html', body: fixture(file) });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  // First install opens the welcome page. Close it so it does not steal a tab.
  const welcome = context.pages().find((p) => p.url().includes('options.html'))
    || (await context.waitForEvent('page', { timeout: 3000 }).catch(() => null));
  await welcome?.close();

  return { context, worker, extensionId, oma };
}

const HIDDEN_KEYS = ['hiddenChannels', ...Array.from({ length: 9 }, (_, i) => `hiddenChannels${i + 1}`)];
const SHOWN_KEYS = ['shownChannels', 'shownChannels1', 'shownChannels2'];
const SYNC_KEYS = ['enabled', 'features', 'allowedHosts', 'mediaAllowedHosts', 'showNotices', 'communityEnabled', 'communityAutoShare', ...HIDDEN_KEYS, ...SHOWN_KEYS];

// Same split as the extension: settings in sync, counters in local.
export async function setStorage(worker, data) {
  await worker.evaluate(
    ({ d, keys }) => {
      const synced = {};
      const local = {};
      for (const [k, v] of Object.entries(d)) (keys.includes(k) ? synced : local)[k] = v;
      return Promise.all([chrome.storage.sync.set(synced), chrome.storage.local.set(local)]);
    },
    { d: data, keys: SYNC_KEYS }
  );
}

export async function resetStorage(worker) {
  await setStorage(worker, {
    enabled: true,
    allowedHosts: [],
    mediaAllowedHosts: [],
    features: { widgets: true, labeled: true },
    showNotices: true,
    communityEnabled: true,
    communityAutoShare: false,
    community: { ...EMPTY_LIST, etag: '', fetchedAt: Date.now() },
    suggestCount: { day: '', count: 0 },
    autoShared: {},
    notAiSent: {},
    autoSharedCount: 0,
  });
  await worker.evaluate((keys) => chrome.storage.sync.remove(keys), [...HIDDEN_KEYS, ...SHOWN_KEYS]);
}

export async function open(context, url) {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(700);
  return page;
}

// Visible = rendered and not display:none (cover keeps things in layout).
export const isHidden = (page, selector) =>
  page.$eval(selector, (el) => getComputedStyle(el).display === 'none');

export const coverOf = (page, selector) => page.$eval(selector, (el) => el.dataset.byeaiCover || '');

// Closed shadow roots (notice, toast) are out of reach for page scripts and
// Playwright selectors. DevTools still sees them, so read them through CDP.
export async function readShadow(page, hostName) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const find = (node, pred) => {
      if (pred(node)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const hit = find(child, pred);
        if (hit) return hit;
      }
      return null;
    };
    const host = find(root, (n) => n.nodeName === hostName.toUpperCase());
    if (!host) return null;
    const shadow = host.shadowRoots?.[0];
    const texts = [];
    const buttons = {};
    const walk = (n, button) => {
      const inButton = n.nodeName === 'BUTTON' ? n : button;
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        texts.push(n.nodeValue.trim());
        if (inButton) buttons[n.nodeValue.trim()] = inButton.backendNodeId;
      }
      [...(n.children || [])].forEach((c) => walk(c, inButton));
    };
    walk(shadow, null);
    return { mode: shadow.shadowRootType, texts, buttons };
  } finally {
    await cdp.detach();
  }
}

export async function clickNode(page, backendNodeId) {
  const cdp = await page.context().newCDPSession(page);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
  await cdp.detach();
  const [x1, y1, , , x3, y3] = model.content;
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
}
