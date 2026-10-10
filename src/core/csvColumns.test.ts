// Inserting / deleting columns, from an EditorState alone. "‸" = the cursor, «…» = a selection
// (several allowed); the result shows the cursor as "‸" when the insert sets one.

import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { deleteColumns, insertColumn, recordsOf, selectedColumns } from './csvColumns'

function setup(text: string): EditorState {
  const ranges: SelectionRange[] = []
  let doc = ''
  let start = -1
  for (const ch of text) {
    if (ch === '‸') ranges.push(EditorSelection.cursor(doc.length))
    else if (ch === '«') start = doc.length
    else if (ch === '»') ranges.push(EditorSelection.range(start, doc.length))
    else doc += ch
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.length ? ranges : [EditorSelection.cursor(0)]),
    extensions: EditorState.allowMultipleSelections.of(true)
  })
}

function insert(text: string, side: 'left' | 'right', delim: ',' | '\t' = ','): string {
  const state = setup(text)
  const next = state.update(insertColumn(state, delim, side)).state
  const head = next.selection.main.head
  const doc = next.doc.toString()
  return doc.slice(0, head) + '‸' + doc.slice(head)
}

function remove(text: string, delim: ',' | '\t' = ','): string {
  const state = setup(text)
  return state.update(deleteColumns(state, delim)).state.doc.toString()
}

/** The document after a delete, with the cursor as "‸". */
function removeAt(text: string): string {
  const state = setup(text)
  const next = state.update(deleteColumns(state, ',')).state
  const doc = next.doc.toString()
  return doc.slice(0, next.selection.main.head) + '‸' + doc.slice(next.selection.main.head)
}

const columns = (text: string): number[] => {
  const state = setup(text)
  return selectedColumns(state, recordsOf(state.doc, ','))
}

describe('recordsOf', () => {
  it('splits records into fields; a quoted line break keeps the record going', () => {
    const doc = setup('a,"x\ny",b\nc').doc
    expect(recordsOf(doc, ',')).toEqual([
      {
        from: 0,
        fields: [
          { from: 0, to: 1 },
          { from: 2, to: 7 },
          { from: 8, to: 9 }
        ]
      },
      { from: 10, fields: [{ from: 10, to: 11 }] }
    ])
  })
})

describe('selectedColumns', () => {
  it('the cursor: the cell it is in (right after a delimiter = the next cell)', () => {
    expect(columns('a‸,b,c')).toEqual([0])
    expect(columns('a,‸b,c')).toEqual([1])
    expect(columns('a,b,c‸')).toEqual([2])
    expect(columns('‸a,b')).toEqual([0])
  })

  it('a selection: every column it touches, also over several rows and ranges', () => {
    expect(columns('a«,b,c»,d')).toEqual([1, 2])
    expect(columns('«a,»b,c')).toEqual([0]) // ends right after a delimiter
    expect(columns('a«,»b,c')).toEqual([1]) // only the delimiter: it leads cell 1
    expect(columns('a,«b,c\nd»,e,f')).toEqual([0, 1])
    expect(columns('a,b,«c\nd»,e,f')).toEqual([0, 1, 2])
    expect(columns('«a»,b,c,d\nx,y,z,«w»')).toEqual([0, 3])
  })

  it('a row shorter than the others, an empty line', () => {
    expect(columns('a,b,c\n‸')).toEqual([0])
    expect(columns('a,b,c\nx‸')).toEqual([0])
  })
})

describe('insertColumn', () => {
  it('left / right of the cursor’s column, in every row; the cursor in the new cell', () => {
    expect(insert('a,‸b,c\n1,2,3', 'left')).toBe('a,‸,b,c\n1,,2,3')
    expect(insert('a,‸b,c\n1,2,3', 'right')).toBe('a,b,‸,c\n1,2,,3')
    expect(insert('‸a,b\n1,2', 'left')).toBe('‸,a,b\n,1,2')
    expect(insert('a,b‸\n1,2', 'right')).toBe('a,b,‸\n1,2,')
  })

  it('pads short rows up to the new column; empty lines stay empty', () => {
    expect(insert('a,b,c‸\n1\n\nx,y', 'right')).toBe('a,b,c,‸\n1,,,\n\nx,y,,')
    expect(insert('a,b,‸c\n1', 'left')).toBe('a,b,‸,c\n1,,')
  })

  it('a selection: left of its leftmost column, right of its rightmost', () => {
    expect(insert('a,«b,c»,d', 'left')).toBe('a,‸,b,c,d')
    expect(insert('a,«b,c»,d', 'right')).toBe('a,b,c,‸,d')
  })

  it('quoted fields, a record over several lines, a BOM, TSV', () => {
    expect(insert('"a,b",‸c', 'left')).toBe('"a,b",‸,c')
    expect(insert('x,y\n"1\n2",3‸', 'left')).toBe('x,,y\n"1\n2",‸,3')
    expect(insert('\ufeff‸a,b\n1,2', 'left')).toBe('\ufeff‸,a,b\n,1,2')
    expect(insert('a\t‸b\n1\t2', 'left', '\t')).toBe('a\t‸\tb\n1\t\t2')
  })
})

describe('deleteColumns', () => {
  it('the cursor’s column from every row (rows without it stay as they are)', () => {
    expect(remove('a,‸b,c\n1,2,3\nx')).toBe('a,c\n1,3\nx')
    expect(remove('‸a,b,c\n1,2,3')).toBe('b,c\n2,3')
    expect(remove('a,b,c‸\n1,2,3\n\n4')).toBe('a,b\n1,2\n\n4')
  })

  it('every column a selection touches; runs of columns and gaps', () => {
    expect(remove('a,«b,c»,d\n1,2,3,4')).toBe('a,d\n1,4')
    expect(remove('«a»,b,c,«d»\n1,2,3,4')).toBe('b,c\n2,3')
    expect(remove('«a,b»,c\n1,2,3\n9')).toBe('c\n3\n')
  })

  it('the cursor: in the cell that took the deleted one’s place, else at the row’s end', () => {
    expect(removeAt('a,b‸b,c\n1,2,3')).toBe('a,‸c\n1,3')
    expect(removeAt('a,«b,c»,d')).toBe('a,‸d')
    expect(removeAt('a‸a,b')).toBe('‸b')
    expect(removeAt('a,b,c‸')).toBe('a,b‸')
    expect(removeAt('a,b,c\nx‸')).toBe('b,c\n‸')
  })

  it('all columns: empty lines', () => {
    expect(remove('«a,b»\n1,2')).toBe('\n')
    expect(remove('‸a\nb')).toBe('\n')
  })

  it('empty cells, quoted fields, a record over several lines, a BOM, TSV', () => {
    expect(remove(',‸,c\n1,,3')).toBe(',c\n1,3')
    expect(remove('‸,b\n,2')).toBe('b\n2')
    expect(remove('a,"x,y"‸,c')).toBe('a,c')
    expect(remove('a,‸b\n1,"2\n3"')).toBe('a\n1')
    expect(remove('\ufeff‸a,b')).toBe('\ufeffb')
    expect(remove('a\t‸b\tc', '\t')).toBe('a\tc')
  })
})
