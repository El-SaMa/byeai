/**
 * YouTube channel lists kept in chrome.storage.sync:
 * - hidden channels ("Hide channel"), up to 500
 * - shown channels ("Not AI, show this channel"), up to 200
 *
 * Saved as an array of { id, n } (plus "a", the other id form when we saw
 * both). Chrome sync allows 8 KB per key, so a long list is split over
 * hiddenChannels, hiddenChannels1, hiddenChannels2... Oldest go first.
 * Sync allows about 100 KB in all, so the shown list gets fewer chunks.
 *
 * Shared by the content script, the options page and the service worker.
 */
(function () {
  'use strict';

  // Sync counts key + JSON value against 8192 bytes. Leave some room.
  const CHUNK_BYTES = 7000;
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

  // "@Handle" -> "@handle". "UC..." ids are case sensitive and stay as they are.
  function normId(raw) {
    const id = String(raw || '').trim();
    if (/^@[^\s/?#]{1,100}$/.test(id)) return id.toLowerCase();
    if (/^UC[\w-]{10,40}$/.test(id)) return id;
    return '';
  }

  function clean(entry) {
    const id = normId(entry?.id);
    if (!id) return null;
    const out = { id, n: String(entry.n || id).replace(/\s+/g, ' ').trim().slice(0, 60) || id };
    const alt = normId(entry.a);
    if (alt && alt !== id) out.a = alt;
    return out;
  }

  function channelList(KEY, MAX, CHUNKS) {
    const KEYS = [KEY, ...Array.from({ length: CHUNKS - 1 }, (_, i) => `${KEY}${i + 1}`)];

    function join(data) {
      return KEYS.flatMap((k) => (Array.isArray(data?.[k]) ? data[k] : []))
        .map(clean)
        .filter(Boolean);
    }

    // Newest last. Returns the chunks, dropping the oldest until they fit.
    function split(list) {
      let items = list.map(clean).filter(Boolean);
      const seen = new Set();
      items = items.reverse().filter((c) => !seen.has(c.id) && seen.add(c.id)).reverse().slice(-MAX);
      for (;;) {
        const chunks = [[]];
        for (const item of items) {
          const last = chunks[chunks.length - 1];
          if (last.length && bytes([...last, item]) + KEY.length + 2 > CHUNK_BYTES) chunks.push([item]);
          else last.push(item);
        }
        if (chunks.length <= CHUNKS) return chunks;
        items = items.slice(1);
      }
    }

    async function read() {
      return join(await chrome.storage.sync.get(KEYS));
    }

    // Sync allows about 100 KB in all, shared with the other lists. If it says
    // no, drop the oldest entries and try again, a few times, then report it.
    async function write(list) {
      let items = list;
      for (let attempt = 0; ; attempt += 1) {
        const chunks = split(items);
        const set = {};
        chunks.forEach((chunk, i) => {
          set[KEYS[i]] = chunk;
        });
        try {
          await chrome.storage.sync.set(set);
        } catch (err) {
          if (attempt >= 4 || !/quota/i.test(String(err?.message || err))) throw err;
          const kept = chunks.flat();
          items = kept.slice(Math.ceil(kept.length * 0.15));
          continue;
        }
        const unused = KEYS.slice(chunks.length);
        if (unused.length) await chrome.storage.sync.remove(unused);
        return;
      }
    }

    const isKey = (k) => KEYS.includes(k);

    return { KEY, KEYS, MAX, normId, clean, join, split, read, write, isKey };
  }

  globalThis.byeaiHiddenChannels = channelList('hiddenChannels', 500, 10);
  globalThis.byeaiShownChannels = channelList('shownChannels', 200, 3);
})();
