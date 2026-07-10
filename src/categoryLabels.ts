export type CategoryKey = 'water' | 'binnen' | 'park' | 'zwembad' | 'buitenwater' | 'temperatuur'

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  water: 'Drinkwaterpunt',
  binnen: 'Koelteplek binnen',
  park: 'Park / schaduw',
  zwembad: 'Zwembad (betaald)',
  buitenwater: 'Buitenzwemwater (gratis)',
  temperatuur: 'Temperatuur (live)',
}
