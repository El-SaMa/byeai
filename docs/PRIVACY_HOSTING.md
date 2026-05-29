# Host ByeAI privacy on lafu.fi

Chrome Web Store requires a public **https** privacy policy URL.

## Production URLs (lafu.fi)

Deploy the `docs/` folder to **lafu.fi** and use:

| Page | URL |
|------|-----|
| Privacy policy (Chrome dashboard) | `https://lafu.fi/privacy` or `https://lafu.fi/privacy.html` |
| Support | `https://lafu.fi/support` |
| LAFU home | `https://lafu.fi/` |
| ByeAI product | `https://lafu.fi/byeai` |

## Publisher

| Role | Name |
|------|------|
| Legal entity | Maximum Effort AY, Finland |
| Brand | LAFU (lafu.fi) |
| Product | ByeAI |
| Contact | hello@lafu.fi |

## Deploy options

### Option A: Point lafu.fi at static hosting

Upload `docs/` contents to your web host for lafu.fi (Netlify, Cloudflare Pages, your server).

### Option B: GitHub Pages + custom domain

1. Push this repo to GitHub (private repo is fine)
2. Settings → Pages → source `/docs`
3. Custom domain: `lafu.fi`
4. Add DNS records your host requires (often CNAME `www` or A records for apex)

## Chrome dashboard

**Privacy policy URL:**
```
https://lafu.fi/privacy.html
```

**Support URL (optional):**
```
https://lafu.fi/support.html
```

**Developer / trader:** Maximum Effort AY, Finland

Form answers: `PRIVACY_CHROME_FORM.md`

## Verify before submit

- [ ] https://lafu.fi/privacy.html loads in incognito
- [ ] Copyright shows Maximum Effort AY + LAFU
- [ ] hello@lafu.fi is live or forwards to you
