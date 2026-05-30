const RULESET_ID = 'core_network';
const GOOGLE_RULESET_ID = 'google_search';
const SEARCH_AI_RULESET_ID = 'search_ai';
const ENABLED_RULESETS = [RULESET_ID, GOOGLE_RULESET_ID, SEARCH_AI_RULESET_ID];
const WHITELIST_RULE_BASE = 9000000;
const BLOCK_RESOURCE_TYPES = ['script', 'sub_frame', 'xmlhttprequest', 'websocket', 'other'];

/** @type {Map<number, { page: number, seen: Set<string> }>} */
const tabStats = new Map();

const DEFAULTS = {
  enabled: true,
  totalBlocked: 0,
  allowedHosts: [],
  onboardingComplete: false,
};

async function getSettings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...data };
}

async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
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
    tabStats.set(tabId, { page: 0, seen: new Set() });
  }
  return tabStats.get(tabId);
}

function resetTabStat(tabId) {
  tabStats.set(tabId, { page: 0, seen: new Set() });
}

async function syncRulesetEnabled(enabled) {
  if (enabled) {
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

  let title = t('actionTitle') || 'ByeAI';

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
}

async function recordBlock(tabId, dedupeKey) {
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
  const totalBlocked = settings.totalBlocked + 1;
  await saveSettings({ totalBlocked });

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
  const stat = tabStats.get(tabId) || { page: 0, seen: new Set() };
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
    totalBlocked: settings.totalBlocked,
    isAllowed: Boolean(hostname && settings.allowedHosts.includes(hostname)),
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
  await syncRulesetEnabled(enabled);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      await refreshTabUi(tab.id);
    }
  }
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

async function removeAllowedHost(hostname) {
  return toggleAllowSite(hostname, false);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await getSettings();
  await syncRulesetEnabled(settings.enabled);
  await syncWhitelistRules(settings.allowedHosts);

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
  if (!settings.enabled) return;

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
      case 'REMOVE_ALLOWED_HOST':
        await removeAllowedHost(message.hostname);
        return getPopupState(message.tabId);
      case 'COSMETIC_BLOCK': {
        const tabId = sender.tab?.id;
        if (typeof tabId === 'number') {
          await recordBlock(tabId, `cosmetic:${message.key}`);
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

getSettings().then(async (settings) => {
  await syncRulesetEnabled(settings.enabled);
  await syncWhitelistRules(settings.allowedHosts);
});
