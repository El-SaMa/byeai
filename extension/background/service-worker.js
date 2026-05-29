const RULESET_ID = 'core_network';
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
      enableRulesetIds: [RULESET_ID],
      disableRulesetIds: [],
    });
  } else {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [],
      disableRulesetIds: [RULESET_ID],
    });
  }
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
  let title = 'ByeAI';

  if (!enabled) {
    title = 'ByeAI is off';
  } else if (isAllowed) {
    title = `ByeAI: AI allowed on ${hostname}`;
  } else if (pageCount > 0) {
    title = `ByeAI: ${pageCount} blocked on this page`;
  } else {
    title = 'ByeAI: nothing blocked here';
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

async function toggleEnabled(enabled) {
  await saveSettings({ enabled });
  await syncRulesetEnabled(enabled);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      await refreshTabUi(tab.id);
    }
  }
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
