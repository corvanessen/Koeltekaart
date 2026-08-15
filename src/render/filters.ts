import type { CategoryKey } from '../categoryLabels'

export type CategoryFilterConfig = { label: string; icon: string }

// Rijen worden één keer aangemaakt en daarna alleen bijgewerkt (i.p.v.
// innerHTML te vervangen), anders verliest een toetsenbordgebruiker de focus
// zodra de temperatuurrefresh de tellers ververst.
export function createCategoryFilterList(
  containerId: string,
  categories: Record<CategoryKey, CategoryFilterConfig>,
  onToggle: (cat: CategoryKey, checked: boolean) => void,
) {
  const container = document.getElementById(containerId)
  const countEls = new Map<CategoryKey, HTMLSpanElement>()

  function render(counts: Record<CategoryKey, number>) {
    if (!container) return

    if (countEls.size === 0) {
      ;(Object.keys(categories) as CategoryKey[]).forEach((key) => {
        const cfg = categories[key]
        const row = document.createElement('label')
        row.className = 'filter-row'

        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = true
        input.dataset.cat = key

        const icon = document.createElement('img')
        icon.className = 'filter-emoji'
        icon.src = cfg.icon
        icon.width = 18
        icon.height = 18
        icon.alt = ''

        const label = document.createElement('span')
        label.className = 'filter-label'
        label.textContent = cfg.label

        const count = document.createElement('span')
        count.className = 'filter-count'
        count.textContent = String(counts[key])

        row.append(input, icon, label, count)
        container.appendChild(row)
        countEls.set(key, count)
      })

      container.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement
        if (target.matches('input[type=checkbox]')) {
          onToggle(target.dataset.cat as CategoryKey, target.checked)
        }
      })
    } else {
      countEls.forEach((count, key) => {
        count.textContent = String(counts[key])
      })
    }
  }

  return { render }
}
