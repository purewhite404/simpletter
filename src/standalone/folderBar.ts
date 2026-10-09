import { errorText } from '../core/errorText'
import { folderName, stillMatching, tabCompletion } from './folderBarText'

/**
 * The address bar above the notes: shows the notes folder, and the user types
 * or pastes another one (with completion of subfolders) or picks it in a
 * window. Port of Brighterm's FolderBar.tsx (React) — same keys and behaviour:
 * Tab completes (and stays in the bar), ↑/↓ choose a completion, Enter
 * switches, Esc closes the list / restores the current folder.
 */

const SUGGEST_DELAY_MS = 120
const IS_WINDOWS = navigator.userAgent.includes('Windows')
/** Windows and macOS paths ignore case. */
const CASE_INSENSITIVE = IS_WINDOWS || navigator.userAgent.includes('Mac OS')
const PLACEHOLDER = IS_WINDOWS
  ? 'フォルダのパスを入力（例: C:\\Users\\名前\\Documents、~ はホーム）'
  : 'フォルダのパスを入力（例: ~/Documents）'

const icon = (d: string): string =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`

export interface FolderBarOptions {
  /** Completions for what's typed (full paths ending in a separator). */
  suggest(input: string): Promise<string[]>
  /** Switch to what was typed; rejects with the message to show. */
  submit(input: string): Promise<void>
  /** The native picker, for those who'd rather click. */
  browse(): Promise<void>
}

export class FolderBar {
  readonly element: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly errorEl: HTMLDivElement
  private readonly listEl: HTMLUListElement
  private path = ''
  private focused = false
  private suggestions: string[] = []
  private highlight = -1
  private busy = false
  private suggestRequest = 0
  private suggestTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: FolderBarOptions) {
    this.element = document.createElement('div')
    this.element.className = 'folderbar'
    this.element.innerHTML = `
      <div class="folderbar-row">
        ${icon('M4 6h6l2 2h8v11H4z')}
        <input class="folderbar-input" spellcheck="false" role="combobox" aria-label="フォルダのパス"
          aria-expanded="false" aria-controls="folderbar-list" aria-autocomplete="list" />
        <button class="folderbar-browse" title="フォルダを選ぶウィンドウを開く" aria-label="フォルダを選ぶウィンドウを開く">
          ${icon('M4 6h6l2 2h8l-2 9H6L4 6z')}
        </button>
      </div>
      <div class="folderbar-error" role="alert" hidden></div>
      <ul id="folderbar-list" class="folderbar-list" role="listbox" aria-label="フォルダの候補" hidden></ul>`
    this.input = this.element.querySelector('input')!
    this.errorEl = this.element.querySelector('.folderbar-error')!
    this.listEl = this.element.querySelector('ul')!
    this.input.placeholder = PLACEHOLDER

    this.input.addEventListener('input', () => {
      // Until the new completions arrive, keep only those that still fit.
      this.suggestions = stillMatching(this.suggestions, this.input.value, CASE_INSENSITIVE)
      // The old completions are stale now: Enter must take what's typed, not one of them.
      this.highlight = -1
      this.setError(null)
      this.renderList()
      this.requestSuggestions()
    })
    this.input.addEventListener('focus', () => {
      this.focused = true
      this.input.select()
      this.requestSuggestions()
    })
    this.input.addEventListener('blur', () => {
      // Like Explorer's address bar: leaving it without Enter keeps the current folder.
      this.focused = false
      this.suggestRequest++
      this.suggestions = []
      this.setError(null)
      this.renderList()
      this.input.value = this.path
      this.showEnd()
    })
    this.input.addEventListener('keydown', (e) => this.onKeyDown(e))
    this.element.querySelector('button')!.addEventListener('click', () => {
      this.options.browse().catch((err: unknown) => this.setError(errorText(err)))
    })
    // Show the end of a long path (the folder's own name) whenever the window is resized.
    new ResizeObserver(() => this.showEnd()).observe(this.input)
  }

  /** The current folder ('' = none yet). */
  setPath(path: string): void {
    this.path = path
    this.input.title = path
    if (this.focused) return
    this.input.value = path
    requestAnimationFrame(() => this.showEnd())
  }

  focus(): void {
    this.input.focus()
  }

  private showEnd(): void {
    if (!this.focused) this.input.scrollLeft = this.input.scrollWidth
  }

  private get listOpen(): boolean {
    return this.focused && this.suggestions.length > 0
  }

  /** Completions for what's typed so far (debounced; late answers to old input are dropped). */
  private requestSuggestions(): void {
    const request = ++this.suggestRequest
    if (this.suggestTimer) clearTimeout(this.suggestTimer)
    this.suggestTimer = setTimeout(() => {
      const typed = this.input.value
      void this.options.suggest(typed).then((found) => {
        if (request !== this.suggestRequest || !this.focused) return
        this.suggestions = found.filter((s) => s !== typed)
        this.highlight = -1
        this.renderList()
      })
    }, SUGGEST_DELAY_MS)
  }

  private setError(message: string | null): void {
    this.errorEl.hidden = !message
    this.errorEl.textContent = message ?? ''
    if (message) this.input.setAttribute('aria-invalid', 'true')
    else this.input.removeAttribute('aria-invalid')
  }

  private renderList(): void {
    const open = this.listOpen
    this.listEl.hidden = !open
    this.input.setAttribute('aria-expanded', String(open))
    this.listEl.innerHTML = ''
    if (!open) return
    this.suggestions.forEach((s, i) => {
      const li = document.createElement('li')
      li.role = 'option'
      li.title = s
      li.setAttribute('aria-selected', String(i === this.highlight))
      if (i === this.highlight) li.className = 'folderbar-option--active'
      const name = document.createElement('span')
      name.className = 'folderbar-option-name'
      name.textContent = folderName(s)
      const path = document.createElement('span')
      path.className = 'folderbar-option-path'
      path.textContent = s
      li.append(name, path)
      // Keep the focus in the input (a click would blur it and close the list first).
      li.addEventListener('mousedown', (e) => e.preventDefault())
      li.addEventListener('mouseenter', () => this.setHighlight(i))
      li.addEventListener('click', () => void this.submit(s))
      this.listEl.appendChild(li)
    })
  }

  private setHighlight(i: number): void {
    this.highlight = i
    ;[...this.listEl.children].forEach((li, j) => {
      li.classList.toggle('folderbar-option--active', j === i)
      li.setAttribute('aria-selected', String(j === i))
    })
    this.listEl.children[i]?.scrollIntoView({ block: 'nearest' })
  }

  private async submit(input: string): Promise<void> {
    this.busy = true
    // Not `disabled`: that would blur it, and a failed switch must leave the focus (and the message) here.
    this.input.readOnly = true
    try {
      await this.options.submit(input)
      this.setError(null)
      this.suggestions = []
      this.renderList()
      this.input.blur()
    } catch (err) {
      this.input.value = input
      this.setError(errorText(err))
    } finally {
      this.busy = false
      this.input.readOnly = false
    }
  }

  private fill(suggestion: string): void {
    this.input.value = suggestion
    this.highlight = -1
    this.setError(null)
    this.input.focus()
    this.requestSuggestions()
  }

  /**
   * Tab: complete what's typed and keep typing (its subfolders come next). Asks for
   * the completions of the input as it is right now — the list on screen may still
   * be the one for the previous keystroke, or not there yet.
   */
  private async complete(): Promise<void> {
    const typed = this.input.value
    const found = (await this.options.suggest(typed)).filter((s) => s !== typed)
    if (this.input.value !== typed) return // typed on meanwhile
    const completion = tabCompletion(typed, found, CASE_INSENSITIVE)
    if (completion) this.fill(completion)
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing) return
    const count = this.suggestions.length
    if (e.key === 'ArrowDown' && this.listOpen) {
      e.preventDefault()
      this.setHighlight((this.highlight + 1) % count)
    } else if (e.key === 'ArrowUp' && this.listOpen) {
      e.preventDefault()
      this.setHighlight(this.highlight <= 0 ? count - 1 : this.highlight - 1)
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Always kept in the bar: leaving it would throw away what was typed. Shift+Tab / Esc leave.
      e.preventDefault()
      if (this.busy) return
      if (this.listOpen && this.highlight >= 0) this.fill(this.suggestions[this.highlight])
      else void this.complete()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void this.submit(this.highlight >= 0 && this.listOpen ? this.suggestions[this.highlight] : this.input.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (this.listOpen) {
        this.suggestRequest++
        this.suggestions = []
        this.renderList()
      } else {
        this.input.value = this.path
        this.setError(null)
        this.input.blur()
      }
    }
  }
}
