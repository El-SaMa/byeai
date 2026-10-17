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
  'https://www.youtube.com/watch?v=test': 'youtube-watch.html',
  'https://www.youtube.com/watch?v=plain': 'youtube-watch-plain.html',
  'https://x.com/home': 'x.html',
  'https://www.instagram.com/': 'instagram.html',
  'https://www.tiktok.com/foryou': 'tiktok.html',
  'https://www.google.com/search?q=test&udm=14': 'google.html',
  'https://www.amazon.com/': 'amazon.html',
  'https://blog.example.com/post': 'generic.html',
  'https://shop.example.com/': 'widget.html',
};

export async function launch() {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  await context.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    if (url.includes('widget.intercom.io')) {
      return route.fulfill({ contentType: 'text/javascript', body: 'window.__intercom = true;' });
    }
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

  return { context, worker, extensionId };
}

export async function setStorage(worker, data) {
  await worker.evaluate((d) => chrome.storage.local.set(d), data);
}

export async function resetStorage(worker) {
  await worker.evaluate(() =>
    chrome.storage.local.set({
      enabled: true,
      allowedHosts: [],
      features: { widgets: true, labeled: true },
    })
  );
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
