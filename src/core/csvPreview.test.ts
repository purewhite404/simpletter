// The table view's decorations, from an EditorState alone (no DOM): which text each
// cell shows and how wide it is, which lines are rows / raw text.

import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { csvDecorations, csvModelOf, csvPreview, insertDelimiter, rescanEffect } from './csvPreview'

/** `doc` with the cursor where "‸" is (no "‸": the editor is unfocused). */
function setup(text: string, delim: ',' | '\t' = ',') {
  const cursor = text.indexOf('‸')
  const doc = text.replace('‸', '')
  let state = EditorState.create({ doc, extensions: csvPreview(delim) })
  if (cursor >= 0) state = state.update({ selection: EditorSelection.cursor(cursor) }).state
  return { state, focused: cursor >= 0 }
}

/**
 * Each line as shown: its cells as "text·width", " | " between them; the text without what's hidden,
 * widgets as their text (a shown tab: "→"), an empty first cell (a spacer widget) as "·width". A raw line (a record over several lines): "raw: " + its text. "*" = the cursor's row.
 */
function shown(text: string, delim: ',' | '\t' = ','): string[] {
  const { state, focused } = setup(text, delim)
  const doc = state.doc
  const decos = csvDecorations(state, [{ from: 0, to: doc.length }], focused)
  const hidden: { from: number; to: number; text: string }[] = []
  const cells: { from: number; to: number; width: string }[] = []
  const lineCls = new Map<number, string>()
  decos.between(0, doc.length, (from, to, deco) => {
    const spec = deco.spec as {
      class?: string
      attributes?: { style: string }
      widget?: { text?: string; width?: number }
    }
    if (from === to && spec.class) lineCls.set(doc.lineAt(from).number, spec.class)
    else if (spec.widget?.width !== undefined) cells.push({ from, to, width: String(spec.widget.width) })
    else if (spec.class === 'cm-csv-cell') cells.push({ from, to, width: /(\d+)ch/.exec(spec.attributes!.style)![1] })
    else if (spec.widget) hidden.push({ from, to, text: spec.widget.text! })
    else if (!spec.class) hidden.push({ from, to, text: '' })
  })
  const show = (from: number, to: number) => {
    let out = ''
    for (let pos = from; pos < to; pos++) {
      const h = hidden.find((r) => r.from === pos)
      if (h) {
        out += h.text
        pos = h.to - 1
      } else out += doc.sliceString(pos, pos + 1)
    }
    return out
  }
  const lines: string[] = []
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const cls = lineCls.get(n) ?? ''
    if (cls === 'cm-csv-raw') {
      lines.push(`raw: ${line.text}`)
      continue
    }
    const row = cells
      .filter((c) => c.from >= line.from && c.to <= line.to)
      .sort((a, b) => a.from - b.from || a.to - b.to) // between() goes layer by layer, not strictly in order
      .map((c) => `${show(c.from, c.to)}·${c.width}`)
    lines.push((cls.includes('cm-csv-active') ? '* ' : '') + row.join(' | '))
  }
  return lines
}

describe('csvDecorations', () => {
  it('unfocused: every line a row, quotes and delimiters hidden, columns as wide as their widest field', () => {
    expect(shown('name,qty\n"りんご, 赤",3\n"say ""hi""",')).toEqual([
      'name·12 | qty·4',
      'りんご, 赤·12 | 3·4',
      'say "hi"·12 | ·4'
    ])
  })

  it("on the cursor's line the quotes and delimiters show; the widths stay", () => {
    expect(shown('name,qty\n"りんご, 赤",3‸\nx,y')).toEqual([
      'name·12 | qty·4',
      '* "りんご, 赤"·12 | ,3·4',
      'x·12 | y·4'
    ])
  })

  it('a cell starts with the delimiter before it: an empty one in the middle or at the end is there too', () => {
    expect(shown('a,,c\n\nd,ee,f\ng,')).toEqual(['a·1 | ·3 | c·2', '', 'd·1 | ee·3 | f·2', 'g·1 | ·3'])
  })

  it('an empty first cell (the line starts with a delimiter) is as wide as its column: the others line up', () => {
    expect(shown('name,qty\n,3\n,')).toEqual(['name·4 | qty·4', '·4 | 3·4', '·4 | ·4'])
    expect(shown('name,qty\n,3‸')).toEqual(['name·4 | qty·4', '* ·4 | ,3·4'])
    expect(shown(',x\n,y')).toEqual(['·0 | x·2', '·0 | y·2']) // the whole column empty
    expect(shown('\ufeff,x')).toEqual(['·0 | x·2']) // after a BOM
    expect(shown('a\n\nb')).toEqual(['a·1', '', 'b·1']) // an empty line: no cell
  })

  it('TSV: a tab is hidden, "→" on the cursor line; commas are plain text', () => {
    expect(shown('a,b\tc\nd\te‸', '\t')).toEqual(['a,b·3 | c·2', '* d·3 | →e·2'])
  })

  it('a record over several lines is raw text; the lines around it are rows', () => {
    expect(shown('a,b\n"x\ny",z\nc,d')).toEqual(['a·1 | b·2', 'raw: "x', 'raw: y",z', 'c·1 | d·2'])
  })
})

describe('the model while editing', () => {
  it('an edited line widens its column at once; narrower again after the rescan', () => {
    let { state } = setup('a,b\nc,d')
    state = state.update({ changes: { from: 0, to: 1, insert: 'longer' } }).state
    expect(csvModelOf(state).widths).toEqual([6, 2])
    state = state.update({ changes: { from: 0, to: 6, insert: 'x' } }).state
    expect(csvModelOf(state).widths).toEqual([6, 2]) // still: only a full read narrows it
    state = state.update({ effects: rescanEffect() }).state
    expect(csvModelOf(state).widths).toEqual([1, 2])
  })

  it('a record over several lines moves with an edit above it; a new one is found by the rescan', () => {
    let { state } = setup('a\n"x\ny"\nb')
    state = state.update({ changes: { from: 0, insert: 'top\n' } }).state
    const [r] = csvModelOf(state).multi
    expect(state.doc.sliceString(r.from, r.to)).toBe('"x\ny"')
    state = state.update({ changes: { from: state.doc.length, insert: '\n"open' } }).state
    expect(csvModelOf(state).multi).toHaveLength(1)
    state = state.update({ effects: rescanEffect() }).state
    expect(csvModelOf(state).multi).toHaveLength(2)
  })
})

it("Tab: the file's delimiter (a tab in TSV, a comma in CSV), also over a selection", () => {
  for (const [delim, out] of [
    ['\t', 'a\t'],
    [',', 'a,']
  ] as const) {
    let state = EditorState.create({ doc: 'ab', selection: EditorSelection.range(1, 2), extensions: csvPreview(delim) })
    insertDelimiter({ state, dispatch: (tr) => (state = tr.state) })
    expect(state.doc.toString()).toBe(out)
    expect(state.selection.main.head).toBe(2)
  }
})
