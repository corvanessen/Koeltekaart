import type { ParkFeatureProperties } from './types'

export async function loadParkOutlines(
  baseUrl: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon, ParkFeatureProperties>> {
  const response = await fetch(`${baseUrl}parks.geojson`)

  if (!response.ok) {
    throw new Error(`Kon park-omtrekken niet laden: ${response.status}`)
  }

  return (await response.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon, ParkFeatureProperties>
}
