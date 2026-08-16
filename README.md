Koeltekaart van de Leidse regio
work in progress

## Locaties toevoegen/wijzigen en goedkeuren

De locatiedata is verdeeld over twee repo's:

- **Deze repo** bevat de site en de oorspronkelijke, samengestelde locaties in
  [public/locations.json](public/locations.json) (ook gebruikt door de SEO-plugin
  in [vite.config.ts](vite.config.ts) om zoekmachines statische HTML te tonen).
- **[KoelteKaartData](https://github.com/corvanessen/KoelteKaartData)** bevat
  uitsluitend community-inzendingen: nieuwe locaties en wijzigingen ("overrides")
  op bestaande locaties (ook op originelen uit deze repo).

Bezoekers kunnen op de kaart een locatie toevoegen (knop "+" rechtsboven) of via
"Wijziging voorstellen" in een popup een bestaande locatie aanpassen. Elke inzending
gaat naar een kleine Cloudflare Worker ([worker/](worker/)), die er een Pull Request
van maakt op `locations.json` in **KoelteKaartData** (nooit op deze repo).

**Goedkeuren = de PR in KoelteKaartData mergen.** De kaart haalt die data er direct
bij op (`raw.githubusercontent.com`), dus een merge is meteen zichtbaar — deze site
hoeft niet opnieuw te deployen. **Afwijzen = de PR sluiten.**

### De Worker deployen (eenmalig)

1. `cd worker; npm install`
2. Maak een GitHub fine-grained personal access token met alléén toegang tot de
   **KoelteKaartData**-repo en de rechten `Contents: Read and write` + `Pull requests: Read and write`.
3. Maak de KV-namespace voor rate limiting: `npx wrangler kv namespace create koeltekaart-rate-limit`
   en vul de teruggegeven `id` in in [worker/wrangler.toml](worker/wrangler.toml).
4. Maak de KV-namespace voor de temperatuurcache: `npx wrangler kv namespace create koeltekaart-cache`
   en vul de teruggegeven `id` ook in in [worker/wrangler.toml](worker/wrangler.toml) (binding `CACHE_KV`).
5. Zet het token als secret (nooit in wrangler.toml of git): `npx wrangler secret put GITHUB_TOKEN`
6. Deploy: `npm run deploy` — onthoud de uitgegeven `*.workers.dev`-URL. De cron trigger
   in [worker/wrangler.toml](worker/wrangler.toml) haalt vanaf dan elke 15 minuten
   automatisch de RIVM Samen Meten-temperaturen op voor de kaart.
7. Zet die URL (met `/submit` erachter) als repository variable `VITE_SUBMIT_ENDPOINT`,
   en dezelfde URL met `/temperature` erachter als `VITE_TEMPERATURE_ENDPOINT`, in GitHub
   (Settings → Secrets and variables → Actions → Variables), en lokaal in een
   `.env`-bestand (zie [.env.example](.env.example)) voor `npm run dev`.

Zonder deze variabelen toont het formulier gewoon een duidelijke melding in plaats
van te crashen, en blijft de temperatuurlaag beperkt tot sensorleiden.nl.

## Nieuwe locaties vinden via OpenStreetMap

[scripts/import-osm.ts](scripts/import-osm.ts) haalt kandidaat-locaties (bibliotheken,
gemeentehuizen, zwembaden) uit OpenStreetMap voor de hele regio en schrijft ze direct
in je lokale kloon van **KoelteKaartData** — geen los reviewbestand, geen GitHub-token.
Dit zijn **ongeverifieerde kandidaten** — OSM bevestigt alleen dat een gebouw bestaat,
niet dat het tijdens hitte echt vrij toegankelijk is als koelplek, dus de git-diff in
KoelteKaartData is het reviewmoment: verwijder daar wat niet klopt vóór je commit en
pusht (en zet de osm.org-ref uit het desc-veld dan in `scripts/osm-ignore.json`,
anders komt die locatie bij de volgende run terug).

1. Zorg dat **KoelteKaartData** als sibling-map van deze repo gekloond staat (dus
   naast, niet in, deze map) en dat git daar al met jouw GitHub-account kan
   pushen — normale git-inloggegevens, geen apart token. Staat 'm ergens anders,
   zet dan de env var `KOELTEKAART_DATA_PATH` naar het pad.
2. `npm run import:osm` — pullt eerst KoelteKaartData bij (met een schone checkout
   als eis, zodat er nooit iets overschreven wordt) en voegt de kandidaten toe aan
   `locations.json` daarin.
3. Bekijk de diff in KoelteKaartData zoals je dat bij elke andere wijziging doet,
   schrap wat niet klopt, en commit + push zelf wanneer je tevreden bent.