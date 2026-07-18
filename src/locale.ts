export type Locale = 'nl' | 'en'

// De actieve taal wordt bepaald door het lang-attribuut van de statische
// HTML-shell (index.html vs en/index.html), niet door de browsertaal —
// zo blijft elke taalversie een stabiele, deelbare URL.
export function getLocale(): Locale {
  return document.documentElement.lang === 'en' ? 'en' : 'nl'
}
