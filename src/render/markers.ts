import L from 'leaflet'

export function makeIcon(iconUrl: string) {
  return L.divIcon({
    html: `<span class="map-drop-icon"><img src="${iconUrl}" width="36" height="36" alt="" /></span>`,
    className: 'map-drop-marker',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -18],
  })
}

export function buildPopupContent(title: string, body: string) {
  return `
    <div class="popup-card">
      <div class="popup-title">${title}</div>
      <div class="popup-body">${body}</div>
    </div>
  `
}

export function tempColor(tempC: number): string {
  const stops: [number, [number, number, number]][] = [
    [12, [47, 128, 237]], // koel: blauw
    [22, [242, 153, 74]], // aangenaam: oranje
    [32, [235, 87, 87]], // warm: rood
  ]

  const clamped = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], tempC))
  const upperIndex = stops.findIndex(([t]) => t >= clamped)
  const [t1, c1] = stops[Math.max(0, upperIndex - 1)]
  const [t2, c2] = stops[upperIndex]
  const ratio = t2 === t1 ? 0 : (clamped - t1) / (t2 - t1)
  const [r, g, b] = c1.map((channel, i) => Math.round(channel + (c2[i] - channel) * ratio))

  return `rgb(${r}, ${g}, ${b})`
}

export function makeTempIcon(tempC: number) {
  return L.divIcon({
    html: `<span class="temp-badge" style="background:${tempColor(tempC)}">${Math.round(tempC)}°</span>`,
    className: 'temp-badge-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  })
}
