import type { TempPoint } from '../types'
import { loadSamenMetenTemperatures } from './samenMeten'
import { loadSensorLeidenTemperatures } from './sensorLeiden'

export const SENSOR_LEIDEN_REFRESH_MS = 5 * 60 * 1000
// Samen Meten wordt door de Worker maar elke ~15 min ververst; vaker
// opnieuw ophalen levert geen nieuwe data op.
export const SAMEN_METEN_REFRESH_MS = 15 * 60 * 1000

// Beide netwerken kunnen in hetzelfde gebied meten; we dedupliceren niet
// stilzwijgend, want kalibratie/precisie verschilt per netwerk. Elk punt
// draagt zijn eigen `source` zodat de popup dat expliciet kan tonen.
export async function loadAllTemperatures(): Promise<TempPoint[]> {
  const [sensorLeiden, samenMeten] = await Promise.all([
    loadSensorLeidenTemperatures().catch((error) => {
      console.error('Kon sensorleiden.nl-temperaturen niet laden', error)
      return [] as TempPoint[]
    }),
    loadSamenMetenTemperatures().catch((error) => {
      console.error('Kon Samen Meten-temperaturen niet laden', error)
      return [] as TempPoint[]
    }),
  ])

  return [...sensorLeiden, ...samenMeten]
}

export { loadSamenMetenTemperatures, loadSensorLeidenTemperatures }
