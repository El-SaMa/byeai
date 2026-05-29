# Chrome Web Store Privacy practices form

Use these answers in the Developer Dashboard **Privacy** tab when publishing ByeAI.

Privacy policy URL (after hosting):

```
https://YOUR_USERNAME.github.io/byeai/privacy.html
```

---

## Data collection

Answer **No** or indicate **no collection** for all personal data categories:

| Category | Collected? |
|----------|------------|
| Personally identifiable information | **No** |
| Health information | **No** |
| Financial and payment information | **No** |
| Authentication information | **No** |
| Personal communications | **No** |
| Location | **No** |
| Web history | **No** (not transmitted to developer) |
| User activity | **No** (not transmitted to developer) |
| Website content | **No** (not transmitted to developer) |

---

## Certification (check all three)

- [x] The data is **not sold** to third parties, outside of approved use cases
- [x] The data is **not used or transferred** for purposes unrelated to the item's core functionality
- [x] The data is **not used or transferred** to determine creditworthiness or for lending purposes

---

## Privacy policy summary (if a text box is shown)

```
ByeAI does not collect or transmit personal data to the developer. The extension stores settings locally on the user's device using Chrome storage, including: on/off state, allowed sites, block counters, and UI preferences. ByeAI blocks known AI widget and AI service network requests using declarativeNetRequest. It does not scan page text, images, or video. No analytics or advertising SDKs are included.
```

---

## Single purpose alignment

ByeAI's single purpose is blocking AI widgets and AI service requests. The privacy policy matches this: no content scanning, no remote profiling.

---

## If Google asks about host permissions

```
ByeAI requires http/https access to block AI loaders on pages the user visits and to apply lightweight cosmetic hiding rules for known AI widgets. Block counts are shown for the active tab only. Browsing history is not sent to the developer.
```

---

## If Google asks about declarativeNetRequestFeedback

```
Used solely to display accurate "blocked on this page" counts in the extension popup. No data is sent to external servers.
```

---

## Developer disclosure (recommended on store listing)

Match AdBlock style transparency in your listing **NOTES** section (already in STORE_LISTING.md):

> The permission notice about access to websites is required so ByeAI can block AI loaders on pages you visit. ByeAI does NOT send your browsing history to us.

---

## Keep in sync

When you change what ByeAI stores or permissions it uses, update:

1. `docs/privacy.html`
2. `extension/privacy/privacy.html`
3. This file
4. Chrome dashboard disclosures
