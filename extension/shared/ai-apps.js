/**
 * AI apps people open on purpose. ByeAI never blocks or hides anything on
 * these sites: you chose to be there. The same services embedded in other
 * sites are still blocked.
 *
 * Loaded by the service worker (importScripts), the content scripts and the
 * popup, so this is the single list.
 */
globalThis.BYEAI_AI_APPS = [
  'chatgpt.com',
  'chat.openai.com',
  'platform.openai.com',
  'sora.com',
  'claude.ai',
  'console.anthropic.com',
  'gemini.google.com',
  'aistudio.google.com',
  'notebooklm.google.com',
  'copilot.microsoft.com',
  'perplexity.ai',
  'poe.com',
  'chat.mistral.ai',
  'chat.deepseek.com',
  'grok.com',
  'meta.ai',
  'character.ai',
  'huggingface.co',
  'you.com',
  'phind.com',
  'pi.ai',
  'midjourney.com',
  'suno.com',
  'runwayml.com',
];

globalThis.byeaiIsAiApp = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  return globalThis.BYEAI_AI_APPS.some((d) => host === d || host.endsWith('.' + d));
};
