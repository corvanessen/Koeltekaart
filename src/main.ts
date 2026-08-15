import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { CATEGORY_LABELS, type CategoryKey } from './categoryLabels'
import { EDITABLE_CATEGORIES, buildSuggestEditLink, initContributions, type EditableCategoryKey } from './contribute'
import { getLocale } from './locale'
import { STRINGS } from './i18n'
import { MUNICIPALITIES, regionEnvelope } from '../shared/municipalities'
import { loadStaticLocations } from './dataSources/staticLocations'
import { loadWaterPoints } from './dataSources/waterPoints'
import { loadParkOutlines } from './dataSources/parks'
import { loadAllTemperatures, SAMEN_METEN_REFRESH_MS, SENSOR_LEIDEN_REFRESH_MS } from './dataSources/temperature'
import { buildPopupContent, makeIcon, makeTempIcon } from './render/markers'
import { createCategoryFilterList } from './render/filters'
import { createMunicipalitySearch } from './render/search'

const locale = getLocale()
const s = STRINGS[locale]

// ---------- Categories ----------
// Elke categorie heeft een eigen SVG-icoon (uit de "glyphs-poly" iconset,
// MIT-licentie, via @iconify-json/glyphs-poly), in dezelfde divIcon-opzet
// als voorheen met emoji's.
const CATEGORIES: Record<CategoryKey, { label: string; icon: string }> = {
  water: { label: CATEGORY_LABELS[locale].water, icon: `${import.meta.env.BASE_URL}icons/water.svg` },
  binnen: { label: CATEGORY_LABELS[locale].binnen, icon: `${import.meta.env.BASE_URL}icons/binnen.svg` },
  park: { label: CATEGORY_LABELS[locale].park, icon: `${import.meta.env.BASE_URL}icons/park.svg` },
  zwembad: { label: CATEGORY_LABELS[locale].zwembad, icon: `${import.meta.env.BASE_URL}icons/zwembad.svg` },
  buitenwater: { label: CATEGORY_LABELS[locale].buitenwater, icon: `${import.meta.env.BASE_URL}icons/buitenwater.svg` },
  temperatuur: { label: CATEGORY_LABELS[locale].temperatuur, icon: `${import.meta.env.BASE_URL}icons/temperatuur.svg` },
}

// ---------- App shell ----------
// De header, sidebar-shell, #map en legend-note staan als statische HTML in
// index.html (voor SEO/crawlability); main.ts vult ze alleen aan (filters,
// weerbadge, kaartmarkers) in plaats van de shell zelf op te bouwen.

// ---------- Zijbalk in-/uitklappen ----------
const layoutEl = document.getElementById('layout')
const sidebarToggle = document.getElementById('sidebarToggle')

sidebarToggle?.addEventListener('click', () => {
  const collapsed = layoutEl?.classList.toggle('sidebar-collapsed') ?? false
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed))
  sidebarToggle.setAttribute('aria-label', collapsed ? s.showCategories : s.hideCategories)
})

// ---------- Weather (Open-Meteo, geen API-key nodig) ----------
async function loadWeather() {
  const badge = document.getElementById('weatherBadge')
  if (!badge) return
  try {
    const { minLat, maxLat, minLon, maxLon } = regionEnvelope()
    const lat = (minLat + maxLat) / 2
    const lon = (minLon + maxLon) / 2
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,apparent_temperature&daily=temperature_2m_max&timezone=Europe%2FAmsterdam`,
    )
    const data = await res.json()
    const t = Math.round(data.current.temperature_2m)
    const feels = Math.round(data.current.apparent_temperature)
    const max = Math.round(data.daily.temperature_2m_max[0])
    badge.innerHTML = s.weatherBadge(t, feels, max)
  } catch (error) {
    badge.textContent = s.weatherError
    console.error(error)
  }
}

void loadWeather()

// ---------- Map ----------
const regionCenter = MUNICIPALITIES.find((m) => m.id === 'leiden')?.center ?? [52.1608, 4.497]
const map = L.map('map').setView(regionCenter, 12)

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  maxZoom: 20,
  subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
}).addTo(map)

initContributions(map)

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
    button.title = s.showMyLocation
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', s.showMyLocation)
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
  alert(s.locationError(e.message))
})

// ---------- Laag-registry: één LayerGroup per categorie ----------
const layerGroups: Record<CategoryKey, L.LayerGroup> = {
  water: L.layerGroup().addTo(map),
  binnen: L.layerGroup().addTo(map),
  park: L.layerGroup().addTo(map),
  zwembad: L.layerGroup().addTo(map),
  buitenwater: L.layerGroup().addTo(map),
  temperatuur: L.layerGroup().addTo(map),
}

const counts: Record<CategoryKey, number> = { water: 0, binnen: 0, park: 0, zwembad: 0, buitenwater: 0, temperatuur: 0 }

const categoryFilters = createCategoryFilterList('filters', CATEGORIES, (cat, checked) => {
  if (checked) {
    map.addLayer(layerGroups[cat])
  } else {
    map.removeLayer(layerGroups[cat])
  }
})

createMunicipalitySearch(
  'municipalitySearch',
  MUNICIPALITIES,
  { placeholder: s.searchPlaceholder, label: s.searchLabel, noResults: s.searchNoResults },
  (result) => {
    map.setView(result.center, result.zoom)
  },
)

// ---------- Statische locaties toevoegen ----------
async function loadStaticLocationsToMap() {
  try {
    const locations = await loadStaticLocations(import.meta.env.BASE_URL)

    locations.forEach((loc) => {
      counts[loc.cat]++
      const editLink = EDITABLE_CATEGORIES.includes(loc.cat as EditableCategoryKey)
        ? buildSuggestEditLink({ ...loc, cat: loc.cat as EditableCategoryKey })
        : ''
      const body = `${loc.addr}${loc.desc ? ' — ' + loc.desc : ''}${editLink}`
      const content = buildPopupContent(loc.name, body)
      const marker = L.marker([loc.lat, loc.lon], { icon: makeIcon(CATEGORIES[loc.cat].icon) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups[loc.cat])
      marker.getElement()?.setAttribute('aria-label', `${CATEGORIES[loc.cat].label}: ${loc.name}`)
    })

    categoryFilters.render(counts)
  } catch (error) {
    console.error('Kon statische locaties niet laden', error)
  }
}

void loadStaticLocationsToMap()

// ---------- Park-omtrekken (statische GeoJSON, opgehaald uit OpenStreetMap) ----------
async function loadParks() {
  try {
    const data = await loadParkOutlines(import.meta.env.BASE_URL)

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
        layerGroups.park.addLayer(layer)
      },
    })
  } catch (error) {
    console.error('Kon park-omtrekken niet laden', error)
  }
}

void loadParks()

// ---------- Drinkwaterpunten uit de GPX ----------
async function loadWater() {
  try {
    const points = await loadWaterPoints(import.meta.env.BASE_URL, s.unknownLocation)

    layerGroups.water.clearLayers()
    counts.water = points.length
    categoryFilters.render(counts)

    points.forEach((point) => {
      const commentText = (point.comment || CATEGORIES.water.label).replace(/\s+/g, ' ').trim()
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

void loadWater()

// ---------- Live temperatuurmetingen (sensorleiden.nl + RIVM Samen Meten) ----------
const TEMP_SOURCE_LABEL = { sensorleiden: s.sourceSensorLeiden, samenmeten: s.sourceSamenMeten }

async function loadTemperatureLayer() {
  try {
    const points = await loadAllTemperatures()

    layerGroups.temperatuur.clearLayers()
    counts.temperatuur = points.length
    categoryFilters.render(counts)

    points.forEach((point) => {
      const time = point.updatedAt
        ? new Date(point.updatedAt).toLocaleTimeString(s.dateLocale, { hour: '2-digit', minute: '2-digit' })
        : null
      const humidityText = point.humidity !== null ? s.humidity(Math.round(point.humidity)) : ''
      const timeText = time ? s.updatedAt(time) : ''
      const sourceText = ` · ${TEMP_SOURCE_LABEL[point.source]}`
      const body = `${point.tempC.toFixed(1)}°C${humidityText}${timeText}${sourceText}`
      const content = buildPopupContent(s.temperatureSensor, body)

      const marker = L.marker([point.lat, point.lon], { icon: makeTempIcon(point.tempC) })
        .bindPopup(content, { autoPan: true })
        .addTo(layerGroups.temperatuur)
      marker.getElement()?.setAttribute('aria-label', `${s.temperatureSensor}: ${point.tempC.toFixed(1)}°C`)
    })
  } catch (error) {
    console.error('Kon temperatuurmetingen niet laden', error)
  }
}

void loadTemperatureLayer()
setInterval(loadTemperatureLayer, Math.min(SENSOR_LEIDEN_REFRESH_MS, SAMEN_METEN_REFRESH_MS))
