import type { Locale } from './locale'

export type CategoryKey = 'water' | 'binnen' | 'park' | 'zwembad' | 'buitenwater' | 'temperatuur'

export const CATEGORY_LABELS: Record<Locale, Record<CategoryKey, string>> = {
  nl: {
    water: 'Drinkwaterpunt',
    binnen: 'Koelteplek binnen',
    park: 'Park / schaduw',
    zwembad: 'Zwembad (betaald)',
    buitenwater: 'Buitenzwemwater (gratis)',
    temperatuur: 'Temperatuur (live)',
  },
  en: {
    water: 'Drinking water point',
    binnen: 'Indoor cool spot',
    park: 'Park / shade',
    zwembad: 'Swimming pool (paid)',
    buitenwater: 'Free outdoor swimming water',
    temperatuur: 'Temperature (live)',
  },
}
