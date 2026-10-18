// Renders the Chrome Web Store promo tiles and screenshots into marketing/store/.
//   node scripts/store-images.mjs
// Then run: python scripts/flatten-png.py marketing/store  (store wants PNG without alpha)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'marketing', 'store');
mkdirSync(out, { recursive: true });

const img = (p) => `data:image/png;base64,${readFileSync(path.join(root, p)).toString('base64')}`;
const icon = img('extension/assets/icons/icon128.png');
const popup = img('docs/img/popup.png');
const youtube = img('docs/img/youtube.png');

const base = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color: #0b3b37;
    background: linear-gradient(135deg, #ecfdf8 0%, #c6efe5 100%); overflow: hidden; }
  .brand { display: flex; align-items: center; }
  .brand img { display: block; }
  .name { font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  .teal { color: #0f766e; }
  .muted { color: #3f6b66; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { padding: 8px 16px; border-radius: 999px; background: #fff; color: #0f766e;
    font-weight: 600; box-shadow: 0 1px 3px rgba(15, 118, 110, 0.15); }
  .shot { border-radius: 16px; box-shadow: 0 24px 60px rgba(11, 59, 55, 0.25); display: block; }
`;

const pages = {
  'promo-small-440x280': [440, 280, `
    <div style="height:100%;display:flex;align-items:center;gap:22px;padding:0 34px">
      <img src="${icon}" width="104" height="104">
      <div>
        <div class="name" style="font-size:54px">ByeAI</div>
        <div class="teal" style="font-size:21px;font-weight:700;margin-top:8px">Block AI on the web</div>
        <div class="muted" style="font-size:15px;margin-top:6px">Chatbots, AI buttons, AI videos</div>
      </div>
    </div>`],

  'promo-marquee-1400x560': [1400, 560, `
    <div style="height:100%;display:flex;align-items:center;justify-content:space-between;padding:0 90px">
      <div style="max-width:720px">
        <div class="brand" style="gap:22px"><img src="${icon}" width="96" height="96"><span class="name" style="font-size:92px">ByeAI</span></div>
        <div class="teal" style="font-size:40px;font-weight:700;margin-top:22px">Block AI on the web.</div>
        <div class="muted" style="font-size:24px;margin-top:14px;line-height:1.4">Chatbots, AI buttons and AI-labeled videos, gone. You choose which sites keep AI.</div>
        <div class="chips" style="margin-top:28px;font-size:18px">
          <span class="chip">Works on your device</span><span class="chip">Open source</span><span class="chip">30 languages</span>
        </div>
      </div>
      <img class="shot" src="${popup}" height="480" style="transform:rotate(2deg)">
    </div>`],

  'screenshot-1-videos-1280x800': [1280, 800, `
    <div style="height:100%;display:flex;flex-direction:column;align-items:center;padding-top:44px">
      <div class="name" style="font-size:44px">AI videos get blurred</div>
      <div class="muted" style="font-size:22px;margin-top:10px">When a site labels a video as AI, ByeAI covers it. Click if you still want to watch.</div>
      <img class="shot" src="${youtube}" style="margin-top:34px;height:590px">
    </div>`],

  'screenshot-2-popup-1280x800': [1280, 800, `
    <div style="height:100%;display:flex;align-items:center;justify-content:center;gap:90px">
      <div style="max-width:520px">
        <div class="name" style="font-size:52px">Two switches.<br>That's it.</div>
        <ul style="list-style:none;margin-top:30px;font-size:23px;line-height:1.45">
          <li style="margin-bottom:18px"><b class="teal">AI assistants</b><br><span class="muted">Chatbots, AI answers, Grok, Gemini, Copilot</span></li>
          <li style="margin-bottom:18px"><b class="teal">AI videos and images</b><br><span class="muted">Blurred, with a click to show</span></li>
          <li><b class="teal">Allow any site</b><br><span class="muted">One click when you do want AI</span></li>
        </ul>
      </div>
      <img class="shot" src="${popup}" height="700">
    </div>`],

  'screenshot-3-privacy-1280x800': [1280, 800, `
    <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      <img src="${icon}" width="120" height="120">
      <div class="name" style="font-size:54px;margin-top:26px">Works on your device</div>
      <div class="muted" style="font-size:26px;margin-top:14px">We never see what you browse.</div>
      <div class="chips" style="margin-top:44px;font-size:22px;justify-content:center;max-width:1180px">
        <span class="chip">No account</span><span class="chip">No tracking</span><span class="chip">No ads</span>
        <span class="chip">Open source</span><span class="chip">Settings sync with Chrome</span><span class="chip">30 languages</span>
      </div>
    </div>`],
};

const browser = await chromium.launch({ channel: 'chromium', headless: true });
for (const [name, [w, h, body]] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${base}</style></head><body style="width:${w}px;height:${h}px">${body}</body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  await page.close();
  console.log(name);
}
await browser.close();
