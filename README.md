# ByeAI

**Block AI on the web.** ByeAI stops AI features from loading on the websites you visit — chat widgets, embedded copilots, Google AI Overviews and other AI search summaries, "Ask AI" panels, and background AI service calls — before they run. You choose which sites can use AI.

Like an ad blocker, but for AI.

Built by **[LAFU](https://lafu.fi)** · Published by **Maximum Effort AY**, Finland.

---

## What ByeAI blocks

- AI chat widgets, floating help bots, and customer-support AI on news sites, shops, SaaS apps
- Embedded copilots and "Ask AI" / "Summarize with AI" panels
- Google AI Overviews and AI search summaries on Google, Bing, DuckDuckGo, Brave Search, and Ecosia
- Background AI service API calls (OpenAI, Anthropic, Google AI, Mistral, Cohere, Perplexity, etc.)
- AI suggestion overlays and rewrite buttons injected into pages

---

## What ByeAI doesn't do

- Does **not** scan or analyze your text, images, audio, or video
- Does **not** detect AI-generated content
- Does **not** send your browsing history anywhere
- Does **not** require an account
- Does **not** sell your data

Settings and allowed sites stay on your device.

---

## Install

### From the Chrome Web Store

Coming soon. Once approved, install in one click.

### From source (developer mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top-right)
4. Click **Load unpacked** and select the `extension/` folder

---

## Usage

- ByeAI is **on by default**. Click the toolbar icon to see how many AI items were blocked on the current page.
- Need a site's AI on one page? Click **Allow AI on this site**. Everywhere else stays protected.
- Turn ByeAI off anytime from the popup.

UI available in **English** and **Finnish**.

---

## Project structure

```
byeai/
├── extension/        Chrome extension source (load this folder unpacked)
├── docs/             Public website served from GitHub Pages
└── scripts/
    └── package.ps1   Builds the Chrome Web Store ZIP
```

---

## Privacy

ByeAI does not collect or transmit personal data. The only network connections it makes are to **block** known AI requests — no telemetry, no analytics, no remote configuration.

Full policy: [https://el-sama.github.io/byeai/privacy.html](https://el-sama.github.io/byeai/privacy.html)

---

## Building

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

Outputs `dist/byeai-chrome.zip` ready for upload to the Chrome Web Store dashboard.

---

## Contact

Email: **hello@lafu.fi** · Web: [lafu.fi](https://lafu.fi)

---

© 2026 Maximum Effort AY, Finland. ByeAI by LAFU.
