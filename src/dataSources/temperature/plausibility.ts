// Kapotte/losgekoppelde sensoren rapporteren soms extreme uitschieters (bv. -140°C
// of -147°C, ook gezien bij Samen Meten-stations); die filteren we hier weg als
// onrealistisch voor buitenlucht. Gedeeld tussen alle temperatuurbronnen.
export const TEMP_MIN_PLAUSIBLE = -15
export const TEMP_MAX_PLAUSIBLE = 45

export function isPlausibleTemperature(tempC: number): boolean {
  return Number.isFinite(tempC) && tempC > TEMP_MIN_PLAUSIBLE && tempC < TEMP_MAX_PLAUSIBLE
}
