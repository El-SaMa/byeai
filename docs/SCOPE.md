# ByeAI — Product Scope

## What it does

ByeAI blocks AI from loading on websites — like an ad blocker, but for AI chat widgets, copilots, embeds, and AI service calls.

| Layer | Behavior |
|-------|----------|
| **Network block (primary)** | Stops AI SDK scripts, embed iframes, chat API calls, and WebSockets before they run |
| **Cosmetic backup (light)** | Hides known AI widget shells if anything slips through |
| **Global on/off** | Master switch — off = nothing blocked |
| **Allow on this site** | Whitelist one site; everything else stays protected |
| **Counters** | *On this page* (current tab) and *In total* (lifetime), shown in popup |
| **Icon hover** | Native tooltip on extension icon with page count |
| **Plain tooltips** | `?` help on each control — simple language for non-tech users |

## What it does NOT do (v1)

- Detect if text, images, or video are AI-generated
- Scan or send page content to external AI services
- Block AI-written article text
- Per-widget granular allow on the same page
- Require account or subscription

## Default behavior

- Installed → blocking **ON** immediately (baked-in rule list)
- Unknown site → block AI loaders
- User clicks **Allow AI on this site** → whitelist + optional reload prompt
- Site acting weird → try Allow or turn ByeAI off

## Platforms

| Version | Platform |
|---------|----------|
| **v1** | Chrome extension (Manifest V3) |
| **Later** | Android, iOS, Windows |

## v1 definition of done

- [x] Core network rules (common AI widgets + LLM APIs)
- [x] Global ByeAI on/off
- [x] Allow on this site + allowed-sites manager in options
- [x] AdBlock-style popup with counters + tooltips
- [x] Icon hover title with page count
- [x] Privacy: no content scanning, local storage only
- [ ] Test on ~20 real sites (manual QA)
