importScripts('../shared/ai-apps.js', '../shared/hidden-channels.js');

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
// A bit under a day, so the daily alarm never finds the list "still fresh".
const COMMUNITY_FRESH_MS = 23 * 60 * 60 * 1000;
const SUGGEST_DAILY_LIMIT = 20;
const SUGGEST_REASONS = ['labeled', 'tagged', 'manual'];

const CATEGORIES = ['widgets', 'buttons', 'labeled'];
// Switches in the popup. Counts still use the finer CATEGORIES.
const FEATURES = ['widgets', 'labeled'];
const FEATURE_DEFAULTS = { widgets: true, labeled: true };

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

function hostToRuleId(hostname) {
  let hash = 0;
  for (let i = 0; i < hostname.length; i += 1) {
    hash = (hash * 31 + hostname.charCodeAt(i)) >>> 0;
  }
  return WHITELIST_RULE_BASE + (hash % 900000);
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

const GOOGLE_HOST = /^(\w+\.)?google\.[\w.]+$/;

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

  const addRules = settings.allowedHosts.map((host) => ({
    id: hostToRuleId(host),
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

async function updateActionTitle(tabId, hostname, pageCount, enabled, isAllowed) {
  const t = (key, args) => {
    try {
      return chrome.i18n.getMessage(key, args || []) || '';
    } catch (_) {
      return '';
    }
  };

  let title;

  if (!enabled) {
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
  await updateActionTitle(tabId, hostname, stat.page, settings.enabled, isAllowed);
  await updateBadge(tabId, settings.enabled && !isAllowed ? stat.page : 0);
}

async function updateBadge(tabId, count) {
  try {
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
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
  const settings = await getSettings();
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

async function toggleEnabled(enabled) {
  await saveSettings({ enabled });
  await syncRulesetEnabled(await getSettings());
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      await refreshTabUi(tab.id);
    }
  }
  await broadcastSettingsChanged();
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
  for (const c of data.channels) {
    if (c?.p !== 'youtube') continue;
    const id = globalThis.byeaiHiddenChannels.normId(c.id);
    if (!id) continue;
    channels.push({ p: 'youtube', id, n: typeof c.n === 'string' ? c.n.slice(0, 100) : '' });
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

// Only when you click "Suggest as AI channel". Channel id, name and reason, nothing else.
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COMMUNITY_ALARM) refreshCommunity();
});

chrome.runtime.onStartup.addListener(() => {
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
      if (base && !sameSite(bareHost(changeInfo.url), base)) clearOnce(tabId);
    });
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
  if (url.searchParams.has('udm')) return;

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
});

migrateToSync().then(getSettings).then(async (settings) => {
  await syncRulesetEnabled(settings);
  chrome.action.setBadgeBackgroundColor({ color: '#0f766e' }).catch(() => {});
  await syncDynamicRules();
});
