import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, resetStorage, isHidden } from './helpers.mjs';

let ctx;

before(async () => {
  ctx = await launch();
});

after(async () => {
  await ctx?.context.close();
});

beforeEach(async () => {
  await resetStorage(ctx.worker);
  await ctx.worker.evaluate(() => Promise.all([chrome.storage.sync.remove('pausedUntil'), chrome.alarms.clear('byeai-resume')]));
  for (const p of ctx.context.pages()) await p.close();
});

const settings = () =>
  ctx.worker.evaluate(async () => ({
    ...(await chrome.storage.sync.get({ enabled: true, pausedUntil: 0 })),
    alarm: (await chrome.alarms.get('byeai-resume'))?.scheduledTime || 0,
  }));

async function popupOpen() {
  const popup = await ctx.context.newPage();
  await popup.goto(`chrome-extension://${ctx.extensionId}/popup/popup.html`);
  await popup.waitForTimeout(300);
  return popup;
}

test('Pause for 1 hour: ByeAI is off, an alarm resumes it, popup says paused', async () => {
  const site = await open(ctx.context, 'https://blog.example.com/post');
  assert.equal(await isHidden(site, '#ask-ai'), true, 'blocked before the pause');

  const popup = await popupOpen();
  const before = Date.now();
  await popup.click('#pauseHourBtn');
  await popup.waitForTimeout(400);

  const s = await settings();
  assert.equal(s.enabled, false);
  assert.ok(s.pausedUntil >= before + 3600 * 1000 - 2000 && s.pausedUntil <= Date.now() + 3600 * 1000 + 2000);
  assert.ok(Math.abs(s.alarm - s.pausedUntil) < 1000, 'alarm set for the end of the pause');

  assert.equal(await popup.textContent('#statusPill'), 'Paused');
  assert.match(await popup.textContent('#pauseNote'), /^Paused until /);
  assert.equal(await popup.isVisible('#resumeBtn'), true);
  assert.equal(await popup.isVisible('#pauseHourBtn'), false);

  await site.waitForTimeout(300);
  assert.equal(await isHidden(site, '#ask-ai'), false, 'AI is not hidden while paused');

  const badge = await ctx.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://blog.example.com/*' });
    return { text: await chrome.action.getBadgeText({ tabId: tab.id }), title: await chrome.action.getTitle({ tabId: tab.id }) };
  });
  assert.equal(badge.text, 'II');
  assert.equal(badge.title, 'ByeAI is paused');
});

test('Resume now switches ByeAI back on and clears the alarm', async () => {
  const site = await open(ctx.context, 'https://blog.example.com/post');
  const popup = await popupOpen();
  await popup.click('#pauseHourBtn');
  await popup.waitForTimeout(300);
  await popup.click('#resumeBtn');
  await popup.waitForTimeout(400);

  const s = await settings();
  assert.deepEqual([s.enabled, s.pausedUntil, s.alarm], [true, 0, 0]);
  assert.equal(await popup.textContent('#statusPill'), 'Protected');
  assert.equal(await popup.isVisible('#pauseHourBtn'), true);
  assert.equal(await popup.isVisible('#resumeBtn'), false);
  await site.waitForTimeout(300);
  assert.equal(await isHidden(site, '#ask-ai'), true);
  const text = await ctx.worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://blog.example.com/*' });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  assert.notEqual(text, 'II');
});

test('Pause until tomorrow ends at the start of a later day', async () => {
  const popup = await popupOpen();
  await popup.click('#pauseTomorrowBtn');
  await popup.waitForTimeout(400);
  const { enabled, pausedUntil } = await settings();
  assert.equal(enabled, false);
  const end = new Date(pausedUntil);
  assert.deepEqual([end.getHours(), end.getMinutes(), end.getSeconds()], [0, 0, 0], 'local midnight');
  const hours = (pausedUntil - Date.now()) / 3600000;
  assert.ok(hours > 1.9 && hours <= 48, `${hours} hours`);
});

test('a pause that is over ends by itself (alarm)', async () => {
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ enabled: false, pausedUntil: Date.now() + 1200 }));
  await new Promise((resolve) => setTimeout(resolve, 3500));
  const s = await settings();
  assert.deepEqual([s.enabled, s.pausedUntil], [true, 0]);
});

test('a pause that ended while the browser was closed ends at start-up', async () => {
  // Nothing scheduled: this is what the worker finds after a restart.
  await ctx.worker.evaluate(async () => {
    await chrome.alarms.clear('byeai-resume');
    await chrome.storage.sync.set({ enabled: false, pausedUntil: Date.now() - 5000 });
    await chrome.alarms.clear('byeai-resume');
    await checkPause();
  });
  const s = await settings();
  assert.deepEqual([s.enabled, s.pausedUntil], [true, 0]);
});

test('a running pause survives a restart: the alarm is put back', async () => {
  const until = Date.now() + 3 * 3600 * 1000;
  await ctx.worker.evaluate(async (t) => {
    await chrome.storage.sync.set({ enabled: false, pausedUntil: t });
    await chrome.alarms.clear('byeai-resume');
    await checkPause();
  }, until);
  const s = await settings();
  assert.equal(s.enabled, false);
  assert.ok(Math.abs(s.alarm - until) < 1000);
});

test('turning ByeAI on or off by hand ends a pause', async () => {
  const popup = await popupOpen();
  await popup.click('#pauseHourBtn');
  await popup.waitForTimeout(300);
  await ctx.worker.evaluate(() => toggleEnabled(true));
  let s = await settings();
  assert.deepEqual([s.enabled, s.pausedUntil, s.alarm], [true, 0, 0]);

  await popup.reload();
  await popup.waitForTimeout(300);
  await popup.click('#pauseHourBtn');
  await popup.waitForTimeout(300);
  await ctx.worker.evaluate(() => toggleEnabled(false));
  s = await settings();
  assert.deepEqual([s.enabled, s.pausedUntil], [false, 0], 'off by hand stays off');
  await popup.reload();
  await popup.waitForTimeout(300);
  assert.equal(await popup.textContent('#statusPill'), 'Off');
  assert.equal(await popup.isVisible('#pauseBox'), false, 'nothing to pause when it is off');
});

test('pause buttons are keyboard reachable and show focus', async () => {
  const popup = await popupOpen();
  await popup.focus('#pauseHourBtn');
  await popup.keyboard.press('Tab');
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'pauseTomorrowBtn');
  const outline = await popup.$eval('#pauseTomorrowBtn', (el) => getComputedStyle(el).outlineStyle);
  assert.notEqual(outline, 'none');
  await popup.keyboard.press('Enter');
  await popup.waitForTimeout(400);
  assert.equal((await settings()).enabled, false);
  assert.equal(await popup.evaluate(() => document.activeElement.id), 'resumeBtn', 'focus moves to Resume now');
});
