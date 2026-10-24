importScripts('../shared/ai-apps.js', '../shared/hidden-channels.js', '../shared/google-queries.js');

const RULESET_ID = 'core_network';
const GOOGLE_RULESET_ID = 'google_search';
const SEARCH_AI_RULESET_ID = 'search_ai';
const ENABLED_RULESETS = [RULESET_ID, GOOGLE_RULESET_ID, SEARCH_AI_RULESET_ID];
const WHITELIST_RULE_BASE = 9000000;
// Sends AI apps (chatgpt.com and friends) to blocked/blocked.html instead of a frozen page.
const AI_APP_PAGE_RULE_ID = WHITELIST_RULE_BASE - 1;
// Session rules for "Allow once", scoped to one tab.
const ONCE_RULE_BASE = 9900000;
const BLOCK_RESOURCE_TYPES = ['script', 'sub_frame', 'xmlhttprequest', 'websocket', 'other'];
const BLOCKED_PAGE = 'blocked/blocked.html';
// Hosts that already got the "ByeAI blocked AI on this page" notice.
const NOTICE_LIMIT = 500;

// ByeAI Community list: a public list of AI channels, downloaded once a day.
const COMMUNITY_URL = 'https://oma.lanetti.fi/api/byeai/community/v1/list';
const SUGGEST_URL = 'https://oma.lanetti.fi/api/byeai/community/v1/suggest';
const COMMUNITY_FILE = 'lists/community.json';
const COMMUNITY_ALARM = 'byeai-community';
const COMMUNITY_MAX = 50000;
const COMMUNITY_VIDEOS_PER_CHANNEL = 30;
const COMMUNITY_VIDEOS_MAX = 20000;
// A bit under a day, so the daily alarm never finds the list "still fresh".
const COMMUNITY_FRESH_MS = 23 * 60 * 60 * 1000;
const SUGGEST_DAILY_LIMIT = 20;
const SUGGEST_REASONS = ['labeled', 'tagged', 'manual', 'not_ai'];
// "Help the Community automatically" and "Not AI": once per channel per 30 days.
const AUTO_SHARE_MS = 30 * 24 * 60 * 60 * 1000;
const AUTO_SHARE_MAX = 1000;

const CATEGORIES = ['widgets', 'buttons', 'labeled'];
// Switches in the popup. Counts still use the finer CATEGORIES.
const FEATURES = ['widgets', 'labeled'];
const FEATURE_DEFAULTS = { widgets: true, labeled: true };

// Pause / snooze: the same as the global switch, plus a time it switches back on.
const PAUSE_ALARM = 'byeai-resume';
const HOUR_MS = 60 * 60 * 1000;
const BADGE_COLOR = '#0f766e';
const BADGE_PAUSED_COLOR = '#64748b';

/** @type {Map<number, { page: number, seen: Set<string>, cats: Record<string, number> }>} */
const tabStats = new Map();

// Settings follow the user across devices through Chrome sync (it still
// works locally when sync is off). Counters change often, so they stay local.
const SYNC_DEFAULTS = {
  enabled: true,
  features: FEATURE_DEFAULTS,
  allowedHosts: [],
  mediaAllowedHosts: [],
  showNotices: true,
  communityEnabled: true,
  communityAutoShare: false,
  // 0 = not paused. Otherwise ByeAI is off until this time (ms since 1970).
  pausedUntil: 0,
};
const LOCAL_DEFAULTS = {
  totalBlocked: 0,
  onboardingComplete: false,
  syncMigrated: false,
};

async function getSettings() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULTS),
    chrome.storage.local.get(LOCAL_DEFAULTS),
  ]);
  return {
    ...SYNC_DEFAULTS,
    ...LOCAL_DEFAULTS,
    ...synced,
    ...local,
    features: { ...FEATURE_DEFAULTS, ...(synced.features || {}) },
  };
}

// 1.1 and older kept settings in local storage. Copy them over once.
async function migrateToSync() {
  const { syncMigrated } = await chrome.storage.local.get({ syncMigrated: false });
  if (syncMigrated) return;
  const old = await chrome.storage.local.get(['enabled', 'features', 'allowedHosts']);
  const current = await chrome.storage.sync.get(['allowedHosts']);
  const merged = { ...old };
  if (old.allowedHosts || current.allowedHosts) {
    merged.allowedHosts = [...new Set([...(current.allowedHosts || []), ...(old.allowedHosts || [])])];
  }
  if (Object.keys(merged).length) await chrome.storage.sync.set(merged);
  await chrome.storage.local.remove(['enabled', 'features', 'allowedHosts']);
  await chrome.storage.local.set({ syncMigrated: true });
}

function emptyStat() {
  return { page: 0, seen: new Set(), cats: { widgets: 0, buttons: 0, labeled: 0 }, notice: '' };
}

async function saveSettings(partial) {
  const synced = {};
  const local = {};
  for (const [key, value] of Object.entries(partial)) {
    if (key in SYNC_DEFAULTS) synced[key] = value;
    else local[key] = value;
  }
  if (Object.keys(synced).length) await chrome.storage.sync.set(synced);
  if (Object.keys(local).length) await chrome.storage.local.set(local);
}

function getTabStat(tabId) {
  if (!tabStats.has(tabId)) {
    tabStats.set(tabId, emptyStat());
  }
  return tabStats.get(tabId);
}

function resetTabStat(tabId) {
  tabStats.set(tabId, emptyStat());
}

// Network rules belong to the widgets + search category.
async function syncRulesetEnabled(settings) {
  if (settings.enabled && settings.features.widgets) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ENABLED_RULESETS,
      disableRulesetIds: [],
    });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [],
      disableRulesetIds: ENABLED_RULESETS,
    });
  }
}

// google.com, google.fi, google.co.uk, google.com.au ... with or without www.
const GOOGLE_HOST = /^(www\.)?google\.[a-z]{2,}(\.[a-z]{2,})?$/;

function isGoogleSearchUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!GOOGLE_HOST.test(url.hostname)) return false;
    return url.pathname.startsWith('/search');
  } catch {
    return false;
  }
}

function hostnameAllowed(hostname, allowedHosts) {
  if (allowedHosts.includes(hostname)) return true;
  const bare = hostname.replace(/^www\./, '');
  return allowedHosts.includes(bare);
}

function aiAppPageRule(settings) {
  const allowed = settings.allowedHosts.filter((h) => globalThis.byeaiIsAiApp(h));
  const condition = {
    regexFilter: '^https?://.*$',
    requestDomains: globalThis.BYEAI_AI_APPS,
    resourceTypes: ['main_frame'],
  };
  if (allowed.length) condition.excludedRequestDomains = allowed;
  return {
    id: AI_APP_PAGE_RULE_ID,
    priority: 50,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: `chrome-extension://${chrome.runtime.id}/${BLOCKED_PAGE}#\\0` },
    },
    condition,
  };
}

async function applyDynamicRules() {
  const settings = await getSettings();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .filter((rule) => rule.id === AI_APP_PAGE_RULE_ID || (rule.id >= WHITELIST_RULE_BASE && rule.id < WHITELIST_RULE_BASE + 1000000))
    .map((rule) => rule.id);

  // Numbered one by one: a hash of the name can collide, and one duplicate
  // id makes Chrome refuse the whole update (no allowed site would work).
  const addRules = [...new Set(settings.allowedHosts)].map((host, i) => ({
    id: WHITELIST_RULE_BASE + 1 + i,
    priority: 100,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: [host],
      resourceTypes: BLOCK_RESOURCE_TYPES,
    },
  }));

  // AI apps get the block page while ByeAI and "AI assistants" are on.
  if (settings.enabled && settings.features.widgets) addRules.push(aiAppPageRule(settings));

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

// Allowed sites and the AI app page rule. Runs one at a time, always from fresh settings.
let rulesQueue = Promise.resolve();
function syncDynamicRules() {
  rulesQueue = rulesQueue.then(applyDynamicRules).catch((err) => console.warn('ByeAI rules', err));
  return rulesQueue;
}

async function updateActionTitle(tabId, hostname, pageCount, enabled, isAllowed, paused = false) {
  const t = (key, args) => {
    try {
      return chrome.i18n.getMessage(key, args || []) || '';
    } catch (_) {
      return '';
    }
  };

  let title;

  if (paused) {
    title = t('actionTitlePaused') || 'ByeAI is paused';
  } else if (!enabled) {
    title = t('actionTitleOff') || 'ByeAI is off';
  } else if (isAllowed) {
    title = t('actionTitleAllowed', [hostname]) || `ByeAI: AI allowed on ${hostname}`;
  } else if (pageCount > 0) {
    title = t('actionTitleBlocked', [String(pageCount)]) || `ByeAI: ${pageCount} blocked on this page`;
  } else {
    title = t('actionTitleNothing') || 'ByeAI: nothing blocked here';
  }

  const details = { title };
  if (typeof tabId === 'number') {
    details.tabId = tabId;
  }
  await chrome.action.setTitle(details);
}

async function refreshTabUi(tabId) {
  if (typeof tabId !== 'number') return;

  const settings = await getSettings();
  const stat = getTabStat(tabId);
  let hostname = '';

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('http')) {
      hostname = new URL(tab.url).hostname.replace(/^www\./, '');
    }
  } catch {
    return;
  }

  const isAllowed = settings.allowedHosts.includes(hostname);
  const paused = isPaused(settings);
  await updateActionTitle(tabId, hostname, stat.page, settings.enabled, isAllowed, paused);
  await updateBadge(tabId, settings.enabled && !isAllowed ? stat.page : 0, paused);
}

async function updateBadge(tabId, count, paused = false) {
  try {
    // Paused shows "II" on a grey badge, on every tab.
    let text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
    if (paused) text = 'II';
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // tab closed
  }
}

// Blocks arrive in bursts. Chain the read-modify-write so none get lost.
let totalQueue = Promise.resolve();
function bumpTotal() {
  totalQueue = totalQueue.then(async () => {
    const { totalBlocked } = await chrome.storage.local.get({ totalBlocked: 0 });
    await chrome.storage.local.set({ totalBlocked: totalBlocked + 1 });
  });
  return totalQueue;
}

async function recordBlock(tabId, dedupeKey, category = 'widgets') {
  const settings = await getSettings();
  if (!settings.enabled) return;

  let hostname = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('http')) {
      hostname = new URL(tab.url).hostname.replace(/^www\./, '');
    }
  } catch {
    return;
  }

  if (settings.allowedHosts.includes(hostname)) return;

  const stat = getTabStat(tabId);
  if (stat.seen.has(dedupeKey)) return;
  stat.seen.add(dedupeKey);

  stat.page += 1;
  if (CATEGORIES.includes(category)) stat.cats[category] += 1;
  await bumpTotal();

  await refreshTabUi(tabId);
  if (hostname && !stat.notice) sendNotice(tabId, hostname);
}

// --- "ByeAI blocked AI on this page" notice, once per site ---

let noticeQueue = Promise.resolve();
function inNoticeQueue(fn) {
  const run = noticeQueue.then(fn);
  noticeQueue = run.catch(() => {});
  return run;
}

async function noticeAllowed(hostname) {
  if (!hostname || globalThis.byeaiIsAiApp(hostname)) return false;
  const settings = await getSettings();
  if (!settings.enabled || !settings.showNotices) return false;
  if (hostnameAllowed(hostname, settings.allowedHosts)) return false;
  const { notifiedHosts } = await chrome.storage.local.get({ notifiedHosts: [] });
  return !notifiedHosts.includes(hostname);
}

async function markNotified(hostname) {
  const { notifiedHosts } = await chrome.storage.local.get({ notifiedHosts: [] });
  const next = notifiedHosts.filter((h) => h !== hostname);
  next.push(hostname);
  await chrome.storage.local.set({ notifiedHosts: next.slice(-NOTICE_LIMIT) });
}

// First block on a tab: ask its content script to show the notice. If the
// script is not listening yet, it asks again itself (NOTICE_READY).
function sendNotice(tabId, hostname) {
  const stat = getTabStat(tabId);
  return inNoticeQueue(async () => {
    if (stat.notice) return;
    if (!(await noticeAllowed(hostname))) {
      stat.notice = 'skip';
      return;
    }
    try {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'SHOW_NOTICE', host: hostname }, { frameId: 0 });
      if (reply?.shown) {
        stat.notice = 'shown';
        await markNotified(hostname);
      }
    } catch {
      // not listening yet
    }
  });
}

function noticeReady(tabId, hostname) {
  const stat = getTabStat(tabId);
  return inNoticeQueue(async () => {
    if (stat.notice || stat.page === 0 || !(await noticeAllowed(hostname))) return { show: false };
    stat.notice = 'shown';
    await markNotified(hostname);
    return { show: true };
  });
}

// --- "Allow once": session rules for one tab, gone when the tab leaves the site ---

function bareHost(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol === 'chrome-extension:' && url.pathname === `/${BLOCKED_PAGE}`) {
      return bareHost(url.hash.slice(1));
    }
    if (!url.protocol.startsWith('http')) return '';
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sameSite(host, base) {
  return host === base || host.endsWith(`.${base}`);
}

async function getOnceHosts() {
  const { onceHosts } = await chrome.storage.session.get({ onceHosts: {} });
  return onceHosts;
}

async function allowOnce(tabId, urlString) {
  const host = bareHost(urlString);
  if (typeof tabId !== 'number' || !host) return false;
  try {
    await clearOnce(tabId);
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const next = Math.max(ONCE_RULE_BASE, ...rules.map((r) => r.id + 1));
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: next,
          priority: 200,
          action: { type: 'allow' },
          condition: { tabIds: [tabId], requestDomains: [host], resourceTypes: ['main_frame'] },
        },
        {
          id: next + 1,
          priority: 200,
          action: { type: 'allow' },
          condition: { tabIds: [tabId], initiatorDomains: [host], resourceTypes: BLOCK_RESOURCE_TYPES },
        },
      ],
    });
    const onceHosts = await getOnceHosts();
    onceHosts[tabId] = host;
    await chrome.storage.session.set({ onceHosts });
    return true;
  } catch (err) {
    // The block page stays and the button comes back: nothing is half applied.
    console.warn('ByeAI allow once', err);
    await clearOnce(tabId).catch(() => {});
    return false;
  }
}

// Session rules outlive the worker, not the browser. After a restart of the
// worker, drop rules of tabs that no longer exist.
async function pruneOnce() {
  const [rules, tabs, onceHosts] = await Promise.all([
    chrome.declarativeNetRequest.getSessionRules(),
    chrome.tabs.query({}),
    getOnceHosts(),
  ]);
  const open = new Set(tabs.map((t) => t.id));
  const removeRuleIds = rules.filter((r) => (r.condition.tabIds || []).some((id) => !open.has(id))).map((r) => r.id);
  if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  const stale = Object.keys(onceHosts).filter((id) => !open.has(Number(id)));
  if (stale.length) {
    stale.forEach((id) => delete onceHosts[id]);
    await chrome.storage.session.set({ onceHosts });
  }
}

async function clearOnce(tabId) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = rules.filter((r) => (r.condition.tabIds || []).includes(tabId)).map((r) => r.id);
  if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds });
  const onceHosts = await getOnceHosts();
  if (tabId in onceHosts) {
    delete onceHosts[tabId];
    await chrome.storage.session.set({ onceHosts });
  }
}

// Only the static rulesets block. Dynamic and session rules are allows and the AI app page.
function isStaticBlock(rule) {
  return Boolean(rule) && rule.rulesetId !== '_dynamic' && rule.rulesetId !== '_session';
}

async function syncMatchedRules() {
  if (!chrome.declarativeNetRequest.getMatchedRules) return;

  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({});
    for (const info of rulesMatchedInfo || []) {
      if (!isStaticBlock(info.rule)) continue;
      const tabId = info.request?.tabId;
      if (typeof tabId !== 'number' || tabId < 0) continue;
      const dedupeKey = `${info.request.url}|${info.rule.ruleId}`;
      await recordBlock(tabId, dedupeKey);
    }
  } catch {
    // getMatchedRules unavailable without feedback permission
  }
}

function scheduleRuleSync(tabId) {
  [400, 1200, 2500, 5000].forEach((delay) => {
    setTimeout(() => {
      syncMatchedRules().then(() => refreshTabUi(tabId));
    }, delay);
  });
}

async function getPopupState(tabId) {
  await syncMatchedRules();
  let settings = await getSettings();
  // The pause end is a point in time, not a timer: a pause that is over is lifted
  // here too, whether or not the alarm has fired yet.
  if (settings.pausedUntil && settings.pausedUntil <= Date.now()) {
    await checkPause();
    settings = await getSettings();
  }
  const stat = tabStats.get(tabId) || emptyStat();
  let hostname = '';
  let url = '';

  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab.url || '';
    if (url.startsWith('http')) {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    }
  } catch {
    // ignore
  }

  return {
    enabled: settings.enabled,
    hostname,
    url,
    pageBlocked: stat.page,
    pageByCategory: stat.cats,
    features: settings.features,
    totalBlocked: settings.totalBlocked,
    isAllowed: Boolean(hostname && settings.allowedHosts.includes(hostname)),
    isAiApp: Boolean(hostname && globalThis.byeaiIsAiApp(hostname)),
    isAllowedOnce: Boolean(hostname && (await getOnceHosts())[tabId] === hostname),
    isMediaAllowed: Boolean(hostname && settings.mediaAllowedHosts.includes(hostname)),
    allowedHosts: settings.allowedHosts,
    paused: isPaused(settings),
    pausedUntil: isPaused(settings) ? settings.pausedUntil : 0,
  };
}

async function broadcastSettingsChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

async function unforceWebModeOnAllowedGoogleTabs(allowedHosts) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || typeof tab.id !== 'number') continue;
      if (!isGoogleSearchUrl(tab.url)) continue;
      try {
        const url = new URL(tab.url);
        if (url.searchParams.get('udm') !== '14') continue;
        const hostname = url.hostname.replace(/^www\./, '');
        if (!hostnameAllowed(hostname, allowedHosts)) continue;
        url.searchParams.delete('udm');
        await chrome.tabs.update(tab.id, { url: url.toString() });
      } catch {
        // ignore individual tab errors
      }
    }
  } catch {
    // ignore
  }
}

async function toggleEnabled(enabled, pausedUntil = 0) {
  await saveSettings({ enabled, pausedUntil });
  await syncPauseAlarm(pausedUntil);
  await syncBadgeColor(pausedUntil > Date.now());
  await syncRulesetEnabled(await getSettings());
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      await refreshTabUi(tab.id);
    }
  }
  await broadcastSettingsChanged();
}

// --- Pause / snooze ---

function isPaused(settings) {
  return !settings.enabled && settings.pausedUntil > Date.now();
}

// 'hour': one hour. 'tomorrow': the start of the next day, local time. Close to
// midnight that would be a blink, so it then means the day after.
function pauseEnd(mode, now = Date.now()) {
  if (mode === 'hour') return now + HOUR_MS;
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now < 2 * HOUR_MS ? next.getTime() + 24 * HOUR_MS : next.getTime();
}

async function pauseFor(mode) {
  if (mode !== 'hour' && mode !== 'tomorrow') return;
  await toggleEnabled(false, pauseEnd(mode));
}

async function syncPauseAlarm(pausedUntil) {
  if (pausedUntil > Date.now()) await chrome.alarms.create(PAUSE_ALARM, { when: pausedUntil });
  else await chrome.alarms.clear(PAUSE_ALARM);
}

async function syncBadgeColor(paused) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: paused ? BADGE_PAUSED_COLOR : BADGE_COLOR });
  } catch {
    // ignore
  }
}

// Runs when the worker starts, on the alarm and when the pause time changes
// (also from another device). A pause that ran out while the browser was
// closed ends here.
async function checkPause() {
  const settings = await getSettings();
  if (!settings.pausedUntil) {
    await chrome.alarms.clear(PAUSE_ALARM);
    return;
  }
  if (settings.pausedUntil <= Date.now()) {
    if (!settings.enabled) await toggleEnabled(true);
    else await saveSettings({ pausedUntil: 0 });
    return;
  }
  await syncPauseAlarm(settings.pausedUntil);
  await syncBadgeColor(true);
}

async function setFeature(name, on) {
  if (!FEATURES.includes(name)) return;
  const settings = await getSettings();
  const features = { ...settings.features, [name]: Boolean(on) };
  await saveSettings({ features });
  await syncRulesetEnabled({ ...settings, features });
  await broadcastSettingsChanged();
}

async function toggleAllowSite(hostname, allow) {
  const settings = await getSettings();
  let allowedHosts = [...settings.allowedHosts];

  if (allow) {
    if (!allowedHosts.includes(hostname)) {
      // One sync item holds 8 KB. Say so instead of failing quietly.
      if (JSON.stringify([...allowedHosts, hostname]).length > HOST_LIST_BYTES) throw new Error('syncFull');
      allowedHosts.push(hostname);
    }
  } else {
    allowedHosts = allowedHosts.filter((h) => h !== hostname);
  }

  await saveSettings({ allowedHosts });
  await syncDynamicRules();

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      resetTabStat(tab.id);
      await refreshTabUi(tab.id);
    }
  }

  await broadcastSettingsChanged();

  if (allow) {
    await unforceWebModeOnAllowedGoogleTabs(allowedHosts);
  }

  return allowedHosts;
}

// "Show AI videos on this site": keeps everything else blocked.
async function toggleMediaSite(hostname, allow) {
  if (!hostname) return;
  const settings = await getSettings();
  const set = new Set(settings.mediaAllowedHosts);
  if (allow) set.add(hostname);
  else set.delete(hostname);
  if (allow && JSON.stringify([...set]).length > HOST_LIST_BYTES) throw new Error('syncFull');
  await saveSettings({ mediaAllowedHosts: [...set] });
  await broadcastSettingsChanged();
}

async function removeAllowedHost(hostname) {
  return toggleAllowSite(hostname, false);
}

// --- ByeAI Community list and hidden channels ---

async function communityWanted() {
  const s = await getSettings();
  return Boolean(s.enabled && s.features.labeled && s.communityEnabled);
}

// Keep only what we use, in the shape the content script expects.
function cleanCommunity(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.channels)) return null;
  const channels = [];
  let videoTotal = 0;
  for (const c of data.channels) {
    if (c?.p !== 'youtube') continue;
    const id = globalThis.byeaiHiddenChannels.normId(c.id);
    if (!id) continue;
    const entry = { p: 'youtube', id, n: typeof c.n === 'string' ? c.n.slice(0, 100) : '' };
    // Optional recent video ids, for Shorts tiles that have no channel link.
    if (Array.isArray(c.v)) {
      const v = [];
      for (const x of c.v) {
        if (v.length >= COMMUNITY_VIDEOS_PER_CHANNEL || videoTotal >= COMMUNITY_VIDEOS_MAX) break;
        if (typeof x === 'string' && /^[A-Za-z0-9_-]{11}$/.test(x) && !v.includes(x)) {
          v.push(x);
          videoTotal += 1;
        }
      }
      if (v.length) entry.v = v;
    }
    channels.push(entry);
    if (channels.length >= COMMUNITY_MAX) break;
  }
  return {
    version: Number.isFinite(data.version) ? data.version : 0,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    channels,
  };
}

// The list bundled with the extension, used until the first download.
async function readCommunity() {
  const { community } = await chrome.storage.local.get({ community: null });
  if (community) return community;
  let bundled = null;
  try {
    bundled = cleanCommunity(await (await fetch(chrome.runtime.getURL(COMMUNITY_FILE))).json());
  } catch {
    // ignore
  }
  const seed = { ...(bundled || { version: 0, updatedAt: '', channels: [] }), etag: '', fetchedAt: 0 };
  await chrome.storage.local.set({ community: seed });
  return seed;
}

// A plain GET: no cookies, no user data. Any error keeps the old list.
async function downloadCommunity(force) {
  if (!(await communityWanted())) return 'off';
  const current = await readCommunity();
  if (!force && Date.now() - (current.fetchedAt || 0) < COMMUNITY_FRESH_MS) return 'fresh';
  try {
    const headers = current.etag ? { 'If-None-Match': current.etag } : {};
    const res = await fetch(COMMUNITY_URL, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers,
    });
    if (res.status === 304) {
      await chrome.storage.local.set({ community: { ...current, fetchedAt: Date.now() } });
      return 'same';
    }
    if (!res.ok) return 'error';
    const list = cleanCommunity(await res.json());
    if (!list) return 'error';
    await chrome.storage.local.set({
      community: { ...list, etag: res.headers.get('ETag') || '', fetchedAt: Date.now() },
    });
    return 'updated';
  } catch {
    return 'error';
  }
}

let communityQueue = Promise.resolve();
function refreshCommunity(force = false) {
  const run = communityQueue.then(() => downloadCommunity(force));
  communityQueue = run.catch(() => {});
  return run.catch(() => 'error');
}

// Daily alarm while the list is in use. Off: no alarm, no downloads.
async function syncCommunity({ force = false } = {}) {
  if (!(await communityWanted())) {
    await chrome.alarms.clear(COMMUNITY_ALARM);
    return;
  }
  if (!(await chrome.alarms.get(COMMUNITY_ALARM))) {
    await chrome.alarms.create(COMMUNITY_ALARM, { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 });
  }
  await refreshCommunity(force);
}

// Only when you click "Suggest as AI channel" or "Not AI", or by "Help the Community
// automatically". Channel id, name and reason, nothing else.
async function suggestChannel(message) {
  const id = globalThis.byeaiHiddenChannels.normId(message.id);
  if (!id) return { ok: false };
  const day = new Date().toISOString().slice(0, 10);
  const { suggestCount } = await chrome.storage.local.get({ suggestCount: { day: '', count: 0 } });
  const count = suggestCount.day === day ? suggestCount.count : 0;
  if (count >= SUGGEST_DAILY_LIMIT) return { ok: false, limit: true };
  await chrome.storage.local.set({ suggestCount: { day, count: count + 1 } });
  const body = {
    p: 'youtube',
    id,
    n: String(message.n || '').slice(0, 100),
    why: SUGGEST_REASONS.includes(message.why) ? message.why : 'manual',
    v: chrome.runtime.getManifest().version,
  };
  try {
    const res = await fetch(SUGGEST_URL, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

// "Help the Community automatically": a YouTube watch page showed YouTube's
// own AI label. Sends the channel id and name only, and only when the
// setting is on, the channel is not in the list and was not sent lately.
async function autoShare(message, sender) {
  const s = await getSettings();
  if (!s.enabled || !s.features.labeled || !s.communityEnabled || !s.communityAutoShare) return { ok: false };
  const host = bareHost(sender?.url || sender?.tab?.url || '');
  if (!/(^|\.)youtube\.com$/.test(host)) return { ok: false };
  if (hostnameAllowed(host, s.allowedHosts) || hostnameAllowed(host, s.mediaAllowedHosts)) return { ok: false };
  const norm = globalThis.byeaiHiddenChannels.normId;
  const ids = [...new Set([message.id, ...(Array.isArray(message.ids) ? message.ids : [])].map(norm).filter(Boolean))];
  if (!ids.length) return { ok: false };

  const community = await readCommunity();
  if (community.channels.some((c) => ids.includes(c.id))) return { ok: false, listed: true };

  const result = await suggestOnce('autoShared', ids, message.n, 'labeled');
  if (result.ok) {
    const { autoSharedCount } = await chrome.storage.local.get({ autoSharedCount: 0 });
    await chrome.storage.local.set({ autoSharedCount: autoSharedCount + 1 });
  }
  return result;
}

// Sends a suggestion at most once per channel per 30 days. `key` is the
// local storage map of channel id -> last try.
async function suggestOnce(key, ids, n, why) {
  const now = Date.now();
  const { [key]: sent } = await chrome.storage.local.get({ [key]: {} });
  if (ids.some((id) => now - (sent[id] || 0) < AUTO_SHARE_MS)) return { ok: false, recent: true };

  const result = await suggestChannel({ id: ids[0], n, why });
  if (result.limit) return result;
  // Remember the try even when it failed, so a broken server is not hit on every visit.
  ids.forEach((id) => {
    sent[id] = now;
  });
  const kept = Object.entries(sent)
    .filter(([, at]) => now - at < AUTO_SHARE_MS)
    .sort((a, b) => a[1] - b[1])
    .slice(-AUTO_SHARE_MAX);
  await chrome.storage.local.set({ [key]: Object.fromEntries(kept) });
  return result;
}

// "Not AI, show this channel" on a Community cover: the channel goes on
// your own shown list. With the Community list on, one anonymous report
// (channel id, name, "not_ai") tells Lanetti to review that list entry.
async function notAi(message) {
  const entry = await showChannel(message.channel);
  if (!entry) return { ok: false };
  if (!(await communityWanted())) return { ok: false, off: true };
  const ids = [entry.id, entry.a].filter(Boolean);
  const community = await readCommunity();
  if (!community.channels.some((c) => ids.includes(c.id))) return { ok: false, listed: false };
  return suggestOnce('notAiSent', ids, entry.n, 'not_ai');
}

// One at a time, so two tabs never send the same channel twice.
let shareQueue = Promise.resolve();
function queueShare(fn) {
  const run = shareQueue.then(fn);
  shareQueue = run.catch(() => {});
  return run.catch(() => ({ ok: false }));
}

// Hidden channels: one writer, so two tabs never overwrite each other.
let hiddenQueue = Promise.resolve();
function editHidden(fn) {
  const store = globalThis.byeaiHiddenChannels;
  const run = hiddenQueue.then(async () => store.write(fn(await store.read())));
  hiddenQueue = run.catch(() => {});
  return run;
}

function hideChannel(channel) {
  const entry = globalThis.byeaiHiddenChannels.clean(channel);
  if (!entry) return Promise.resolve();
  const ids = new Set([entry.id, entry.a].filter(Boolean));
  return editHidden((list) => [...list.filter((c) => !ids.has(c.id) && !ids.has(c.a)), entry]);
}

function unhideChannel(ids) {
  const set = new Set((Array.isArray(ids) ? ids : [ids]).map(globalThis.byeaiHiddenChannels.normId).filter(Boolean));
  return editHidden((list) => list.filter((c) => !set.has(c.id) && !set.has(c.a)));
}

// Shown channels ("Not AI, show this channel"): same rules, own list.
let shownQueue = Promise.resolve();
function editShown(fn) {
  const store = globalThis.byeaiShownChannels;
  const run = shownQueue.then(async () => store.write(fn(await store.read())));
  shownQueue = run.catch(() => {});
  return run;
}

async function showChannel(channel) {
  const entry = globalThis.byeaiShownChannels.clean(channel);
  if (!entry) return null;
  const ids = new Set([entry.id, entry.a].filter(Boolean));
  await editShown((list) => [...list.filter((c) => !ids.has(c.id) && !ids.has(c.a)), entry]);
  return entry;
}

function unshowChannel(ids) {
  const set = new Set((Array.isArray(ids) ? ids : [ids]).map(globalThis.byeaiShownChannels.normId).filter(Boolean));
  return editShown((list) => list.filter((c) => !set.has(c.id) && !set.has(c.a)));
}

// --- Export / import of your settings ---

const EXPORT_FORMAT = 1;
const EXPORT_MAX_BYTES = 1024 * 1024;
const HOST_LIST_BYTES = 7000;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SWITCHES = ['enabled', 'showNotices', 'communityEnabled', 'communityAutoShare'];

// Settings only: no counters, no Community list, no history.
async function exportSettings() {
  const s = await getSettings();
  return {
    app: 'byeai',
    format: EXPORT_FORMAT,
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    // A pause is not a setting: export "on".
    switches: {
      enabled: isPaused(s) ? true : s.enabled,
      showNotices: s.showNotices,
      communityEnabled: s.communityEnabled,
      communityAutoShare: s.communityAutoShare,
      features: s.features,
    },
    allowedHosts: s.allowedHosts,
    mediaAllowedHosts: s.mediaAllowedHosts,
    hiddenChannels: await globalThis.byeaiHiddenChannels.read(),
    shownChannels: await globalThis.byeaiShownChannels.read(),
  };
}

function cleanHost(raw) {
  const host = String(raw || '').trim().toLowerCase().replace(/^www\./, '');
  return host.length <= 253 && HOST_PATTERN.test(host) ? host : '';
}

// Adds hosts to the end of `current`, as many as fit in one sync item.
function mergeHosts(current, incoming) {
  const out = [...current];
  const known = new Set(out);
  let added = 0;
  let skipped = 0;
  for (const raw of incoming) {
    const host = cleanHost(raw);
    if (!host || known.has(host) || JSON.stringify([...out, host]).length > HOST_LIST_BYTES) {
      skipped += 1;
      continue;
    }
    out.push(host);
    known.add(host);
    added += 1;
  }
  return { list: out, added, skipped };
}

// New channels go on the end. What is already there is never pushed out by an
// import: only as many new ones as the list (count and sync size) still holds.
function mergeChannels(store, current, incoming) {
  const known = new Set(current.flatMap((c) => [c.id, c.a].filter(Boolean)));
  const fresh = [];
  let skipped = 0;
  for (const raw of incoming) {
    const entry = store.clean(raw);
    const ids = entry ? [entry.id, entry.a].filter(Boolean) : [];
    if (!entry || ids.some((id) => known.has(id))) {
      skipped += 1;
      continue;
    }
    ids.forEach((id) => known.add(id));
    fresh.push(entry);
  }
  const fits = (n) => store.split([...current, ...fresh.slice(0, n)]).flat().length === current.length + n;
  let lo = 0;
  let hi = Math.min(fresh.length, Math.max(0, store.MAX - current.length));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  skipped += fresh.length - lo;
  return { list: [...current, ...fresh.slice(0, lo)], added: lo, skipped };
}

async function importSettings(data) {
  const bad = { ok: false, error: 'format' };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad;
  if (data.app !== 'byeai' || !Number.isInteger(data.format) || data.format < 1 || data.format > EXPORT_FORMAT) return bad;
  const hasList = (k) => Array.isArray(data[k]);
  const hasSwitches = data.switches && typeof data.switches === 'object' && !Array.isArray(data.switches);
  if (!['allowedHosts', 'mediaAllowedHosts', 'hiddenChannels', 'shownChannels'].some(hasList) && !hasSwitches) return bad;

  const result = { ok: true, added: 0, skipped: 0, switches: 0 };
  const settings = await getSettings();

  for (const key of ['allowedHosts', 'mediaAllowedHosts']) {
    if (!hasList(key)) continue;
    const merged = mergeHosts(settings[key], data[key].slice(0, 5000));
    result.added += merged.added;
    result.skipped += merged.skipped;
    if (merged.added) await saveSettings({ [key]: merged.list });
  }
  await syncDynamicRules();

  const lists = [
    ['hiddenChannels', globalThis.byeaiHiddenChannels, editHidden],
    ['shownChannels', globalThis.byeaiShownChannels, editShown],
  ];
  for (const [key, store, edit] of lists) {
    if (!hasList(key)) continue;
    let counts = { added: 0, skipped: 0 };
    await edit((current) => {
      counts = mergeChannels(store, current, data[key].slice(0, 5000));
      return counts.list;
    });
    result.added += counts.added;
    result.skipped += counts.skipped;
  }

  if (hasSwitches) {
    const next = {};
    for (const key of SWITCHES) {
      if (typeof data.switches[key] === 'boolean') next[key] = data.switches[key];
    }
    if (data.switches.features && typeof data.switches.features === 'object') {
      const features = { ...settings.features };
      for (const name of FEATURES) {
        if (typeof data.switches.features[name] === 'boolean') features[name] = data.switches.features[name];
      }
      next.features = features;
    }
    // A pause ends on its own; do not fight it.
    if (isPaused(settings)) delete next.enabled;
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(value) !== JSON.stringify(settings[key])) result.switches += 1;
    }
    if (Object.keys(next).length) await saveSettings(next);
  }
  return result;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COMMUNITY_ALARM) refreshCommunity();
  if (alarm.name === PAUSE_ALARM) checkPause().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  checkPause().catch(() => {});
  syncCommunity().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async (details) => {
  syncCommunity({ force: true }).catch(() => {});
  await migrateToSync();
  const settings = await getSettings();
  await syncRulesetEnabled(settings);
  await syncDynamicRules();
  await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });

  if (details.reason === 'install' && !settings.onboardingComplete) {
    await chrome.runtime.openOptionsPage();
    await saveSettings({ onboardingComplete: true });
  }
});

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (info) => {
  if (info.request.tabId < 0 || !isStaticBlock(info.rule)) return;
  const dedupeKey = `${info.request.url}|${info.rule.ruleId}`;
  await recordBlock(info.request.tabId, dedupeKey);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    getOnceHosts().then((onceHosts) => {
      const base = onceHosts[tabId];
      if (base && !sameSite(bareHost(changeInfo.url), base)) return clearOnce(tabId);
    }).catch((err) => console.warn('ByeAI allow once', err));
  }
  if (changeInfo.status !== 'loading') return;
  resetTabStat(tabId);
  refreshTabUi(tabId);
  scheduleRuleSync(tabId);
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!isGoogleSearchUrl(details.url)) return;

  const url = new URL(details.url);
  // Images, News, Shopping, Videos (tbm=...) and the other tabs (udm=2, 7, 12 ...)
  // are not AI and stay exactly as they are. AI Mode (udm=50) becomes Web.
  if (url.searchParams.has('tbm')) return;
  if (url.searchParams.has('udm') && url.searchParams.get('udm') !== '50') return;
  // The Web view also drops Google's answer boxes (calculator, converter, dictionary,
  // weather, scores). Those searches keep the normal page; its AI is hidden by the page script.
  if (!url.searchParams.has('udm') && globalThis.byeaiWantsAnswerBox(url.searchParams.get('q'))) return;

  const settings = await getSettings();
  if (!settings.enabled || !settings.features.widgets) return;

  const hostname = url.hostname.replace(/^www\./, '');
  if (hostnameAllowed(hostname, settings.allowedHosts)) return;

  url.searchParams.set('udm', '14');
  await chrome.tabs.update(details.tabId, { url: url.toString() });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStats.delete(tabId);
  clearOnce(tabId).catch(() => {});
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await refreshTabUi(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case 'GET_STATE': {
        const tabId = message.tabId ?? sender.tab?.id;
        return getPopupState(tabId);
      }
      case 'SET_ENABLED':
        await toggleEnabled(message.enabled);
        return getPopupState(message.tabId);
      case 'PAUSE':
        await pauseFor(message.mode);
        return getPopupState(message.tabId);
      case 'RESUME':
        await toggleEnabled(true);
        return getPopupState(message.tabId);
      case 'EXPORT_SETTINGS':
        return exportSettings();
      case 'IMPORT_SETTINGS':
        if (JSON.stringify(message.data ?? null).length > EXPORT_MAX_BYTES) return { ok: false, error: 'format' };
        return importSettings(message.data).catch((err) => {
          console.warn('ByeAI import', err);
          return { ok: false, error: 'sync' };
        });
      case 'TOGGLE_ALLOW_SITE':
        await toggleAllowSite(message.hostname, message.allow);
        return getPopupState(message.tabId);
      case 'SET_FEATURE':
        await setFeature(message.name, message.on);
        return getPopupState(message.tabId);
      case 'TOGGLE_MEDIA_SITE':
        await toggleMediaSite(message.hostname, message.allow);
        return getPopupState(message.tabId);
      case 'REMOVE_ALLOWED_HOST':
        await removeAllowedHost(message.hostname);
        return getPopupState(message.tabId);
      case 'AI_APP_BLOCKED': {
        // The block page counts as one block.
        const tabId = sender.tab?.id;
        if (typeof tabId === 'number') await recordBlock(tabId, `aiapp:${message.url}`, 'widgets');
        return { ok: true };
      }
      case 'ALLOW_ONCE':
        return { ok: await allowOnce(sender.tab?.id, message.url) };
      case 'NOTICE_READY': {
        const tabId = sender.tab?.id;
        if (typeof tabId !== 'number' || sender.frameId !== 0) return { show: false };
        return noticeReady(tabId, bareHost(sender.url || sender.tab.url || ''));
      }
      case 'HIDE_CHANNEL':
        await hideChannel(message.channel);
        return { ok: true };
      case 'UNHIDE_CHANNEL':
        await unhideChannel(message.ids);
        return { ok: true };
      case 'SUGGEST_CHANNEL':
        return suggestChannel(message);
      case 'AUTO_SHARE_CHANNEL':
        return queueShare(() => autoShare(message, sender));
      case 'NOT_AI_CHANNEL':
        return queueShare(() => notAi(message));
      case 'UNSHOW_CHANNEL':
        await unshowChannel(message.ids);
        return { ok: true };
      case 'COSMETIC_BLOCK': {
        const tabId = sender.tab?.id;
        if (typeof tabId === 'number') {
          await recordBlock(tabId, `cosmetic:${message.key}`, message.category);
        }
        return { ok: true };
      }
      default:
        return { error: 'Unknown message type' };
    }
  };

  handler().then(sendResponse).catch((err) => sendResponse({ error: String(err) }));
  return true;
});

// Settings changed on another device (or in the options page).
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  if (changes.enabled || changes.features) await syncRulesetEnabled(await getSettings());
  if (changes.enabled || changes.features || changes.allowedHosts) await syncDynamicRules();
  if (changes.enabled || changes.features || changes.communityEnabled) await syncCommunity();
  if (changes.pausedUntil) await checkPause();
});

migrateToSync().then(getSettings).then(async (settings) => {
  await syncRulesetEnabled(settings);
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  await syncDynamicRules();
  await checkPause();
  await pruneOnce().catch((err) => console.warn('ByeAI allow once', err));
});
