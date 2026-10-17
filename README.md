# ByeAI

Block AI on the web. ByeAI stops chat widgets, copilots, AI Overviews and AI buttons before they load, and blurs videos and posts that sites label as AI. You choose which sites can use AI.

Like an ad blocker, but for AI. [Get it on the Chrome Web Store](https://chromewebstore.google.com/detail/byeai-block-ai-on-the-web/edlaekiaipaefekkomllmlhnmonpfbcl).

## What it blocks

- **Chatbots and AI search**: chat widgets, copilots, Google AI Overviews, Bing Copilot, DuckDuckGo and Brave AI answers
- **AI buttons**: Grok, Meta AI, Gemini, Copilot, Rufus, "Help me write" and friends
- **AI-labeled media**: blurs posts and videos that YouTube, TikTok, Instagram, Facebook, Pinterest and others mark as AI. Click one to see it anyway
- **Strict mode** (off by default): also blurs posts tagged #aiart, #midjourney, #sora and similar

Each one has its own switch in the popup. Everything runs on your device, nothing is sent anywhere.

## Development

Load `extension/` as an unpacked extension. Run the tests with `npm install` and `npm test`.

Built by [LAFU](https://lafu.fi). Published by Maximum Effort AY, Finland.
