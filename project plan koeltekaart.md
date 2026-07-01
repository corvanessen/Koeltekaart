Als je kiest voor **Next.js**, kies je voor een framework dat uitstekend is voor SEO (handig als Leidenaren straks zoeken op "koelteplek Leiden") en supersnel laadt. Omdat je data statisch is (GeoJSON), kun je de site volledig *statically genereren* (SSG), waardoor de hosting alsnog gratis kan (bijvoorbeeld op Vercel in plaats van GitHub Pages, wat perfect samengaat met Next.js).

Hier is het concrete stappenplan om jouw Leidse koeltekaart te bouwen:

---

## 🛠️ Stappenplan: Van Idee naar de Leidse Koeltekaart

### Stap 1: De Projectstructuur & Setup

Begin met het opzetten van een schone Next.js installatie (gebruik de modernere App Router) en installeer de nodige kaartbibliotheken.

> **Tip:** Voor Next.js werkt `MapLibre GL` of `Leaflet` (via `react-leaflet`) prima. MapLibre voelt vaak net iets moderner aan en rendert vectorkaarten soepel, maar Leaflet is eenvoudiger op te zetten met simpele GeoJSON-bestanden.

1. Initialiseer je project:
```bash
npx create-next-app@latest leidse-koeltekaart
# Kies voor: TypeScript (aanbevolen), Tailwind CSS, App Router.

```


2. Installeer je kaart-dependencies (bijvoorbeeld voor Leaflet):
```bash
npm install leaflet react-leaflet @types/leaflet

```



### Stap 2: Data inrichten (De GeoJSON)

Plaats je verzamelde data in de `public/` map van je Next.js project (bijvoorbeeld `public/data/koelte-leiden.geojson`). Zorg dat elk punt in je GeoJSON een duidelijke `category` en `properties` heeft die overeenkomen met je filters:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [4.493, 52.160] },
  "properties": {
    "naam": "BplusC Bibliotheek Nieuwstraat",
    "categorie": "koelteplek-binnen",
    "airco": true,
    "gratis_water": true,
    "toegankelijk": true,
    "openingstijden": "09:00 - 17:00"
  }
}

```

### Stap 3: De Kaart-component Bouwen

Omdat kaarten gebruikmaken van de `window`-browseromgeving, moet je de kaartcomponent in Next.js laden met **Client Components** en dynamische imports om SSR (Server-Side Rendering) fouten te voorkomen.

1. Maak een component `components/CoolMap.tsx` met `"use client";` bovenaan.
2. Importeer deze in je hoofdpagina (`app/page.tsx`) via `next/dynamic` met `ssr: false`:
```tsx
import dynamic from 'next/dynamic';
const CoolMap = dynamic(() => import('@/components/CoolMap'), { ssr: false });

```



### Stap 4: Filters en State Management

Bouw een zijbalk (sidebar) of topbar met Tailwind CSS voor de 5 categorieën.

* Gebruik simpele React `useState` om bij te houden welke filters actief zijn (bijv. een array `activeFilters`).
* Filter de GeoJSON-data in JavaScript *voordat* je deze doorgeeft aan de kaart-markers. Omdat het om tientallen/honderden punten gaat (en geen tienduizenden), kan de browser dit fluitend live filteren.

### Stap 5: De Live Weer-Widget (Open-Meteo)

Maak een kleine component die bij het laden van de pagina (via `useEffect` of een `fetch` in een Server Component) de huidige temperatuur en gevoelstemperatuur (`apparent_temperature`) ophaalt voor de coördinaten van Leiden (52.1601, 4.4960).

* **API-endpoint:** `[https://api.open-meteo.com/v1/forecast?latitude=52.1601&longitude=4.4960&current=temperature_2m,apparent_temperature&timezone=Europe%2FAmsterdam](https://api.open-meteo.com/v1/forecast?latitude=52.1601&longitude=4.4960&current=temperature_2m,apparent_temperature&timezone=Europe%2FAmsterdam)`

### Stap 6: Aanmeldformulier & Deployment

1. **Formulier:** Aangezien je geen backend hebt, kun je voor het aanmeldformulier voor nieuwe locaties een gratis dienst gebruiken zoals **Tally.so**, **Formspree**, of simpelweg een ingebedde **Google Forms** die je netjes styled.
2. **Deployen:** Push je code naar GitHub en koppel het aan **Vercel** (het platform achter Next.js). Dit is binnen 2 minuten gratis geregeld. Elke keer dat je de GeoJSON-data update en pusht naar GitHub, bouwt Vercel de site automatisch opnieuw op.

---

## 💡 Strategisch advies voor de 'Leiden Crux'

Omdat je al aangaf dat de data verzamelen het echte werk is, hier twee tips om dit behapbaar te maken in je Next.js opzet:

* **Start met een Google Sheet:** In plaats van direct GeoJSON te typen, kun je de data (naam, x, y, airco: ja/nee) bijhouden in een gedeelde Google Sheet. Er zijn simpele online tools (of een klein node-scriptje dat je kunt schrijven) om een Google Sheet om te zetten naar GeoJSON. Dit maakt het makkelijker als je straks hulp krijgt van anderen (of de gemeente) bij het vullen.
* **WMS-lagen van de Gemeente:** Je noemde `kaart.leiden.nl`. Hoewel je die niet makkelijk kunt *scrapen*, kun je in de netwerktab van je browser (F12) vaak de directe **WMS- of WFS-URL's** achterhalen als ze de kaart laden. Next.js/Leaflet kan WMS-lagen vaak direct inladen als een overlay-tegelset. Dat kan je heel veel handwerk schelen voor bomen en parken!