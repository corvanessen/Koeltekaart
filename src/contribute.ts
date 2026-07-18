import L from 'leaflet'
import { CATEGORY_LABELS } from './categoryLabels'
import { getLocale } from './locale'
import { STRINGS } from './i18n'

const locale = getLocale()
const s = STRINGS[locale]

export type EditableCategoryKey = 'binnen' | 'park' | 'zwembad' | 'buitenwater'

export const EDITABLE_CATEGORIES: EditableCategoryKey[] = ['binnen', 'park', 'zwembad', 'buitenwater']

export type ContributionSubject = {
  id: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
}

type ContributionPayload = {
  kind: 'add' | 'edit'
  id?: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  website: string
}

// De submit-endpoint is een losse Cloudflare Worker die van een inzending een
// GitHub PR maakt op locations.json; goedkeuren = de PR mergen. Zolang die
// Worker niet is gedeployed (VITE_SUBMIT_ENDPOINT ontbreekt) toont het formulier
// gewoon een duidelijke foutmelding in plaats van te crashen.
const SUBMIT_ENDPOINT = import.meta.env.VITE_SUBMIT_ENDPOINT as string | undefined

const NAME_MAX = 100
const ADDR_MAX = 150
const DESC_MAX = 500

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildSuggestEditLink(subject: ContributionSubject): string {
  return `<button type="button" class="suggest-edit-link" data-id="${escapeAttr(subject.id)}" data-cat="${escapeAttr(subject.cat)}" data-name="${escapeAttr(subject.name)}" data-addr="${escapeAttr(subject.addr)}" data-desc="${escapeAttr(subject.desc)}" data-lat="${subject.lat}" data-lon="${subject.lon}">${s.suggestEdit}</button>`
}

function readSuggestEditSubject(button: HTMLElement): ContributionSubject | null {
  const { id, cat, name, addr, desc, lat, lon } = button.dataset
  if (!id || !cat || !name || !lat || !lon) return null
  if (!EDITABLE_CATEGORIES.includes(cat as EditableCategoryKey)) return null

  return {
    id,
    cat: cat as EditableCategoryKey,
    name,
    addr: addr ?? '',
    desc: desc ?? '',
    lat: Number(lat),
    lon: Number(lon),
  }
}

function buildContributionForm(mode: 'add' | 'edit', latlng: L.LatLng, subject?: ContributionSubject): HTMLFormElement {
  const form = document.createElement('form')
  form.className = 'contribute-form'

  const heading = document.createElement('h3')
  heading.className = 'contribute-heading'
  heading.textContent = mode === 'edit' ? s.suggestEditHeading(subject?.name ?? '') : s.addLocationHeading
  form.appendChild(heading)

  const nameLabel = document.createElement('label')
  nameLabel.className = 'contribute-label'
  nameLabel.textContent = s.fieldName
  const nameInput = document.createElement('input')
  nameInput.type = 'text'
  nameInput.required = true
  nameInput.maxLength = NAME_MAX
  nameInput.value = subject?.name ?? ''
  nameLabel.appendChild(nameInput)
  form.appendChild(nameLabel)

  const catLabel = document.createElement('label')
  catLabel.className = 'contribute-label'
  catLabel.textContent = s.fieldCategory
  const catSelect = document.createElement('select')
  EDITABLE_CATEGORIES.forEach((key) => {
    const option = document.createElement('option')
    option.value = key
    option.textContent = CATEGORY_LABELS[locale][key]
    catSelect.appendChild(option)
  })
  catSelect.value = subject?.cat ?? EDITABLE_CATEGORIES[0]
  catLabel.appendChild(catSelect)
  form.appendChild(catLabel)

  const addrLabel = document.createElement('label')
  addrLabel.className = 'contribute-label'
  addrLabel.textContent = s.fieldAddress
  const addrInput = document.createElement('input')
  addrInput.type = 'text'
  addrInput.maxLength = ADDR_MAX
  addrInput.value = subject?.addr ?? ''
  addrLabel.appendChild(addrInput)
  form.appendChild(addrLabel)

  const descLabel = document.createElement('label')
  descLabel.className = 'contribute-label'
  descLabel.textContent = s.fieldDescription
  const descInput = document.createElement('textarea')
  descInput.maxLength = DESC_MAX
  descInput.rows = 3
  descInput.value = subject?.desc ?? ''
  descLabel.appendChild(descInput)
  form.appendChild(descLabel)

  // Honeypot: voor mensen onzichtbaar, eenvoudige bots vullen elk veld in.
  const honeypotLabel = document.createElement('label')
  honeypotLabel.className = 'contribute-honeypot'
  honeypotLabel.textContent = s.fieldWebsite
  const honeypotInput = document.createElement('input')
  honeypotInput.type = 'text'
  honeypotInput.name = 'website'
  honeypotInput.tabIndex = -1
  honeypotInput.autocomplete = 'off'
  honeypotLabel.appendChild(honeypotInput)
  form.appendChild(honeypotLabel)

  const status = document.createElement('p')
  status.className = 'contribute-status'
  status.setAttribute('aria-live', 'polite')
  form.appendChild(status)

  const actions = document.createElement('div')
  actions.className = 'contribute-actions'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'contribute-cancel'
  cancelButton.textContent = s.cancel
  cancelButton.addEventListener('click', () => {
    form.dispatchEvent(new CustomEvent('contribute:cancel'))
  })
  actions.appendChild(cancelButton)

  const submitButton = document.createElement('button')
  submitButton.type = 'submit'
  submitButton.className = 'contribute-submit'
  submitButton.textContent = s.submitSuggestion
  actions.appendChild(submitButton)

  form.appendChild(actions)

  form.addEventListener('submit', (event) => {
    event.preventDefault()

    if (honeypotInput.value.trim() !== '') return

    const name = nameInput.value.trim()
    if (!name) {
      status.textContent = s.statusNeedName
      return
    }

    if (!SUBMIT_ENDPOINT) {
      status.textContent = s.statusSubmitNotActive
      return
    }

    const payload: ContributionPayload = {
      kind: mode,
      id: subject?.id,
      cat: catSelect.value as EditableCategoryKey,
      name,
      addr: addrInput.value.trim(),
      desc: descInput.value.trim(),
      lat: latlng.lat,
      lon: latlng.lng,
      website: honeypotInput.value,
    }

    submitButton.disabled = true
    cancelButton.disabled = true
    status.textContent = s.statusSending

    fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Versturen mislukt: ${response.status}`)
        status.textContent = s.statusSubmitted
        form.dispatchEvent(new CustomEvent('contribute:submitted'))
      })
      .catch((error) => {
        console.error(error)
        status.textContent = s.statusSubmitFailed
        submitButton.disabled = false
        cancelButton.disabled = false
      })
  })

  return form
}

export function initContributions(map: L.Map) {
  let addMode = false

  const banner = L.DomUtil.create('div', 'add-mode-banner')
  banner.textContent = s.addModeBanner
  banner.hidden = true
  map.getContainer().appendChild(banner)

  const AddLocationControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control add-location-control')
      const button = L.DomUtil.create('a', 'add-location-button', container)
      button.href = '#'
      button.title = s.addLocation
      button.setAttribute('role', 'button')
      button.setAttribute('aria-label', s.addLocation)
      button.setAttribute('aria-pressed', 'false')
      button.innerHTML = '+'

      L.DomEvent.disableClickPropagation(container)
      L.DomEvent.on(button, 'click', (e) => {
        L.DomEvent.preventDefault(e)
        setAddMode(!addMode, button)
      })

      return container
    },
  })

  map.addControl(new AddLocationControl())

  function setAddMode(next: boolean, button: HTMLElement) {
    addMode = next
    button.classList.toggle('active', addMode)
    button.setAttribute('aria-pressed', String(addMode))
    banner.hidden = !addMode
    map.getContainer().classList.toggle('add-mode-active', addMode)
  }

  map.on('click', (e: L.LeafletMouseEvent) => {
    if (!addMode) return

    const button = map.getContainer().querySelector<HTMLElement>('.add-location-button')
    if (button) setAddMode(false, button)

    openContributionPopup(map, 'add', e.latlng)
  })

  map.getContainer().addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.suggest-edit-link')
    if (!target) return

    const subject = readSuggestEditSubject(target)
    if (!subject) return

    map.closePopup()
    openContributionPopup(map, 'edit', L.latLng(subject.lat, subject.lon), subject)
  })
}

function openContributionPopup(map: L.Map, mode: 'add' | 'edit', latlng: L.LatLng, subject?: ContributionSubject) {
  const form = buildContributionForm(mode, latlng, subject)
  const popup = L.popup(latlng, { className: 'contribute-popup', minWidth: 260, autoPan: true })
    .setContent(form)
    .openOn(map)

  form.addEventListener('contribute:cancel', () => popup.close())
  form.addEventListener('contribute:submitted', () => {
    setTimeout(() => popup.close(), 3000)
  })
}
