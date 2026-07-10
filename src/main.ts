import './style.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// ---------- Categories ----------
// Elke categorie heeft een eigen SVG-icoon (uit de "glyphs-poly" iconset,
// MIT-licentie, via @iconify-json/glyphs-poly), in dezelfde divIcon-opzet
// als voorheen met emoji's.
type CategoryKey = 'water' | 'binnen' | 'park' | 'zwembad' | 'buitenwater' | 'temperatuur'

const CATEGORIES: Record<CategoryKey, { label: string; icon: string }> = {
  water: { label: 'Drinkwaterpunt', icon: `${import.meta.env.BASE_URL}icons/water.svg` },
  binnen: { label: 'Koelteplek binnen', icon: `${import.meta.env.BASE_URL}icons/binnen.svg` },
  park: { label: 'Park / schaduw', icon: `${import.meta.env.BASE_URL}icons/park.svg` },
  zwembad: { label: 'Zwembad (betaald)', icon: `${import.meta.env.BASE_URL}icons/zwembad.svg` },
  buitenwater: { label: 'Buitenzwemwater (gratis)', icon: `${import.meta.env.BASE_URL}icons/buitenwater.svg` },
  temperatuur: { label: 'Temperatuur (live)', icon: `${import.meta.env.BASE_URL}icons/temperatuur.svg` },
}

function makeIcon(iconUrl: string) {
  return L.divIcon({
    html: `<span class="map-drop-icon"><img src="${iconUrl}" width="36" height="36" alt="" /></span>`,
    className: 'map-drop-marker',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -18],
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
      <div class="weather-badge" id="weatherBadge" aria-live="polite">Weer wordt geladen…</div>
    </div>
  </header>
  <main class="layout" id="layout">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-inner">
        <h2>Categorieën</h2>
        <div id="filters"></div>
      </div>
      <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-expanded="true" aria-controls="sidebar" aria-label="Verberg categorieën">
        <span class="chevron" aria-hidden="true">‹</span>
      </button>
    </aside>
    <div id="map"></div>
    <p class="legend-note">
      Gegevens verzameld uit gemeentelijke berichtgeving, drinkwaterkaart.nl,
      OpenBomenKaart, OpenStreetMap en sensorleiden.nl (live temperatuursensoren).
      Locaties, openingstijden en metingen kunnen wijzigen.
      <a class="legend-github" href="https://github.com/corvanessen/Koeltekaart" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub repository">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
            -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
            .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
            -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
            1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
            1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
            0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
        </svg>
      </a>
    </p>
  </main>
`

// ---------- Zijbalk in-/uitklappen ----------
const layoutEl = document.getElementById('layout')
const sidebarToggle = document.getElementById('sidebarToggle')

sidebarToggle?.addEventListener('click', () => {
  const collapsed = layoutEl?.classList.toggle('sidebar-collapsed') ?? false
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed))
  sidebarToggle.setAttribute('aria-label', collapsed ? 'Toon categorieën' : 'Verberg categorieën')
})

// ---------- Weather (Open-Meteo, geen API-key nodig) ----------
async function loadWeather() {
  const badge = document.getElementById('weatherBadge')
  if (!badge) return
  try {
    const res = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=52.16&longitude=4.49&current=temperature_2m,apparent_temperature&daily=temperature_2m_max&timezone=Europe%2FAmsterdam',
    )
    const data = await res.json()
    const t = Math.round(data.current.temperature_2m)
    const feels = Math.round(data.current.apparent_temperature)
    const max = Math.round(data.daily.temperature_2m_max[0])
    badge.innerHTML = `<strong>${t}°C</strong>&nbsp;· voelt als ${feels}°C&nbsp;· max ${max}°C`
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
    // role="button" only makes Enter work natively on an <a>; Space needs a manual handler.
    L.DomEvent.on(button, 'keydown', (e) => {
      const key = (e as KeyboardEvent).key
      if (key === ' ' || key === 'Spacebar') {
        L.DomEvent.preventDefault(e)
        toggleLocate(button)
      }
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
  temperatuur: L.layerGroup().addTo(map),
}

const counts: Record<CategoryKey, number> = { water: 0, binnen: 0, park: 0, zwembad: 0, buitenwater: 0, temperatuur: 0 }

// ---------- Statische locaties toevoegen ----------
async function loadStaticLocationsToMap() {
  try {
    await loadStaticLocations()

    STATIC_LOCATIONS.forEach((loc) => {
      counts[loc.cat]++
      const body = `${loc.addr}${loc.desc ? ' — ' + loc.desc : ''}`
      const content = buildPopupContent(loc.name, body)
      const marker = L.marker([loc.lat, loc.lon], { icon: makeIcon(CATEGORIES[loc.cat].icon) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups[loc.cat])
      marker.getElement()?.setAttribute('aria-label', `${CATEGORIES[loc.cat].label}: ${loc.name}`)
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

function isInLeiden(point: { lat: number; lon: number }) {
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

      const marker = L.marker([point.lat, point.lon], { icon: makeIcon(CATEGORIES.water.icon) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups.water)
      marker.getElement()?.setAttribute('aria-label', `${CATEGORIES.water.label}: ${point.name}`)
    })
  } catch (error) {
    console.error('Kon drinkwaterpunten niet laden', error)
  }
}

void loadWaterPoints()

// ---------- Live temperatuurmetingen (sensorleiden.nl) ----------
// sensorleiden.nl ontsluit het "Sensor Leiden" citizen-science netwerk
// (Sensor.Community-achtige BME280-sensoren) als open JSON, geen API-key nodig.
// KNMI WOW-NL en Weather Underground bleken geen bruikbare gratis/directe
// API voor Leiden te hebben; Meet je Stad! werkt technisch maar heeft momenteel
// geen actieve sensoren in Leiden.
const TEMP_API_URL = 'https://www.sensorleiden.nl/api/data/now'
const TEMP_REFRESH_MS = 5 * 60 * 1000
// Kapotte/losgekoppelde BME280-sensoren rapporteren soms extreme uitschieters
// (bv. -140°C); die filteren we hier weg als onrealistisch voor buitenlucht.
const TEMP_MIN_PLAUSIBLE = -15
const TEMP_MAX_PLAUSIBLE = 45

type SensorLeidenReading = {
  location_id: number
  value_type: string
  value: string
  updated_at?: string
  location?: { lat: string; long: string }
}

type TempPoint = {
  lat: number
  lon: number
  tempC: number
  humidity: number | null
  updatedAt: string | null
}

function tempColor(tempC: number): string {
  const stops: [number, [number, number, number]][] = [
    [12, [47, 128, 237]], // koel: blauw
    [22, [242, 153, 74]], // aangenaam: oranje
    [32, [235, 87, 87]], // warm: rood
  ]

  const clamped = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], tempC))
  const upperIndex = stops.findIndex(([t]) => t >= clamped)
  const [t1, c1] = stops[Math.max(0, upperIndex - 1)]
  const [t2, c2] = stops[upperIndex]
  const ratio = t2 === t1 ? 0 : (clamped - t1) / (t2 - t1)
  const [r, g, b] = c1.map((channel, i) => Math.round(channel + (c2[i] - channel) * ratio))

  return `rgb(${r}, ${g}, ${b})`
}

function makeTempIcon(tempC: number) {
  return L.divIcon({
    html: `<span class="temp-badge" style="background:${tempColor(tempC)}">${Math.round(tempC)}°</span>`,
    className: 'temp-badge-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  })
}

async function loadTemperatureLayer() {
  try {
    const response = await fetch(TEMP_API_URL)

    if (!response.ok) {
      throw new Error(`Kon temperatuurmetingen niet laden: ${response.status}`)
    }

    const data = (await response.json()) as { sensors: SensorLeidenReading[] }
    const sensors = data.sensors ?? []

    const humidityByLocation = new Map<number, number>()
    sensors.forEach((sensor) => {
      if (sensor.value_type === 'humidity') {
        const humidity = Number.parseFloat(sensor.value)
        if (Number.isFinite(humidity)) {
          humidityByLocation.set(sensor.location_id, humidity)
        }
      }
    })

    const points: TempPoint[] = sensors
      .filter((sensor) => sensor.value_type === 'temperature')
      .map((sensor) => ({
        lat: Number.parseFloat(sensor.location?.lat ?? ''),
        lon: Number.parseFloat(sensor.location?.long ?? ''),
        tempC: Number.parseFloat(sensor.value),
        humidity: humidityByLocation.get(sensor.location_id) ?? null,
        updatedAt: sensor.updated_at ?? null,
      }))
      .filter(
        (point) =>
          Number.isFinite(point.lat) &&
          Number.isFinite(point.lon) &&
          isInLeiden(point) &&
          Number.isFinite(point.tempC) &&
          point.tempC > TEMP_MIN_PLAUSIBLE &&
          point.tempC < TEMP_MAX_PLAUSIBLE,
      )

    layerGroups.temperatuur.clearLayers()
    counts.temperatuur = points.length
    renderFilters()

    points.forEach((point) => {
      const time = point.updatedAt
        ? new Date(point.updatedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
        : null
      const humidityText = point.humidity !== null ? ` · ${Math.round(point.humidity)}% luchtvochtigheid` : ''
      const timeText = time ? ` · bijgewerkt ${time}` : ''
      const body = `${point.tempC.toFixed(1)}°C${humidityText}${timeText}`
      const content = buildPopupContent('Temperatuursensor', body)

      const marker = L.marker([point.lat, point.lon], { icon: makeTempIcon(point.tempC) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups.temperatuur)
      marker
        .getElement()
        ?.setAttribute('aria-label', `Temperatuursensor: ${point.tempC.toFixed(1)}°C`)
    })
  } catch (error) {
    console.error('Kon temperatuurmetingen niet laden', error)
  }
}

void loadTemperatureLayer()
setInterval(loadTemperatureLayer, TEMP_REFRESH_MS)

// ---------- Zijbalk met filters per categorie ----------
// De rijen worden één keer aangemaakt en daarna alleen bijgewerkt (i.p.v.
// innerHTML te vervangen), anders verliest een toetsenbordgebruiker de focus
// zodra de 5-minuten temperatuurrefresh de tellers ververst.
const filterCountEls = new Map<CategoryKey, HTMLSpanElement>()

function renderFilters() {
  const filtersEl = document.getElementById('filters')
  if (!filtersEl) return

  if (filterCountEls.size === 0) {
    ;(Object.keys(CATEGORIES) as CategoryKey[]).forEach((key) => {
      const cfg = CATEGORIES[key]
      const row = document.createElement('label')
      row.className = 'filter-row'

      const input = document.createElement('input')
      input.type = 'checkbox'
      input.checked = true
      input.dataset.cat = key

      const icon = document.createElement('img')
      icon.className = 'filter-emoji'
      icon.src = cfg.icon
      icon.width = 18
      icon.height = 18
      icon.alt = ''

      const label = document.createElement('span')
      label.className = 'filter-label'
      label.textContent = cfg.label

      const count = document.createElement('span')
      count.className = 'filter-count'
      count.textContent = String(counts[key])

      row.append(input, icon, label, count)
      filtersEl.appendChild(row)
      filterCountEls.set(key, count)
    })
  } else {
    filterCountEls.forEach((count, key) => {
      count.textContent = String(counts[key])
    })
  }
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
