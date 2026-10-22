/**
 * Google's Web view (udm=14) is the surest way to get no AI Overview, but it
 * also drops Google's own answer boxes: calculator, currency and unit
 * converter, dictionary, weather, time, sports scores, stock charts, timers.
 * For searches that ask for one of those, ByeAI leaves the address alone and
 * only hides the AI parts on the page (content/google-search.js).
 *
 * Best effort and on purpose narrow: a wrong "yes" only means the AI box is
 * hidden by the page script instead of the Web view.
 *
 * Shared by the service worker. Pure function, no browser APIs.
 */
(function () {
  'use strict';

  // Word edges that also work next to letters like ä and é (\b does not).
  const START = String.raw`(?<![\p{L}\d])`;
  const END = String.raw`(?![\p{L}\d])`;
  const anywhere = (words) => new RegExp(`${START}(?:${words})${END}`, 'iu');
  const atStart = (words) => new RegExp(`^(?:${words})${END}`, 'iu');
  const atEnd = (words) => new RegExp(`${START}(?:${words})$`, 'iu');

  const PATTERNS = [
    // Dictionary: define x, meaning of x, x synonyms, what does x mean
    atStart('define|definition of|meaning of|synonyms? (?:of|for)|antonyms? (?:of|for)|etymology of|pronunciation of|translate|määritelmä|mitä tarkoittaa|bedeutung von|definition von|définition de|signification de|significado de|significato di'),
    /^what (?:does|is the meaning of) .+ (?:mean|means)$/iu,
    atEnd('meaning|definition|synonyms?|antonyms?|etymology|merkitys|bedeutung|signification|significado|significato|betekenis|betydelse'),
    // Weather
    anywhere('weather|forecast|temperature|sää|säätila|sääennuste|säätiedotus|ennuste|lämpötila|wetter|vorhersage|météo|meteo|clima|tiempo en|väder|vejr|vær|pogoda'),
    // Time, timers, clocks
    atStart("what(?:'s| is) the time|what time is it|current time|time now|time in|time at|paljonko kello|kello|wie spät|quelle heure|qué hora|timer|stopwatch|set (?:a )?timer|set (?:an )?alarm|ajastin|metronome|world clock"),
    // Sports scores
    anywhere('scores?|standings|fixtures|league table|livescore|tulokset|sarjataulukko|ottelut|spielstand|tabelle|resultados|classement|risultati|wyniki'),
    // Stock and crypto charts
    anywhere('stock price|share price|stocks?|osakekurssi|aktienkurs|cours de l.action|cotización|bitcoin|btc|ethereum'),
    // Small tools
    atStart('calculator|laskin|taschenrechner|calculatrice|calculadora|calcolatrice|flip a coin|roll (?:a )?dice|random number|coin flip|kolikonheitto|nopanheitto|speed ?test|colou?r picker|protractor|ruler'),
  ];

  // 12 * 8 + 4, 15% of 80, sqrt(49), 2^10
  const MATH_ONLY = /^[\s\d.,+\-*/×÷x^()%=!]+$/iu;
  const MATH_OPERATOR = /[+\-*/×÷^%]|\bx\b/iu;
  const MATH_WORDS = /^(?:sqrt|square root|sin|cos|tan|log|ln|abs|\d+(?:\.\d+)?%? of)(?![\p{L}]).*\d/iu;
  // 100 usd to eur, 5 km in miles, 10 kg -> lb, 3 cups to ml
  const CONVERT = /(?:^|\s)\d[\d.,\s]*\s?[\p{L}$€£¥°]{1,16}\s+(?:to|in|into|as|->|→|=|nach|en|a|em|naar|till|til|na|ile|muunna)\s+[\p{L}$€£¥°]{1,16}(?:\s|$)/iu;
  const CONVERT_WORD = atStart('convert|muunna|umrechnen|convertir|convertire|converter|omrekenen|konvertera');

  function wantsAnswerBox(query) {
    const q = String(query || '').trim().slice(0, 200);
    if (!q) return false;
    if (/\d/.test(q) && MATH_ONLY.test(q) && MATH_OPERATOR.test(q)) return true;
    if (MATH_WORDS.test(q) || CONVERT.test(q) || (CONVERT_WORD.test(q) && /\d/.test(q))) return true;
    return PATTERNS.some((p) => p.test(q));
  }

  globalThis.byeaiWantsAnswerBox = wantsAnswerBox;
})();
