# Chrome Web Store listing

Paste into the store dashboard. Written for everyday users, no tech words.

No brand or platform names in the description: the store rejected 1.2.1 for "keyword spam" when it listed them (2026-10-18).

## English

**Short description** (comes from the extension itself)

Block AI on the web: chat widgets, copilots, AI Overviews, AI buttons and AI-labeled videos. Allow any site with one click.

**Description**

```
Block AI on the web: chatbots, AI buttons, AI Overviews and AI videos

ByeAI keeps AI out of your way while you browse. It stops AI chat bubbles, AI buttons and AI search answers before they load, and blurs videos and pictures that sites mark as made with AI. You decide which sites can use AI.

==============================
WHAT BYEAI BLOCKS

★ AI chat bubbles and help bots on shops, news sites and apps
★ AI buttons and "write it for me" helpers that sites add
★ AI answers at the top of search results
★ AI-written review summaries in shops (the real reviews stay)
★ Hidden AI connections that sites use to stream AI answers in the background

==============================
AI VIDEOS AND IMAGES

★ Blurs posts and videos that video and social sites label as made with AI
★ Also catches posts with clear AI art tags
★ Each blur says why it is there. Click it to see the post anyway
★ Blurred videos stay paused until you choose to watch

==============================
SIMPLE TO USE

★ Two switches: AI assistants, and AI videos and images
★ See how much was blocked on the page you are on
★ Allow AI on any site with one click, or show AI videos on just that site
★ Your settings follow you to your other computers through Chrome
★ Available in 30 languages

==============================
PRIVATE BY DESIGN

★ Works on your device. We never see what you browse
★ No account, no tracking, no ads
★ ByeAI does not use AI to guess what is AI. It only reacts to labels and tags the site already shows
★ Free and open source: github.com/El-SaMa/byeai

==============================
GOOD TO KNOW

• Chrome shows a notice that ByeAI can read and change data on websites. It needs this to stop AI on the pages you visit. Your browsing history is never sent to us.
• If a site acts strange, press "Allow AI on this site". Everything else stays protected.
• Spotted AI that got through? Use Report in the popup.

Made in Finland by LAFU.
```

## Suomi

**Kuvaus**

```
Estä tekoäly verkossa: chatbotit, tekoälypainikkeet, tekoälykatsaukset ja tekoälyvideot

ByeAI pitää tekoälyn poissa tieltäsi, kun selaat. Se estää tekoälychatit, tekoälypainikkeet ja tekoälyn hakuvastaukset ennen kuin ne latautuvat, ja sumentaa videot ja kuvat, jotka palvelu on merkinnyt tekoälyn tekemiksi. Sinä päätät, millä sivustoilla tekoäly saa toimia.

==============================
MITÄ BYEAI ESTÄÄ

★ Tekoälychatit ja -avustajat verkkokaupoissa, uutissivuilla ja sovelluksissa
★ Tekoälypainikkeet ja "kirjoita puolestani" -apurit, joita sivustot lisäävät
★ Tekoälyn vastaukset hakutulosten yläosassa
★ Verkkokauppojen tekoälyn kirjoittamat arvostelukoosteet (oikeat arvostelut jäävät näkyviin)
★ Taustalla toimivat tekoälyyhteydet, joilla sivustot hakevat vastauksia huomaamatta

==============================
TEKOÄLYVIDEOT JA -KUVAT

★ Sumentaa julkaisut ja videot, jotka video- ja somepalvelut merkitsevät tekoälyn tekemiksi
★ Tunnistaa myös julkaisut, joissa on selvä tekoälytaiteen tunniste
★ Jokainen sumennus kertoo syynsä. Klikkaa, jos haluat silti nähdä
★ Sumennetut videot pysyvät pysäytettyinä, kunnes itse päätät katsoa

==============================
HELPPO KÄYTTÄÄ

★ Kaksi valintaa: tekoälyavustajat sekä tekoälyvideot ja -kuvat
★ Näet, paljonko sivulla estettiin
★ Salli tekoäly millä tahansa sivustolla yhdellä klikkauksella, tai näytä tekoälyvideot vain sillä sivustolla
★ Asetuksesi seuraavat sinua muille tietokoneillesi Chromen kautta
★ Saatavilla 30 kielellä

==============================
YKSITYINEN

★ Toimii laitteellasi. Emme näe, mitä selaat
★ Ei tiliä, ei seurantaa, ei mainoksia
★ ByeAI ei käytä tekoälyä arvatakseen, mikä on tekoälyä. Se reagoi vain merkintöihin ja tunnisteisiin, jotka sivusto itse näyttää
★ Ilmainen ja avointa lähdekoodia: github.com/El-SaMa/byeai

==============================
HYVÄ TIETÄÄ

• Chrome kertoo, että ByeAI voi lukea ja muuttaa sivustojen tietoja. Sitä tarvitaan, jotta tekoäly voidaan estää vierailemillasi sivuilla. Selaushistoriaasi ei koskaan lähetetä meille.
• Jos sivusto toimii oudosti, paina "Salli tekoäly tällä sivustolla". Muualla suojaus pysyy päällä.
• Pääsikö tekoäly läpi? Kerro siitä ponnahdusikkunan Ilmoita-linkillä.

Tehty Suomessa, LAFU.
```

## Images

Ready in `marketing/store/` (24-bit PNG, no alpha):

- Small promo tile: `promo-small-440x280.png`
- Marquee promo tile: `promo-marquee-1400x560.png`
- Screenshots, in this order: `screenshot-1-videos-1280x800.png`, `screenshot-2-popup-1280x800.png`, `screenshot-3-privacy-1280x800.png`

Rebuild with `node scripts/store-images.mjs` then `python scripts/flatten-png.py marketing/store`.
