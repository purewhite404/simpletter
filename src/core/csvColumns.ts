// Inserting / deleting a column of a CSV / TSV file — pure (csvColumns.test.ts); csvPreview.ts
// turns these into the editor's commands (the right-click menu).
//
// A column is the n-th field of every record (a record over several lines included). Which
// column(s): those of the cursor / touched by the selection; a cell = the delimiter before its
// field + the field, so a cursor right after a delimiter is in the next column. Rows without the
// column: an insert pads them with delimiters up to it, a delete leaves them alone. Empty lines are
// never touched.

import type { ChangeSpec, EditorState, Text, TransactionSpec } from '@codemirror/state'
import { parseLine, type Delimiter } from './csv'

/** A field in the document: [from, to), quotes included, the delimiter before it not. */
interface Span {
  from: number
  to: number
}

/** A record: one line, or several (a quoted field with line breaks). */
interface CsvRecord {
  /** The start of its first line. */
  from: number
  fields: Span[]
}

/** Every record of the document, in order. */
export function recordsOf(doc: Text, delim: Delimiter): CsvRecord[] {
  const records: CsvRecord[] = []
  let current: CsvRecord | null = null // a record going on in the next line
  let pos = 0
  for (const iter = doc.iterLines(); !iter.next().done;) {
    const text = iter.value
    const { fields, open } = parseLine(text, delim, current !== null)
    const spans = fields.map((f) => ({ from: pos + f.from, to: pos + f.to }))
    if (current) {
      current.fields[current.fields.length - 1].to = spans[0].to // the quoted field goes on
      current.fields.push(...spans.slice(1))
    } else current = { from: pos, fields: spans }
    if (!open) {
      records.push(current)
      current = null
    }
    pos += text.length + 1
  }
  if (current) records.push(current) // a quote never closed
  return records
}

/** An empty line (or one with a BOM only): no cells. */
const isEmpty = (r: CsvRecord): boolean => r.fields.length === 1 && r.fields[0].from === r.fields[0].to

/** The record `pos` is in. */
function recordAt(records: CsvRecord[], pos: number): CsvRecord {
  let lo = 0
  let hi = records.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (records[mid].from <= pos) lo = mid
    else hi = mid - 1
  }
  return records[lo]
}

/** The column of the cell `pos` is in. */
function columnAt(record: CsvRecord, pos: number): number {
  let i = record.fields.length - 1
  while (i > 0 && record.fields[i].from > pos) i--
  return i
}

/** The columns of the cursor and those the selection touches, sorted. */
export function selectedColumns(state: EditorState, records: CsvRecord[]): number[] {
  const columns = new Set<number>()
  for (const { from, to } of state.selection.ranges) {
    const start = recordAt(records, from)
    const end = recordAt(records, to)
    let first = columnAt(start, from)
    let last = columnAt(end, to)
    if (to > from) {
      // Starting at a field's end / ending right after a delimiter: nothing of that cell's text is selected
      // (a delimiter alone: the cell it leads).
      if (first < start.fields.length - 1 && start.fields[first].to === from) first++
      if (last > 0 && end.fields[last].from === to && (start !== end || last > first)) last--
    }
    for (let c = Math.min(first, last); c <= Math.max(first, last); c++) columns.add(c)
  }
  return [...columns].sort((a, b) => a - b)
}

/**
 * A new empty column left of the leftmost selected one, or right of the rightmost. The cursor goes into the
 * new cell of its row.
 */
export function insertColumn(state: EditorState, delim: Delimiter, side: 'left' | 'right'): TransactionSpec {
  const records = recordsOf(state.doc, delim)
  const columns = selectedColumns(state, records)
  const k = side === 'left' ? columns[0] : columns[columns.length - 1] + 1
  const changes: ChangeSpec[] = []
  for (const r of records) {
    if (isEmpty(r)) continue
    const n = r.fields.length
    changes.push(
      k < n ? { from: r.fields[k].from, insert: delim } : { from: r.fields[n - 1].to, insert: delim.repeat(k - n + 1) }
    )
  }
  const changeSet = state.changes(changes)
  const head = state.selection.main.head
  const row = recordAt(records, head)
  if (isEmpty(row)) return { changes: changeSet }
  const n = row.fields.length
  const cursor = k < n ? changeSet.mapPos(row.fields[k].from, -1) : changeSet.mapPos(row.fields[n - 1].to, 1)
  return { changes: changeSet, selection: { anchor: cursor } }
}

/**
 * Deletes the selected columns from every row that has them. The cursor goes to the cell that takes the first
 * deleted one's place in its row (none: the row's end).
 */
export function deleteColumns(state: EditorState, delim: Delimiter): TransactionSpec {
  const records = recordsOf(state.doc, delim)
  const columns = selectedColumns(state, records)
  const changes: ChangeSpec[] = []
  for (const r of records) {
    if (isEmpty(r)) continue
    const f = r.fields
    const n = f.length
    for (let i = 0; i < columns.length && columns[i] < n;) {
      // A run of adjacent columns a..b goes in one piece, with one delimiter.
      const a = columns[i]
      let b = a
      while (++i < columns.length && columns[i] === b + 1 && columns[i] < n) b++
      if (a > 0)
        changes.push({ from: f[a].from - 1, to: f[b].to }) // with the delimiter before it
      else if (b < n - 1)
        changes.push({ from: f[0].from, to: f[b + 1].from }) // with the one after it
      else changes.push({ from: f[0].from, to: f[n - 1].to }) // every column: an empty line
    }
  }
  const changeSet = state.changes(changes)
  const row = recordAt(records, state.selection.main.head)
  if (isEmpty(row)) return { changes: changeSet }
  const deleted = new Set(columns)
  const next = row.fields.findIndex((_, i) => i >= columns[0] && !deleted.has(i))
  const cursor =
    next >= 0 ? changeSet.mapPos(row.fields[next].from, 1) : changeSet.mapPos(row.fields[row.fields.length - 1].to, -1)
  return { changes: changeSet, selection: { anchor: cursor } }
}
