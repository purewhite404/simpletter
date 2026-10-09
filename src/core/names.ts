/** File names and ordering — pure, so they're unit-tested (names.test.ts). */

export interface Named {
  name: string
  modifiedAt?: number
}

/** How the list is ordered (remembered in storage). */
export const SORT_ORDERS = ['name-asc', 'name-desc', 'date-desc', 'date-asc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

export const isSortOrder = (value: unknown): value is SortOrder => SORT_ORDERS.includes(value as SortOrder)

export const isMarkdown = (name: string): boolean => name.toLowerCase().endsWith('.md')

/** How a file is shown: a note (live preview), a table (CSV / TSV) or plain text. */
export type FileKind = 'markdown' | 'csv' | 'tsv' | 'plain'

export function fileKind(name: string): FileKind {
  const ext = /\.([^.]*)$/.exec(name.toLowerCase())?.[1]
  return ext === 'md' ? 'markdown' : ext === 'csv' ? 'csv' : ext === 'tsv' ? 'tsv' : 'plain'
}

/** Notes and tables are listed whenever they're in the folder; other files only once opened from outside. */
export const isListed = (name: string): boolean => fileKind(name) !== 'plain'

/** Notes show without ".md"; other files keep their full name so the extension stays visible. */
export const displayName = (name: string): string => (isMarkdown(name) ? name.replace(/\.md$/i, '') : name)

/** By the name as shown ("note 2" before "note 10", case ignored). */
export const byName = (a: Named, b: Named): number =>
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

/** A typed title as a file name: characters Windows doesn't allow become "_". */
export const safeTitle = (title: string): string => title.trim().replace(/[\\/:*?"<>|]/g, '_')

/** A file name for a new note, from the title if one was typed, else "メモ-2026-10-08-15-30". */
export function newFileName(files: Named[], title: string, now: Date = new Date()): string {
  const base = safeTitle(title) || `メモ-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`
  let name = `${base}.md`
  let n = 2
  while (nameTaken(files, name)) name = `${base} (${n++}).md`
  return name
}
