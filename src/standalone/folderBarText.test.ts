import { describe, expect, it } from 'vitest'
import { folderName, stillMatching, tabCompletion } from './folderBarText'

describe('folderName', () => {
  it('is the last name of a completion', () => {
    expect(folderName('C:\\Users\\me\\Notes\\')).toBe('Notes')
    expect(folderName('/home/me/メモ/')).toBe('メモ')
    expect(folderName('/home/me')).toBe('me')
  })

  it('keeps roots whole', () => {
    expect(folderName('D:\\')).toBe('D:\\')
    expect(folderName('/')).toBe('/')
  })
})

const DOCS = 'C:\\Users\\Me\\Documents\\'
const docs = (...names: string[]): string[] => names.map((n) => `${DOCS}${n}\\`)

describe('stillMatching', () => {
  it('drops the previous input\'s completions that no longer fit', () => {
    expect(stillMatching(docs('Arduino', 'MATLAB', 'QAM'), `${DOCS}Q`, true)).toEqual(docs('QAM'))
  })

  it('ignores case and separator style on Windows, not case on Linux', () => {
    expect(stillMatching(docs('QAM'), 'c:/users/me/documents/q', true)).toEqual(docs('QAM'))
    expect(stillMatching(['/home/a/Notes/'], '/home/a/n', false)).toEqual([])
  })
})

describe('tabCompletion', () => {
  it('takes the only completion', () => {
    expect(tabCompletion(`${DOCS}q`, docs('QAM'), true)).toBe(`${DOCS}QAM\\`)
  })

  it('fills what several completions have in common, like a shell', () => {
    expect(tabCompletion(`${DOCS}Ph`, docs('Photos-2023', 'Photos-2024'), true)).toBe(`${DOCS}Photos-202`)
    expect(tabCompletion(`${DOCS}ph`, docs('Photos-2023', 'photos-old'), true)).toBe(`${DOCS}Photos-`)
  })

  it('takes the first when they have nothing more in common', () => {
    expect(tabCompletion(DOCS, docs('Arduino', 'MATLAB'), true)).toBe(`${DOCS}Arduino\\`)
    expect(tabCompletion(`${DOCS}Photos-202`, docs('Photos-2023', 'Photos-2024'), true)).toBe(`${DOCS}Photos-2023\\`)
  })

  it('has nothing to do without completions', () => {
    expect(tabCompletion(`${DOCS}zzz`, [], true)).toBeNull()
  })
})
