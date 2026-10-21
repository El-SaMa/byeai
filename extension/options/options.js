const allowedList = document.getElementById('allowedList');
const emptyAllowed = document.getElementById('emptyAllowed');
const totalBlockedEl = document.getElementById('totalBlocked');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const privacyLink = document.getElementById('privacyLink');
const footerVersion = document.getElementById('footerVersion');
const showNotices = document.getElementById('showNotices');

const t = (key, args) =>
  (window.byeaiI18n && window.byeaiI18n.msg(key, args)) || '';

privacyLink.href = chrome.runtime.getURL('privacy/privacy.html');

try {
  const version = chrome.runtime.getManifest().version;
  footerVersion.textContent = t('optionsFooterVersion', [version]) || `ByeAI v${version}`;
} catch (_) {
  // ignore
}

function addRow(host, note, buttonText, onClick) {
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
  allowedList.appendChild(li);
}

async function load() {
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get({ allowedHosts: [], mediaAllowedHosts: [], showNotices: true }),
    chrome.storage.local.get({ totalBlocked: 0 }),
  ]);

  totalBlockedEl.textContent = String(local.totalBlocked);
  showNotices.checked = synced.showNotices !== false;
  allowedList.innerHTML = '';

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
}

// Lists can change from another device.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.allowedHosts || changes.mediaAllowedHosts || changes.showNotices)) load();
});

showNotices.addEventListener('change', () => {
  chrome.storage.sync.set({ showNotices: showNotices.checked });
});

resetStatsBtn.addEventListener('click', async () => {
  const message = t('optionsStatsResetConfirm') || 'Reset the total blocked counter to zero?';
  if (!confirm(message)) return;
  await chrome.storage.local.set({ totalBlocked: 0 });
  load();
});

load();
