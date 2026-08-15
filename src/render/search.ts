import type { Municipality, MunicipalityId } from '../../shared/municipalities'
import { matchScore } from '../search/fuzzyMatch'

export type SearchResult = {
  municipality: MunicipalityId
  center: [number, number]
  zoom: number
}

type SearchCandidate = SearchResult & {
  label: string
  sublabel: string | null
}

const MAX_RESULTS = 8
// Een specifieke plaats is kleinschaliger dan de hele gemeente, dus die zoomen
// we iets verder in dan de gemeente-standaardzoom.
const PLACE_ZOOM = 14

function buildCandidates(municipalities: Municipality[]): SearchCandidate[] {
  const candidates: SearchCandidate[] = []

  municipalities.forEach((muni) => {
    candidates.push({ label: muni.name, sublabel: null, municipality: muni.id, center: muni.center, zoom: muni.defaultZoom })
    muni.places
      .filter((place) => place.name !== muni.name)
      .forEach((place) =>
        candidates.push({ label: place.name, sublabel: muni.name, municipality: muni.id, center: place.center, zoom: PLACE_ZOOM }),
      )
  })

  return candidates
}

function rankCandidates(query: string, candidates: SearchCandidate[]): SearchCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: matchScore(query, candidate.label) }))
    .filter((entry): entry is { candidate: SearchCandidate; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.candidate.label.localeCompare(b.candidate.label))
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.candidate)
}

// Combobox-patroon (WAI-ARIA): tekstinvoer + losstaande listbox met suggesties,
// bedienbaar met pijltjestoetsen/Enter/Escape en met de muis.
export function createMunicipalitySearch(
  containerId: string,
  municipalities: Municipality[],
  labels: { placeholder: string; label: string; noResults: string },
  onSelect: (result: SearchResult) => void,
) {
  const container = document.getElementById(containerId)
  if (!container) return

  const candidates = buildCandidates(municipalities)

  const wrapper = document.createElement('div')
  wrapper.className = 'municipality-search'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'municipality-search-input'
  input.placeholder = labels.placeholder
  input.setAttribute('aria-label', labels.label)
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  input.autocomplete = 'off'

  const listId = `${containerId}-listbox`
  const list = document.createElement('ul')
  list.className = 'municipality-search-results'
  list.id = listId
  list.setAttribute('role', 'listbox')
  list.hidden = true

  input.setAttribute('aria-controls', listId)
  wrapper.append(input, list)
  container.appendChild(wrapper)

  let results: SearchCandidate[] = []
  let activeIndex = -1

  function closeList() {
    list.hidden = true
    list.innerHTML = ''
    results = []
    activeIndex = -1
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }

  function selectCandidate(candidate: SearchCandidate) {
    onSelect({ municipality: candidate.municipality, center: candidate.center, zoom: candidate.zoom })
    input.value = ''
    closeList()
  }

  function renderResults() {
    list.innerHTML = ''

    if (results.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'municipality-search-empty'
      empty.textContent = labels.noResults
      list.appendChild(empty)
      list.hidden = false
      input.setAttribute('aria-expanded', 'true')
      return
    }

    results.forEach((candidate, index) => {
      const item = document.createElement('li')
      item.className = 'municipality-search-option'
      item.id = `${listId}-option-${index}`
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(index === activeIndex))
      item.classList.toggle('active', index === activeIndex)

      const label = document.createElement('span')
      label.className = 'municipality-search-label'
      label.textContent = candidate.label
      item.appendChild(label)

      if (candidate.sublabel) {
        const sublabel = document.createElement('span')
        sublabel.className = 'municipality-search-sublabel'
        sublabel.textContent = candidate.sublabel
        item.appendChild(sublabel)
      }

      item.addEventListener('mousedown', (event) => {
        // voorkomt dat de input zijn blur/change vóór de click afhandelt
        event.preventDefault()
        selectCandidate(candidate)
      })

      list.appendChild(item)
    })

    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    updateActiveDescendant()
  }

  function updateActiveDescendant() {
    if (activeIndex >= 0 && activeIndex < results.length) {
      input.setAttribute('aria-activedescendant', `${listId}-option-${activeIndex}`)
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  input.addEventListener('input', () => {
    const query = input.value.trim()
    if (query.length === 0) {
      closeList()
      return
    }
    results = rankCandidates(query, candidates)
    activeIndex = results.length > 0 ? 0 : -1
    renderResults()
  })

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (results.length === 0) return
      activeIndex = (activeIndex + 1) % results.length
      renderResults()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (results.length === 0) return
      activeIndex = (activeIndex - 1 + results.length) % results.length
      renderResults()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0 && activeIndex < results.length) {
        selectCandidate(results[activeIndex])
      }
    } else if (event.key === 'Escape') {
      closeList()
    }
  })

  input.addEventListener('blur', () => {
    // korte vertraging zodat een muisklik op een optie (mousedown) eerst afhandelt
    setTimeout(closeList, 100)
  })
}
