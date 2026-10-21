import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, setStorage, resetStorage } from './helpers.mjs';

let ctx;

// The notice sits in a closed shadow root, out of reach for page scripts and
// Playwright selectors. DevTools still sees it, so read it through CDP.
async function readNotice(page) {
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
    const host = find(root, (n) => n.nodeName === 'BYEAI-NOTICE');
    if (!host) return null;
    const shadow = host.shadowRoots?.[0];
    const texts = [];
    const walk = (n) => {
      if (n.nodeType === 3 && n.parentId && n.nodeValue.trim()) texts.push(n.nodeValue.trim());
      [...(n.children || [])].forEach(walk);
    };
    const box = find(shadow, (n) => n.attributes?.includes('role'));
    walk(box);
    const attrs = Object.fromEntries(
      (box.attributes || []).reduce((acc, v, i, all) => (i % 2 ? acc : [...acc, [v, all[i + 1]]]), [])
    );
    const allow = find(box, (n) => n.nodeName === 'BUTTON' && !(n.attributes || []).includes('close'));
    return { mode: shadow.shadowRootType, role: attrs.role, texts, allowNode: allow?.backendNodeId };
  } finally {
    await cdp.detach();
  }
}

async function clickNode(page, backendNodeId) {
  const cdp = await page.context().newCDPSession(page);
  const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId });
  await cdp.detach();
  const [x1, y1, , , x3, y3] = model.content;
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
}

before(async () => {
  ctx = await launch();
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  await setStorage(ctx.worker, { notifiedHosts: [] });
  for (const p of ctx.context.pages()) await p.close();
});

test('first block on a site shows the notice once', async () => {
  const page = await open(ctx.context, 'https://shop.example.com/');
  await page.waitForTimeout(500);
  const notice = await readNotice(page);
  assert.ok(notice, 'notice shown');
  assert.equal(notice.mode, 'closed');
  assert.equal(notice.role, 'status');
  assert.deepEqual(notice.texts, ['ByeAI blocked AI on this page', 'Allow', '×']);

  const { notifiedHosts } = await ctx.worker.evaluate(() => chrome.storage.local.get('notifiedHosts'));
  assert.deepEqual(notifiedHosts, ['shop.example.com']);

  const again = await open(ctx.context, 'https://shop.example.com/');
  await again.waitForTimeout(500);
  assert.equal(await readNotice(again), null, 'second visit: no notice');
});

test('notice fades out on its own', async () => {
  const page = await open(ctx.context, 'https://shop.example.com/');
  await page.mouse.move(0, 0);
  assert.ok(await readNotice(page));
  await page.waitForTimeout(6800);
  assert.equal(await readNotice(page), null);
});

test('no notice when "Show notices" is off', async () => {
  await setStorage(ctx.worker, { showNotices: false });
  const page = await open(ctx.context, 'https://shop.example.com/');
  await page.waitForTimeout(500);
  assert.equal(await readNotice(page), null);
  // It still blocks.
  assert.equal(await page.evaluate(() => window.__intercom === true), false);
});

test('no notice on an allowed site', async () => {
  await setStorage(ctx.worker, { allowedHosts: ['shop.example.com'] });
  const page = await open(ctx.context, 'https://shop.example.com/');
  await page.waitForTimeout(500);
  assert.equal(await readNotice(page), null);
});

test('no notice where nothing was blocked', async () => {
  const page = await open(ctx.context, 'https://example.com/page');
  await page.waitForTimeout(500);
  assert.equal(await readNotice(page), null);
});

test('Allow in the notice allows the site and offers a reload', async () => {
  const page = await open(ctx.context, 'https://shop.example.com/');
  const notice = await readNotice(page);
  await clickNode(page, notice.allowNode);
  await page.waitForTimeout(400);

  const { allowedHosts } = await ctx.worker.evaluate(() => chrome.storage.sync.get('allowedHosts'));
  assert.deepEqual(allowedHosts, ['shop.example.com']);
  const after = await readNotice(page);
  assert.deepEqual(after.texts, ['AI allowed on this site.', 'Reload', '×']);
});

test('options page saves "Show notices"', async () => {
  const options = await ctx.context.newPage();
  await options.goto(`chrome-extension://${ctx.extensionId}/options/options.html`);
  await options.waitForTimeout(300);
  assert.equal(await options.isChecked('#showNotices'), true);
  assert.match(await options.textContent('label[for="showNotices"]'), /Show notices/);
  await options.click('#showNotices');
  await options.waitForTimeout(200);
  const { showNotices } = await ctx.worker.evaluate(() => chrome.storage.sync.get('showNotices'));
  assert.equal(showNotices, false);
});

test('a network block alone, before the page is ready, still gives one notice', async () => {
  const page = await open(ctx.context, 'https://net.example.com/');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__intercom === true), false);
  assert.ok(await readNotice(page));
  assert.equal(await page.$$eval('byeai-notice', (els) => els.length), 1);
});

test('page asks for the notice itself when the first message missed it', async () => {
  // As if every block happened before the content script was listening.
  await ctx.worker.evaluate(() => {
    globalThis.__send = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = () => Promise.reject(new Error('Receiving end does not exist.'));
  });
  try {
    const page = await open(ctx.context, 'https://net.example.com/');
    await page.waitForTimeout(500);
    assert.ok(await readNotice(page));
  } finally {
    await ctx.worker.evaluate(() => {
      chrome.tabs.sendMessage = globalThis.__send;
    });
  }
});

test('notified sites list is capped', async () => {
  const many = Array.from({ length: 500 }, (_, i) => `site${i}.example`);
  await setStorage(ctx.worker, { notifiedHosts: many });
  await open(ctx.context, 'https://shop.example.com/');
  const { notifiedHosts } = await ctx.worker.evaluate(() => chrome.storage.local.get('notifiedHosts'));
  assert.equal(notifiedHosts.length, 500);
  assert.equal(notifiedHosts.at(-1), 'shop.example.com');
  assert.equal(notifiedHosts[0], 'site1.example', 'oldest dropped');
});
