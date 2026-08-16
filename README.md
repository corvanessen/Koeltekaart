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
gemeentehuizen, zwembaden) uit OpenStreetMap voor de hele regio en schrijft ze naar
`osm-candidates.json` (gitignored). Dit zijn **ongeverifieerde kandidaten** — OSM
bevestigt alleen dat een gebouw bestaat, niet dat het tijdens hitte echt vrij
toegankelijk is als koelplek.

1. `npm run import:osm` — genereert/ververst `osm-candidates.json`.
2. Loop het bestand na en verwijder wat je niet wilt overnemen (bijv. omdat de
   locatie niet vrij toegankelijk blijkt).
3. Maak een GitHub fine-grained personal access token aan (zelfde soort token als
   hierboven bij de Worker: alléén toegang tot **KoelteKaartData**, met
   `Contents: Read and write` + `Pull requests: Read and write`) via
   [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta).
   De worker-secret kun je hier niet voor hergebruiken — die is niet uitleesbaar
   nadat je 'm bij Cloudflare hebt gezet.
4. Zet het token tijdelijk in je terminal en draai het publiceer-script:

   PowerShell:
   ```powershell
   $env:GITHUB_TOKEN = "github_pat_..."
   npm run publish:osm
   ```

   Bash:
   ```bash
   GITHUB_TOKEN=github_pat_... npm run publish:osm
   ```

   Dit zet de token alleen voor die terminalsessie — er wordt niets in een
   bestand of in git opgeslagen.
5. [scripts/publish-osm-candidates.ts](scripts/publish-osm-candidates.ts) opent
   daarmee één PR op KoelteKaartData met alles wat nog in `osm-candidates.json`
   staat. Mergen = goedkeuren, precies zoals bij losse community-inzendingen.