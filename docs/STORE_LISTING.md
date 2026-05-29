# ByeAI Chrome Web Store listing (ready to paste)

Copy each block into the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

Replace `[YOUR_PRIVACY_URL]` and developer contact details before publishing.

---

## Store listing fields

### Extension name (45 characters max)

```
ByeAI: block AI across the web
```

Alternative if taken:

```
ByeAI Block AI Widgets
```

### Summary / short description (132 characters max)

```
Block AI chat widgets and copilots before they load. Allow any site with one click. No content scanning.
```

Character count: 103

### Category

**Productivity**

Alternative: **Privacy & Security**

### Language

**English**

### Single purpose description (for review questionnaire)

```
Block AI chat widgets, copilots, and AI service requests on web pages, with user controlled per site allow options.
```

---

## Detailed description (paste into Overview)

Copy everything between the lines into the store **Description** field:

```
Block AI chat widgets and copilots on your favorite sites for free

ByeAI stops surprise AI helpers from loading on the websites you visit. Block floating chat bots, embedded copilots, and AI service calls before they run. You choose which sites can use AI.

==============================
FEATURES

☆ Block AI chat widgets and floating help bots on news sites, shops, SaaS apps, and more
☆ Block embedded copilots and AI assistant panels before they load
☆ Block network calls to major AI services when sites try to connect in the background
☆ See how many AI loaders were blocked on the current page
☆ Allow AI on any site with one click when you need help chat or site tools
☆ Turn blocking on or off anytime from the popup
☆ Plain language help on every control
☆ No scanning of your text, images, or video
☆ Settings and allowed sites stored locally on your device

==============================
ABOUT

Download ByeAI to browse with fewer surprise AI pop ups and embedded assistants.

ByeAI works like an ad blocker, but for AI. It uses a local block list to stop known AI widget scripts, embeds, and AI API requests. It does not send your page content to us or run AI to detect AI.

ByeAI is on by default. Click the ByeAI icon to see what was blocked, turn protection off, or allow AI on the site you are viewing. If a site acts broken, allow AI on that site only.

ByeAI does NOT detect whether articles, images, or videos were made by AI. It blocks AI tools from loading, not human written content.

==============================
NOTES

* The permission notice about access to websites is required so ByeAI can block AI loaders on pages you visit and show stats for the current tab. ByeAI does NOT send your browsing history to us.

* ByeAI does not sell your data. Allowed sites and stats stay on your device.

* Need help chat on one site? Use Allow AI on this site. Everywhere else stays protected.
```

---

## Privacy practices tab

### Privacy policy URL

Host the `docs/` folder on **lafu.fi** (see **`PRIVACY_HOSTING.md`**), then paste:

```
https://lafu.fi/privacy.html
```

Full form answers: **`PRIVACY_CHROME_FORM.md`**

### Data use certification

Select **No** for all collection types, then certify:

- Not sold to third parties, outside of approved use cases
- Not used or transferred for unrelated purposes
- Not used or transferred for creditworthiness or lending

### Privacy disclosure summary (if asked)

```
ByeAI does not collect or transmit personal data. Settings, allowed sites, and block counters are stored locally in Chrome storage on the user's device.
```

---

## Permission justifications

Paste into the justification fields if Chrome requests them.

**Host permission (http/https)**

```
ByeAI blocks AI widget scripts and embeds on pages you visit using declarativeNetRequest and lightweight cosmetic rules. Host access is required to apply those rules and to show block counts for the active tab in the popup.
```

**declarativeNetRequest**

```
Core functionality. Blocks known AI chat widget URLs, copilot embeds, and AI service API requests before they load.
```

**declarativeNetRequestFeedback**

```
Used only to show accurate blocked counts in the popup for the current page.
```

**storage**

```
Saves the user's on/off setting, allowed sites list, block counters, and minor UI preferences locally on the device.
```

**tabs**

```
Reads the active tab hostname so the popup can show the current site and apply Allow AI on this site.
```

---

## Developer profile (fill in before publish)

| Field | Suggested value |
|-------|-----------------|
| **Developer name** | Your name or studio |
| **Email** | Support email you monitor |
| **Website** | GitHub repo or product site |
| **Support URL** | Same as website or a simple help page |
| **Trader status** | Declare if selling in EU; free extension can still require trader info in some regions |

### Support site blurb (optional page)

```
ByeAI Help

How do I allow AI on one site?
Open the ByeAI popup and click Allow AI on this site.

Why is a site broken?
Allow AI on that site, or turn ByeAI off from the popup.

Does ByeAI read my pages?
No. It blocks known AI loaders. It does not scan your text or images.

Privacy policy: [YOUR_PRIVACY_URL]
```

---

## Visual assets checklist

### Extension icon

Already in `extension/assets/icons/` (16, 48, 128 px)

### Screenshots (minimum 1, recommend 4)

Size: **1280×800** or **640×400**

| # | Show |
|---|------|
| 1 | Popup: Protected status, Block AI on, counters at 0 |
| 2 | Popup: blocked count on this page > 0 |
| 3 | Popup: Allow AI on this site button |
| 4 | Options/welcome page |

Optional caption ideas (in screenshot design, not store text):

- Block AI before it loads
- Allow AI on any site
- No content scanning

### Promotional tile (optional)

Size: **440×280**

Text: **ByeAI** + **Bye, AI until you allow it.**

### Marquee promo tile (optional)

Size: **1400×560**

Same message with popup mockup

---

## Package and upload

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

Upload: `dist/byeai-chrome.zip`

---

## Pre submit checklist

See `docs/REVIEW_CHECKLIST.md`

Quick version:

- [ ] Privacy policy URL is live and matches `extension/privacy/privacy.html`
- [ ] Description pasted from this file
- [ ] Screenshots uploaded
- [ ] Permission justifications ready
- [ ] Tested unpacked build on 3+ sites
- [ ] Version in manifest matches footer (1.0.1)

---

## Related extensions positioning (for your planning, not store text)

ByeAI is **not** an AI content detector. Do not compare directly to "AI Blocker" style extensions that scan text and images. ByeAI is closest to **AdBlock for AI embeds**.
