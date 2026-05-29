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

let activeTabId = null;
let state = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function renderStatusPill(state) {
  statusPill.classList.remove('is-off', 'is-allowed');

  if (!state.enabled) {
    statusPill.textContent = 'Off';
    statusPill.classList.add('is-off');
  } else if (state.isAllowed) {
    statusPill.textContent = 'Allowed';
    statusPill.classList.add('is-allowed');
  } else {
    statusPill.textContent = 'Protected';
  }
}

function render(state) {
  const hasSite = Boolean(state.hostname);
  siteNameEl.textContent = hasSite ? state.hostname : 'This page';
  enabledToggle.checked = state.enabled;
  pageCountEl.textContent = String(state.pageBlocked);
  totalCountEl.textContent = String(state.totalBlocked);
  renderStatusPill(state);

  if (state.isAllowed) {
    allowedNote.classList.remove('hidden');
    allowBtnText.textContent = 'Block AI on this site again';
  } else {
    allowedNote.classList.add('hidden');
    allowBtnText.textContent = 'Allow AI on this site';
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

refresh();
