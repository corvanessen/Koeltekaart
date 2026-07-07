import './style.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// ---------- Categories ----------
// Elke categorie heeft een eigen SVG-icoon (uit de "glyphs-poly" iconset,
// MIT-licentie, via @iconify-json/glyphs-poly), in dezelfde divIcon-opzet
// als voorheen met emoji's.
type CategoryKey = 'water' | 'binnen' | 'park' | 'zwembad' | 'buitenwater'

const CATEGORIES: Record<CategoryKey, { label: string; icon: string }> = {
  water: { label: 'Drinkwaterpunt', icon: `${import.meta.env.BASE_URL}icons/water.svg` },
  binnen: { label: 'Koelteplek binnen', icon: `${import.meta.env.BASE_URL}icons/binnen.svg` },
  park: { label: 'Park / schaduw', icon: `${import.meta.env.BASE_URL}icons/park.svg` },
  zwembad: { label: 'Zwembad (betaald)', icon: `${import.meta.env.BASE_URL}icons/zwembad.svg` },
  buitenwater: { label: 'Buitenzwemwater (gratis)', icon: `${import.meta.env.BASE_URL}icons/buitenwater.svg` },
}

function makeIcon(iconUrl: string) {
  return L.divIcon({
    html: `<span class="map-drop-icon"><img src="${iconUrl}" width="18" height="18" alt="" /></span>`,
    className: 'map-drop-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  })
}

function buildPopupContent(title: string, body: string) {
  return `
    <div class="popup-card">
      <div class="popup-title">${title}</div>
      <div class="popup-body">${body}</div>
    </div>
  `
}

// ---------- Static locations (koelteplekken, parken, zwembaden) ----------
type StaticPoint = {
  cat: Exclude<CategoryKey, 'water'>
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
}

let STATIC_LOCATIONS: StaticPoint[] = []

async function loadStaticLocations() {
  const response = await fetch(`${import.meta.env.BASE_URL}locations.json`)

  if (!response.ok) {
    throw new Error(`Kon locaties niet laden: ${response.status}`)
  }

  STATIC_LOCATIONS = (await response.json()) as StaticPoint[]
}

// ---------- App shell ----------
type WaterPoint = {
  name: string
  lat: number
  lon: number
  comment: string
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App container not found')
}

app.innerHTML = `
  <header class="page-header">
    <div class="header-top">
      <div>
        <h1>Koeltekaart Leiden</h1>
        <p>Koele plekken bij hitte, in en om Leiden.</p>
      </div>
      <div class="weather-badge" id="weatherBadge">Weer wordt geladen…</div>
    </div>
  </header>
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <h2>Categorieën</h2>
      <div id="filters"></div>
      <p class="legend-note">
        Gegevens verzameld uit gemeentelijke berichtgeving, drinkwaterkaart.nl,
        OpenBomenKaart en OpenStreetMap. Locaties en openingstijden kunnen wijzigen.
      </p>
    </aside>
    <div id="map"></div>
  </div>
`

// ---------- Weather (Open-Meteo, geen API-key nodig) ----------
async function loadWeather() {
  const badge = document.getElementById('weatherBadge')
  if (!badge) return
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=52.16&longitude=4.49&current=temperature_2m,apparent_temperature&timezone=Europe%2FAmsterdam',
    )
    const data = await res.json()
    const t = Math.round(data.current.temperature_2m)
    const feels = Math.round(data.current.apparent_temperature)
    badge.innerHTML = `<strong>${t}°C</strong>&nbsp;· voelt als ${feels}°C`
  } catch (error) {
    badge.textContent = 'Weer kon niet worden geladen'
    console.error(error)
  }
}

void loadWeather()

// ---------- Map ----------
const map = L.map('map').setView([52.1608, 4.497], 12)

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map)

// De hoogte van #map hangt af van de flex-layout (header/sidebar), die na
// initialisatie nog kan verschuiven (weerbadge, fonts, filters). Leaflet
// merkt zo'n resize niet vanzelf op, waardoor er een grijze strook zonder
// tegels kan ontstaan. invalidateSize() bijwerken bij elke resize voorkomt dat.
const mapEl = document.getElementById('map')
if (mapEl) {
  new ResizeObserver(() => map.invalidateSize()).observe(mapEl)
}
window.addEventListener('load', () => map.invalidateSize())

// ---------- Mijn locatie ----------
let locationMarker: L.CircleMarker | null = null
let locationAccuracyCircle: L.Circle | null = null
let watchingLocation = false
let hasCenteredOnLocation = false
// Zodra de gebruiker zelf aan de kaart schuift, stoppen we met automatisch
// hercentreren op de locatie-updates (watch:true blijft de marker wel bijwerken).
let userPannedMap = false

map.on('dragstart', () => {
  userPannedMap = true
})

const LocateControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control locate-control')
    const button = L.DomUtil.create('a', 'locate-button', container)
    button.href = '#'
    button.title = 'Mijn locatie tonen'
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', 'Mijn locatie tonen')
    button.innerHTML = '◎'

    L.DomEvent.disableClickPropagation(container)
    L.DomEvent.on(button, 'click', (e) => {
      L.DomEvent.preventDefault(e)
      toggleLocate(button)
    })

    return container
  },
})

map.addControl(new LocateControl())

function toggleLocate(button: HTMLElement) {
  if (watchingLocation) {
    map.stopLocate()
    watchingLocation = false
    button.classList.remove('active')
    if (locationMarker) {
      map.removeLayer(locationMarker)
      locationMarker = null
    }
    if (locationAccuracyCircle) {
      map.removeLayer(locationAccuracyCircle)
      locationAccuracyCircle = null
    }
    return
  }

  button.classList.add('active')
  watchingLocation = true
  hasCenteredOnLocation = false
  userPannedMap = false
  map.locate({ setView: false, watch: true, enableHighAccuracy: true, maxZoom: 16 })
}

map.on('locationfound', (e: L.LocationEvent) => {
  if (!hasCenteredOnLocation) {
    map.setView(e.latlng, 16)
    hasCenteredOnLocation = true
  } else if (!userPannedMap) {
    map.panTo(e.latlng)
  }

  if (!locationMarker) {
    locationMarker = L.circleMarker(e.latlng, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#1a73e8',
      fillOpacity: 1,
    }).addTo(map)
  } else {
    locationMarker.setLatLng(e.latlng)
  }

  if (!locationAccuracyCircle) {
    locationAccuracyCircle = L.circle(e.latlng, {
      radius: e.accuracy,
      color: '#1a73e8',
      weight: 1,
      fillColor: '#1a73e8',
      fillOpacity: 0.12,
    }).addTo(map)
  } else {
    locationAccuracyCircle.setLatLng(e.latlng)
    locationAccuracyCircle.setRadius(e.accuracy)
  }
})

map.on('locationerror', (e: L.ErrorEvent) => {
  watchingLocation = false
  document.querySelector('.locate-button')?.classList.remove('active')
  alert(`Kon locatie niet bepalen: ${e.message}`)
})

const layerGroups: Record<CategoryKey, L.LayerGroup> = {
  water: L.layerGroup().addTo(map),
  binnen: L.layerGroup().addTo(map),
  park: L.layerGroup().addTo(map),
  zwembad: L.layerGroup().addTo(map),
  buitenwater: L.layerGroup().addTo(map),
}

const counts: Record<CategoryKey, number> = { water: 0, binnen: 0, park: 0, zwembad: 0, buitenwater: 0 }

// ---------- Statische locaties toevoegen ----------
async function loadStaticLocationsToMap() {
  try {
    await loadStaticLocations()

    STATIC_LOCATIONS.forEach((loc) => {
      counts[loc.cat]++
      const body = `${loc.addr}${loc.desc ? ' — ' + loc.desc : ''}`
      const content = buildPopupContent(loc.name, body)
      L.marker([loc.lat, loc.lon], { icon: makeIcon(CATEGORIES[loc.cat].icon) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups[loc.cat])
    })

    renderFilters()
  } catch (error) {
    console.error('Kon statische locaties niet laden', error)
  }
}

void loadStaticLocationsToMap()

// ---------- Park-omtrekken (statische GeoJSON, opgehaald uit OpenStreetMap) ----------
type ParkFeatureProperties = {
  name?: string
}

async function loadParkOutlines() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}parks.geojson`)

    if (!response.ok) {
      throw new Error(`Kon park-omtrekken niet laden: ${response.status}`)
    }

    const data = (await response.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon, ParkFeatureProperties>

    L.geoJSON(data, {
      style: {
        color: '#2e7d32',
        weight: 2,
        fillColor: '#66bb6a',
        fillOpacity: 0.2,
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties?.name ?? 'Park'
        layer.bindPopup(buildPopupContent(name, 'Park'), { autoPan: true })
      },
    }).addTo(layerGroups.park)
  } catch (error) {
    console.error('Kon park-omtrekken niet laden', error)
  }
}

void loadParkOutlines()

// ---------- Drinkwaterpunten uit de GPX (ongewijzigde logica) ----------
const municipalityBounds = {
  minLat: 52.11,
  maxLat: 52.28,
  minLon: 4.33,
  maxLon: 4.55,
}

function isInLeiden(point: WaterPoint) {
  return (
    point.lat >= municipalityBounds.minLat &&
    point.lat <= municipalityBounds.maxLat &&
    point.lon >= municipalityBounds.minLon &&
    point.lon <= municipalityBounds.maxLon
  )
}

async function loadWaterPoints() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}2022 01 Drinkwaterkaart.gpx`)

    if (!response.ok) {
      throw new Error(`Kan GPX niet laden: ${response.status}`)
    }

    const text = await response.text()
    const parser = new DOMParser()
    const xml = parser.parseFromString(text, 'application/xml')
    const points = Array.from(xml.querySelectorAll('wpt'))
      .map((waypoint) => {
        const lat = Number(waypoint.getAttribute('lat'))
        const lon = Number(waypoint.getAttribute('lon'))
        const name = waypoint.querySelector('name')?.textContent?.trim() ?? 'Onbekend'
        const comment = waypoint.querySelector('cmt')?.textContent?.trim() ?? ''

        return { name, lat, lon, comment } satisfies WaterPoint
      })
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && isInLeiden(point))

    layerGroups.water.clearLayers()
    counts.water = points.length
    renderFilters() // update de teller in de zijbalk

    points.forEach((point) => {
      const commentText = (point.comment || 'Drinkwaterpunt').replace(/\s+/g, ' ').trim()
      const content = buildPopupContent(point.name, commentText)

      L.marker([point.lat, point.lon], { icon: makeIcon(CATEGORIES.water.icon) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups.water)
    })
  } catch (error) {
    console.error('Kon drinkwaterpunten niet laden', error)
  }
}

void loadWaterPoints()

// ---------- Zijbalk met filters per categorie ----------
function renderFilters() {
  const filtersEl = document.getElementById('filters')
  if (!filtersEl) return

  const checkedState: Record<string, boolean> = {}
  filtersEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((input) => {
    checkedState[input.dataset.cat ?? ''] = input.checked
  })

  filtersEl.innerHTML = ''
  ;(Object.keys(CATEGORIES) as CategoryKey[]).forEach((key) => {
    const cfg = CATEGORIES[key]
    const row = document.createElement('label')
    row.className = 'filter-row'
    const checked = checkedState[key] ?? true
    row.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} data-cat="${key}">
      <img class="filter-emoji" src="${cfg.icon}" width="18" height="18" alt="" />
      <span class="filter-label">${cfg.label}</span>
      <span class="filter-count">${counts[key]}</span>
    `
    filtersEl.appendChild(row)
  })
}

renderFilters()

document.getElementById('filters')?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement
  if (target.matches('input[type=checkbox]')) {
    const cat = target.dataset.cat as CategoryKey
    if (target.checked) {
      map.addLayer(layerGroups[cat])
    } else {
      map.removeLayer(layerGroups[cat])
    }
  }
})
