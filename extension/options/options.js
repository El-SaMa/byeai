const allowedList = document.getElementById('allowedList');
const emptyAllowed = document.getElementById('emptyAllowed');
const totalBlockedEl = document.getElementById('totalBlocked');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const privacyLink = document.getElementById('privacyLink');

privacyLink.href = chrome.runtime.getURL('privacy/privacy.html');

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
    btn.textContent = 'Block again';
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
  if (!confirm('Reset the total blocked counter to zero?')) return;
  await chrome.storage.local.set({ totalBlocked: 0 });
  load();
});

load();
