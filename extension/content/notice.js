/**
 * "ByeAI blocked AI on this page": a small note in the bottom corner, the
 * first time ByeAI blocks something on a site. The service worker decides
 * when (once per site, setting on, site not allowed). This only draws it.
 *
 * It lives in a closed shadow root on its own element under <html>, so the
 * page's CSS and scripts cannot reach it and it cannot touch the page.
 */
(function () {
  'use strict';

  if (window.top !== window) return;

  const host = location.hostname.replace(/^www\./, '');
  const SHOW_MS = 6000;
  let shown = false;

  const msg = (key, fallback) => {
    try {
      return chrome.i18n.getMessage(key) || fallback;
    } catch (_) {
      return fallback;
    }
  };

  const STYLE = `
    :host { all: initial; }
    .toast {
      --bg: #ffffff; --text: #1f2937; --muted: #4b5563; --border: #d1d5db;
      --link: #0f766e; --focus: #0f766e;
      position: fixed; bottom: 16px; inset-inline-end: 16px; z-index: 2147483647;
      display: flex; align-items: center; gap: 10px;
      max-width: min(360px, calc(100vw - 32px)); padding-block: 10px; padding-inline: 12px 8px;
      font: 14px/1.4 "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--text);
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
      opacity: 1; transition: opacity 0.3s ease, transform 0.3s ease;
    }
    .toast.hiding { opacity: 0; transform: translateY(6px); }
    @media (prefers-color-scheme: dark) {
      .toast { --bg: #1f2937; --text: #f3f4f6; --muted: #cbd5e1; --border: #374151; --link: #5eead4; --focus: #5eead4; }
    }
    @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
    img { width: 24px; height: 24px; flex: none; border-radius: 6px; }
    .text { flex: 1; min-width: 0; }
    button {
      font: inherit; color: var(--link); background: none; border: 0; border-radius: 6px;
      padding: 4px 6px; cursor: pointer; font-weight: 600; flex: none;
    }
    button:hover { text-decoration: underline; }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .close { color: var(--muted); font-size: 18px; line-height: 1; padding: 4px 8px; font-weight: 400; }
    .close:hover { text-decoration: none; color: var(--text); }
  `;

  function show() {
    if (shown) return;
    shown = true;

    const el = document.createElement('byeai-notice');
    const root = el.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    const box = document.createElement('div');
    box.className = 'toast';
    box.setAttribute('role', 'status');
    box.dir = msg('@@bidi_dir', 'ltr');
    box.lang = msg('@@ui_locale', 'en').replace('_', '-');

    const icon = document.createElement('img');
    icon.alt = '';
    icon.src = chrome.runtime.getURL('assets/icons/icon48.png');
    icon.addEventListener('error', () => icon.remove());

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = msg('noticeBlocked', 'ByeAI blocked AI on this page');

    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = msg('noticeAllow', 'Allow');
    action.setAttribute('aria-label', msg('popupAllowOn', 'Allow AI on this site'));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', msg('noticeClose', 'Close'));

    box.append(icon, text, action, close);
    root.append(style, box);
    document.documentElement.appendChild(el);

    let timer = null;
    let sticky = false;
    const remove = () => {
      clearTimeout(timer);
      box.classList.add('hiding');
      setTimeout(() => el.remove(), 300);
    };
    const start = () => {
      clearTimeout(timer);
      if (!sticky) timer = setTimeout(remove, SHOW_MS);
    };
    const pause = () => clearTimeout(timer);

    // Stays while you point at it or tab into it.
    box.addEventListener('mouseenter', pause);
    box.addEventListener('mouseleave', start);
    box.addEventListener('focusin', pause);
    box.addEventListener('focusout', start);
    close.addEventListener('click', remove);

    action.addEventListener('click', async () => {
      if (action.dataset.step === 'reload') {
        location.reload();
        return;
      }
      sticky = true;
      pause();
      await chrome.runtime.sendMessage({ type: 'TOGGLE_ALLOW_SITE', hostname: host, allow: true }).catch(() => {});
      text.textContent = msg('noticeAllowed', 'AI allowed on this site.');
      action.textContent = msg('noticeReload', 'Reload');
      action.removeAttribute('aria-label');
      action.dataset.step = 'reload';
      action.focus();
    });

    start();
  }

  function showWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', show, { once: true });
    } else {
      show();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SHOW_NOTICE' || message.host !== host) return;
    showWhenReady();
    sendResponse({ shown: true });
  });

  // Blocks can happen before this script listens. Ask once the page is parsed.
  const ask = () => {
    if (shown) return;
    chrome.runtime
      .sendMessage({ type: 'NOTICE_READY' })
      .then((reply) => {
        if (reply?.show) show();
      })
      .catch(() => {});
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ask, { once: true });
  } else {
    ask();
  }
})();
