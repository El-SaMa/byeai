/**
 * YouTube channels: "Hide channel" and the ByeAI Community list.
 *
 * Runs at document_start after byeai-flag.js, on YouTube only. Both parts
 * belong to the "AI videos and images" switch (byeai.state.labeled).
 *
 * - Hidden channels: tiles get data-byeai-channel-hidden and CSS hides them.
 *   No nodes go into YouTube's trees. The hide button is one overlay under
 *   <html> that we move over the tile you point at.
 * - Community list: downloaded by the service worker. ai-content.js covers
 *   those channels with the usual blur, through byeai.channels below.
 */
(function () {
  'use strict';

  const byeai = globalThis.byeai;
  const store = globalThis.byeaiHiddenChannels;
  if (!byeai || !store || !/(^|\.)youtube\.com$/.test(byeai.host) || window.top !== window) return;

  const msg = (key, fallback, args) => {
    try {
      return chrome.i18n.getMessage(key, args || []) || fallback;
    } catch (_) {
      return fallback;
    }
  };

  const TILES = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'yt-lockup-view-model',
  ].join(',');
  const LINKS = 'a[href^="/@"], a[href^="/channel/"], a[href*="youtube.com/@"], a[href*="youtube.com/channel/"]';
  const THUMBS = 'ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail, img';
  const OWNER = 'ytd-watch-metadata #owner, ytd-video-owner-renderer';
  const ATTR = 'data-byeai-channel-hidden';
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  let hiddenIds = new Set();
  let community = new Set();
  let communityOn = true;
  // Channel id -> 'labeled' | 'tagged', when ai-content.js saw an AI label or tag.
  const seen = new Map();
  const listeners = [];

  // ------------------------------------------------------------ identity

  function idFromHref(href) {
    let path;
    try {
      path = new URL(href, location.origin).pathname;
    } catch (_) {
      return '';
    }
    let m = /^\/(@[^/]+)/.exec(path);
    if (m) {
      try {
        return store.normId(decodeURIComponent(m[1]));
      } catch (_) {
        return store.normId(m[1]);
      }
    }
    m = /^\/channel\/([^/]+)/.exec(path);
    return m ? store.normId(m[1]) : '';
  }

  // { id, ids, n } from the channel links inside el, handle first.
  function channelIn(el) {
    if (!el) return null;
    const ids = [];
    let name = '';
    for (const a of el.querySelectorAll(LINKS)) {
      const id = idFromHref(a.getAttribute('href'));
      if (!id) continue;
      if (!ids.includes(id)) ids.push(id);
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!name && text) name = text;
    }
    if (!ids.length) return null;
    ids.sort((x, y) => (y[0] === '@') - (x[0] === '@'));
    return { id: ids[0], ids, n: (name || ids[0]).slice(0, 60) };
  }

  const isWatch = () => location.pathname === '/watch';
  const watchChannel = () => (isWatch() ? channelIn(document.querySelector(OWNER)) : null);
  const isHidden = (info) => Boolean(info && info.ids.some((id) => hiddenIds.has(id)));
  const isCommunity = (info) => Boolean(communityOn && info && info.ids.some((id) => community.has(id)));

  function entryFor(info) {
    const entry = { id: info.id, n: info.n };
    const alt = info.ids.find((id) => id !== info.id);
    if (alt) entry.a = alt;
    return entry;
  }

  // ------------------------------------------------------------- storage

  function setHidden(list) {
    hiddenIds = new Set(list.flatMap((c) => (c.a ? [c.id, c.a] : [c.id])));
    changed();
  }

  function loadHidden() {
    store.read().then(setHidden).catch(() => {});
  }

  function loadCommunity() {
    Promise.all([chrome.storage.sync.get({ communityEnabled: true }), chrome.storage.local.get({ community: null })])
      .then(([synced, local]) => {
        communityOn = synced.communityEnabled !== false;
        const channels = Array.isArray(local.community?.channels) ? local.community.channels : [];
        community = new Set(channels.filter((c) => c?.p === 'youtube').map((c) => store.normId(c.id)).filter(Boolean));
        changed();
      })
      .catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    const keys = Object.keys(changes);
    if (area === 'sync' && keys.some(store.isKey)) loadHidden();
    if ((area === 'sync' && changes.communityEnabled) || (area === 'local' && changes.community)) loadCommunity();
  });

  // --------------------------------------------------------------- hiding

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'byeai-channels-style';
    style.textContent = `html[data-byeai-labeled="1"] [${ATTR}] { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  function tilesIn(root) {
    const tiles = new Set();
    for (let el = root.closest?.(TILES); el; el = el.parentElement?.closest(TILES)) tiles.add(el);
    root.querySelectorAll?.(TILES).forEach((el) => tiles.add(el));
    return tiles;
  }

  function mark(root) {
    const on = byeai.state.labeled;
    for (const tile of tilesIn(root)) {
      const hide = on && isHidden(channelIn(tile));
      if (hide && !tile.hasAttribute(ATTR)) tile.setAttribute(ATTR, '1');
      else if (!hide && tile.hasAttribute(ATTR)) tile.removeAttribute(ATTR);
    }
  }

  function changed() {
    if (!document.body) return;
    mark(document.body);
    if (current && (current.tile.hasAttribute(ATTR) || !byeai.state.labeled)) hideButton();
    placeWatchButton();
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (_) {
        // ignore
      }
    });
  }

  function hide(info) {
    hiddenIds = new Set([...hiddenIds, ...info.ids]);
    changed();
    chrome.runtime.sendMessage({ type: 'HIDE_CHANNEL', channel: entryFor(info) }).catch(() => {});
    showToast(info);
  }

  function unhide(info) {
    info.ids.forEach((id) => hiddenIds.delete(id));
    changed();
    chrome.runtime.sendMessage({ type: 'UNHIDE_CHANNEL', ids: info.ids }).catch(() => {});
  }

  // ------------------------------------------------------- overlay button

  const ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.3 6.3C4.2 7.7 2.7 9.8 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

  const BUTTON_CSS = `
    :host { all: initial; }
    button {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; margin: 0; padding: 0; border: 0; border-radius: 50%;
      background: rgba(15, 23, 42, 0.88); color: #ffffff; cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
    }
    button:hover { background: #0f766e; }
    button:focus-visible { outline: 2px solid #ffffff; outline-offset: 0; box-shadow: 0 0 0 4px #0f766e; }
  `;

  const WATCH_CSS = `
    :host { all: initial; }
    button {
      --bg: #f2f2f2; --text: #0f0f0f; --hover: #e5e5e5; --focus: #0f766e;
      font: 500 13px/18px Roboto, "Segoe UI", system-ui, sans-serif; color: var(--text);
      background: var(--bg); border: 0; border-radius: 16px; padding: 7px 12px; margin: 0;
      cursor: pointer; white-space: nowrap;
    }
    button:hover { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      button { --bg: #272727; --text: #f1f1f1; --hover: #3f3f3f; --focus: #5eead4; }
    }
    :host([data-theme="dark"]) button { --bg: #272727; --text: #f1f1f1; --hover: #3f3f3f; --focus: #5eead4; }
    :host([data-theme="light"]) button { --bg: #f2f2f2; --text: #0f0f0f; --hover: #e5e5e5; --focus: #0f766e; }
  `;

  // An element under <html>, out of YouTube's trees, holding one button.
  function overlay(tag, css, onClick) {
    const host = document.createElement(tag);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const button = document.createElement('button');
    button.type = 'button';
    root.append(style, button);
    const set = (p, v) => host.style.setProperty(p, v, 'important');
    set('position', 'absolute');
    set('z-index', '2147483646');
    set('display', 'none');
    // Keep the page from treating our clicks as clicks on the video.
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick'].forEach((type) => {
      host.addEventListener(
        type,
        (event) => {
          event.stopPropagation();
          if (type !== 'pointerdown' && type !== 'mousedown') event.preventDefault();
          if (type === 'click') onClick();
        },
        true
      );
    });
    document.documentElement.appendChild(host);
    return { host, button, set };
  }

  let tileButton = null;
  let current = null;

  function outerTile(el) {
    let tile = el instanceof Element ? el.closest(TILES) : null;
    for (let up = tile?.parentElement?.closest(TILES); up; up = up.parentElement?.closest(TILES)) tile = up;
    return tile;
  }

  function showButton(tile) {
    const info = byeai.state.labeled && !tile.hasAttribute(ATTR) ? channelIn(tile) : null;
    if (!info) return hideButton();
    if (!tileButton) {
      tileButton = overlay('byeai-hide-channel', BUTTON_CSS, () => current && hide(current.info));
      tileButton.button.innerHTML = ICON;
      tileButton.button.addEventListener('keydown', onButtonKey);
    }
    const thumb = [...tile.querySelectorAll(THUMBS)].find((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 60 && r.height >= 34;
    });
    const r = (thumb || tile).getBoundingClientRect();
    if (!r.width || !r.height) return hideButton();
    // Top start corner: YouTube puts its own Watch later buttons at the end.
    const rtl = getComputedStyle(tile).direction === 'rtl';
    const left = (rtl ? r.right - 40 : r.left + 8) + window.scrollX;
    current = { tile, info };
    const label = `${msg('channelHide', 'Hide channel')}: ${info.n}`;
    tileButton.button.setAttribute('aria-label', label);
    tileButton.button.title = label;
    tileButton.set('left', `${Math.round(left)}px`);
    tileButton.set('top', `${Math.round(r.top + 8 + window.scrollY)}px`);
    tileButton.set('display', 'block');
  }

  function hideButton() {
    current = null;
    tileButton?.set('display', 'none');
  }

  const focusables = (root) =>
    [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled && el.getClientRects().length);

  // Keyboard: Tab from the tile's last control lands on the button, then
  // moves on to whatever comes after the tile.
  function onButtonKey(event) {
    if (event.key === 'Escape' && current) {
      const back = focusables(current.tile).pop();
      hideButton();
      back?.focus();
      return;
    }
    if (event.key !== 'Tab' || !current) return;
    event.preventDefault();
    const tile = current.tile;
    if (event.shiftKey) {
      focusables(tile).pop()?.focus();
      return;
    }
    const next = focusables(document.body).find(
      (el) => !tile.contains(el) && tile.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    hideButton();
    next?.focus();
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Tab' || event.shiftKey || !current || !tileButton) return;
      const active = document.activeElement;
      if (active && current.tile.contains(active) && focusables(current.tile).pop() === active) {
        event.preventDefault();
        tileButton.button.focus();
      }
    },
    true
  );

  document.addEventListener(
    'pointerover',
    (event) => {
      if (tileButton && event.target === tileButton.host) return;
      const tile = outerTile(event.target);
      if (!tile) hideButton();
      else if (tile !== current?.tile) showButton(tile);
    },
    true
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (tileButton && event.target === tileButton.host) return;
      const tile = outerTile(event.target);
      if (tile) showButton(tile);
      else hideButton();
    },
    true
  );

  window.addEventListener('resize', () => {
    hideButton();
    placeWatchButton();
  });

  // ------------------------------------------------------ watch page button

  let watchButton = null;
  let watchInfo = null;

  function placeWatchButton() {
    const owner = document.querySelector(OWNER);
    const info = byeai.state.labeled ? watchChannel() : null;
    if (!info || !owner) {
      watchInfo = null;
      watchButton?.set('display', 'none');
      return;
    }
    if (!watchButton) {
      watchButton = overlay('byeai-watch-channel', WATCH_CSS, () => {
        if (!watchInfo) return;
        if (isHidden(watchInfo)) unhide(watchInfo);
        else hide(watchInfo);
      });
    }
    watchInfo = info;
    watchButton.button.textContent = isHidden(info) ? msg('channelUnhide', 'Unhide channel') : msg('channelHide', 'Hide channel');
    watchButton.host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    // After the last thing in the channel row (usually Subscribe).
    const rects = [...owner.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height);
    const box = owner.getBoundingClientRect();
    if (!rects.length || !box.height) {
      watchButton.set('display', 'none');
      return;
    }
    const rtl = getComputedStyle(owner).direction === 'rtl';
    watchButton.set('display', 'block');
    const width = watchButton.host.getBoundingClientRect().width || 100;
    const left = rtl ? Math.min(...rects.map((r) => r.left)) - 8 - width : Math.max(...rects.map((r) => r.right)) + 8;
    watchButton.set('left', `${Math.round(left + window.scrollX)}px`);
    watchButton.set('top', `${Math.round(box.top + box.height / 2 - 16 + window.scrollY)}px`);
  }

  // -------------------------------------------------------------- toast

  const TOAST_MS = 8000;
  const TOAST_CSS = `
    :host { all: initial; }
    .toast {
      --bg: #ffffff; --text: #1f2937; --muted: #4b5563; --border: #d1d5db;
      --link: #0f766e; --focus: #0f766e;
      position: fixed; bottom: 16px; inset-inline-end: 16px; z-index: 2147483647;
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px;
      max-width: min(380px, calc(100vw - 32px)); padding-block: 10px; padding-inline: 12px 8px;
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
    .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 2px; flex-basis: 100%; padding-inline-start: 30px; }
    button {
      font: inherit; color: var(--link); background: none; border: 0; border-radius: 6px;
      padding: 4px 6px; cursor: pointer; font-weight: 600; flex: none;
    }
    button:hover { text-decoration: underline; }
    button:disabled { cursor: default; text-decoration: none; opacity: 0.6; }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .close { color: var(--muted); font-size: 18px; line-height: 1; padding: 4px 8px; font-weight: 400; }
    .close:hover { text-decoration: none; color: var(--text); }
  `;

  let toast = null;

  function why(info) {
    const kinds = info.ids.map((id) => seen.get(id));
    if (kinds.includes('labeled')) return 'labeled';
    if (kinds.includes('tagged')) return 'tagged';
    return 'manual';
  }

  function showToast(info) {
    toast?.remove(true);

    const el = document.createElement('byeai-toast');
    const root = el.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = TOAST_CSS;

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
    text.textContent = msg('channelHidden', `Hidden ${info.n}`, [info.n]);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', msg('noticeClose', 'Close'));

    const actions = document.createElement('div');
    actions.className = 'actions';

    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'undo';
    undo.textContent = msg('channelUndo', 'Undo');
    actions.append(undo);

    // Already in the list: nothing to suggest.
    let suggest = null;
    if (!isCommunity(info)) {
      suggest = document.createElement('button');
      suggest.type = 'button';
      suggest.className = 'suggest';
      suggest.textContent = msg('channelSuggest', 'Suggest as AI channel');
      actions.append(suggest);
    }

    box.append(icon, text, close, actions);
    root.append(style, box);
    document.documentElement.appendChild(el);

    let timer = null;
    const remove = (now) => {
      clearTimeout(timer);
      if (toast?.el === el) toast = null;
      if (now) return el.remove();
      box.classList.add('hiding');
      setTimeout(() => el.remove(), 300);
    };
    const start = () => {
      clearTimeout(timer);
      timer = setTimeout(remove, TOAST_MS);
    };
    const pause = () => clearTimeout(timer);
    toast = { el, remove };

    box.addEventListener('mouseenter', pause);
    box.addEventListener('mouseleave', start);
    box.addEventListener('focusin', pause);
    box.addEventListener('focusout', start);
    close.addEventListener('click', () => remove());

    undo.addEventListener('click', () => {
      unhide(info);
      remove();
    });

    suggest?.addEventListener('click', async () => {
      suggest.disabled = true;
      undo.disabled = true;
      const reply = await chrome.runtime
        .sendMessage({ type: 'SUGGEST_CHANNEL', id: info.id, n: info.n, why: why(info) })
        .catch(() => null);
      text.textContent = reply?.ok
        ? msg('channelSuggestSent', 'Thanks, suggestion sent')
        : msg('channelSuggestFailed', 'Could not send, try later');
      suggest.remove();
      undo.disabled = false;
      close.focus();
    });

    start();
  }

  // ---------------------------------------------------------------- loop

  let pending = new Set();
  let timer = null;

  function flush() {
    timer = null;
    const roots = [...pending];
    pending = new Set();
    if (roots.length > 40) mark(document.body);
    else roots.forEach((r) => r.isConnected && mark(r));
    placeWatchButton();
  }

  function schedule(root) {
    if (!root || root.nodeType !== 1) return;
    pending.add(root);
    if (!timer) timer = setTimeout(flush, 60);
  }

  function start() {
    injectStyle();
    changed();
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') schedule(m.target);
        else m.addedNodes.forEach((n) => schedule(n.nodeType === 1 ? n : n.parentElement));
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }

  document.addEventListener('yt-navigate-finish', () => {
    hideButton();
    schedule(document.body);
  });

  // Used by ai-content.js for Community covers and the reason of a suggestion.
  byeai.channels = {
    of: channelIn,
    watch: watchChannel,
    hidden: isHidden,
    community: isCommunity,
    noteAi(info, kind) {
      if (!info) return;
      info.ids.forEach((id) => {
        if (seen.get(id) !== 'labeled') seen.set(id, kind);
      });
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };

  byeai.onChange(() => changed());
  loadHidden();
  loadCommunity();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
