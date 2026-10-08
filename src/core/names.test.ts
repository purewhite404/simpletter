import { describe, expect, it } from 'vitest'
import { displayName, freeName, isSortOrder, nameTaken, newFileName, safeTitle, sortFiles } from './names'

const named = (...names: string[]) => names.map((name) => ({ name }))

describe('displayName', () => {
  it('drops .md (any case) but keeps other extensions', () => {
    expect(displayName('メモ.md')).toBe('メモ')
    expect(displayName('README.MD')).toBe('README')
    expect(displayName('log.txt')).toBe('log.txt')
  })
})

describe('sortFiles', () => {
  // Name order and date order differ on purpose; "メモ 2" must come before "メモ 10".
  const files = () => [
    { name: 'メモ 10.md', modifiedAt: 3 },
    { name: 'メモ 2.md', modifiedAt: 5 },
    { name: 'apple.md', modifiedAt: 4 },
    { name: 'Banana.md', modifiedAt: 1 }
  ]
  const order = (o: Parameters<typeof sortFiles>[1]) => sortFiles(files(), o).map((f) => displayName(f.name))

  it('by name, numbers as numbers, case ignored', () => {
    expect(order('name-asc')).toEqual(['apple', 'Banana', 'メモ 2', 'メモ 10'])
    expect(order('name-desc')).toEqual(['メモ 10', 'メモ 2', 'Banana', 'apple'])
  })

  it('by date, ties by name', () => {
    expect(order('date-desc')).toEqual(['メモ 2', 'apple', 'メモ 10', 'Banana'])
    expect(order('date-asc')).toEqual(['Banana', 'メモ 10', 'apple', 'メモ 2'])
    expect(sortFiles([{ name: 'b.md' }, { name: 'a.md' }], 'date-desc').map((f) => f.name)).toEqual(['a.md', 'b.md'])
  })

  it('only known orders are accepted from storage', () => {
    expect(isSortOrder('date-asc')).toBe(true)
    expect(isSortOrder('size-asc')).toBe(false)
    expect(isSortOrder(null)).toBe(false)
  })
})

describe('names in a folder (case-insensitive, like Windows)', () => {
  it('nameTaken ignores case and the file being renamed', () => {
    const files = named('Note.md', 'other.md')
    expect(nameTaken(files, 'note.md')).toBe(true)
    expect(nameTaken(files, 'note.md', 'Note.md')).toBe(false)
    expect(nameTaken(files, 'new.md')).toBe(false)
  })

  it('freeName numbers copies', () => {
    expect(freeName(named('a.md'), 'b.md')).toBe('b.md')
    expect(freeName(named('a.md', 'A (2).md'), 'a.md')).toBe('a (3).md')
    expect(freeName(named('README'), 'README')).toBe('README (2)')
  })

  it('newFileName comes from the title, made safe, or from the time', () => {
    expect(newFileName([], '  買い物: 週末?  ')).toBe('買い物_ 週末_.md')
    expect(newFileName(named('x.md'), 'X')).toBe('X (2).md')
    expect(newFileName([], '', new Date('2026-10-08T06:30:00Z'))).toBe('メモ-2026-10-08-06-30.md')
    expect(safeTitle(' a/b\\c ')).toBe('a_b_c')
  })
})
