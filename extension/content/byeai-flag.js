/**
 * Runs at document_start. Sets html[data-byeai-active] so the cosmetic
 * CSS knows whether the page should be hidden or revealed.
 *
 * The default is "active" (block) to avoid AI flashing visible while we
 * fetch state. The async check below relaxes it to "0" if the page is
 * allowed or the master toggle is off.
 *
 * Also handles live updates from the popup / background by listening
 * for SETTINGS_CHANGED. When the page becomes allowed, this script
 * un-hides any elements that the other content scripts already hid
 * with inline styles.
 */
(function () {
  'use strict';

  const HIDE_PROPS = ['display', 'visibility', 'pointer-events', 'height', 'overflow'];

  function setFlag(active) {
    if (!document.documentElement) return;
    document.documentElement.setAttribute('data-byeai-active', active ? '1' : '0');
  }

  function revealHidden() {
    document.querySelectorAll('[data-byeai-hidden]').forEach((el) => {
      HIDE_PROPS.forEach((p) => el.style.removeProperty(p));
      delete el.dataset.byeaiHidden;
    });
  }

  // Pessimistic default before async state arrives.
  setFlag(true);

  async function refresh() {
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      const active = Boolean(state?.enabled && !state?.isAllowed);
      setFlag(active);
      if (!active) revealHidden();
    } catch (_) {
      // If messaging fails, keep blocking.
    }
  }

  refresh();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SETTINGS_CHANGED') {
      refresh();
    }
  });
})();
