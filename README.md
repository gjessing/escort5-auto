# escort5-auto — Automatisk artikel-generator

## Installation (kun første gang)

1. Åbn Terminal på din Mac
2. Installer Node.js hvis du ikke har det: https://nodejs.org (vælg LTS)
3. Naviger til mappen og kør:

```bash
cd escort5-auto
npm install
npx playwright install chromium
```

4. Åbn `.env` filen og indsæt din Anthropic API-nøgle:
```
ANTHROPIC_API_KEY=din-rigtige-nøgle-her
```

---

## Brug

```bash
node artikel.js --by "København" --emne "diskret escort guide"
```

Med ekstra instruktioner:
```bash
node artikel.js --by "Aarhus" --emne "massage" --extra "skriv til kvinder, nævn diskrethed"
```

Kør i baggrunden uden at se browser:
```bash
node artikel.js --by "Odense" --emne "escort tips" --headless
```

---

## Hvad sker der?

1. Claude genererer artikel (titel, intro, brødtekst, meta, billedtekst)
2. Playwright åbner Chrome, logger automatisk ind
3. Alle felter udfyldes automatisk
4. Browser holdes åben i 2 min — du kan tjekke og trykke Gem selv
5. Screenshot gemmes som `screenshot.png`

---

## Fejlfinding

- **Felt ikke fundet**: Login-felternes ID er anderledes — åbn siden i browser, F12 og find de rigtige IDs
- **Login fejler**: Tjek brugernavn/adgangskode i `.env`
- **API fejl**: Tjek din `ANTHROPIC_API_KEY` i `.env`
