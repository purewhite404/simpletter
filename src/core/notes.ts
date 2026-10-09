// Notes — a small markdown notebook (the editor is CodeMirror, editor.ts). Ported from Brighterm's
// plugins-builtin/notes/main.js: the behaviour is the same; `window.brighterm`
// became the `host` argument so the same code runs as the simpletter app and as
// Brighterm's Notes plugin (see host.ts).

// The notes folder is chosen in the folder bar the host draws above this UI
// (fs.showFolderBar / fs.onFolderBarChange) — no picker window needed.

import { createEditor } from './editor'
import { errorText } from './errorText'
import type { FileEntry, FolderHandle, NotesHost } from './host'
import { NOTES_MARKUP } from './markup'
import {
  displayName,
  fileKind,
  freeName,
  isListed,
  isMarkdown,
  isSortOrder,
  nameTaken,
  newFileName,
  noteExtension,
  safeTitle,
  sortFiles,
  type SortOrder
} from './names'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

/** What the one running the UI can ask of it. */
export interface NotesApp {
  /** Saves what's being typed right now (the window is about to close). */
  flush(): Promise<void>
}

/** Builds the notes UI inside `root`. Resolves once the saved folder (if any) is listed. */
export function startNotes(root: HTMLElement, host: NotesHost): Promise<NotesApp> {
  root.innerHTML = NOTES_MARKUP

  const pickerScreen = $('picker-screen')
  const notesScreen = $('notes-screen')
  const newNoteBtn = $<HTMLButtonElement>('new-note')
  const searchInput = $<HTMLInputElement>('search')
  const fileListEl = $('file-list')
  const titleInput = $<HTMLInputElement>('title')
  // Markdown notes: live preview (markup shows only where the cursor is); other files: plain text.
  const editor = createEditor($('content'), () => {
    edits++
    scheduleSave()
  })
  const sortSelect = $<HTMLSelectElement>('sort')
  const toggleSidebarBtn = $<HTMLButtonElement>('toggle-sidebar')
  const sidebarBackdrop = $('sidebar-backdrop')

  // ---- File list pane: always shown on a roomy window (unless collapsed by hand);
  // on a small one it's folded away and opens over the editor on demand.
  const NARROW = window.matchMedia('(max-width: 559px)')
  let sidebarCollapsed = false // wide: user folded it away
  let sidebarOpen = false // narrow: temporarily shown over the editor

  function applySidebar(): void {
    const narrow = NARROW.matches
    notesScreen.classList.toggle('narrow', narrow)
    notesScreen.classList.toggle('sidebar-hidden', narrow ? !sidebarOpen : sidebarCollapsed)
    notesScreen.classList.toggle('sidebar-overlay', narrow && sidebarOpen)
    toggleSidebarBtn.setAttribute('aria-expanded', String(narrow ? sidebarOpen : !sidebarCollapsed))
  }

  toggleSidebarBtn.addEventListener('click', () => {
    if (NARROW.matches) sidebarOpen = !sidebarOpen
    else sidebarCollapsed = !sidebarCollapsed
    applySidebar()
  })
  sidebarBackdrop.addEventListener('click', () => {
    sidebarOpen = false
    applySidebar()
  })
  NARROW.addEventListener('change', () => {
    sidebarOpen = false
    applySidebar()
  })
  applySidebar()

  /** After picking a note on a small window, get the list out of the way. */
  function closeOverlaySidebar(): void {
    if (!sidebarOpen) return
    sidebarOpen = false
    applySidebar()
  }

  let folderHandle: FolderHandle | null = null
  let files: FileEntry[] = [] // in the chosen order
  let sortOrder: SortOrder = 'name-asc'
  let currentFile: string | null = null // file name of the currently open note
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // The open note's text as it is on disk (as the editor shows it: CRLF reads as LF) — nothing to save while
  // the editor still has exactly that.
  let savedText = ''
  // Bumped by each openFile: a note whose read finishes after another was clicked isn't shown.
  let openRequest = 0
  // Counts the edits (to tell whether anything was typed while a note was being read).
  let edits = 0
  // A file opened from outside that isn't listed otherwise (a .txt, .log, config file...); listed alongside the notes.
  let extraFile: string | null = null

  /** The open folder — every file action needs one (the notes screen only shows with a folder). */
  function folder(): FolderHandle {
    if (!folderHandle) throw new Error('フォルダが選ばれていません')
    return folderHandle
  }

  async function init(): Promise<void> {
    const savedOrder = await host.storage.get('sortOrder')
    if (isSortOrder(savedOrder)) sortOrder = savedOrder
    sortSelect.value = sortOrder
    folderHandle = await host.storage.get<FolderHandle>('folderHandle')
    if (folderHandle) {
      try {
        await refreshFileList()
        await host.fs.showFolderBar(folderHandle)
        showScreen('notes')
        return
      } catch {
        // The saved handle is stale (folder moved/deleted) — ask for a folder again.
        folderHandle = null
      }
    }
    await host.fs.showFolderBar(null)
    showScreen('picker')
  }

  function showScreen(which: 'picker' | 'notes'): void {
    pickerScreen.hidden = which !== 'picker'
    notesScreen.hidden = which !== 'notes'
  }

  /** Drops a pending save; true if there was one. */
  function cancelSave(): boolean {
    if (!saveTimer) return false
    clearTimeout(saveTimer)
    saveTimer = null
    return true
  }

  /** Saves what's being typed right now, before the note or the folder changes under it. */
  async function flushSave(): Promise<void> {
    if (cancelSave()) await saveCurrent()
  }

  /** No note open: empty title and editor; a note still being read isn't shown. */
  function closeNote(): void {
    openRequest++
    currentFile = null
    titleInput.value = ''
    editor.setValue('', 'markdown')
    savedText = ''
  }

  /** Makes `handle` the notes folder (remembered for next time) and lists it. */
  async function useFolder(handle: FolderHandle): Promise<void> {
    await flushSave()
    folderHandle = handle
    closeNote()
    await host.storage.set('folderHandle', handle)
    await refreshFileList()
    await host.fs.showFolderBar(handle)
    showScreen('notes')
  }

  async function refreshFileList(): Promise<void> {
    const all = await host.fs.listFiles(folder())
    files = all.filter((f) => !f.isDirectory && (isListed(f.name) || f.name === extraFile))
    sortFiles(files, sortOrder)
    renderFileList()
  }

  sortSelect.addEventListener('change', async () => {
    sortOrder = isSortOrder(sortSelect.value) ? sortSelect.value : 'name-asc'
    sortFiles(files, sortOrder)
    renderFileList()
    await host.storage.set('sortOrder', sortOrder)
  })

  /** A note was just saved: by date, it moves to where it belongs now (without listing the folder again). */
  function touched(name: string): void {
    const file = files.find((f) => f.name === name)
    if (!file) return
    file.modifiedAt = Date.now()
    if (!sortOrder.startsWith('date')) return
    sortFiles(files, sortOrder)
    renderFileList()
  }

  function renderFileList(): void {
    const query = searchInput.value.trim().toLowerCase()
    const visible = query ? files.filter((f) => f.name.toLowerCase().includes(query)) : files

    fileListEl.innerHTML = ''
    for (const file of visible) {
      const row = document.createElement('button')
      row.className = 'file-row' + (file.name === currentFile ? ' file-row--active' : '')
      row.textContent = file.name // the list shows the extension; the title field doesn't
      row.dataset.name = file.name
      row.addEventListener('click', () => {
        closeOverlaySidebar()
        void openFile(file.name)
      })
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        showMenu(e.clientX, e.clientY, file)
      })
      fileListEl.appendChild(row)
    }
  }

  // ---- Right-click menu on the file list: copy / cut / paste / copy path / rename / delete.
  // The folder is remembered too: a note copied here can be pasted after switching folders.
  let fileClipboard: { handle: FolderHandle; name: string; cut: boolean } | null = null
  let menuEl: HTMLDivElement | null = null

  function closeMenu(): void {
    if (menuEl) menuEl.remove()
    menuEl = null
  }
  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu())
  window.addEventListener('blur', closeMenu)
  fileListEl.addEventListener('scroll', closeMenu)
  fileListEl.addEventListener('contextmenu', (e) => {
    if (e.target === fileListEl && fileClipboard) {
      e.preventDefault()
      showMenu(e.clientX, e.clientY, null)
    }
  })

  function showMenu(x: number, y: number, file: FileEntry | null): void {
    closeMenu()
    const items: [string, () => unknown][] = []
    if (file) {
      items.push(['コピー', () => (fileClipboard = { handle: folder(), name: file.name, cut: false })])
      items.push(['切り取り', () => (fileClipboard = { handle: folder(), name: file.name, cut: true })])
    }
    if (fileClipboard) items.push(['貼り付け', pasteFile])
    if (file) {
      items.push(['パスのコピー', () => host.fs.copyPath(folder(), file.name)])
      items.push(['名前の変更', () => renameFile(file)])
      items.push(['削除', () => deleteNote(file)])
    }
    const menu = document.createElement('div')
    menuEl = menu
    menu.className = 'ctx-menu'
    for (const [label, action] of items) {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', async (e) => {
        e.stopPropagation()
        closeMenu()
        try {
          await action()
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

  /**
   * Renames a file in this folder (the Host API has no rename: write the new one, delete the old).
   * A change of case only goes through a temporary name — written straight away, "Note.md"
   * would *be* "note.md" on Windows, and deleting the old name would delete the note.
   */
  async function moveFile(from: string, to: string, content: string): Promise<void> {
    const fs = host.fs
    const dir = folder()
    if (from.toLowerCase() === to.toLowerCase()) {
      const temp = `${to}.renaming-${Date.now()}`
      await fs.writeFile(dir, temp, content)
      await fs.deleteFile(dir, from)
      await fs.writeFile(dir, to, content)
      await fs.deleteFile(dir, temp)
      return
    }
    await fs.writeFile(dir, to, content)
    await fs.deleteFile(dir, from)
  }

  async function pasteFile(): Promise<void> {
    if (!fileClipboard) return
    const { handle, name, cut } = fileClipboard
    await flushSave()
    const sameFolder = handle.id === folder().id
    if (cut && sameFolder) return // cut then paste into the same folder: nothing moves
    // Read from the folder it was copied in — the current one may have another file of that name.
    const content = await host.fs.readFile(handle, name)
    const newName = freeName(files, name)
    await host.fs.writeFile(folder(), newName, content)
    if (cut) {
      await host.fs.deleteFile(handle, name)
      fileClipboard = null
    }
    await refreshFileList()
  }

  /** Rename in place: the row turns into a text box (Enter = apply, Esc = cancel). */
  function askName(file: FileEntry): Promise<string | null> {
    return new Promise((resolve) => {
      const row = [...fileListEl.children].find((el) => (el as HTMLElement).dataset.name === file.name)
      if (!row) return resolve(null)
      const box = document.createElement('input')
      box.className = 'file-rename'
      box.value = displayName(file.name)
      row.replaceWith(box)
      box.focus()
      box.select()
      let done = false
      const finish = (value: string | null): void => {
        if (done) return
        done = true
        resolve(value)
      }
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(box.value)
        if (e.key === 'Escape') finish(null)
      })
      box.addEventListener('blur', () => finish(null))
    })
  }

  async function renameFile(file: FileEntry): Promise<void> {
    const input = await askName(file)
    renderFileList() // the text box goes back to being a row, whatever happens next
    if (input === null) return
    const title = safeTitle(input)
    if (!title) return
    const newName = isMarkdown(file.name) ? title + noteExtension(file.name) : title
    if (newName === file.name) return
    if (nameTaken(files, newName, file.name)) throw new Error(`同じ名前のファイルがあります: ${newName}`)
    await flushSave()
    const content = await host.fs.readFile(folder(), file.name)
    await moveFile(file.name, newName, content)
    if (currentFile === file.name) {
      currentFile = newName
      titleInput.value = displayName(newName)
    }
    if (extraFile === file.name) extraFile = newName
    if (fileClipboard && fileClipboard.name === file.name) fileClipboard.name = newName
    await refreshFileList()
  }

  async function deleteNote(file: FileEntry): Promise<void> {
    // `await`: in the simpletter app, Tauri's dialog plugin makes confirm() async (a native dialog).
    if (!(await confirm(`「${file.name}」を削除しますか？`))) return
    if (currentFile === file.name) {
      cancelSave()
      closeNote()
    }
    await host.fs.deleteFile(folder(), file.name)
    if (extraFile === file.name) extraFile = null
    if (fileClipboard && fileClipboard.name === file.name) fileClipboard = null
    await refreshFileList()
  }

  /**
   * Shows note `name`. What's typed into the note shown until then is saved to *that* note first — also
   * what's typed while `name` is being read: `currentFile` only changes together with the text.
   */
  async function openFile(name: string): Promise<void> {
    const request = ++openRequest
    await flushSave() // read after it's saved: clicking the open note itself reads what was typed
    const editsBefore = edits
    const content = await host.fs.readFile(folder(), name)
    if (request !== openRequest) return // another note (or folder) was opened meanwhile
    // Typed into this very note while it was read again: what's on screen is newer — keep it.
    if (name === currentFile && edits !== editsBefore) return flushSave()
    await show(name, content)
  }

  /**
   * Shows note `name` with `content`, right away (no await before the switch: the title field and the
   * editor never belong to different notes). What was typed into the note shown until now is saved to it —
   * `flushSave` takes the note's name and text before its first await. Resolves once that's saved.
   */
  function show(name: string, content: string): Promise<void> {
    const saving = flushSave()
    openRequest++ // a note still being read: not shown
    currentFile = name
    titleInput.value = displayName(name)
    editor.setValue(content, fileKind(name))
    savedText = editor.getValue()
    renderFileList()
    return saving
  }

  newNoteBtn.addEventListener('click', async () => {
    closeOverlaySidebar()
    const name = `Untitled-${Date.now()}.md`
    await host.fs.writeFile(folder(), name, '')
    const saving = show(name, '') // empty: nothing to read
    titleInput.focus()
    await saving
    await refreshFileList()
  })

  searchInput.addEventListener('input', renderFileList)

  function scheduleSave(): void {
    cancelSave()
    saveTimer = setTimeout(() => void saveCurrent(), 400)
  }

  async function saveCurrent(): Promise<void> {
    saveTimer = null
    if (!folderHandle) return
    const text = editor.getValue()
    if (!currentFile) {
      // Typing with no note open (e.g. a brand-new, empty folder) starts a new note.
      if (!text && !titleInput.value.trim()) return
      currentFile = newFileName(files, titleInput.value)
      titleInput.value = displayName(currentFile)
      await write(currentFile, text)
      await refreshFileList()
      return
    }
    if (text === savedText) return // typed and undone: the file has it already
    const name = currentFile
    await write(name, text)
    touched(name)
  }

  /** Saves `text` as note `name` of the open folder; `savedText` follows if it's still the note shown. */
  async function write(name: string, text: string): Promise<void> {
    await host.fs.writeFile(folder(), name, text)
    if (currentFile === name) savedText = text
  }

  async function renameCurrent(): Promise<void> {
    if (!currentFile) {
      await saveCurrent()
      return
    }
    const title = safeTitle(titleInput.value)
    const newName = isMarkdown(currentFile) ? (title || 'Untitled') + noteExtension(currentFile) : title || currentFile
    if (newName === currentFile) return
    const oldName = currentFile
    if (nameTaken(files, newName, oldName)) {
      titleInput.value = displayName(oldName)
      alert(`同じ名前のファイルがあります: ${newName}`)
      return
    }
    const content = editor.getValue()
    await moveFile(oldName, newName, content)
    savedText = content
    currentFile = newName
    if (extraFile === oldName) extraFile = newName
    await refreshFileList()
  }

  titleInput.addEventListener('change', () => void renameCurrent())

  const ready = init()

  // Another folder typed into the folder bar: open its first note, or leave the editor ready — typing creates one.
  host.fs.onFolderBarChange(async (handle) => {
    await ready
    extraFile = null
    await useFolder(handle)
    if (files.length > 0) await openFile(files[0].name)
    editor.focus()
  })

  // "Open in Notes" from outside (Brighterm's Files tile): switch to that file's folder and open it.
  host.onOpenFile(async ({ folder, name }) => {
    await ready
    extraFile = isListed(name) ? null : name
    await useFolder(folder)
    await openFile(name)
    editor.focus()
  })

  return ready.then(() => ({ flush: flushSave }))
}
