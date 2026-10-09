// @vitest-environment happy-dom
//
// The notes UI driven through a fake host: folders in memory, with Windows'
// case-insensitive names (writing "Note.md" over "note.md" keeps "note.md").
// Scenarios follow Brighterm's tests/e2e/notes.spec.ts.

import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry, FolderHandle, NotesHost } from './host'
import { startNotes } from './notes'

type Folder = Record<string, { content: string; modifiedAt: number }>

function fakeHost(folders: Record<string, Folder>, saved: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(saved))
  const state = {
    bar: undefined as FolderHandle | null | undefined,
    copied: '',
    changeFolder: (_: FolderHandle) => {},
    openFile: (_: { folder: FolderHandle; name: string }) => {}
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
      get: async <T,>(k: string) => (storage.has(k) ? (structuredClone(storage.get(k)) as T) : null),
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
const row = (text: string) => [...document.querySelectorAll<HTMLElement>('.file-row')].find((r) => r.textContent === text)!
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
  const button = [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu button')].find((b) => b.textContent === item)
  if (!button) throw new Error(`no "${item}" in the menu`)
  button.click()
  await settle()
}

const settle = () => new Promise((r) => setTimeout(r, 0))

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
    const a: Folder = { 'b.md': { content: 'B', modifiedAt: 1 }, 'a.md': { content: 'A', modifiedAt: 2 }, 'x.txt': { content: '', modifiedAt: 1 } }
    let s = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), s.host)
    expect($('#notes-screen').hidden).toBe(false)
    expect(rows()).toEqual(['a', 'b']) // only .md
    expect(s.state.bar).toEqual(handle('A'))

    s = fakeHost({}, { folderHandle: handle('gone') })
    await startNotes(root(), s.host)
    expect($('#picker-screen').hidden).toBe(false)
    expect(s.state.bar).toBeNull()
  })

  it('a folder from the bar: its first note opens, and it is remembered', async () => {
    const { host, state, storage } = fakeHost({ A: { 'z.md': { content: 'Z', modifiedAt: 1 }, 'm.md': { content: 'M', modifiedAt: 1 } } })
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
    expect(rows()).toEqual(['買い物'])
  })
})

describe('editing', () => {
  it('saves 0.4 s after typing stops; switching folders saves at once', async () => {
    const a: Folder = { 'a.md': { content: 'old', modifiedAt: 1 } }
    const b: Folder = { 'b.md': { content: 'B', modifiedAt: 1 } }
    const { host, state } = fakeHost({ A: a, B: b }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    row('a').click()
    await settle()
    typeContent('new')
    expect(a['a.md'].content).toBe('old')
    await vi.waitFor(() => expect(a['a.md'].content).toBe('new'), { timeout: 2000 })

    typeContent('newer')
    state.changeFolder(handle('B')) // before the timer fires
    await vi.waitFor(() => expect(content()).toBe('B'))
    expect(a['a.md'].content).toBe('newer')
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
    expect(rows()).toEqual(['new note', 'mid', 'old note'])
    expect(storage.get('sortOrder')).toBe('date-desc')

    row('old note').click()
    await settle()
    typeContent('edited')
    await vi.waitFor(() => expect(rows()).toEqual(['old note', 'new note', 'mid']), { timeout: 2000 })

    // Search keeps the order.
    type($('#search'), 'note')
    expect(rows()).toEqual(['old note', 'new note'])

    // Next start: the same order.
    await startNotes(root(), host)
    expect($<HTMLSelectElement>('#sort').value).toBe('date-desc')
    expect(rows()).toEqual(['old note', 'new note', 'mid'])
  })

  it('the title field renames the note, but never over another one', async () => {
    const a: Folder = { 'note.md': { content: 'my note', modifiedAt: 1 }, 'other.md': { content: 'other', modifiedAt: 1 } }
    const { host } = fakeHost({ A: a }, { folderHandle: handle('A') })
    await startNotes(root(), host)
    row('note').click()
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

    await new Promise((r) => setTimeout(r, 600)) // longer than the save delay
    expect(dir['a.md'].modifiedAt).toBe(1)
    expect(dir['log.txt'].modifiedAt).toBe(1)
  })

  it('a table shows as a <table>; a click on a cell puts the cursor in its source text', async () => {
    const text = '# 表\n\n| 品物 | 数 |\n|:--|--:|\n| **りんご** | 3 |\n|  | 5 |\n'
    const dir: Folder = { 't.md': { content: text, modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('t').click()
    await vi.waitFor(() => expect($('#content .cm-lp-table')).not.toBeNull())
    const cells = () => [...document.querySelectorAll<HTMLElement>('#content .cm-lp-table tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(cells()).toEqual([['品物', '数'], ['りんご', '3'], ['', '5']])
    expect($('#content .cm-lp-table td .cm-lp-strong')?.textContent).toBe('りんご')
    expect($<HTMLElement>('#content .cm-lp-table th:last-child').style.textAlign).toBe('right')

    const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    const cursor = () => editorView().state.selection.main.head
    click([...document.querySelectorAll<HTMLElement>('#content .cm-lp-table td')][0])
    expect(text.slice(0, cursor())).toMatch(/\| \*\*りんご$/) // after the cell's text (inside the **)
    click([...document.querySelectorAll<HTMLElement>('#content .cm-lp-table td')][2])
    expect(text.slice(cursor())).toMatch(/^ \| 5 \|/) // an empty cell: inside it, after one space

    await new Promise((r) => setTimeout(r, 600))
    expect(dir['t.md'].modifiedAt).toBe(1) // not an edit
  })

  it('CSV / TSV files are listed and shown as a table; edits are saved as the raw text', async () => {
    const csv = 'name,qty\n"apple, red",3\n'
    const dir: Folder = {
      'a.md': { content: '', modifiedAt: 1 },
      'data.csv': { content: csv, modifiedAt: 1 },
      't.TSV': { content: 'x\ty', modifiedAt: 1 },
      'x.txt': { content: '', modifiedAt: 1 }
    }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    expect(rows()).toEqual(['a', 'data.csv', 't.TSV'])

    row('data.csv').click()
    await vi.waitFor(() => expect(content()).toBe(csv))
    expect($('#content .cm-editor').classList.contains('cm-csv')).toBe(true)
    expect($<HTMLInputElement>('#title').value).toBe('data.csv')
    const cellTexts = () => [...document.querySelectorAll('#content .cm-csv-cell')].map((c) => c.textContent)
    expect(cellTexts()).toEqual(['name', 'qty', 'apple, red', '3']) // the quotes and delimiters are hidden
    expect($<HTMLElement>('#content .cm-csv-cell').style.width).toBe('calc(12ch + 1px)')
    await new Promise((r) => setTimeout(r, 600))
    expect(dir['data.csv'].modifiedAt).toBe(1) // opening is not an edit

    const view = editorView()
    view.dispatch({ changes: { from: csv.indexOf('3'), to: csv.indexOf('3') + 1, insert: '12' }, userEvent: 'input.type' })
    await vi.waitFor(() => expect(dir['data.csv'].content).toBe('name,qty\n"apple, red",12\n'), { timeout: 2000 })

    row('t.TSV').click()
    await vi.waitFor(() => expect(content()).toBe('x\ty'))
    expect(cellTexts()).toEqual(['x', 'y']) // the tab: a 1 ch widget
  })

  it('clicking a checkbox ticks the task in the file', async () => {
    const dir: Folder = { 'todo.md': { content: '- [ ] milk\n- [x] eggs', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('todo').click()
    await vi.waitFor(() => expect(document.querySelectorAll('#content .cm-lp-task')).toHaveLength(2))
    const [milk] = document.querySelectorAll<HTMLInputElement>('#content .cm-lp-task')
    expect(milk.checked).toBe(false)
    milk.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    expect(content()).toBe('- [x] milk\n- [x] eggs')
    await vi.waitFor(() => expect(dir['todo.md'].content).toBe('- [x] milk\n- [x] eggs'), { timeout: 2000 })
  })
})

describe('dialogs', () => {
  it("delete waits for an async confirm (Tauri's dialog plugin) and keeps the note on cancel", async () => {
    let answer = false
    vi.stubGlobal('confirm', (m: string) => (dialogs.push(m), Promise.resolve(answer)))
    const dir: Folder = { 'keep.md': { content: 'x', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    await menuItem('keep', '削除')
    await settle()
    expect(dialogs).toEqual(['「keep」を削除しますか？'])
    expect(names(dir)).toEqual(['keep.md'])
    answer = true
    await menuItem('keep', '削除')
    await vi.waitFor(() => expect(names(dir)).toEqual([]))
  })
})

describe('menu', () => {
  it('copy / cut / paste, also into another folder; copy path', async () => {
    const one: Folder = { 'a.md': { content: 'note A', modifiedAt: 1 }, 'b.md': { content: 'note B', modifiedAt: 1 } }
    const two: Folder = { 'a.md': { content: 'folder two A', modifiedAt: 1 } }
    const { host, state } = fakeHost({ one, two }, { folderHandle: handle('one') })
    await startNotes(root(), host)

    row('a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect([...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent)).toEqual([
      'コピー',
      '切り取り',
      'パスのコピー',
      '名前の変更',
      '削除'
    ])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect($('.ctx-menu')).toBeNull()

    await menuItem('a', 'コピー')
    await menuItem('b', '貼り付け')
    expect(names(one)).toEqual(['a (2).md', 'a.md', 'b.md'])
    expect(one['a (2).md'].content).toBe('note A')

    await menuItem('b', 'パスのコピー')
    expect(state.copied).toBe('one\\b.md')

    // Copied in one, pasted in two (which has its own a.md): the copy is folder one's.
    await menuItem('a', 'コピー')
    state.changeFolder(handle('two'))
    await vi.waitFor(() => expect(rows()).toEqual(['a']))
    await menuItem('a', '貼り付け')
    expect(two['a (2).md'].content).toBe('note A')
    expect(two['a.md'].content).toBe('folder two A')

    // Cut in one: pasting in one changes nothing; in two, the note moves, and the cut is used up.
    state.changeFolder(handle('one'))
    await vi.waitFor(() => expect(rows()).toContain('b'))
    await menuItem('b', '切り取り')
    await menuItem('a', '貼り付け')
    expect(names(one)).toEqual(['a (2).md', 'a.md', 'b.md'])
    state.changeFolder(handle('two'))
    await vi.waitFor(() => expect(rows()).toEqual(['a', 'a (2)']))
    await menuItem('a', '貼り付け')
    expect(two['b.md'].content).toBe('note B')
    expect(one['b.md']).toBeUndefined()
    row('a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect([...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent)).not.toContain('貼り付け')
  })

  it('rename in place: Esc, unchanged, case only, taken name, real rename; delete asks first', async () => {
    const dir: Folder = { 'note.md': { content: 'my note', modifiedAt: 1 }, 'other.md': { content: 'other note', modifiedAt: 1 } }
    const { host } = fakeHost({ D: dir }, { folderHandle: handle('D') })
    await startNotes(root(), host)
    row('note').click()
    await settle()
    const box = () => $<HTMLInputElement>('.file-rename')

    // Esc: nothing changes.
    await menuItem('note', '名前の変更')
    expect(document.activeElement).toBe(box())
    expect(box().value).toBe('note')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(box()).toBeNull()
    expect(rows()).toEqual(['note', 'other'])

    // Only the case changes (the same file on Windows): the note must survive.
    await menuItem('note', '名前の変更')
    box().value = 'Note'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(names(dir)).toEqual(['Note.md', 'other.md']))
    expect(dir['Note.md'].content).toBe('my note')
    expect($<HTMLInputElement>('#title').value).toBe('Note')

    // A name another note has (in any case) is refused; nothing is overwritten.
    await menuItem('Note', '名前の変更')
    box().value = 'OTHER'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(dialogs.at(-1)).toContain('同じ名前のファイルがあります'))
    expect(dir['other.md'].content).toBe('other note')
    expect(dir['Note.md'].content).toBe('my note')

    // A real rename.
    await menuItem('Note', '名前の変更')
    box().value = 'renamed'
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(names(dir)).toEqual(['other.md', 'renamed.md']))
    expect(dir['renamed.md'].content).toBe('my note')

    // Delete: cancel keeps it; OK deletes it and clears the editor.
    await menuItem('renamed', '削除')
    expect(dialogs.at(-1)).toBe('「renamed」を削除しますか？')
    expect(dir['renamed.md']).toBeDefined()
    acceptConfirm = true
    await menuItem('renamed', '削除')
    await vi.waitFor(() => expect(names(dir)).toEqual(['other.md']))
    expect(content()).toBe('')
    expect($<HTMLInputElement>('#title').value).toBe('')
  })
})
