const allowedList = document.getElementById('allowedList');
const emptyAllowed = document.getElementById('emptyAllowed');
const totalBlockedEl = document.getElementById('totalBlocked');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const privacyLink = document.getElementById('privacyLink');
const footerVersion = document.getElementById('footerVersion');

const t = (key, args) =>
  (window.byeaiI18n && window.byeaiI18n.msg(key, args)) || '';

privacyLink.href = chrome.runtime.getURL('privacy/privacy.html');

try {
  const version = chrome.runtime.getManifest().version;
  footerVersion.textContent = t('optionsFooterVersion', [version]) || `ByeAI v${version}`;
} catch (_) {
  // ignore
}

async function load() {
  const data = await chrome.storage.local.get({
    allowedHosts: [],
    totalBlocked: 0,
  });

  totalBlockedEl.textContent = String(data.totalBlocked);
  allowedList.innerHTML = '';

  if (!data.allowedHosts.length) {
    emptyAllowed.classList.remove('hidden');
    return;
  }

  emptyAllowed.classList.add('hidden');

  data.allowedHosts.forEach((host) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = host;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = t('optionsAllowedBlockBtn') || 'Block again';
    btn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'REMOVE_ALLOWED_HOST',
        hostname: host,
      });
      load();
    });

    li.appendChild(span);
    li.appendChild(btn);
    allowedList.appendChild(li);
  });
}

resetStatsBtn.addEventListener('click', async () => {
  const message = t('optionsStatsResetConfirm') || 'Reset the total blocked counter to zero?';
  if (!confirm(message)) return;
  await chrome.storage.local.set({ totalBlocked: 0 });
  load();
});

load();
