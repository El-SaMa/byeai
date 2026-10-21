const allowedList = document.getElementById('allowedList');
const emptyAllowed = document.getElementById('emptyAllowed');
const totalBlockedEl = document.getElementById('totalBlocked');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const privacyLink = document.getElementById('privacyLink');
const footerVersion = document.getElementById('footerVersion');
const showNotices = document.getElementById('showNotices');
const hiddenList = document.getElementById('hiddenList');
const emptyHidden = document.getElementById('emptyHidden');
const communityEnabled = document.getElementById('communityEnabled');
const hiddenStore = window.byeaiHiddenChannels;

const t = (key, args) =>
  (window.byeaiI18n && window.byeaiI18n.msg(key, args)) || '';

privacyLink.href = chrome.runtime.getURL('privacy/privacy.html');

try {
  const version = chrome.runtime.getManifest().version;
  footerVersion.textContent = t('optionsFooterVersion', [version]) || `ByeAI v${version}`;
} catch (_) {
  // ignore
}

function addRow(host, note, buttonText, onClick, list = allowedList) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = host;
  if (note) {
    const small = document.createElement('small');
    small.className = 'muted';
    small.textContent = ` · ${note}`;
    span.appendChild(small);
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = buttonText;
  btn.addEventListener('click', async () => {
    await onClick();
    load();
  });

  li.appendChild(span);
  li.appendChild(btn);
  list.appendChild(li);
}

async function load() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get({
      allowedHosts: [],
      mediaAllowedHosts: [],
      showNotices: true,
      communityEnabled: true,
      ...Object.fromEntries(hiddenStore.KEYS.map((k) => [k, []])),
    }),
    chrome.storage.local.get({ totalBlocked: 0 }),
  ]);

  totalBlockedEl.textContent = String(local.totalBlocked);
  showNotices.checked = synced.showNotices !== false;
  communityEnabled.checked = synced.communityEnabled !== false;
  allowedList.innerHTML = '';
  hiddenList.innerHTML = '';

  const empty = !synced.allowedHosts.length && !synced.mediaAllowedHosts.length;
  emptyAllowed.classList.toggle('hidden', !empty);

  synced.allowedHosts.forEach((host) => {
    addRow(host, '', t('optionsAllowedBlockBtn') || 'Block again', () =>
      chrome.runtime.sendMessage({ type: 'REMOVE_ALLOWED_HOST', hostname: host })
    );
  });

  synced.mediaAllowedHosts.forEach((host) => {
    addRow(host, t('optionsMediaAllowedNote') || 'AI videos shown', t('optionsMediaBlurBtn') || 'Blur again', () =>
      chrome.runtime.sendMessage({ type: 'TOGGLE_MEDIA_SITE', hostname: host, allow: false })
    );
  });

  // Newest first.
  const hidden = hiddenStore.join(synced).reverse();
  emptyHidden.classList.toggle('hidden', hidden.length > 0);
  hidden.forEach((channel) => {
    const note = channel.n !== channel.id ? channel.id : '';
    addRow(
      channel.n,
      note,
      t('optionsUnhideBtn') || 'Unhide',
      () => chrome.runtime.sendMessage({ type: 'UNHIDE_CHANNEL', ids: [channel.id, channel.a].filter(Boolean) }),
      hiddenList
    );
  });
}

// Lists can change from another device.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const keys = Object.keys(changes);
  if (keys.some((k) => hiddenStore.isKey(k) || ['allowedHosts', 'mediaAllowedHosts', 'showNotices', 'communityEnabled'].includes(k))) load();
});

showNotices.addEventListener('change', () => {
  chrome.storage.sync.set({ showNotices: showNotices.checked });
});

communityEnabled.addEventListener('change', () => {
  chrome.storage.sync.set({ communityEnabled: communityEnabled.checked });
});

resetStatsBtn.addEventListener('click', async () => {
  const message = t('optionsStatsResetConfirm') || 'Reset the total blocked counter to zero?';
  if (!confirm(message)) return;
  await chrome.storage.local.set({ totalBlocked: 0 });
  load();
});

load();
