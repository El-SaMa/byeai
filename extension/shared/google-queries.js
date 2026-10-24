/**
 * Google's Web view (udm=14) is the surest way to get no AI Overview, but it
 * also drops Google's own answer boxes: calculator, currency and unit
 * converter, dictionary, weather, time, sports scores, stock charts, timers.
 * flights, maps and places, translation, lyrics, package tracking, holidays,
 * sunrise and sunset. For searches that ask for one of those, ByeAI leaves the address alone and
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

  const UNITS = String.raw`(?:cups?|tablespoons?|teaspoons?|tbsp|tsp|ounces?|oz|pounds?|lbs?|kg|kilos?|kilograms?|grams?|g|km|kilometers?|kilometres?|miles?|meters?|metres?|m|feet|foot|ft|inch(?:es)?|cm|mm|liters?|litres?|l|ml|gallons?|quarts?|pints?|minutes?|hours?|seconds?|days?|weeks?|months?|years?|bytes?|kb|mb|gb|tb|celsius|fahrenheit|kelvin|°c|°f|mph|km/h|kmh|knots?|acres?|hectares?|stone)`;
  const LANGS = String.raw`english|spanish|french|german|finnish|italian|swedish|norwegian|danish|dutch|portuguese|polish|russian|ukrainian|turkish|arabic|persian|farsi|hindi|chinese|japanese|korean|greek|czech|hungarian|romanian|thai|vietnamese|indonesian|latin`;

  const PATTERNS = [
    // Dictionary: define x, meaning of x, x synonyms, what does x mean, spelling
    atStart('define|definition of|meaning of|synonyms? (?:of|for)|antonyms? (?:of|for)|etymology of|pronunciation of|dictionary|thesaurus|rhymes? with|määritelmä|mitä tarkoittaa|sanakirja|bedeutung von|definition von|wörterbuch|définition de|signification de|dictionnaire|significado de|diccionario|significato di|dizionario'),
    /^what (?:does|is the meaning of) .+ (?:mean|means)$/iu,
    atEnd('meaning|definition|synonyms?|antonyms?|etymology|merkitys|bedeutung|signification|significado|significato|betekenis|betydelse'),
    anywhere(String.raw`spell ?check|how (?:do you |to )?spell|spelling of|correct spelling|oikeinkirjoitus|miten kirjoitetaan|rechtschreibung|orthographe|ortografía`),
    // Translate: "translate x", "x in spanish", "hello auf deutsch"
    anywhere('translate|translation|translator|google translate|käännä|käännös|kääntäjä|übersetzen?|übersetzer|traduire|traduction|traducteur|traducir|traducción|traductor|tradurre|traduzione|vertalen|översätt|oversæt|tłumacz'),
    atEnd(String.raw`(?:in|to|into|auf|en|på|i|suomeksi|englanniksi|ruotsiksi)\s+(?:${LANGS})|suomeksi|englanniksi|ruotsiksi|saksaksi|ranskaksi|espanjaksi|auf deutsch|auf englisch|en français|en anglais|en inglés|en español|in italiano|in inglese`),
    // Weather
    anywhere('weather|forecast|temperature|sää|säätila|sääennuste|säätiedotus|ennuste|lämpötila|wetter|vorhersage|météo|meteo|clima|tiempo en|väder|vejr|vær|pogoda'),
    // Sun and moon
    anywhere('sunrise|sunset|moon ?phase|moonrise|moonset|auringonnousu|auringonlasku|kuun vaihe|sonnenaufgang|sonnenuntergang|lever du soleil|coucher du soleil|amanecer|puesta de sol|alba|tramonto'),
    // Time, date, timers, clocks, time zones
    atStart("what(?:'s| is) the time|what time is it|current time|time now|time in|time at|time difference|paljonko kello|kello|wie spät|quelle heure|qué hora|che ora|what(?:'s| is) (?:the |today'?s )?date|what day is (?:it|today)|today'?s date|date today|days (?:until|till|since|left)|how many days (?:until|till|since|are left)|week number|what week|mikä päivä|monesko päivä|viikkonumero|welcher tag|quel jour|qué día"),
    anywhere(String.raw`time ?zones?|aikavyöhyke|zeitzone|fuseau horaire|zona horaria|fuso orario|timers?|stopwatch|countdown|alarm clock|world clock|metronome|ajastin|sekuntikello|stoppuhr|minuterie|chronomètre|temporizador|cronómetro|cronometro|set (?:a |an )?alarm`),
    // Sports: scores, standings, schedules, "A vs B"
    anywhere('scores?|standings|fixtures|league table|livescore|tulokset|sarjataulukko|ottelut|spielstand|tabelle|resultados|classement|risultati|wyniki'),
    atEnd('schedule|fixtures|ottelu|ottelut|pelit|otteluohjelma|spielplan|calendrier|calendario de partidos'),
    anywhere(String.raw`vs\.?|versus`),
    // Stock, crypto and exchange rates
    anywhere('stock price|share price|stocks?|market cap|osakekurssi|aktienkurs|cours de l.action|cotización|bitcoin|btc|ethereum|dogecoin|solana|litecoin|cardano|xrp|crypto(?:currency)? (?:prices?|market)|dow jones|nasdaq|s&p ?500|ftse|nikkei|exchange rate|valuuttakurssi|wechselkurs|taux de change|tipo de cambio|tasso di cambio'),
    // Flights
    anywhere(String.raw`flights?|flight status|flight tracker|lennot|lento|flüge|flugstatus|vuelos|voli|vols? (?:pour|vers|de)`),
    // Maps, places, directions
    anywhere('near me|nearby|nearest|closest|open now|opening hours|lähellä|lähin|lähimmät|aukioloajat|in der nähe|öffnungszeiten|près de chez moi|près de moi|horaires d.ouverture|cerca de mí|cerca de mi|cerca de aquí|vicino a me|nära mig|i nærheden|w pobliżu|in de buurt'),
    atStart(String.raw`directions?(?: to| from)?|route (?:to|from)|how (?:far|long) (?:is|to|does it take)|distance (?:from|between|to)|maps? of|google maps|kartta|reitti|reittiohje|etäisyys|karte von|wegbeschreibung|entfernung|itinéraire|plan de|cómo llegar|mapa de|indicazioni|mappa di`),
    atEnd('google maps|on (?:the )?map|kartalla|auf der karte|sur la carte|en el mapa|sulla mappa'),
    // Lyrics
    anywhere('lyrics|songtext|paroles de|letra de|sanoitukset|laulun sanat|testo di|testo della canzone'),
    // Package tracking
    anywhere(String.raw`track(?:ing)?(?: a| my)? (?:package|parcel|order|shipment)|package tracking|parcel tracking|tracking number|paketin seuranta|lähetyksen seuranta|postin seuranta|sendungsverfolgung|paketverfolgung|suivi de colis|suivi colis|seguimiento de paquete|seguimiento de envío|rastreo|tracciare pacco|tracking pacco`),
    /(?:^|\s)1Z[0-9A-Z]{16}(?:\s|$)/u,
    /(?:^|\s)[A-Z]{2}\d{9}[A-Z]{2}(?:\s|$)/u,
    /^\d{12,22}$/u,
    // Holidays
    anywhere(String.raw`(?:public|bank|national|school) holidays?|holidays? (?:in|on|for|\d{4})|\d{4} holidays?|lomapäivät|pyhäpäivät|juhlapäivät|feiertage?|jours fériés|días festivos|festività`),
    // Own IP address
    /^(?:what(?:'s| is) )?my ip(?: address)?$|^mikä on ip-osoitteeni$|^meine ip(?:-adresse)?$/iu,
    // Small tools
    anywhere('speed ?test|internet speed|nopeustesti|geschwindigkeitstest|test de vitesse|test de velocidad'),
    atStart('calculator|laskin|taschenrechner|calculatrice|calculadora|calcolatrice|flip a coin|roll (?:a )?dice|random number|coin flip|kolikonheitto|nopanheitto|colou?r picker|protractor|ruler'),
    // Unit conversion: "celsius to fahrenheit", "how many cups in a quart"
    new RegExp(String.raw`^${UNITS}\s+(?:to|in|into)\s+${UNITS}$`, 'iu'),
    new RegExp(String.raw`^how (?:many|much) (?:${UNITS}\s+)?(?:are |is )?(?:in|per) (?:an? |one |1 |\d+ )?${UNITS}$`, 'iu'),
    new RegExp(String.raw`^how (?:many|much) ${UNITS} (?:in|per)\b`, 'iu'),
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
