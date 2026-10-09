// CSV / TSV, line by line — pure, so it's unit-tested (csv.test.ts). The table view
// (csvPreview.ts) draws each line as a row of cells; this says where the cells are
// and how wide each column must be.
//
// RFC 4180-ish and lenient: a field is quoted only if it starts with `"`; `""` inside
// is one quote; text after the closing quote still belongs to the field. A quoted field
// may run over several lines — such a record isn't drawn as a row (shown as raw text).

import type { Text } from '@codemirror/state'

export type Delimiter = ',' | '\t'

/** A field of a line: [from, to) relative to the line's start, quotes included, the delimiter not. */
export interface Field {
  from: number
  to: number
  quoted: boolean
}

export interface ParsedLine {
  fields: Field[]
  /** The line ends inside a quoted field: the record goes on in the next line. */
  open: boolean
}

const QUOTE = 34 // "

const BOM = 0xfeff

/**
 * Splits one line into fields. `inQuote`: the line goes on with a quoted field from the line
 * before (its first field has no opening quote then). A BOM at the start isn't part of a field.
 */
export function parseLine(text: string, delim: Delimiter, inQuote = false): ParsedLine {
  const d = delim.charCodeAt(0)
  const n = text.length
  const fields: Field[] = []
  let from = !inQuote && text.charCodeAt(0) === BOM ? 1 : 0
  let quoted = inQuote
  let inQ = inQuote
  let i = from
  if (!inQ && text.charCodeAt(i) === QUOTE) {
    quoted = inQ = true
    i++
  }
  while (i < n) {
    const c = text.charCodeAt(i)
    if (inQ) {
      if (c === QUOTE) {
        if (text.charCodeAt(i + 1) === QUOTE) i += 2
        else {
          inQ = false
          i++
        }
      } else i++
    } else if (c === d) {
      fields.push({ from, to: i, quoted })
      from = ++i
      quoted = inQ = text.charCodeAt(i) === QUOTE
      if (inQ) i++
    } else i++
  }
  fields.push({ from, to: n, quoted })
  return { fields, open: inQ }
}

/**
 * Where the quote marks of a quoted field are (relative to the line): the opening one, the
 * first of each `""`, the closing one — what's hidden when the row is shown as a table.
 */
export function quoteMarks(text: string, field: Field, continued = false): number[] {
  if (!field.quoted) return []
  const marks: number[] = []
  let i = field.from
  if (!continued) marks.push(i++)
  while (i < field.to) {
    if (text.charCodeAt(i) === QUOTE) {
      marks.push(i)
      if (text.charCodeAt(i + 1) === QUOTE) i += 2
      else return marks // the closing one; what follows is plain text
    } else i++
  }
  return marks
}

/** A column is never drawn wider than this (in `ch`): longer cells wrap inside. */
export const MAX_WIDTH = 40

/** How many `ch` a character takes in a monospace font: East Asian wide / fullwidth ones 2. */
export function charWidth(code: number): number {
  if (code < 0x1100) return 1
  if (code === BOM) return 0 // it takes no room
  if (
    code <= 0x115f || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK … Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) || // emoji
    (code >= 0x20000 && code <= 0x3fffd) // CJK extension B…
  ) {
    return 2
  }
  return 1
}

/** The width of text[from, to) in `ch` (stops counting at `cap`). */
export function textWidth(text: string, from = 0, to = text.length, cap = Infinity): number {
  let w = 0
  for (let i = from; i < to && w < cap; i++) {
    const code = text.codePointAt(i)!
    if (code > 0xffff) i++
    w += charWidth(code)
  }
  return w
}

/** What the table view needs to know of the whole file. */
export interface CsvModel {
  /**
   * Each column's width in `ch`: the delimiter before it (1, none for the first column) + its widest field
   * (quotes included), at most MAX_WIDTH.
   */
  widths: number[]
  /** The records over several lines, [from, to] in the document (whole lines): shown as raw text. */
  multi: { from: number; to: number }[]
}

/** How wide column `i`'s cell for `field` is: its delimiter (not the first column's) + its text. */
export const fieldWidth = (text: string, field: Field, i: number): number =>
  Math.min(textWidth(text, field.from, field.to, MAX_WIDTH) + (i > 0 ? 1 : 0), MAX_WIDTH)

/** Widens `widths` to fit the fields of one line. */
export function fitLine(widths: number[], text: string, fields: Field[]): void {
  fields.forEach((f, i) => {
    const w = fieldWidth(text, f, i)
    if (!(widths[i] >= w)) widths[i] = w
  })
}

/** Reads the whole document. */
export function scanDoc(doc: Text, delim: Delimiter): CsvModel {
  const widths: number[] = []
  const multi: CsvModel['multi'] = []
  let pos = 0
  let recordFrom = -1 // ≥ 0 while inside a record over several lines
  for (const iter = doc.iterLines(); !iter.next().done;) {
    const text = iter.value
    const inQuote = recordFrom >= 0
    const { fields, open } = parseLine(text, delim, inQuote)
    if (!inQuote && !open) fitLine(widths, text, fields)
    else if (!inQuote) recordFrom = pos
    else if (!open) {
      multi.push({ from: recordFrom, to: pos + text.length })
      recordFrom = -1
    }
    pos += text.length + 1
  }
  if (recordFrom >= 0) multi.push({ from: recordFrom, to: doc.length }) // a quote never closed
  return { widths, multi }
}
