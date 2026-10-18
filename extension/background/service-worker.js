const RULESET_ID = 'core_network';
const GOOGLE_RULESET_ID = 'google_search';
const SEARCH_AI_RULESET_ID = 'search_ai';
const ENABLED_RULESETS = [RULESET_ID, GOOGLE_RULESET_ID, SEARCH_AI_RULESET_ID];
const WHITELIST_RULE_BASE = 9000000;
const BLOCK_RESOURCE_TYPES = ['script', 'sub_frame', 'xmlhttprequest', 'websocket', 'other'];

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
  return { page: 0, seen: new Set(), cats: { widgets: 0, buttons: 0, labeled: 0 } };
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

async function syncWhitelistRules(allowedHosts) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .filter((rule) => rule.id >= WHITELIST_RULE_BASE && rule.id < WHITELIST_RULE_BASE + 1000000)
    .map((rule) => rule.id);

  const addRules = allowedHosts.map((host) => ({
    id: hostToRuleId(host),
    priority: 100,
    action: { type: 'allow' },
    condition: {
      initiatorDomains: [host],
      resourceTypes: BLOCK_RESOURCE_TYPES,
    },
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
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
}

async function syncMatchedRules() {
  if (!chrome.declarativeNetRequest.getMatchedRules) return;

  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({});
    for (const info of rulesMatchedInfo || []) {
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
  await syncWhitelistRules(allowedHosts);

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

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateToSync();
  const settings = await getSettings();
  await syncRulesetEnabled(settings);
  await syncWhitelistRules(settings.allowedHosts);
  await chrome.action.setBadgeBackgroundColor({ color: '#0f766e' });

  if (details.reason === 'install' && !settings.onboardingComplete) {
    await chrome.runtime.openOptionsPage();
    await saveSettings({ onboardingComplete: true });
  }
});

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (info) => {
  if (info.request.tabId < 0) return;
  const dedupeKey = `${info.request.url}|${info.rule.ruleId}`;
  await recordBlock(info.request.tabId, dedupeKey);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
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
  if (changes.allowedHosts) await syncWhitelistRules(changes.allowedHosts.newValue || []);
});

migrateToSync().then(getSettings).then(async (settings) => {
  await syncRulesetEnabled(settings);
  chrome.action.setBadgeBackgroundColor({ color: '#0f766e' }).catch(() => {});
  await syncWhitelistRules(settings.allowedHosts);
});
