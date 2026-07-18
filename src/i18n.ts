import type { Locale } from './locale'

export const STRINGS: Record<
  Locale,
  {
    showCategories: string
    hideCategories: string
    weatherError: string
    weatherBadge: (t: number, feels: number, max: number) => string
    showMyLocation: string
    locationError: (message: string) => string
    addLocation: string
    addModeBanner: string
    unknownLocation: string
    temperatureSensor: string
    humidity: (value: number) => string
    updatedAt: (time: string) => string
    suggestEdit: string
    suggestEditHeading: (name: string) => string
    addLocationHeading: string
    fieldName: string
    fieldCategory: string
    fieldAddress: string
    fieldDescription: string
    fieldWebsite: string
    cancel: string
    submitSuggestion: string
    statusNeedName: string
    statusSubmitNotActive: string
    statusSending: string
    statusSubmitted: string
    statusSubmitFailed: string
    dateLocale: string
  }
> = {
  nl: {
    showCategories: 'Toon categorieën',
    hideCategories: 'Verberg categorieën',
    weatherError: 'Weer kon niet worden geladen',
    weatherBadge: (t, feels, max) => `<strong>${t}°C</strong>&nbsp;· voelt als ${feels}°C&nbsp;· max ${max}°C`,
    showMyLocation: 'Mijn locatie tonen',
    locationError: (message) => `Kon locatie niet bepalen: ${message}`,
    addLocation: 'Locatie toevoegen',
    addModeBanner: 'Klik op de kaart om een locatie toe te voegen. Klik nogmaals op de knop om te annuleren.',
    unknownLocation: 'Onbekend',
    temperatureSensor: 'Temperatuursensor',
    humidity: (value) => ` · ${value}% luchtvochtigheid`,
    updatedAt: (time) => ` · bijgewerkt ${time}`,
    suggestEdit: 'Wijziging voorstellen',
    suggestEditHeading: (name) => `Wijziging voorstellen: ${name}`,
    addLocationHeading: 'Locatie toevoegen',
    fieldName: 'Naam',
    fieldCategory: 'Categorie',
    fieldAddress: 'Adres',
    fieldDescription: 'Beschrijving',
    fieldWebsite: 'Website',
    cancel: 'Annuleren',
    submitSuggestion: 'Voorstel versturen',
    statusNeedName: 'Vul een naam in.',
    statusSubmitNotActive: 'Het versturen van voorstellen is nog niet actief op deze kaart.',
    statusSending: 'Versturen…',
    statusSubmitted: 'Bedankt! Je voorstel wordt eerst beoordeeld voordat het op de kaart verschijnt.',
    statusSubmitFailed: 'Versturen is niet gelukt. Probeer het later opnieuw.',
    dateLocale: 'nl-NL',
  },
  en: {
    showCategories: 'Show categories',
    hideCategories: 'Hide categories',
    weatherError: 'Weather could not be loaded',
    weatherBadge: (t, feels, max) => `<strong>${t}°C</strong>&nbsp;· feels like ${feels}°C&nbsp;· max ${max}°C`,
    showMyLocation: 'Show my location',
    locationError: (message) => `Could not determine location: ${message}`,
    addLocation: 'Add location',
    addModeBanner: 'Click on the map to add a location. Click the button again to cancel.',
    unknownLocation: 'Unknown',
    temperatureSensor: 'Temperature sensor',
    humidity: (value) => ` · ${value}% humidity`,
    updatedAt: (time) => ` · updated ${time}`,
    suggestEdit: 'Suggest edit',
    suggestEditHeading: (name) => `Suggest edit: ${name}`,
    addLocationHeading: 'Add location',
    fieldName: 'Name',
    fieldCategory: 'Category',
    fieldAddress: 'Address',
    fieldDescription: 'Description',
    fieldWebsite: 'Website',
    cancel: 'Cancel',
    submitSuggestion: 'Send suggestion',
    statusNeedName: 'Please enter a name.',
    statusSubmitNotActive: "Submitting suggestions isn't active on this map yet.",
    statusSending: 'Sending…',
    statusSubmitted: 'Thanks! Your suggestion will be reviewed before it appears on the map.',
    statusSubmitFailed: 'Sending failed. Please try again later.',
    dateLocale: 'en-GB',
  },
}
