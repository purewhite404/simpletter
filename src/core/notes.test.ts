// @vitest-environment happy-dom
//
// The notes UI driven through a fake host: folders in memory, with Windows'
// case-insensitive names (writing "Note.md" over "note.md" keeps "note.md").
// Scenarios follow Brighterm's tests/e2e/notes.spec.ts.

import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, FolderHandle, NotesHost, OpenedFile } from './host'
import { startNotes, type NotesStatus, type SaveAnswer } from './notes'

type Folder = Record<string, { content: string; modifiedAt: number }>

function fakeHost(folders: Record<string, Folder>, saved: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(saved))
  const state = {
    bar: undefined as FolderHandle | null | undefined,
    copied: '',
    changeFolder: (_: FolderHandle) => {},
    openFile: (_: OpenedFile) => {}
  }
  const folderOf = (h: FolderHandle): Folder => {
    const f = folders[h.id]
    if (!f) throw new Error(`フォルダを読めません: ${h.id}`)
    return f
  }
  const key = (f: Folder, name: string) => Object.keys(f).find((k) => k.toLowerCase() === name.toLowerCase())
  let clock = 1_000
  const host: NotesHost = {
    storage: {
      get: async <T>(k: string) => (storage.has(k) ? (structuredClone(storage.get(k)) as T) : null),
      set: async (k, v) => void storage.set(k, structuredClone(v))
    },
    fs: {
      showFolderBar: async (h) => void (state.bar = h),
      onFolderBarChange: (cb) => {
        state.changeFolder = cb
        return () => {}
      },
      listFiles: async (h): Promise<FileEntry[]> =>
        Object.entries(folderOf(h)).map(([name, f]) => ({ name, isDirectory: false, modifiedAt: f.modifiedAt })),
      readFile: async (h, name) => {
        const f = folderOf(h)
        const k = key(f, name)
        if (!k) throw new Error(`読み込めません: ${name}`)
        return f[k].content
      },
      writeFile: async (h, name, content) => {
        const f = folderOf(h)
        // Like the native side: a file Windows would run is never created (an existing one is written).
        if (!key(f, name) && /\.(bat|cmd|exe|ps1)$/i.test(name)) throw new Error(`実行できる種類: ${name}`)
        f[key(f, name) ?? name] = { content, modifiedAt: ++clock }
      },
      deleteFile: async (h, name) => {
        const f = folderOf(h)
        const k = key(f, name)
        if (!k) throw new Error(`削除できません: ${name}`)
        delete f[k]
      },
      copyPath: async (h, name) => void (state.copied = `${h.id}\\${name}`)
    },
    onOpenFile: (cb) => {
      state.openFile = cb
      return () => {}
    }
  }
  return { host, state, storage }
}

const handle = (id: string): FolderHandle => ({ id, label: id })
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T
const rows = () => [...document.querySelectorAll('.file-row')].map((r) => r.textContent)
const row = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.file-row')].find((r) => r.textContent === text)!
const names = (f: Folder) => Object.keys(f).sort()

function type(el: HTMLInputElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** The note editor (CodeMirror). */
const editorView = () => EditorView.findFromDOM($('#content'))!
const content = () => editorView().state.doc.toString()
/** Replaces the note's text, as typing would. */
function typeContent(value: string): void {
  const view = editorView()
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, userEvent: 'input.type' })
}

/** Right-click `rowText`, then click `item` in the menu. */
async function menuItem(rowText: string, item: string): Promise<void> {
  row(rowText).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
  const button = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find(
    (b) => b.textContent === item
  )
  if (!button) throw new Error(`no "${item}" in the menu`)
  button.click()
  await settle()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const settle = () => sleep(0)

/** Makes reading `only` (else every file) take `ms`. */
function slowRead(host: NotesHost, ms: number, only?: string): void {
  const read = host.fs.readFile
  host.fs.readFile = async (h, name) => {
    if (!only || name === only) await sleep(ms)
    return read(h, name)
  }
}

function root(): HTMLElement {
  document.body.innerHTML = '<div id="notes-root"></div>'
  return $('#notes-root')
}

let dialogs: string[]
let acceptConfirm: boolean
beforeEach(() => {
  dialogs = []
  acceptConfirm = false
  vi.stubGlobal('alert', (m: string) => void dialogs.push(m))
  vi.stubGlobal('confirm', (m: string) => (dialogs.push(m), acceptConfirm))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('folder', () => {
  it('no saved folder: asks for one, with an empty folder bar', async () => {
    const { host, state } = fakeHost({})
    await startNotes(root(), host)
    expect($('#picker-screen').hidden).toBe(false)
    expect($('#notes-screen').hidden).toBe(true)
    expect(state.bar).toBeNull()
  })

  it('a saved folder is listed again; a stale one asks again', async () => {
    const a: Folder = {
      'b.md': { content: 'B', modifiedAt: 1 },
      'a.md': { content: 'A', modifiedAt: 2 },
      'x.bak': { content: '', modifiedAt: 1 }
    }
    let s = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), s.host)
    expect($('#notes-screen').hidden).toBe(false)
    expect(rows()).toEqual(['a.md', 'b.md']) // not the .bak; shown with the extension
    expect(s.state.bar).toEqual(handle('A'))

    s = fakeHost({}, { folderHandle: handle('gone') })
    await startNotes(root(), s.host)
    expect($('#picker-screen').hidden).toBe(false)
    expect(s.state.bar).toBeNull()
  })

  it('a folder from the bar: its first note opens, and it is remembered', async () => {
    const { host, state, storage } = fakeHost({
      A: { 'z.md': { content: 'Z', modifiedAt: 1 }, 'm.md': { content: 'M', modifiedAt: 1 } }
    })
    await startNotes(root(), host)
    state.changeFolder(handle('A'))
    await vi.waitFor(() => expect(content()).toBe('M'))
    expect($<HTMLInputElement>('#title').value).toBe('m')
    expect(storage.get('folderHandle')).toEqual(handle('A'))
  })

  it('an empty folder: typing creates a note, named after the title if one was typed', async () => {
    const empty: Folder = {}
    const { host, state } = fakeHost({ E: empty })
    await startNotes(root(), host)
    state.changeFolder(handle('E'))
    await vi.waitFor(() => expect($('#notes-screen').hidden).toBe(false))
    type($('#title'), '買い物')
    typeContent('牛乳')
    await vi.waitFor(() => expect(names(empty)).toEqual(['買い物.md']), { timeout: 2000 })
    expect(empty['買い物.md'].content).toBe('牛乳')
    expect(rows()).toEqual(['買い物.md'])
  })
})

describe('editing', () => {
  it('saves 0.4 s after typing stops; switching folders saves at once', async () => {
    const a: Folder = { 'a.md': { content: 'old', modifiedAt: 1 } }
    const b: Folder = { 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host, state } = fakeHost({ A: a, B: b }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('new')
    expect(a['a.md'].content).toBe('old')
    await vi.waitFor(() => expect(a['a.md'].content).toBe('new'), { timeout: 2000 })

    typeContent('newer')
    state.changeFolder(handle('B')) // before the timer fires
    await vi.waitFor(() => expect(content()).toBe('B'))
    expect(a['a.md'].content).toBe('newer')
  })

  it('switching notes right after typing: the old note gets the text, the new one is not written', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 }, 'b.md': { content: 'B\r\nline', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('A edited')
    row('b.md').click() // before the save timer fires
    await vi.waitFor(() => expect(content()).toBe('B\nline'))
    await sleep(600) // longer than the save delay
    expect(d['a.md'].content).toBe('A edited')
    expect(d['b.md']).toEqual({ content: 'B\r\nline', modifiedAt: 1 }) // not even its line endings
  })

  it('a note slow to read: the save timer firing meanwhile never writes into it', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 }, 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    slowRead(host, 600, 'b.md') // longer than the save delay
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('A edited')
    row('b.md').click()
    await vi.waitFor(() => expect(content()).toBe('B'), { timeout: 2000 })
    expect(d['a.md'].content).toBe('A edited')
    expect(d['b.md']).toEqual({ content: 'B', modifiedAt: 1 })
  })

  it('two notes clicked quickly: the last one shows, also if the first is read last', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 }, 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    slowRead(host, 100, 'a.md')
    await startNotes(root(), host)
    row('a.md').click()
    row('b.md').click()
    await sleep(200) // both reads are done
    expect(content()).toBe('B')
    expect($<HTMLInputElement>('#title').value).toBe('b')
    typeContent('B edited')
    await vi.waitFor(() => expect(d['b.md'].content).toBe('B edited'), { timeout: 2000 })
    expect(d['a.md']).toEqual({ content: 'A', modifiedAt: 1 })
  })

  it('a new note is the one its title renames at once, even with notes slow to read', async () => {
    const d: Folder = { 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    slowRead(host, 300)
    await startNotes(root(), host)
    row('b.md').click()
    await vi.waitFor(() => expect(content()).toBe('B'))
    $<HTMLButtonElement>('#new-note').click()
    await settle() // its empty file is written; nothing to read
    const title = $<HTMLInputElement>('#title')
    expect(title.value).toMatch(/^Untitled-/)
    title.value = '買い物'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(names(d)).toEqual(['b.md', '買い物.md']))
    expect(d['b.md'].content).toBe('B')
  })

  it('the open note clicked again and typed into while it is read: the typing stays', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    slowRead(host, 600) // the save timer fires meanwhile
    await startNotes(root(), host)
    row('a.md').click()
    await vi.waitFor(() => expect(content()).toBe('A'), { timeout: 2000 })
    row('a.md').click()
    typeContent('A, typed during the read')
    await sleep(800)
    expect(content()).toBe('A, typed during the read')
    expect(d['a.md'].content).toBe('A, typed during the read')
  })

  it('text back to what is on disk is not written', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('typo')
    typeContent('A') // undone before the save
    await sleep(600)
    expect(d['a.md']).toEqual({ content: 'A', modifiedAt: 1 })

    typeContent('A2')
    await vi.waitFor(() => expect(d['a.md'].content).toBe('A2'), { timeout: 2000 })
    const saved = d['a.md'].modifiedAt
    typeContent('A23')
    typeContent('A2') // back to the saved text
    await sleep(600)
    expect(d['a.md'].modifiedAt).toBe(saved)
  })

  it('flush() saves what is being typed at once (the window is closing)', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D') })
    const notes = await startNotes(root(), host)
    await notes.flush() // nothing to save
    expect(d['a.md'].modifiedAt).toBe(1)
    row('a.md').click()
    await settle()
    typeContent('last words')
    await notes.flush()
    expect(d['a.md'].content).toBe('last words')
  })

  it('by date, the note just edited moves to the top; the order is remembered', async () => {
    const a: Folder = {
      'old note.md': { content: '', modifiedAt: 1 },
      'mid.md': { content: '', modifiedAt: 50 },
      'new note.md': { content: '', modifiedAt: 100 }
    }
    const { host, storage } = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    const sort = $<HTMLSelectElement>('#sort')
    sort.value = 'date-desc'
    sort.dispatchEvent(new Event('change'))
    await settle()
    expect(rows()).toEqual(['new note.md', 'mid.md', 'old note.md'])
    expect(storage.get('sortOrder')).toBe('date-desc')

    row('old note.md').click()
    await settle()
    typeContent('edited')
    await vi.waitFor(() => expect(rows()).toEqual(['old note.md', 'new note.md', 'mid.md']), { timeout: 2000 })

    // Search keeps the order.
    type($('#search'), 'note')
    expect(rows()).toEqual(['old note.md', 'new note.md'])

    // Next start: the same order.
    await startNotes(root(), host)
    expect($<HTMLSelectElement>('#sort').value).toBe('date-desc')
    expect(rows()).toEqual(['old note.md', 'new note.md', 'mid.md'])
  })

  it('the title field renames the note, but never over another one', async () => {
    const a: Folder = {
      'note.md': { content: 'my note', modifiedAt: 1 },
      'other.md': { content: 'other', modifiedAt: 1 }
    }
    const { host } = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    row('note.md').click()
    await settle()
    const title = $<HTMLInputElement>('#title')
    title.value = 'Other'
    title.dispatchEvent(new Event('change'))
    await settle()
    expect(dialogs.at(-1)).toBe('同じ名前のファイルがあります: Other.md')
    expect(title.value).toBe('note')
    expect(a['other.md'].content).toBe('other')

    title.value = 'a/b'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(names(a)).toEqual(['a_b.md', 'other.md']))
    expect(a['a_b.md'].content).toBe('my note')

    // A device name gets a "_"; the title field shows the name as it was made.
    title.value = 'con'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(names(a)).toEqual(['_con.md', 'other.md']))
    expect(title.value).toBe('_con')
  })

  it('a rename never makes a file Windows would run; an existing one is edited and kept', async () => {
    const a: Folder = {
      'run.txt': { content: 'echo hi', modifiedAt: 1 },
      'build.bat': { content: '@echo off', modifiedAt: 1 }
    }
    const { host, state } = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    const title = $<HTMLInputElement>('#title')
    const executable = (name: string) => `実行できる種類のファイルは新しく作れません: ${name}`

    // The title field: refused before anything is written, the title goes back.
    state.openFile({ folder: handle('A'), name: 'run.txt' })
    await vi.waitFor(() => expect(title.value).toBe('run.txt'))
    title.value = 'run.bat'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(dialogs.at(-1)).toBe(executable('run.bat')))
    expect(title.value).toBe('run.txt')
    expect(names(a)).toEqual(['build.bat', 'run.txt'])

    // The menu: same. A trailing dot (dropped by Windows) doesn't get around it.
    await menuItem('run.txt', '名前の変更')
    const box = $<HTMLInputElement>('.file-rename')
    box.value = 'run.bat.'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(dialogs.at(-1)).toBe(executable('run.bat')))
    expect(names(a)).toEqual(['build.bat', 'run.txt'])

    // An existing one: edited as any text; a case-only rename is refused before the note moves away.
    state.openFile({ folder: handle('A'), name: 'build.bat' })
    await vi.waitFor(() => expect(content()).toBe('@echo off'))
    typeContent('@echo on')
    await vi.waitFor(() => expect(a['build.bat'].content).toBe('@echo on'))
    title.value = 'BUILD.bat'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(dialogs.at(-1)).toBe(executable('BUILD.bat')))
    expect(names(a)).toEqual(['build.bat', 'run.txt'])
    expect(a['build.bat'].content).toBe('@echo on')
  })
})

describe('editor', () => {
  it('notes get the live preview, other files plain text; opening a file is not an edit', async () => {
    const dir: Folder = { 'a.md': { content: '# A\n**b**', modifiedAt: 1 } }
    const { host, state } = fakeHost({ D: dir })
    await startNotes(root(), host)
    state.changeFolder(handle('D'))
    await vi.waitFor(() => expect(content()).toBe('# A\n**b**'))
    expect($('#content .cm-editor').classList.contains('cm-markdown')).toBe(true)
    expect($('#content .cm-lp-h1')).not.toBeNull()
    expect($('#content .cm-lp-strong')?.textContent).toContain('b')

    dir['log.txt'] = { content: '# not a heading', modifiedAt: 1 }
    state.openFile({ folder: handle('D'), name: 'log.txt' })
    await vi.waitFor(() => expect(content()).toBe('# not a heading'))
    expect($('#content .cm-editor').classList.contains('cm-plain')).toBe(true)
    expect($('#content .cm-lp-h1')).toBeNull()

    await sleep(600) // longer than the save delay
    expect(dir['a.md'].modifiedAt).toBe(1)
    expect(dir['log.txt'].modifiedAt).toBe(1)
  })

  it('text and config files are listed as plain text; other files only once opened from outside', async () => {
    const dir: Folder = {
      'a.md': { content: '', modifiedAt: 1 },
      'app.log': { content: 'started', modifiedAt: 1 },
      'config.yaml': { content: 'a: 1', modifiedAt: 1 },
      'old.bak': { content: 'kept', modifiedAt: 1 }
    }
    const { host, state } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    expect(rows()).toEqual(['a.md', 'app.log', 'config.yaml'])
    row('config.yaml').click()
    await vi.waitFor(() => expect(content()).toBe('a: 1'))
    expect($('#content .cm-editor').classList.contains('cm-plain')).toBe(true)

    state.openFile({ folder: handle('D'), name: 'old.bak' })
    await vi.waitFor(() => expect(content()).toBe('kept'))
    expect(rows()).toEqual(['a.md', 'app.log', 'config.yaml', 'old.bak'])
  })

  it('a table shows as a <table>; a click on a cell puts the cursor in its source text', async () => {
    const text = '# 表\n\n| 品物 | 数 |\n|:--|--:|\n| **りんご** | 3 |\n|  | 5 |\n'
    const dir: Folder = { 't.md': { content: text, modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('t.md').click()
    await vi.waitFor(() => expect($('#content .cm-lp-table')).not.toBeNull())
    const cells = () =>
      [...document.querySelectorAll<HTMLElement>('#content .cm-lp-table tr')].map((tr) =>
        [...tr.children].map((c) => c.textContent)
      )
    expect(cells()).toEqual([
      ['品物', '数'],
      ['りんご', '3'],
      ['', '5']
    ])
    expect($('#content .cm-lp-table td .cm-lp-strong')?.textContent).toBe('りんご')
    expect($<HTMLElement>('#content .cm-lp-table th:last-child').style.textAlign).toBe('right')

    const click = (el: HTMLElement) =>
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    const cursor = () => editorView().state.selection.main.head
    click([...document.querySelectorAll<HTMLElement>('#content .cm-lp-table td')][0])
    expect(text.slice(0, cursor())).toMatch(/\| \*\*りんご$/) // after the cell's text (inside the **)
    click([...document.querySelectorAll<HTMLElement>('#content .cm-lp-table td')][2])
    expect(text.slice(cursor())).toMatch(/^ \| 5 \|/) // an empty cell: inside it, after one space

    await sleep(600)
    expect(dir['t.md'].modifiedAt).toBe(1) // not an edit
  })

  it('CSV / TSV files are listed and shown as a table; edits are saved as the raw text', async () => {
    const csv = 'name,qty\n"apple, red",3\n'
    const dir: Folder = {
      'a.md': { content: '', modifiedAt: 1 },
      'data.csv': { content: csv, modifiedAt: 1 },
      't.TSV': { content: 'x\ty', modifiedAt: 1 },
      'x.bak': { content: '', modifiedAt: 1 }
    }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    expect(rows()).toEqual(['a.md', 'data.csv', 't.TSV'])

    row('data.csv').click()
    await vi.waitFor(() => expect(content()).toBe(csv))
    expect($('#content .cm-editor').classList.contains('cm-csv')).toBe(true)
    expect($<HTMLInputElement>('#title').value).toBe('data.csv')
    const cellTexts = () => [...document.querySelectorAll('#content .cm-csv-cell')].map((c) => c.textContent)
    expect(cellTexts()).toEqual(['name', 'qty', 'apple, red', '3']) // the quotes and delimiters are hidden
    expect($<HTMLElement>('#content .cm-csv-cell').style.width).toBe('calc(12ch + 1px)')
    await sleep(600)
    expect(dir['data.csv'].modifiedAt).toBe(1) // opening is not an edit

    const view = editorView()
    view.dispatch({
      changes: { from: csv.indexOf('3'), to: csv.indexOf('3') + 1, insert: '12' },
      userEvent: 'input.type'
    })
    await vi.waitFor(() => expect(dir['data.csv'].content).toBe('name,qty\n"apple, red",12\n'), { timeout: 2000 })

    row('t.TSV').click()
    await vi.waitFor(() => expect(content()).toBe('x\ty'))
    expect(cellTexts()).toEqual(['x', 'y']) // the tab: a 1 ch widget
  })

  it('CSV / TSV: the right-click menu inserts / deletes columns, cuts / copies / pastes', async () => {
    const dir: Folder = {
      'data.csv': { content: 'a,b,c\n1,2,3', modifiedAt: 1 },
      'n.md': { content: '', modifiedAt: 1 }
    }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    let clipboard = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void (clipboard = t), readText: async () => clipboard }
    })
    await startNotes(root(), host)
    row('data.csv').click()
    await vi.waitFor(() => expect(content()).toBe('a,b,c\n1,2,3'))
    const view = editorView()
    const menu = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')]
    /** Opens the menu from the keyboard (keeps the selection; a mouse click would move the cursor). */
    async function choose(item: string, selection: { anchor: number; head?: number }): Promise<void> {
      view.dispatch({ selection })
      view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 }))
      const button = menu().find((b) => b.textContent === item)
      if (!button) throw new Error(`no "${item}" in the menu`)
      button.click()
      await settle()
    }

    view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0 }))
    expect(menu().map((b) => [b.textContent, b.disabled])).toEqual([
      ['切り取り', true], // nothing selected
      ['コピー', true],
      ['貼り付け', false],
      ['左に列を挿入', false],
      ['右に列を挿入', false],
      ['列を削除', false]
    ])
    document.body.click()
    expect($('.ctx-menu')).toBeNull()

    await choose('右に列を挿入', { anchor: 3 }) // in "b"
    expect(content()).toBe('a,b,,c\n1,2,,3')
    expect(view.state.selection.main.head).toBe(4) // in the new cell
    await choose('左に列を挿入', { anchor: 0 })
    expect(content()).toBe(',a,b,,c\n,1,2,,3')
    await choose('列を削除', { anchor: 1, head: 6 }) // "a,b,," : columns 1–3
    expect(content()).toBe(',c\n,3')
    await choose('列を削除', { anchor: 0 })
    expect(content()).toBe('c\n3')
    await vi.waitFor(() => expect(dir['data.csv'].content).toBe('c\n3'), { timeout: 2000 })

    await choose('コピー', { anchor: 0, head: 1 })
    expect(clipboard).toBe('c')
    await choose('貼り付け', { anchor: 3 })
    expect(content()).toBe('c\n3c')
    await choose('切り取り', { anchor: 2, head: 4 })
    expect(clipboard).toBe('3c')
    expect(content()).toBe('c\n')

    // A markdown note keeps the WebView's own menu.
    row('n.md').click()
    await vi.waitFor(() => expect(editorView().state.doc.toString()).toBe(''))
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    editorView().contentDOM.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect($('.ctx-menu')).toBeNull()
  })

  it('clicking a checkbox ticks the task in the file', async () => {
    const dir: Folder = { 'todo.md': { content: '- [ ] milk\n- [x] eggs', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('todo.md').click()
    await vi.waitFor(() => expect(document.querySelectorAll('#content .cm-lp-task')).toHaveLength(2))
    const [milk] = document.querySelectorAll<HTMLInputElement>('#content .cm-lp-task')
    expect(milk.checked).toBe(false)
    milk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(content()).toBe('- [x] milk\n- [x] eggs')
    await vi.waitFor(() => expect(dir['todo.md'].content).toBe('- [x] milk\n- [x] eggs'), { timeout: 2000 })
  })

  it('.markdown files are notes: listed, live preview, renamed with their own extension', async () => {
    const dir: Folder = { 'old.markdown': { content: '# H', modifiedAt: 1 }, 'x.bak': { content: '', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    expect(rows()).toEqual(['old.markdown']) // the list shows the extension, the title field doesn't
    row('old.markdown').click()
    await vi.waitFor(() => expect(content()).toBe('# H'))
    expect($('#content .cm-editor').classList.contains('cm-markdown')).toBe(true)
    const title = $<HTMLInputElement>('#title')
    expect(title.value).toBe('old')

    title.value = 'by title'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(names(dir)).toEqual(['by title.markdown', 'x.bak']))

    await menuItem('by title.markdown', '名前の変更')
    const box = $<HTMLInputElement>('.file-rename')
    box.value = 'by menu'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(names(dir)).toEqual(['by menu.markdown', 'x.bak']))
    expect(dir['by menu.markdown'].content).toBe('# H')
    expect(title.value).toBe('by menu')
  })
})

describe('search (Ctrl+F)', () => {
  const ctrlF = (target: EventTarget) => {
    const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    target.dispatchEvent(e)
    return e
  }
  const panel = () => $('#content .cm-search')
  const field = (name: string) => $<HTMLInputElement>(`#content .cm-search input[name=${name}]`)
  function query(name: 'search' | 'replace', value: string): void {
    field(name).value = value
    field(name).dispatchEvent(new Event('change'))
  }
  const button = (name: string) => $<HTMLButtonElement>(`#content .cm-search button[name=${name}]`)

  it('in the editor: the whole note, also lines far off screen; replace all is saved', async () => {
    const text = 'top\n' + 'filler line\n'.repeat(5000) + 'needle at the end\n'
    const dir: Folder = { 'long.md': { content: text, modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('long.md').click()
    await vi.waitFor(() => expect(content()).toBe(text))

    const e = ctrlF(editorView().contentDOM)
    expect(e.defaultPrevented).toBe(true) // no WebView find bar
    expect(panel()).not.toBeNull()
    expect(field('search').placeholder).toBe('検索')
    expect(button('replaceAll').textContent).toBe('すべて置換')
    expect(document.activeElement).not.toBe($('#search')) // the file filter stays out of it

    query('search', 'needle')
    button('next').click()
    const sel = editorView().state.selection.main
    expect(text.slice(sel.from, sel.to)).toBe('needle')
    expect(sel.from).toBe(text.indexOf('needle'))

    query('search', 'filler')
    query('replace', 'f')
    button('replaceAll').click()
    const replaced = 'top\n' + 'f line\n'.repeat(5000) + 'needle at the end\n'
    expect(content()).toBe(replaced)
    await vi.waitFor(() => expect(dir['long.md'].content).toBe(replaced), { timeout: 2000 })
  })

  it('a match in a table: the table shows as its text while the panel is open', async () => {
    const text = '# 表\n\n| 品物 | 数 |\n|--|--|\n| りんご | 3 |\n\nend\n'
    const dir: Folder = { 't.md': { content: text, modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('t.md').click()
    await vi.waitFor(() => expect($('#content .cm-lp-table')).not.toBeNull())

    ctrlF(editorView().contentDOM)
    query('search', 'りんご')
    button('next').click()
    expect($('#content .cm-lp-table')).toBeNull()
    expect($('#content .cm-lp-table-src')).not.toBeNull()
  })

  it('anywhere else: the file filter, with the file list shown; F3 does nothing', async () => {
    const dir: Folder = { 'a.md': { content: 'x', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    $<HTMLButtonElement>('#toggle-sidebar').click() // folded away
    expect($('#notes-screen').classList.contains('sidebar-hidden')).toBe(true)

    const e = ctrlF(row('a.md'))
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe($('#search'))
    expect($('#notes-screen').classList.contains('sidebar-hidden')).toBe(false)
    expect(panel()).toBeNull()

    const f3 = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })
    document.body.dispatchEvent(f3)
    expect(f3.defaultPrevented).toBe(true)
  })
})

describe('manual save', () => {
  const ctrlS = () => {
    const e = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    editorView().contentDOM.dispatchEvent(e)
    return e
  }
  const autoSaveBox = () => $<HTMLInputElement>('#autosave')
  function toggleAutoSave(on: boolean): void {
    autoSaveBox().checked = on
    autoSaveBox().dispatchEvent(new Event('change'))
  }
  /** window.askSave answers `answers` in turn; `asked` = the questions so far. */
  let asked: string[]
  let answers: SaveAnswer[]
  beforeEach(() => {
    asked = []
    answers = []
    window.askSave = async (text) => (asked.push(text), answers.shift() ?? 'cancel')
  })
  afterEach(() => delete window.askSave)

  it('the toggle is remembered; manual: typing is not saved, the status says so, Ctrl+S saves', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 } }
    const { host, storage } = fakeHost({ D: d }, { folderHandle: handle('D') })
    const statuses: NotesStatus[] = []
    await startNotes(root(), host, { onStatus: (s) => statuses.push(s) })
    expect(autoSaveBox().checked).toBe(true) // the default: as before
    expect(statuses).toEqual([{ name: null, dirty: false }])
    row('a.md').click()
    await settle()
    expect(statuses.at(-1)).toEqual({ name: 'a.md', dirty: false })
    typeContent('auto') // auto save: never shown as unsaved
    expect(statuses.at(-1)).toEqual({ name: 'a.md', dirty: false })
    await vi.waitFor(() => expect(d['a.md'].content).toBe('auto'), { timeout: 2000 })

    toggleAutoSave(false)
    await settle()
    expect(storage.get('autoSave')).toBe(false)
    const count = statuses.length
    typeContent('manual')
    typeContent('manual, more') // told once, not per keystroke
    expect(statuses.slice(count)).toEqual([{ name: 'a.md', dirty: true }])
    await sleep(600) // longer than the save delay
    expect(d['a.md'].content).toBe('auto')
    typeContent('auto') // back to what's on disk
    expect(statuses.at(-1)).toEqual({ name: 'a.md', dirty: false })

    typeContent('saved by hand')
    expect(ctrlS().defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(d['a.md'].content).toBe('saved by hand'))
    expect(statuses.at(-1)).toEqual({ name: 'a.md', dirty: false })
    expect(asked).toEqual([])

    // Next start: still manual.
    await startNotes(root(), host)
    expect(autoSaveBox().checked).toBe(false)
  })

  it('leaving a file with unsaved changes asks: cancel stays, "don\'t save" drops them, save writes them', async () => {
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 }, 'b.md': { content: 'B', modifiedAt: 1 } }
    const e: Folder = { 'e.md': { content: 'E', modifiedAt: 1 } }
    const { host, state } = fakeHost({ D: d, E: e }, { folderHandle: handle('D'), autoSave: false })
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('A edited')

    answers = ['cancel']
    row('b.md').click()
    await settle()
    expect(asked).toEqual(['「a.md」への変更を保存しますか？'])
    expect(content()).toBe('A edited')
    expect($<HTMLInputElement>('#title').value).toBe('a')

    row('a.md').click() // the open file itself: not read again, nothing asked
    await settle()
    expect(asked).toHaveLength(1)
    expect(content()).toBe('A edited')

    answers = ['cancel'] // a new note: none made
    $<HTMLButtonElement>('#new-note').click()
    await settle()
    expect(names(d)).toEqual(['a.md', 'b.md'])

    answers = ['cancel'] // another folder: the bar goes back to this one
    state.changeFolder(handle('E'))
    await vi.waitFor(() => expect(asked).toHaveLength(3))
    await settle()
    expect(state.bar).toEqual(handle('D'))
    expect(content()).toBe('A edited')

    answers = ['discard']
    row('b.md').click()
    await vi.waitFor(() => expect(content()).toBe('B'))
    expect(d['a.md']).toEqual({ content: 'A', modifiedAt: 1 })

    typeContent('B edited')
    answers = ['save']
    row('a.md').click()
    await vi.waitFor(() => expect(content()).toBe('A'))
    expect(d['b.md'].content).toBe('B edited')
    expect(asked).toHaveLength(5)

    row('b.md').click() // nothing unsaved: nothing asked
    await vi.waitFor(() => expect(content()).toBe('B edited'))
    expect(asked).toHaveLength(5)
  })

  it("without window.askSave (Brighterm): confirm, OK = save, Cancel = don't save", async () => {
    delete window.askSave
    const d: Folder = { 'a.md': { content: 'A', modifiedAt: 1 }, 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D'), autoSave: false })
    await startNotes(root(), host)
    row('a.md').click()
    await settle()
    typeContent('A edited')
    acceptConfirm = true
    row('b.md').click()
    await vi.waitFor(() => expect(content()).toBe('B'))
    expect(dialogs).toEqual(['「a.md」への変更を保存しますか？\n\nOK = 保存 / キャンセル = 保存しない'])
    expect(d['a.md'].content).toBe('A edited')

    typeContent('B edited')
    acceptConfirm = false
    row('a.md').click()
    await vi.waitFor(() => expect(content()).toBe('A edited'))
    expect(d['b.md'].content).toBe('B')
  })

  it('a rename keeps the changes unsaved; switching to auto saves them; closing asks', async () => {
    const d: Folder = { 'a.md': { content: 'A\r\nline', modifiedAt: 1 } }
    const { host } = fakeHost({ D: d }, { folderHandle: handle('D'), autoSave: false })
    const statuses: NotesStatus[] = []
    const notes = await startNotes(root(), host, { onStatus: (s) => statuses.push(s) })
    expect(await notes.beforeClose()).toBe(true) // nothing open
    row('a.md').click()
    await settle()
    typeContent('changed')

    const title = $<HTMLInputElement>('#title')
    title.value = 'renamed'
    title.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(names(d)).toEqual(['renamed.md']))
    expect(d['renamed.md'].content).toBe('A\r\nline') // the file as it was, line endings too
    expect(content()).toBe('changed')
    expect(statuses.at(-1)).toEqual({ name: 'renamed.md', dirty: true })

    answers = ['cancel']
    expect(await notes.beforeClose()).toBe(false)
    expect(asked).toEqual(['「renamed.md」への変更を保存しますか？'])
    answers = ['discard']
    expect(await notes.beforeClose()).toBe(true)
    expect(d['renamed.md'].content).toBe('A\r\nline')

    toggleAutoSave(true)
    await vi.waitFor(() => expect(d['renamed.md'].content).toBe('changed'))
    expect(statuses.at(-1)).toEqual({ name: 'renamed.md', dirty: false })
    typeContent('last words')
    expect(await notes.beforeClose()).toBe(true) // auto: saved at once, nothing asked
    expect(d['renamed.md'].content).toBe('last words')
    expect(asked).toHaveLength(2)
  })

  it('no file open: typed text is unsaved until Ctrl+S makes it a note named after the title', async () => {
    const empty: Folder = {}
    const { host, state } = fakeHost({ E: empty }, { autoSave: false })
    const statuses: NotesStatus[] = []
    await startNotes(root(), host, { onStatus: (s) => statuses.push(s) })
    state.changeFolder(handle('E'))
    await vi.waitFor(() => expect($('#notes-screen').hidden).toBe(false))
    const title = $<HTMLInputElement>('#title')
    title.value = '買い物'
    title.dispatchEvent(new Event('change'))
    typeContent('牛乳')
    expect(statuses.at(-1)).toEqual({ name: null, dirty: true })
    await sleep(600)
    expect(names(empty)).toEqual([])
    ctrlS()
    await vi.waitFor(() => expect(names(empty)).toEqual(['買い物.md']))
    expect(empty['買い物.md'].content).toBe('牛乳')
    expect(statuses.at(-1)).toEqual({ name: '買い物.md', dirty: false })
  })
})

describe('dialogs', () => {
  it("delete waits for an async confirm (Tauri's dialog plugin) and keeps the note on cancel", async () => {
    let answer = false
    vi.stubGlobal('confirm', (m: string) => (dialogs.push(m), Promise.resolve(answer)))
    const dir: Folder = { 'keep.md': { content: 'x', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    await menuItem('keep.md', '削除')
    await settle()
    expect(dialogs).toEqual(['「keep.md」を削除しますか？'])
    expect(names(dir)).toEqual(['keep.md'])
    answer = true
    await menuItem('keep.md', '削除')
    await vi.waitFor(() => expect(names(dir)).toEqual([]))
  })
})

describe('menu', () => {
  it('copy / cut / paste, also into another folder; copy path', async () => {
    const one: Folder = { 'a.md': { content: 'note A', modifiedAt: 1 }, 'b.md': { content: 'note B', modifiedAt: 1 } }
    const two: Folder = { 'a.md': { content: 'folder two A', modifiedAt: 1 } }
    const { host, state } = fakeHost({ one, two }, { folderHandle: handle('one') })
    await startNotes(root(), host)

    row('a.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect([...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent)).toEqual([
      'コピー',
      '切り取り',
      'パスのコピー',
      '名前の変更',
      '削除'
    ])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect($('.ctx-menu')).toBeNull()

    await menuItem('a.md', 'コピー')
    await menuItem('b.md', '貼り付け')
    expect(names(one)).toEqual(['a (2).md', 'a.md', 'b.md'])
    expect(one['a (2).md'].content).toBe('note A')

    await menuItem('b.md', 'パスのコピー')
    expect(state.copied).toBe('one\\b.md')

    // Copied in one, pasted in two (which has its own a.md): the copy is folder one's.
    await menuItem('a.md', 'コピー')
    state.changeFolder(handle('two'))
    await vi.waitFor(() => expect(rows()).toEqual(['a.md']))
    await menuItem('a.md', '貼り付け')
    expect(two['a (2).md'].content).toBe('note A')
    expect(two['a.md'].content).toBe('folder two A')

    // Cut in one: pasting in one changes nothing; in two, the note moves, and the cut is used up.
    state.changeFolder(handle('one'))
    await vi.waitFor(() => expect(rows()).toContain('b.md'))
    await menuItem('b.md', '切り取り')
    await menuItem('a.md', '貼り付け')
    expect(names(one)).toEqual(['a (2).md', 'a.md', 'b.md'])
    state.changeFolder(handle('two'))
    await vi.waitFor(() => expect(rows()).toEqual(['a.md', 'a (2).md']))
    await menuItem('a.md', '貼り付け')
    expect(two['b.md'].content).toBe('note B')
    expect(one['b.md']).toBeUndefined()
    row('a.md').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect([...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent)).not.toContain('貼り付け')
  })

  it('rename in place: Esc, unchanged, case only, taken name, real rename; delete asks first', async () => {
    const dir: Folder = {
      'note.md': { content: 'my note', modifiedAt: 1 },
      'other.md': { content: 'other note', modifiedAt: 1 }
    }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('note.md').click()
    await settle()
    const box = () => $<HTMLInputElement>('.file-rename')

    // Esc: nothing changes.
    await menuItem('note.md', '名前の変更')
    expect(document.activeElement).toBe(box())
    expect(box().value).toBe('note')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(box()).toBeNull()
    expect(rows()).toEqual(['note.md', 'other.md'])

    // Only the case changes (the same file on Windows): the note must survive.
    await menuItem('note.md', '名前の変更')
    box().value = 'Note'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(names(dir)).toEqual(['Note.md', 'other.md']))
    expect(dir['Note.md'].content).toBe('my note')
    expect($<HTMLInputElement>('#title').value).toBe('Note')

    // A name another note has (in any case) is refused; nothing is overwritten.
    await menuItem('Note.md', '名前の変更')
    box().value = 'OTHER'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(dialogs.at(-1)).toContain('同じ名前のファイルがあります'))
    expect(dir['other.md'].content).toBe('other note')
    expect(dir['Note.md'].content).toBe('my note')

    // A real rename.
    await menuItem('Note.md', '名前の変更')
    box().value = 'renamed'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(names(dir)).toEqual(['other.md', 'renamed.md']))
    expect(dir['renamed.md'].content).toBe('my note')

    // Delete: cancel keeps it; OK deletes it and clears the editor.
    await menuItem('renamed.md', '削除')
    expect(dialogs.at(-1)).toBe('「renamed.md」を削除しますか？')
    expect(dir['renamed.md']).toBeDefined()
    acceptConfirm = true
    await menuItem('renamed.md', '削除')
    await vi.waitFor(() => expect(names(dir)).toEqual(['other.md']))
    expect(content()).toBe('')
    expect($<HTMLInputElement>('#title').value).toBe('')
  })
})
