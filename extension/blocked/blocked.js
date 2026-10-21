// Shown instead of an AI app (chatgpt.com and friends). The service worker
// redirects here with the original address after the #.
const t = (key, args) => (window.byeaiI18n && window.byeaiI18n.msg(key, args)) || '';

const target = location.hash.slice(1);
let host = '';
try {
  const url = new URL(target);
  if (url.protocol === 'https:' || url.protocol === 'http:') host = url.hostname.replace(/^www\./, '');
} catch (_) {
  // no address
}

const titleEl = document.getElementById('title');
const allowSite = document.getElementById('allowSite');
const allowOnce = document.getElementById('allowOnce');
const goBack = document.getElementById('goBack');

function renderTitle() {
  const text = host ? t('blockedPageTitle', [host]) || `ByeAI blocked ${host}` : 'ByeAI';
  titleEl.textContent = text;
  document.title = text;
}

function busy(on) {
  allowSite.disabled = on;
  allowOnce.disabled = on;
}

if (!host) {
  allowSite.hidden = true;
  allowOnce.hidden = true;
} else {
  chrome.runtime.sendMessage({ type: 'AI_APP_BLOCKED', url: target }).catch(() => {});
}

allowSite.addEventListener('click', async () => {
  busy(true);
  await chrome.runtime.sendMessage({ type: 'TOGGLE_ALLOW_SITE', hostname: host, allow: true });
  location.replace(target);
});

allowOnce.addEventListener('click', async () => {
  busy(true);
  const reply = await chrome.runtime.sendMessage({ type: 'ALLOW_ONCE', url: target });
  if (reply?.ok) location.replace(target);
  else busy(false);
});

goBack.addEventListener('click', async () => {
  if (history.length > 1) {
    history.back();
    return;
  }
  // Opened straight into the AI app: nothing to go back to.
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
});

// i18n.js fills data-i18n on DOMContentLoaded. The title needs the host.
renderTitle();
allowSite.focus();
