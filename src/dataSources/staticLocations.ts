import type { CommunityData, StaticPoint } from './types'

// Community-inzendingen (toevoegingen + wijzigingen op bestaande locaties) leven
// in een aparte data-repo en worden los van de site gepubliceerd: een gemergede
// PR daar verschijnt zo op de kaart, zonder dat deze site opnieuw hoeft te deployen.
const COMMUNITY_DATA_URL = 'https://raw.githubusercontent.com/corvanessen/KoelteKaartData/main/locations.json'

export async function loadCommunityData(): Promise<CommunityData> {
  try {
    const response = await fetch(COMMUNITY_DATA_URL)
    if (!response.ok) return { additions: [], overrides: {} }
    return (await response.json()) as CommunityData
  } catch (error) {
    console.error(error)
    return { additions: [], overrides: {} }
  }
}

export async function loadStaticLocations(baseUrl: string): Promise<StaticPoint[]> {
  const response = await fetch(`${baseUrl}locations.json`)

  if (!response.ok) {
    throw new Error(`Kon locaties niet laden: ${response.status}`)
  }

  const base = (await response.json()) as StaticPoint[]
  const community = await loadCommunityData()

  const withOverrides = base.map((loc) => (community.overrides[loc.id] ? { ...loc, ...community.overrides[loc.id] } : loc))
  const additions = community.additions.map((loc) => (community.overrides[loc.id] ? { ...loc, ...community.overrides[loc.id] } : loc))

  return [...withOverrides, ...additions]
}
