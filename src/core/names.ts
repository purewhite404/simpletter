/** File names and ordering — pure, so they're unit-tested (names.test.ts). */

export interface Named {
  name: string
  modifiedAt?: number
}

/** How the list is ordered (remembered in storage). */
const SORT_ORDERS = ['name-asc', 'name-desc', 'date-desc', 'date-asc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

export const isSortOrder = (value: unknown): value is SortOrder => SORT_ORDERS.includes(value as SortOrder)

/** How a file is shown: a note (live preview), a table (CSV / TSV) or plain text. */
export type FileKind = 'markdown' | 'csv' | 'tsv' | 'plain'

const KINDS = new Map<string, FileKind>([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['csv', 'csv'],
  ['tsv', 'tsv']
])

/** "a.Tar.GZ" → "gz"; "" without a dot. */
const extension = (name: string): string => /\.([^.]*)$/.exec(name.toLowerCase())?.[1] ?? ''

export function fileKind(name: string): FileKind {
  return KINDS.get(extension(name)) ?? 'plain'
}

/** A note: .md, or .markdown (the other extension the installer associates). */
export const isMarkdown = (name: string): boolean => fileKind(name) === 'markdown'

const NOTE_EXTENSION = /\.(md|markdown)$/i

/** The extension a note renamed to another title keeps: ".markdown" stays, anything else is ".md". */
export const noteExtension = (name: string): string => (/\.markdown$/i.test(name) ? '.markdown' : '.md')

/** Text files shown as plain text but listed like the notes. */
const TEXT_EXTENSIONS = new Set(['txt', 'log', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'json', 'toml'])

/**
 * Listed whenever they're in the folder: notes, tables and the text files above — the same extensions the installer
 * associates (src-tauri/tauri.conf.json, checked by names.test.ts). Other files only once opened from outside.
 */
export const isListed = (name: string): boolean => fileKind(name) !== 'plain' || TEXT_EXTENSIONS.has(extension(name))

/**
 * A name without ".md" / ".markdown" (other files keep their full name): the title field, the rename box and
 * the sort order use it. The file list shows the full name.
 */
export const displayName = (name: string): string => name.replace(NOTE_EXTENSION, '')

/** By the name as shown ("note 2" before "note 10", case ignored). */
const byName = (a: Named, b: Named): number =>
  displayName(a.name).localeCompare(displayName(b.name), 'ja', { numeric: true, sensitivity: 'base' })

/** Sorts in place: by name, or by when it was last changed (ties by name). */
export function sortFiles<T extends Named>(files: T[], order: SortOrder): T[] {
  const [key, direction] = order.split('-')
  const sign = direction === 'asc' ? 1 : -1
  return files.sort((a, b) => {
    if (key === 'date') return sign * ((a.modifiedAt || 0) - (b.modifiedAt || 0)) || byName(a, b)
    return sign * byName(a, b)
  })
}

/**
 * Is `name` taken in this folder (by a file other than `except`)? Case is ignored:
 * on Windows "Note.md" and "note.md" are the same file, so writing one overwrites the other.
 */
export function nameTaken(files: Named[], name: string, except: string | null = null): boolean {
  const lower = name.toLowerCase()
  return files.some((f) => f.name !== except && f.name.toLowerCase() === lower)
}

/** "a.md" → "a (2).md" … the first name not taken yet. */
export function freeName(files: Named[], name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let n = 2
  let candidate = name
  while (nameTaken(files, candidate)) candidate = `${base} (${n++})${ext}`
  return candidate
}

/** A typed title as a file name: characters Windows doesn't allow (and control characters) become "_". */
export const safeTitle = (title: string): string => title.trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')

/** A device name ("CON", "nul.txt", "COM1 .log"…): Windows opens the device, not a file. */
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(\.|$)/i

/**
 * A whole file name as Windows keeps it: no trailing dots / spaces (Windows drops them), a device name gets a
 * leading "_". The native side refuses the others (src-tauri/src/files.rs `valid_name`).
 */
export function safeName(name: string): string {
  const trimmed = name.replace(/[. ]+$/, '')
  return RESERVED.test(trimmed) ? '_' + trimmed : trimmed
}

/**
 * Extensions Windows runs on a double-click: the native side never creates such a file (src-tauri/src/files.rs
 * `EXECUTABLE`, keep in step). Checked here too, before a rename writes anything.
 */
const EXECUTABLE = new Set(
  'exe com scr pif msi msp msc cpl dll bat cmd ps1 psm1 vbs vbe js jse wsf wsh hta lnk url reg jar scf chm application appref-ms settingcontent-ms'.split(
    ' '
  )
)

export const isExecutable = (name: string): boolean => EXECUTABLE.has(extension(name))

/** Why a file can't get `name` (same text as the native side's). */
export const executableMessage = (name: string): string => `実行できる種類のファイルは新しく作れません: ${name}`

/** A file name for a new note, from the title if one was typed, else "メモ-2026-10-08-15-30". */
export function newFileName(files: Named[], title: string, now: Date = new Date()): string {
  const base = safeTitle(title) || `メモ-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`
  return freeName(files, safeName(`${base}.md`))
}
