/**
 * Tiny i18n helper for ByeAI HTML pages.
 *
 * Use:
 *   <span data-i18n="messageKey">fallback</span>
 *   <button data-i18n-attr="title:keyA,aria-label:keyB" title="..." aria-label="...">…</button>
 *
 * Then call applyI18n() once after DOM is ready (or it auto-runs at DOMContentLoaded).
 *
 * For dynamic strings, use:  msg('messageKey')  /  msg('messageKey', [arg1, arg2])
 *
 * Also sets <html lang="..."> to chrome.i18n.getUILanguage() so screen readers and
 * lang-aware CSS can react.
 */
(function () {
  'use strict';

  function get(key, args) {
    if (!key) return '';
    try {
      const v = chrome.i18n.getMessage(key, args || []);
      return v || '';
    } catch (_) {
      return '';
    }
  }

  function applyI18n(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      const msg = get(key);
      if (!msg) return;
      // Allow simple safe HTML in messages with keys ending in "Html"
      if (key.endsWith('Html')) {
        el.innerHTML = msg;
      } else {
        el.textContent = msg;
      }
    });

    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const spec = el.dataset.i18nAttr;
      if (!spec) return;
      spec.split(',').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        const msg = get(key);
        if (msg) el.setAttribute(attr, msg);
      });
    });

    if (scope === document) {
      try {
        document.documentElement.lang = chrome.i18n.getUILanguage();
      } catch (_) {
        // ignore
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyI18n());
  } else {
    applyI18n();
  }

  // Expose for dynamic translation in popup.js / options.js.
  window.byeaiI18n = { apply: applyI18n, msg: get };
})();
