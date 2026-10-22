(function () {
  'use strict';

  // Injected while the extension was reloading: it is already gone, so stop.
  if (!globalThis.chrome?.runtime?.id) return;

  const GOOGLE_HOST = /^(\w+\.)?google\.[\w.]+$/;

  function isGooglePage() {
    return GOOGLE_HOST.test(window.location.hostname);
  }

  function isActiveOnPage() {
    return Boolean(globalThis.byeai?.state.widgets);
  }

  function hideElement(el, key) {
    if (!el || el.dataset.byeaiHidden) return;
    el.dataset.byeaiHidden = 'widgets';
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    globalThis.byeai?.report('widgets', key);
  }

  function hideGoogleAiOverviews() {
    document.querySelectorAll('[data-attnms]').forEach((el) => {
      const container = el.closest('.Kevs9, .YNk70c, .SLPe5b, .WaaZC') || el.parentElement?.parentElement || el;
      hideElement(container, 'google:data-attnms');
    });

    const simpleSelectors = [
      '[data-attrid="VisualDigestGeneratedDescription"]',
      '[jscontroller="Elkdbc"]',
      '[jsname="YrZdPb"][data-evn]',
      '[jsname="lHCI7d"]',
      '.oGdvd',
      '[jscontroller="DyTeib"]',
      '.plR5qb',
      '.olrp5b',
      '.iVzeVc',
      '[data-crust-trigger]',
    ];

    simpleSelectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => hideElement(el, `google:${selector}`));
      } catch {
        // invalid selector
      }
    });

    document.querySelectorAll('[jsname="bq0EGf"]').forEach((section) => {
      const aiItems = section.querySelectorAll('[jsname="YrZdPb"][data-evn]');
      const allItems = section.querySelectorAll('[jsname="YrZdPb"]');
      if (aiItems.length > 0 && aiItems.length === allItems.length) {
        hideElement(section, 'google:paa-ai-section');
      }
    });
  }

  function runPass() {
    if (!isGooglePage()) return;
    if (!isActiveOnPage()) return;
    hideGoogleAiOverviews();
  }

  if (isGooglePage()) {
    globalThis.byeai?.onChange(runPass);

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runPass, 300);
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
})();
