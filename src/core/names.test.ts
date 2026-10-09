import { describe, expect, it } from 'vitest'
import tauriConf from '../../src-tauri/tauri.conf.json'
import {
  displayName,
  fileKind,
  freeName,
  isExecutable,
  isListed,
  isSortOrder,
  nameTaken,
  newFileName,
  noteExtension,
  safeName,
  safeTitle,
  sortFiles
} from './names'

const named = (...names: string[]) => names.map((name) => ({ name }))

describe('displayName', () => {
  it('drops .md (any case) but keeps other extensions', () => {
    expect(displayName('メモ.md')).toBe('メモ')
    expect(displayName('README.MD')).toBe('README')
    expect(displayName('長い拡張子.markdown')).toBe('長い拡張子')
    expect(displayName('log.txt')).toBe('log.txt')
  })

  it('a renamed note keeps .markdown; anything else becomes .md', () => {
    expect(['a.md', 'a.MD', 'a.markdown', 'a.Markdown'].map(noteExtension)).toEqual([
      '.md',
      '.md',
      '.markdown',
      '.markdown'
    ])
  })
})

describe('fileKind', () => {
  it('notes, tables (CSV / TSV, any case) and the rest', () => {
    expect(
      ['a.md', 'f.Markdown', 'b.CSV', 'c.tsv', 'd.txt', 'csv', 'e.csv.bak', 'g.constructor'].map(fileKind)
    ).toEqual(['markdown', 'markdown', 'csv', 'tsv', 'plain', 'plain', 'plain', 'plain'])
  })

  it('notes, tables and text / config files are listed; other files are not', () => {
    const listed = ['a.md', 'b.csv', 'c.TSV', 'd.txt', 'app.LOG', 'x.ini', 'y.yml', 'package.json', 'Cargo.toml']
    expect(listed.filter(isListed)).toEqual(listed)
    expect(['x.bak', 'build.bat', 'txt', 'a.txt.bak', 'g.constructor'].filter(isListed)).toEqual([])
  })

  it('the installer associates exactly the listed extensions', () => {
    const associated = tauriConf.bundle.fileAssociations.flatMap((a) => a.ext)
    expect(associated.filter((ext) => !isListed(`a.${ext}`))).toEqual([])
    expect(new Set(associated).size).toBe(associated.length)
    expect([...associated].sort()).toEqual(
      ['md', 'markdown', 'csv', 'tsv', 'txt', 'log', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'json', 'toml'].sort()
    )
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
    expect(safeTitle('a\tb\u0001c')).toBe('a_b_c')
    expect(newFileName([], 'CON')).toBe('_CON.md')
  })

  it('safeName: no trailing dots / spaces, device names get a "_"', () => {
    expect(['x.bat.', 'a. . ', 'To be continued...md', '...'].map(safeName)).toEqual([
      'x.bat',
      'a',
      'To be continued...md',
      ''
    ])
    expect(['CON.md', 'nul', 'Com1.txt', 'lpt¹', 'AUX .log'].map(safeName)).toEqual([
      '_CON.md',
      '_nul',
      '_Com1.txt',
      '_lpt¹',
      '_AUX .log'
    ])
    expect(['CONFIG.md', 'com10.md', 'console.txt'].map(safeName)).toEqual(['CONFIG.md', 'com10.md', 'console.txt'])
  })

  it('isExecutable: by the extension, any case', () => {
    expect(['run.bat', 'X.CMD', 'a.ps1', 'l.lnk', 'app.exe', 'm.js', 'c.settingcontent-ms'].map(isExecutable)).toEqual(
      Array(7).fill(true)
    )
    expect(['a.md', 'config.json', 'bat', '.bashrc', 'notes.bat.md', 'x.json5'].map(isExecutable)).toEqual(
      Array(6).fill(false)
    )
  })
})
