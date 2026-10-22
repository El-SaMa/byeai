# Changelog

## 1.4.0 (2026-10-22)

- Google: searches for calculator, currency and unit converter, dictionary, weather, time, sports scores and stock charts keep Google's normal page. The Web view dropped those answer boxes. Only the AI parts are hidden there
- Google: AI Mode (udm=50) is sent to the Web view and its tab and buttons are hidden, in every language. Images, News, Shopping, Videos and Maps tabs are never rewritten. Works on every google.* domain
- Google: hiding an AI box also hides the empty space around it
- Bing: the Copilot answer, its follow-up box, its AI notice and the AI Mode tab are hidden (2026 markup)
- DuckDuckGo: Search Assist, its toolbar pill and the Duck.ai chat box are hidden (2026 markup)
- Pause for 1 hour or until tomorrow in the popup, with Resume now. The icon shows II while paused. It ends by itself, also after a browser restart
- Export and import in settings: allowed sites, AI-video sites, hidden and shown channels and switches in one JSON file, no counters. Import checks the file, skips duplicates and invalid entries, and never pushes out what you already have
- What ByeAI sends: a short box in the popup and in the privacy section of settings
- Something looks wrong on this page: one click in the popup opens the Site broken form for this host, without any query string
- New live check script (scripts/live-check.mjs) for real search pages. Not part of the test suite
- No new permissions

## 1.3.0 (2026-10-21)

- Hide channel on YouTube: point at a video and click the button in the corner of its thumbnail, or use Hide channel on a video page. Every video from that channel disappears
- The note after hiding has Undo and Suggest as AI channel
- ByeAI Community list: AI channels reported by ByeAI users, downloaded once a day and blurred like labeled videos
- New settings: Hidden channels, with Unhide, and a switch for the ByeAI Community list
- Both are part of the "AI videos and images" switch
- Suggestions are sent only when you click Suggest, with just the channel and the reason. Nothing about you
- Asks for the "alarms" permission, used for the daily list download
- Help the Community automatically (off by default): when YouTube itself labels a video as AI, ByeAI sends just that channel to the Community list, once per channel per 30 days
- Not AI, show this channel: a button on Community covers shows that channel again everywhere, lists it under "Channels you chose to show", and with the Community list on sends the channel and the reason "not AI", nothing about you
- Covered YouTube videos have one clear panel: Show video, Hide channel, Not AI (Community covers) and Next video on the player. Only the buttons act, a stray click never reveals, and a covered player stays paused until you press Show video

## 1.2.2 (2026-10-21)

- AI apps like ChatGPT now show a ByeAI page instead of hanging, with one click to allow them
- "Allow once" lets an AI app load in that tab only, until you leave the site
- A small notice tells you when ByeAI blocked AI on a site, the first time only. Turn it off in settings
- The popup on an allowed AI app can block it again

## 1.2.1 (2026-10-18)

- Cleaner popup: switch descriptions moved behind a small ? tooltip
- Hashtags read correctly in Arabic and Persian

## 1.2.0 (2026-10-18)

- Now in 30 languages, with a right-to-left layout for Arabic and Persian
- Settings sync between your computers through Chrome sync
- "Show AI videos on this site" in the popup, for sites where you want them
- Hides Amazon's AI review summary ("Customers say"), real reviews stay
- Asks for one permission less: "tabs" was not needed
- Fixed the total counter missing blocks that happened at the same moment
- Down to two switches: "AI assistants" (chatbots, AI search answers and AI buttons) and "AI videos and images"
- Strict mode is gone. Clear AI hashtags like #aiart and #midjourney are now part of "AI videos and images"
- Broad tags like #ai are no longer matched, so news about AI stays visible
- Blurred posts now say why: labeled by the site, or which tag matched
- Fixed a tag sometimes running into the next line ("#aiartPixel")
- Popup shows that ByeAI works on your device, with a link to the source
- Report link opens a short form on GitHub with the page filled in

## 1.1.0 (2026-10-18)

- New switches in the popup: AI buttons, AI-labeled media and strict mode
- Hides AI buttons like Grok, Meta AI, Gemini, Copilot and Rufus
- Blurs posts and videos that sites label as AI. Click to show one
- Covered videos stay paused until you reveal them
- Strict mode catches #aiart, #midjourney, #sora and similar tags
- Counts per category in the popup, plus a count on the toolbar icon
- Report link for AI that slipped through
- Switches apply right away, no reload needed
- Fixed Google AI Overviews that loaded late sometimes staying visible
- Updated privacy policy

## 1.0.4

- Blocks AI chat widgets, copilots and AI search answers
- Allow AI on any site with one click
