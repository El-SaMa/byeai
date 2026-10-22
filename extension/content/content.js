(function () {
  'use strict';

  // Injected while the extension was reloading: it is already gone, so stop.
  if (!globalThis.chrome?.runtime?.id) return;

  const COSMETIC_SELECTORS = [
    '#intercom-container',
    '#intercom-frame',
    '.intercom-lightweight-app',
    '.drift-frame-controller',
    'iframe[src*="intercom"]',
    'iframe[src*="drift"]',
    'iframe[src*="crisp"]',
    'iframe[src*="tidio"]',
    'iframe[src*="zendesk"]',
    'iframe[src*="livechat"]',
    'iframe[src*="chatbot"]',
    'iframe[src*="copilot"]',
    '[data-testid*="chatbot"]',
    '[class*="ai-assistant"]',
  ];

  function isActiveOnPage() {
    return Boolean(globalThis.byeai?.state.widgets);
  }

  function hideKnownWidgets() {
    COSMETIC_SELECTORS.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (el.dataset.byeaiHidden) return;
          el.dataset.byeaiHidden = 'widgets';
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          globalThis.byeai?.report('widgets', selector);
        });
      } catch {
        // invalid selector on older browsers
      }
    });
  }

  function runPass() {
    if (!isActiveOnPage()) return;
    hideKnownWidgets();
  }

  runPass();

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runPass, 400);
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.byeai?.onChange(runPass);
})();
