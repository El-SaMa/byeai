# ByeAI — Chrome Web Store review checklist

Use this before every submission.

## Extension package

- [ ] Run `scripts/package.ps1` and upload the generated ZIP
- [ ] ZIP root contains `manifest.json` (not a nested folder)
- [ ] Version bumped in `manifest.json` and popup footer
- [ ] No secrets, `.env`, or dev keys in the package
- [ ] Test loaded unpacked build one more time

## Policy & accuracy

- [ ] Store description matches actual behavior (blocks loaders, not AI text detection)
- [ ] Privacy policy URL is **publicly accessible** https URL (see `PRIVACY_HOSTING.md`)
- [ ] Email set in `docs/privacy.html` section 14
- [ ] Chrome Privacy tab answers match `PRIVACY_CHROME_FORM.md`
- [ ] Privacy policy matches code (local storage only, no remote analytics)
- [ ] Single purpose is clear: block AI widgets/API calls
- [ ] No misleading screenshots or claims

## Permissions

- [ ] Every permission has a written justification in the dashboard
- [ ] Host permission scoped to `http://*/*` and `https://*/*` (not `<all_urls>` unless required)
- [ ] No unused permissions (uses `tabs` only, not `webNavigation`)

## Block rules

- [ ] No overly broad rules (removed whole-domain HubSpot/Zendesk/Drift duplicates)
- [ ] No global regex rules that break unrelated sites
- [ ] Rules target known AI widget / AI API hosts

## UX & quality

- [ ] Popup works on http/https pages
- [ ] Allow site + reload flow works
- [ ] Options page lists allowed sites
- [ ] Help/options open correctly
- [ ] Icon visible at 16px toolbar size

## Common rejection reasons (avoided)

| Risk | Mitigation |
|------|------------|
| Permission too broad | http/https only; justify in listing |
| Misleading "AI Blocker" claims | Clear: blocks widgets, not content scanning |
| Broken functionality | Test allow/block toggle and counters |
| Missing privacy policy | Host `docs/privacy.html` |
| Deceptive single purpose | One job: block AI embeds with user allow list |

## Review timeline

Plan **1–3 business days** for first review; respond quickly if Google requests changes.
