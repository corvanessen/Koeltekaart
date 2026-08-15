import { findMunicipality } from '../../shared/municipalities'
import type { WaterPoint } from './types'

// De GPX-bron (drinkwaterkaart.nl) dekt heel Nederland; we filteren hier op de
// geconfigureerde regio in plaats van op één stad, zodat nieuwe gemeentes
// vanzelf meekomen zonder deze module aan te passen.
export async function loadWaterPoints(baseUrl: string, unknownLocationLabel: string): Promise<WaterPoint[]> {
  const response = await fetch(`${baseUrl}2022 01 Drinkwaterkaart.gpx`)

  if (!response.ok) {
    throw new Error(`Kan GPX niet laden: ${response.status}`)
  }

  const text = await response.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'application/xml')

  const candidates = Array.from(xml.querySelectorAll('wpt')).map((waypoint) => {
    const lat = Number(waypoint.getAttribute('lat'))
    const lon = Number(waypoint.getAttribute('lon'))
    const name = waypoint.querySelector('name')?.textContent?.trim() ?? unknownLocationLabel
    const comment = waypoint.querySelector('cmt')?.textContent?.trim() ?? ''

    return { name, lat, lon, comment, municipality: Number.isFinite(lat) && Number.isFinite(lon) ? findMunicipality({ lat, lon }) : undefined }
  })

  return candidates.filter((point): point is WaterPoint => point.municipality !== undefined)
}
