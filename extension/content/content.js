const COSMETIC_SELECTORS = [
  '#intercom-container',
  '#intercom-frame',
  '.intercom-lightweight-app',
  '.drift-frame-controller',
  'iframe[src*="intercom"]',
  'iframe[src*="drift"]',
  'iframe[src*="crisp"]',
  'iframe[src*="tidio"]',
  'iframe[src*="zendesk"]',
  'iframe[src*="livechat"]',
  'iframe[src*="chatbot"]',
  'iframe[src*="copilot"]',
  '[data-testid*="chatbot"]',
  '[class*="ai-assistant"]',
  '[id*="copilot" i]',
];

async function isActiveOnPage() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    return Boolean(response?.enabled && !response?.isAllowed);
  } catch {
    return false;
  }
}

function hideKnownWidgets() {
  COSMETIC_SELECTORS.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.dataset.byeaiHidden) return;
        el.dataset.byeaiHidden = '1';
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
        chrome.runtime.sendMessage({
          type: 'COSMETIC_BLOCK',
          key: selector,
        });
      });
    } catch {
      // invalid selector on older browsers
    }
  });
}

async function runPass() {
  if (!(await isActiveOnPage())) return;
  hideKnownWidgets();
}

runPass();

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPass, 400);
});

if (document.documentElement) {
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_CHANGED') {
    runPass();
  }
});
