const siteNameEl = document.getElementById('siteName');
const statusPill = document.getElementById('statusPill');
const enabledToggle = document.getElementById('enabledToggle');
const pageCountEl = document.getElementById('pageCount');
const totalCountEl = document.getElementById('totalCount');
const allowBtn = document.getElementById('allowBtn');
const allowBtnText = document.getElementById('allowBtnText');
const allowedNote = document.getElementById('allowedNote');
const tipBanner = document.getElementById('tipBanner');
const reloadBanner = document.getElementById('reloadBanner');
const dismissTip = document.getElementById('dismissTip');
const dismissReload = document.getElementById('dismissReload');
const reloadBtn = document.getElementById('reloadBtn');
const tooltip = document.getElementById('tooltip');
const settingsBtn = document.getElementById('settingsBtn');
const helpBtn = document.getElementById('helpBtn');
const privacyLink = document.getElementById('privacyLink');
const footerVersion = document.getElementById('footerVersion');
const reportLink = document.getElementById('reportLink');
const featureCard = document.querySelector('.feature-card');
const featureRows = document.querySelectorAll('.feature');
const mediaSiteBtn = document.getElementById('mediaSiteBtn');

const REPORT_URL = 'https://github.com/El-SaMa/byeai/issues/new';

const t = (key, args) =>
  (window.byeaiI18n && window.byeaiI18n.msg(key, args)) || '';

let activeTabId = null;
let state = null;

function setVersionLabel() {
  try {
    const version = chrome.runtime.getManifest().version;
    if (footerVersion) footerVersion.textContent = `v${version}`;
  } catch (_) {
    // ignore
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderStatusPill(state) {
  statusPill.classList.remove('is-off', 'is-allowed');

  if (!state.enabled) {
    statusPill.textContent = t('popupStatusOff') || 'Off';
    statusPill.classList.add('is-off');
  } else if (state.isAllowed) {
    statusPill.textContent = t('popupStatusAllowed') || 'Allowed';
    statusPill.classList.add('is-allowed');
  } else {
    statusPill.textContent = t('popupStatusProtected') || 'Protected';
  }
}

function render(state) {
  const hasSite = Boolean(state.hostname);
  siteNameEl.textContent = hasSite
    ? state.hostname
    : t('popupSiteFallback') || 'This page';
  enabledToggle.checked = state.enabled;
  pageCountEl.textContent = String(state.pageBlocked);
  totalCountEl.textContent = String(state.totalBlocked);
  renderStatusPill(state);
  renderFeatures(state);

  if (state.isAllowed) {
    allowedNote.classList.remove('hidden');
    allowBtnText.textContent = t('popupAllowOff') || 'Block AI on this site again';
  } else {
    allowedNote.classList.add('hidden');
    allowBtnText.textContent = t('popupAllowOn') || 'Allow AI on this site';
  }

  if (!hasSite || !state.url.startsWith('http')) {
    document.body.classList.add('unavailable');
    allowBtn.disabled = true;
  } else {
    document.body.classList.remove('unavailable');
    allowBtn.disabled = false;
  }

  chrome.storage.local.get({ tipDismissed: false }).then(({ tipDismissed }) => {
    if (!tipDismissed && state.enabled && !state.isAllowed && state.pageBlocked === 0) {
      tipBanner.classList.remove('hidden');
    } else {
      tipBanner.classList.add('hidden');
    }
  });
}

function renderFeatures(state) {
  const features = state.features || {};
  const counts = state.pageByCategory || {};
  featureCard.classList.toggle('features-paused', !state.enabled || state.isAllowed);

  featureRows.forEach((row) => {
    const name = row.dataset.feature;
    row.querySelector('input').checked = Boolean(features[name]);
    const count = row.querySelector('.feature-count');
    // The assistants row also covers hidden AI buttons.
    const n = (counts[name] || 0) + (name === 'widgets' ? counts.buttons || 0 : 0);
    count.textContent = String(n);
    count.hidden = n === 0;
  });

  // Only offered where it matters: AI media was blurred here, or the site is already an exception.
  const showLink =
    state.enabled && !state.isAllowed && state.hostname && features.labeled &&
    (state.isMediaAllowed || (counts.labeled || 0) > 0);
  mediaSiteBtn.hidden = !showLink;
  mediaSiteBtn.textContent = state.isMediaAllowed
    ? t('popupMediaBlur', [state.hostname]) || `Blur AI videos on ${state.hostname} again`
    : t('popupMediaShow', [state.hostname]) || `Show AI videos on ${state.hostname}`;
}

async function refresh() {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  state = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: activeTabId });
  if (state?.error) return;
  render(state);
}

enabledToggle.addEventListener('change', async () => {
  state = await chrome.runtime.sendMessage({
    type: 'SET_ENABLED',
    enabled: enabledToggle.checked,
    tabId: activeTabId,
  });
  render(state);
});

allowBtn.addEventListener('click', async () => {
  if (!state?.hostname) return;

  const allow = !state.isAllowed;
  state = await chrome.runtime.sendMessage({
    type: 'TOGGLE_ALLOW_SITE',
    hostname: state.hostname,
    allow,
    tabId: activeTabId,
  });
  render(state);

  if (allow) {
    reloadBanner.classList.remove('hidden');
  } else {
    reloadBanner.classList.add('hidden');
  }
});

featureRows.forEach((row) => {
  row.querySelector('input').addEventListener('change', async (event) => {
    state = await chrome.runtime.sendMessage({
      type: 'SET_FEATURE',
      name: row.dataset.feature,
      on: event.target.checked,
      tabId: activeTabId,
    });
    render(state);
  });
});

mediaSiteBtn.addEventListener('click', async () => {
  if (!state?.hostname) return;
  state = await chrome.runtime.sendMessage({
    type: 'TOGGLE_MEDIA_SITE',
    hostname: state.hostname,
    allow: !state.isMediaAllowed,
    tabId: activeTabId,
  });
  render(state);
});

// Only opens a prefilled GitHub issue. Nothing is sent unless you submit it.
reportLink.addEventListener('click', (event) => {
  event.preventDefault();
  // Origin and path only: query strings can carry tokens and issues are public.
  let where = '';
  try {
    const page = new URL(state?.url || '');
    if (page.protocol.startsWith('http')) where = `${page.origin}${page.pathname}`;
  } catch (_) {
    // not a web page
  }
  const url = new URL(REPORT_URL);
  // Prefills the "Missed AI" issue form (.github/ISSUE_TEMPLATE/missed-ai.yml).
  url.searchParams.set('template', 'missed-ai.yml');
  url.searchParams.set('title', `Missed AI on ${state?.hostname || 'a site'}`);
  url.searchParams.set('page', where);
  url.searchParams.set('version', chrome.runtime.getManifest().version);
  chrome.tabs.create({ url: url.toString() });
});

reloadBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (tab?.id) chrome.tabs.reload(tab.id);
  reloadBanner.classList.add('hidden');
});

dismissReload.addEventListener('click', () => {
  reloadBanner.classList.add('hidden');
});

dismissTip.addEventListener('click', () => {
  tipBanner.classList.add('hidden');
  chrome.storage.local.set({ tipDismissed: true });
});

settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
helpBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

privacyLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('privacy/privacy.html') });
});

document.querySelectorAll('.tip-btn').forEach((btn) => {
  const show = () => {
    const text = btn.dataset.tip;
    if (!text) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    const rect = btn.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, rect.left - 70)}px`;
    tooltip.style.top = `${rect.bottom + 8}px`;
  };

  btn.addEventListener('mouseenter', show);
  btn.addEventListener('focus', show);
  btn.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
  });
  btn.addEventListener('blur', () => {
    tooltip.hidden = true;
  });
});

setVersionLabel();
refresh();
