import L from 'leaflet'
import 'leaflet.markercluster'
import { tempColor } from './markers'

// Vanaf dit zoomniveau tonen we altijd losse markers i.p.v. clusters. Dit is
// het laagste defaultZoom van onze gemeentes (Leiden, zie shared/municipalities.ts),
// dus zodra een hele plaats in beeld is, zijn alle individuele locaties zichtbaar.
export const CITY_ZOOM = 12

export type TempMarker = L.Marker & { tempC: number }

export function attachTemp(marker: L.Marker, tempC: number): TempMarker {
  const tempMarker = marker as TempMarker
  tempMarker.tempC = tempC
  return tempMarker
}

// Icoon bovenin, aantal eronder — zelfde opzet als de temperatuur-cluster
// hierboven, zodat beide nooit over elkaar heen vallen (icoon + telling
// bleven anders lastig te onderscheiden op de kleine clusterbol).
function categoryClusterIcon(iconUrl: string, count: number): L.DivIcon {
  return L.divIcon({
    html: `<span class="category-cluster-badge"><img src="${iconUrl}" width="20" height="20" alt="" /><span class="category-cluster-count">${count}</span></span>`,
    className: 'temp-badge-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

function tempClusterIcon(avgC: number, count: number): L.DivIcon {
  return L.divIcon({
    html: `<span class="temp-cluster-badge" style="background:${tempColor(avgC)}"><span class="temp-cluster-value">${Math.round(avgC)}°</span><span class="temp-cluster-count">${count}</span></span>`,
    className: 'temp-badge-marker',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

function baseOptions(iconCreateFunction: L.MarkerClusterGroupOptions['iconCreateFunction']): L.MarkerClusterGroupOptions {
  return {
    disableClusteringAtZoom: CITY_ZOOM,
    showCoverageOnHover: false,
    iconCreateFunction,
  }
}

export function createClusterGroup(iconUrl: string): L.MarkerClusterGroup {
  return L.markerClusterGroup(baseOptions((cluster) => categoryClusterIcon(iconUrl, cluster.getChildCount())))
}

// Kleinere straal dan de rest: drinkwaterpunten liggen vaak dicht bij elkaar
// binnen één plek (bv. een park), en moeten uiteenvallen zodra ze redelijk
// individueel zichtbaar zouden zijn, niet pas op stadsniveau.
export function createWaterClusterGroup(iconUrl: string): L.MarkerClusterGroup {
  return L.markerClusterGroup({
    ...baseOptions((cluster) => categoryClusterIcon(iconUrl, cluster.getChildCount())),
    maxClusterRadius: 35,
  })
}

export function createTemperatureClusterGroup(): L.MarkerClusterGroup {
  return L.markerClusterGroup({
    ...baseOptions((cluster) => {
      const markers = cluster.getAllChildMarkers() as TempMarker[]
      const avg = markers.reduce((sum, m) => sum + m.tempC, 0) / markers.length
      return tempClusterIcon(avg, markers.length)
    }),
    maxClusterRadius: 50,
  })
}
