import type { CategoryKey } from '../categoryLabels'
import type { MunicipalityId } from '../../shared/municipalities'

export type StaticPoint = {
  id: string
  cat: Exclude<CategoryKey, 'water'>
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  /** Woonplaats, bv. "Warmond" — vrij tekstveld, ingevuld door de beheerder/contribuant. */
  place?: string
  municipality?: MunicipalityId
}

export type LocationOverride = {
  cat: Exclude<CategoryKey, 'water'>
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  place?: string
  municipality?: MunicipalityId
}

// additions = nieuwe community-locaties; overrides = wijzigingen op een bestaande
// id (zowel op een origineel uit Koeltekaart als op een eigen addition).
export type CommunityData = {
  additions: StaticPoint[]
  overrides: Record<string, LocationOverride>
}

export type WaterPoint = {
  name: string
  lat: number
  lon: number
  comment: string
  municipality: MunicipalityId
}

export type TempSource = 'sensorleiden' | 'samenmeten'

export type TempPoint = {
  lat: number
  lon: number
  tempC: number
  humidity: number | null
  updatedAt: string | null
  source: TempSource
  municipality: MunicipalityId
}

export type ParkFeatureProperties = {
  name?: string
}
