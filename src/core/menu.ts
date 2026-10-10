// The right-click menu (one at a time): the file list's and the CSV / TSV editor's.

import { errorText } from './errorText'

export interface MenuItem {
  label: string
  action: () => unknown
  /** Shown greyed out, can't be clicked. */
  disabled?: boolean
}

/** `null` = a separator line. */
export type MenuEntry = MenuItem | null

let menuEl: HTMLDivElement | null = null
let listening = false

export function closeMenu(): void {
  if (menuEl) menuEl.remove()
  menuEl = null
}

/** Shows a menu at (x, y), kept inside the window. A failing action shows its error. */
export function openMenu(x: number, y: number, entries: MenuEntry[]): void {
  closeMenu()
  if (!listening) {
    listening = true
    document.addEventListener('click', closeMenu)
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu())
    window.addEventListener('blur', closeMenu)
    window.addEventListener('scroll', closeMenu, true) // any element scrolled: the file list, the editor
  }
  const menu = document.createElement('div')
  menuEl = menu
  menu.className = 'ctx-menu'
  for (const entry of entries) {
    if (!entry) {
      menu.appendChild(document.createElement('hr'))
      continue
    }
    const b = document.createElement('button')
    b.textContent = entry.label
    b.disabled = !!entry.disabled
    // The focus stays where it is (the editor: its selection is what the action works on).
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      closeMenu()
      try {
        await entry.action()
      } catch (err) {
        alert(errorText(err))
      }
    })
    menu.appendChild(b)
  }
  document.body.appendChild(menu)
  menu.style.left = Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth - 4)) + 'px'
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight - 4)) + 'px'
}
