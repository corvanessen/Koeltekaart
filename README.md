Koeltekaart van Leiden
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
4. Zet het token als secret (nooit in wrangler.toml of git): `npx wrangler secret put GITHUB_TOKEN`
5. Deploy: `npm run deploy` — onthoud de uitgegeven `*.workers.dev`-URL.
6. Zet die URL (met `/submit` erachter) als repository variable `VITE_SUBMIT_ENDPOINT`
   in GitHub (Settings → Secrets and variables → Actions → Variables), en lokaal in
   een `.env`-bestand (zie [.env.example](.env.example)) voor `npm run dev`.

Zonder deze variabele toont het formulier gewoon een duidelijke melding in plaats
van te crashen.