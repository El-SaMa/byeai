/**
 * Runs at document_start. Works out what ByeAI should block on this page
 * and exposes it to the other content scripts as globalThis.byeai.
 *
 * Flags on <html>:
 *   data-byeai-active   widgets + search AI (used by the cosmetic CSS)
 *   data-byeai-buttons  AI buttons inside apps (same switch as widgets)
 *   data-byeai-labeled  AI videos and images (site labels + AI hashtags)
 *
 * Defaults are pessimistic so AI does not flash in while storage loads.
 * State is read straight from chrome.storage and kept live with
 * storage.onChanged, so toggles apply without a reload.
 */
(function () {
  'use strict';

  const FEATURE_DEFAULTS = { widgets: true, labeled: true };
  const HIDE_PROPS = ['display', 'visibility', 'pointer-events', 'height', 'overflow'];
  const host = location.hostname.replace(/^www\./, '');
  const listeners = [];

  const state = { ready: false, widgets: true, buttons: true, labeled: true };

  function setFlags() {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-byeai-active', state.widgets ? '1' : '0');
    root.setAttribute('data-byeai-buttons', state.buttons ? '1' : '0');
    root.setAttribute('data-byeai-labeled', state.labeled ? '1' : '0');
  }

  // Undo inline hiding for any category that is no longer active.
  function revealInactive() {
    document.querySelectorAll('[data-byeai-hidden]').forEach((el) => {
      const category = el.dataset.byeaiHidden === 'buttons' ? 'buttons' : 'widgets';
      if (state[category]) return;
      HIDE_PROPS.forEach((p) => el.style.removeProperty(p));
      delete el.dataset.byeaiHidden;
    });
  }

  function apply(data) {
    const features = { ...FEATURE_DEFAULTS, ...(data.features || {}) };
    const allowed = (data.allowedHosts || []).includes(host);
    const on = Boolean(data.enabled) && !allowed;

    state.widgets = on && features.widgets;
    // One "AI assistants" switch covers widgets, search AI and AI buttons.
    state.buttons = on && features.widgets;
    state.labeled = on && features.labeled;
    state.ready = true;

    setFlags();
    revealInactive();
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (_) {
        // one bad listener should not stop the others
      }
    });
  }

  function load() {
    chrome.storage.local
      .get({ enabled: true, allowedHosts: [], features: FEATURE_DEFAULTS })
      .then(apply)
      .catch(() => {});
  }

  globalThis.byeai = {
    host,
    state,
    onChange(fn) {
      listeners.push(fn);
      if (state.ready) fn(state);
    },
    report(category, key) {
      chrome.runtime.sendMessage({ type: 'COSMETIC_BLOCK', category, key }).catch(() => {});
    },
  };

  setFlags();
  load();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled || changes.allowedHosts || changes.features) load();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SETTINGS_CHANGED') load();
  });
})();
