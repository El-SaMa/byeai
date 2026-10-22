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
 * - Shown channels: "Not AI" on a Community cover. Those channels no longer
 *   count as Community channels. Hide channel still wins.
 * - Covered videos get one action panel (Show video, Hide channel, Not AI,
 *   Next video on the player), also an overlay under <html>.
 */
(function () {
  'use strict';

  // Injected while the extension was reloading: it is already gone, so stop.
  if (!globalThis.chrome?.runtime?.id) return;

  // After the extension reloads or updates, scripts left in open tabs lose
  // the extension and chrome.runtime calls throw. Those tabs just go quiet.
  const send = (message) => {
    try {
      return chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch (_) {
      return Promise.resolve(undefined);
    }
  };

  const byeai = globalThis.byeai;
  const store = globalThis.byeaiHiddenChannels;
  const shownStore = globalThis.byeaiShownChannels;
  if (!byeai || !store || !shownStore || !/(^|\.)youtube\.com$/.test(byeai.host) || window.top !== window) return;

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
    'ytd-playlist-panel-video-renderer',
    'ytd-playlist-panel-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'yt-lockup-view-model',
  ].join(',');
  const PANEL_ITEM = 'ytd-playlist-panel-video-renderer';
  const LINKS = 'a[href^="/@"], a[href^="/channel/"], a[href*="youtube.com/@"], a[href*="youtube.com/channel/"]';
  const THUMBS = 'ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail, img';
  const OWNER = 'ytd-watch-metadata #owner, ytd-video-owner-renderer';
  const ATTR = 'data-byeai-channel-hidden';
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  let hiddenIds = new Set();
  let shownIds = new Set();
  let community = new Set();
  let communityOn = true;
  // Channel name -> ids, from your hidden/shown channels and the Community list.
  // Mix and playlist panels show only the channel name, no channel link.
  const names = { hidden: new Map(), shown: new Map(), community: new Map() };
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
    if (!ids.length) return byName(el);
    ids.sort((x, y) => (y[0] === '@') - (x[0] === '@'));
    return { id: ids[0], ids, n: (name || ids[0]).slice(0, 60) };
  }

  const nameKey = (text) => (text || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function nameMap(list) {
    const map = new Map();
    for (const c of list) {
      const key = nameKey(c?.n);
      if (!key) continue;
      const ids = map.get(key) || [];
      [c.id, c.a].map((id) => store.normId(id)).filter(Boolean).forEach((id) => ids.includes(id) || ids.push(id));
      map.set(key, ids);
    }
    return map;
  }

  // Panel items without a channel link: match the byline text to a known channel name.
  function byName(el) {
    if (!el.matches?.(PANEL_ITEM)) return null;
    const n = (el.querySelector('#byline')?.textContent || '').replace(/\s+/g, ' ').trim();
    const key = nameKey(n);
    if (!key) return null;
    const ids = [...new Set([names.hidden, names.shown, names.community].flatMap((m) => m.get(key) || []))];
    if (!ids.length) return null;
    ids.sort((x, y) => (y[0] === '@') - (x[0] === '@'));
    return { id: ids[0], ids, n: n.slice(0, 60) };
  }

  const isWatch = () => location.pathname === '/watch';
  const watchChannel = () => (isWatch() ? channelIn(document.querySelector(OWNER)) : null);
  const isHidden = (info) => Boolean(info && info.ids.some((id) => hiddenIds.has(id)));
  const isShown = (info) => Boolean(info && info.ids.some((id) => shownIds.has(id)));
  const isCommunity = (info) =>
    Boolean(communityOn && info && info.ids.some((id) => community.has(id)) && !isShown(info));

  function entryFor(info) {
    const entry = { id: info.id, n: info.n };
    const alt = info.ids.find((id) => id !== info.id);
    if (alt) entry.a = alt;
    return entry;
  }

  // ------------------------------------------------------------- storage

  const idsOf = (list) => new Set(list.flatMap((c) => (c.a ? [c.id, c.a] : [c.id])));

  function loadHidden() {
    store
      .read()
      .then((list) => {
        hiddenIds = idsOf(list);
        names.hidden = nameMap(list);
        changed();
      })
      .catch(() => {});
  }

  function loadShown() {
    shownStore
      .read()
      .then((list) => {
        shownIds = idsOf(list);
        names.shown = nameMap(list);
        changed();
      })
      .catch(() => {});
  }

  function loadCommunity() {
    Promise.all([chrome.storage.sync.get({ communityEnabled: true }), chrome.storage.local.get({ community: null })])
      .then(([synced, local]) => {
        communityOn = synced.communityEnabled !== false;
        const channels = Array.isArray(local.community?.channels) ? local.community.channels : [];
        const youtube = channels.filter((c) => c?.p === 'youtube');
        community = new Set(youtube.map((c) => store.normId(c.id)).filter(Boolean));
        names.community = nameMap(youtube);
        changed();
      })
      .catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    const keys = Object.keys(changes);
    if (area === 'sync' && keys.some(store.isKey)) loadHidden();
    if (area === 'sync' && keys.some(shownStore.isKey)) loadShown();
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
    syncPanels();
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
    send({ type: 'HIDE_CHANNEL', channel: entryFor(info) }).catch(() => {});
    showHideToast(info);
  }

  function unhide(info) {
    info.ids.forEach((id) => hiddenIds.delete(id));
    changed();
    send({ type: 'UNHIDE_CHANNEL', ids: info.ids }).catch(() => {});
  }

  // "Not AI, show this channel": every Community cover of the channel goes
  // at once. The worker saves it and, with the Community list on, sends
  // one anonymous "not_ai" report.
  function show(info) {
    shownIds = new Set([...shownIds, ...info.ids]);
    changed();
    send({ type: 'NOT_AI_CHANNEL', channel: entryFor(info) }).catch(() => {});
    showToast(msg('channelShown', `Showing ${info.n}. Thanks, we'll review it.`, [info.n]), () => unshow(info));
  }

  function unshow(info) {
    info.ids.forEach((id) => shownIds.delete(id));
    changed();
    send({ type: 'UNSHOW_CHANNEL', ids: info.ids }).catch(() => {});
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
      --bg: #0f766e; --text: #ffffff; --hover: #115e59; --focus: #0f766e;
      font: 600 13px/18px Roboto, "Segoe UI", system-ui, sans-serif; color: var(--text);
      background: var(--bg); border: 0; border-radius: 16px; padding: 7px 12px; margin: 0;
      cursor: pointer; white-space: nowrap;
    }
    button:hover { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      button { --bg: #2dd4bf; --text: #042f2e; --hover: #5eead4; --focus: #5eead4; }
    }
    :host([data-theme="dark"]) button { --bg: #2dd4bf; --text: #042f2e; --hover: #5eead4; --focus: #5eead4; }
    :host([data-theme="light"]) button { --bg: #0f766e; --text: #ffffff; --hover: #115e59; --focus: #0f766e; }
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
    // Covered tiles have the panel, with its own Hide channel.
    const covered = tile.hasAttribute('data-byeai-cover');
    const info = byeai.state.labeled && !tile.hasAttribute(ATTR) && !covered ? channelIn(tile) : null;
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
      if (event.key !== 'Tab' || event.shiftKey) return;
      const active = document.activeElement;
      const tile = current?.tile;
      if (!active || !tile || !tile.contains(active) || focusables(tile).pop() !== active || !tileButton) return;
      event.preventDefault();
      tileButton.button.focus();
    },
    true
  );

  document.addEventListener(
    'pointerover',
    (event) => {
      if (event.target === tileButton?.host) return;
      const tile = outerTile(event.target);
      if (!tile) hideButton();
      else if (tile !== current?.tile) showButton(tile);
    },
    true
  );

  document.addEventListener(
    'focusin',
    (event) => {
      if (event.target === tileButton?.host) return;
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

  // ------------------------------------------------ cover action panels

  // One panel per covered element: what it is, why, and clear buttons. Like
  // the hide button it lives under <html>, positioned over the covered
  // element, and never goes into YouTube's trees. It also blocks clicks
  // through to the video: nothing reveals unless a button is used.
  const PANEL_CSS = `
    :host { all: initial; }
    .scrim {
      --surface: #ffffff; --text: #0f0f0f; --muted: #4b4b4b; --btn: #f2f2f2; --btn-hover: #e0e0e0;
      --primary: #0f766e; --primary-text: #ffffff; --primary-hover: #115e59; --focus: #0f766e;
      position: absolute; inset: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      padding: 8px; overflow: hidden; background: rgba(15, 23, 42, 0.55);
      font: 13px/1.35 Roboto, "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      .scrim { --surface: #212121; --text: #f1f1f1; --muted: #cfcfcf; --btn: #3a3a3a; --btn-hover: #4d4d4d;
        --primary: #5eead4; --primary-text: #042f2e; --primary-hover: #99f6e4; --focus: #5eead4; }
    }
    :host([data-theme="dark"]) .scrim { --surface: #212121; --text: #f1f1f1; --muted: #cfcfcf; --btn: #3a3a3a; --btn-hover: #4d4d4d;
      --primary: #5eead4; --primary-text: #042f2e; --primary-hover: #99f6e4; --focus: #5eead4; }
    :host([data-theme="light"]) .scrim { --surface: #ffffff; --text: #0f0f0f; --muted: #4b4b4b; --btn: #f2f2f2; --btn-hover: #e0e0e0;
      --primary: #0f766e; --primary-text: #ffffff; --primary-hover: #115e59; --focus: #0f766e; }
    .panel {
      box-sizing: border-box; max-width: 100%; max-height: 100%; overflow: hidden; display: flex; flex-direction: column;
      align-items: center; gap: 6px; padding: 12px 14px; text-align: center; color: var(--text);
      background: var(--surface); border-radius: 12px; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
    }
    .title { font-weight: 700; font-size: 15px; }
    .reason { color: var(--muted); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 4px; }
    button {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; margin: 0;
      padding: 5px 12px; border: 0; border-radius: 16px; cursor: pointer; white-space: nowrap;
      font-family: inherit; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text); background: var(--btn);
    }
    button:hover { background: var(--btn-hover); }
    button.primary { color: var(--primary-text); background: var(--primary); }
    button.primary:hover { background: var(--primary-hover); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    svg { flex: none; }
    :host([data-size="compact"]) .panel { padding: 8px 10px; gap: 4px; }
    :host([data-size="compact"]) .title { font-size: 13px; }
    :host([data-size="mini"]) .scrim { padding: 4px; }
    :host([data-size="mini"]) .panel { padding: 4px; gap: 0; border-radius: 16px; }
    :host([data-size="mini"]) .actions { margin: 0; gap: 4px; }
    :host([data-size="mini"]) button { padding: 4px 10px; }
    :host([data-size="mini"]) button.icon, :host([data-size="compact"]) button.icon { padding: 4px 7px; }
  `;

  const COVER = '[data-byeai-cover]';
  const NEXT = '#movie_player .ytp-next-button, .html5-video-player .ytp-next-button';
  /** @type {Map<Element, object>} */
  const panels = new Map();
  let panelTimer = null;
  let panelFrame = 0;

  const isPlayerCard = (card) => card.id === 'movie_player' || card.matches('ytd-player');
  const coverInfo = (card) => (isPlayerCard(card) ? watchChannel() : channelIn(card));

  function nextButton() {
    const b = document.querySelector(NEXT);
    return b && b.getClientRects().length ? b : null;
  }

  // Our own click on YouTube's button must get through the cover's click guard.
  function goNext() {
    byeai.passClick = true;
    try {
      nextButton()?.click();
    } finally {
      byeai.passClick = false;
    }
  }

  function scrollParent(card) {
    for (let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return el;
    }
    return null;
  }

  function sizeOf(card, r) {
    if (card.matches(PANEL_ITEM) || r.width < 200 || r.height < 100) return 'mini';
    return r.width < 300 || r.height < 150 ? 'compact' : 'full';
  }

  function panelButton(act, cls = '', icon = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    if (cls) b.className = cls;
    if (icon) b.innerHTML = ICON;
    return b;
  }

  // Fill the panel for the current size, kind and channel.
  function render(p) {
    const { card, info, size } = p;
    const kind = card.dataset.byeaiCover;
    const mini = size === 'mini';
    const box = document.createElement('div');
    box.className = 'panel';
    box.setAttribute('role', 'group');
    const title = msg('coverTitle', 'AI video hidden');
    box.setAttribute('aria-label', title);

    if (!mini) {
      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = title;
      box.append(t);
    }
    if (size === 'full') {
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent =
        kind === 'community'
          ? msg('coverReasonCommunity', 'On the ByeAI Community list')
          : kind === 'labeled'
            ? msg('coverReasonLabeled', 'YouTube labels it as AI')
            : msg('coverReasonTagged', 'Tagged as AI by the creator');
      box.append(reason);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const showBtn = panelButton('show', 'primary');
    showBtn.textContent = mini ? msg('coverShowShort', 'Show') : msg('coverShow', 'Show video');
    actions.append(showBtn);
    if (isPlayerCard(card) && p.next) {
      const next = panelButton('next');
      next.textContent = msg('coverNextVideo', 'Next video');
      actions.append(next);
    }
    if (info) {
      const hideText = msg('channelHide', 'Hide channel');
      const hideBtn = panelButton('hide', size === 'full' ? '' : 'icon', true);
      if (size === 'full') hideBtn.append(document.createTextNode(hideText));
      hideBtn.setAttribute('aria-label', `${hideText}: ${info.n}`);
      hideBtn.title = `${hideText}: ${info.n}`;
      actions.append(hideBtn);
      if (!mini && kind === 'community' && isCommunity(info)) {
        const notAi = panelButton('notai');
        notAi.textContent = msg('coverNotAi', 'Not AI');
        notAi.setAttribute('aria-label', `${msg('coverNotAi', 'Not AI')}: ${info.n}`);
        actions.append(notAi);
      }
    }
    box.append(actions);
    p.scrim.replaceChildren(box);
    p.scrim.dir = msg('@@bidi_dir', 'ltr');
    p.scrim.lang = msg('@@ui_locale', 'en').replace('_', '-');
  }

  const panelButtons = (p) => [...p.root.querySelectorAll('button')];

  function afterCard(card) {
    return focusables(document.body).find(
      (el) => !card.contains(el) && card.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function beforeCard(card) {
    const inside = focusables(card).pop();
    if (inside) return inside;
    return focusables(document.body)
      .filter((el) => !card.contains(el) && card.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
      .pop();
  }

  function act(p, name) {
    const { card } = p;
    const info = coverInfo(card);
    if (name === 'show') {
      const focusBack = p.root.activeElement ? focusables(card)[0] : null;
      byeai.covers?.reveal(card);
      syncPanels();
      focusBack?.focus({ preventScroll: true });
    } else if (name === 'next') {
      goNext();
    } else if (name === 'hide') {
      if (!info) return;
      hide(info);
      if (isPlayerCard(card)) goNext();
    } else if (name === 'notai') {
      if (info && isCommunity(info)) show(info);
    }
  }

  function createPanel(card) {
    const host = document.createElement('byeai-cover-panel');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    root.append(style, scrim);
    const set = (k, v) => host.style.setProperty(k, v, 'important');
    set('position', 'absolute');
    set('z-index', '2147483000');
    set('display', 'none');
    host.dataset.card = card.id || '';
    const p = { card, host, root, scrim, set, info: null, size: '', sig: '', next: false, scroller: scrollParent(card) };

    // Keep the page from treating our clicks as clicks on the video.
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick', 'click'].forEach((type) => {
      host.addEventListener(
        type,
        (event) => {
          event.stopPropagation();
          if (type === 'pointerdown' || type === 'mousedown') return;
          event.preventDefault();
          if (type !== 'click') return;
          const button = event.composedPath().find((n) => n instanceof HTMLButtonElement);
          if (button) act(p, button.dataset.act);
        },
        true
      );
    });
    host.addEventListener(
      'keydown',
      (event) => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const buttons = panelButtons(p);
        const active = root.activeElement;
        if (event.shiftKey && active === buttons[0]) {
          event.preventDefault();
          beforeCard(card)?.focus();
        } else if (!event.shiftKey && active === buttons[buttons.length - 1]) {
          event.preventDefault();
          afterCard(card)?.focus();
        }
      },
      true
    );
    document.documentElement.appendChild(host);
    return p;
  }

  // Cover rectangle, cut to the scrolling box it sits in (mix panel list).
  function visibleRect(p) {
    const r = p.card.getBoundingClientRect();
    if (!r.width || !r.height || p.card.hasAttribute(ATTR)) return null;
    let { left, top, right, bottom } = r;
    if (p.scroller) {
      const s = p.scroller.getBoundingClientRect();
      left = Math.max(left, s.left);
      top = Math.max(top, s.top);
      right = Math.min(right, s.right);
      bottom = Math.min(bottom, s.bottom);
    }
    if (right - left < 20 || bottom - top < 20) return null;
    if (bottom < -window.innerHeight || top > window.innerHeight * 2) return null;
    return { left, top, width: right - left, height: bottom - top, full: r };
  }

  function place(p) {
    const r = visibleRect(p);
    if (!r) return p.set('display', 'none');
    const size = sizeOf(p.card, r.full);
    if (size !== p.size) {
      p.size = size;
      p.host.dataset.size = size;
      render(p);
    }
    p.host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
    p.scrim.style.borderRadius = getComputedStyle(p.card).borderRadius;
    p.set('left', `${Math.round(r.left + window.scrollX)}px`);
    p.set('top', `${Math.round(r.top + window.scrollY)}px`);
    p.set('width', `${Math.round(r.width)}px`);
    p.set('height', `${Math.round(r.height)}px`);
    p.set('display', 'block');
  }

  // Channel and kind can change when YouTube recycles a tile.
  function refresh(p) {
    const info = coverInfo(p.card);
    const next = isPlayerCard(p.card) && Boolean(nextButton());
    const sig = `${p.card.dataset.byeaiCover}|${info?.id || ''}|${info?.n || ''}|${next}|${isCommunity(info)}`;
    p.info = info;
    p.next = next;
    if (sig !== p.sig) {
      p.sig = sig;
      p.size = '';
    }
    place(p);
  }

  function syncPanels() {
    if (!document.body) return;
    const covered = byeai.state.labeled ? [...document.querySelectorAll(`${COVER}[data-byeai-panel]`)] : [];
    for (const [card, p] of panels) {
      if (covered.includes(card)) continue;
      p.host.remove();
      panels.delete(card);
    }
    for (const card of covered) {
      if (!panels.has(card)) panels.set(card, createPanel(card));
      refresh(panels.get(card));
    }
  }

  function placePanels() {
    panelFrame = 0;
    panels.forEach((p) => {
      if (p.card.isConnected) place(p);
    });
  }

  const queuePlace = () => {
    if (panels.size && !panelFrame) panelFrame = requestAnimationFrame(placePanels);
  };
  window.addEventListener('scroll', queuePlace, { capture: true, passive: true });
  window.addEventListener('resize', queuePlace);

  // Layout moves without events (feeds load, the sidebar reflows).
  function startPanels() {
    clearInterval(panelTimer);
    panelTimer = setInterval(() => {
      if (!panels.size) return;
      for (const [card, p] of panels) {
        if (!card.isConnected) {
          p.host.remove();
          panels.delete(card);
        } else if (isPlayerCard(card) && Boolean(nextButton()) !== p.next) {
          refresh(p);
        }
      }
      queuePlace();
    }, 400);
  }

  // Keyboard: Tab from the last control of a covered element lands on its panel.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Tab' || event.shiftKey) return;
      const active = document.activeElement;
      const card = active instanceof Element ? active.closest(`${COVER}[data-byeai-panel]`) : null;
      const p = card && panels.get(card);
      if (!p || focusables(card).pop() !== active || p.host.style.display === 'none') return;
      event.preventDefault();
      panelButtons(p)[0]?.focus();
    },
    true
  );

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

  function showHideToast(info) {
    // Already in the list: nothing to suggest.
    showToast(msg('channelHidden', `Hidden ${info.n}`, [info.n]), () => unhide(info), isCommunity(info) ? null : info);
  }

  // A note in the corner with Undo, plus Suggest after hiding a channel.
  function showToast(message, onUndo, suggestInfo = null) {
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
    try {
      icon.src = chrome.runtime.getURL('assets/icons/icon48.png');
    } catch (_) {
      // Orphaned after an extension reload: no icon.
    }
    icon.addEventListener('error', () => icon.remove());

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = message;

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

    let suggest = null;
    if (suggestInfo) {
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
      onUndo();
      remove();
    });

    suggest?.addEventListener('click', async () => {
      suggest.disabled = true;
      undo.disabled = true;
      const reply = await send({ type: 'SUGGEST_CHANNEL', id: suggestInfo.id, n: suggestInfo.n, why: why(suggestInfo) })
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
    syncPanels();
  }

  function schedule(root) {
    if (!root || root.nodeType !== 1) return;
    pending.add(root);
    if (!timer) timer = setTimeout(flush, 60);
  }

  function start() {
    injectStyle();
    startPanels();
    changed();
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes') schedule(m.target);
        else m.addedNodes.forEach((n) => schedule(n.nodeType === 1 ? n : n.parentElement));
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-byeai-cover'] });
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
    shown: isShown,
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
  loadShown();
  loadCommunity();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
