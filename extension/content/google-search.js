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

  // Where the page's own layout lives. Never hidden, however empty it looks.
  const KEEP = 'body, html, #main, #cnt, #center_col, #rcnt, #search, #rso, #appbar, #hdtb, #hdtb-msb, #sfcnt, [role="main"], [role="navigation"], [role="search"]';

  // Never hide the page's layout or anything that holds the results, whatever
  // selector or parent-climbing found it.
  function holdsResults(el) {
    return el.matches(KEEP) || Boolean(el.querySelector(KEEP));
  }

  function hideElement(el, key, count = true) {
    if (!el || el.dataset.byeaiHidden || holdsResults(el)) return;
    el.dataset.byeaiHidden = 'widgets';
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    if (count) globalThis.byeai?.report('widgets', key);
  }

  function gone(el) {
    return Boolean(el.dataset.byeaiHidden) || el.hidden || getComputedStyle(el).display === 'none';
  }

  // After hiding an AI box: if its parent now holds nothing else you can see,
  // hide that too, so no empty gap (margins, borders) is left behind.
  function collapseEmptyParents(el) {
    let node = el;
    for (let i = 0; i < 3; i += 1) {
      const parent = node.parentElement;
      if (!parent || parent.matches(KEEP) || parent.querySelector(KEEP)) return;
      const rest = [...parent.children].filter((c) => c !== node && !['SCRIPT', 'STYLE'].includes(c.tagName) && !gone(c));
      if (rest.length || parent.textContent.replace(node.textContent, '').trim()) return;
      hideElement(parent, 'google:collapse', false);
      node = parent;
    }
  }

  // AI Mode entry points: the tab in the bar under the search box, the button
  // in the search box and on the home page. Found by where they lead (udm=50),
  // since their labels change with the language.
  function hideAiModeEntries() {
    document.querySelectorAll('a[href*="udm=50"]').forEach((link) => {
      let udm = '';
      try {
        udm = new URL(link.getAttribute('href'), location.href).searchParams.get('udm');
      } catch {
        return;
      }
      if (udm !== '50') return;
      const item = link.closest('[role="listitem"], [role="presentation"], li') || link;
      hideElement(item, 'google:ai-mode-entry');
    });
  }

  function hideGoogleAiOverviews() {
    document.querySelectorAll('[data-attnms]').forEach((el) => {
      let container = el.closest('.Kevs9, .YNk70c, .SLPe5b, .WaaZC') || el.parentElement?.parentElement || el;
      // The wrapper turned out to hold the results too: hide just the box.
      if (holdsResults(container)) container = el;
      hideElement(container, 'google:data-attnms');
      collapseEmptyParents(container);
    });
    hideAiModeEntries();

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
        document.querySelectorAll(selector).forEach((el) => {
          hideElement(el, `google:${selector}`);
          collapseEmptyParents(el);
        });
      } catch {
        // invalid selector
      }
    });

    document.querySelectorAll('[jsname="bq0EGf"]').forEach((section) => {
      const aiItems = section.querySelectorAll('[jsname="YrZdPb"][data-evn]');
      const allItems = section.querySelectorAll('[jsname="YrZdPb"]');
      if (aiItems.length > 0 && aiItems.length === allItems.length) {
        hideElement(section, 'google:paa-ai-section');
        collapseEmptyParents(section);
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
