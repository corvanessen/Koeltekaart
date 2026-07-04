import './style.css'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

const dropIcon = L.divIcon({
  html: '<span class="map-drop-icon">💧</span>',
  className: 'map-drop-marker',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
})

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
    <h1>Drinkwaterpunten in Leiden</h1>
    <p>Alle punten uit de GPX-data binnen de gemeente Leiden.</p>
  </header>
  <div id="map"></div>
`

const map = L.map('map').setView([52.1608, 4.497], 12)

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map)

const markerGroup = L.layerGroup().addTo(map)

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

async function loadPoints() {
  try {
    const response = await fetch('/2022 01 Drinkwaterkaart.gpx')

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

        return {
          name,
          lat,
          lon,
          comment,
        } satisfies WaterPoint
      })
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && isInLeiden(point))

    markerGroup.clearLayers()

    points.forEach((point) => {
      const commentText = (point.comment || 'Drinkwaterpunt').replace(/\s+/g, ' ').trim()
      const content = `<div class="tooltip-content"><strong>${point.name}</strong><br /><span class="tooltip-comment">${commentText}</span></div>`

      L.marker([point.lat, point.lon], { icon: dropIcon })
        .bindTooltip(content, {
          sticky: true,
          direction: 'top',
        })
        .bindPopup(content)
        .addTo(markerGroup)
    })

    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon] as [number, number]))
      map.fitBounds(bounds, { padding: [20, 20] })
    } else {
      map.setView([52.1608, 4.497], 12)
    }
  } catch (error) {
    const mapContainer = document.getElementById('map')

    if (mapContainer) {
      mapContainer.innerHTML = '<p class="map-error">Kon de GPX-data niet laden.</p>'
    }

    console.error(error)
  }
}

void loadPoints()
