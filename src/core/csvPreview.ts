// CSV / TSV files shown as a table, line by line: each line is a row, each field a
// cell as wide as its column (inline-blocks of fixed width in `ch`, the font being
// monospace). The text stays the editor's own text — clicking, selecting, the IME
// and undo work as anywhere — and the file is saved as it is.
//
// A cell = the delimiter before its field (none in the first column) + the field: text
// typed right after a delimiter is in that cell. Delimiters and quotes are widgets, not
// text: off the cursor's lines a delimiter is an empty 1 ch and the quotes are gone; on
// the cursor's lines both show, dimmed — the columns don't move. (As widgets, the browser
// never types into them: text typed next to a "," would otherwise land in the ","'s span —
// for an IME composition, inside the narrow cell before, wrapping a character a line.)
// A record over several lines (a quoted field with a line break) is left as raw text.
//
// Files may have tens of thousands of lines: the column widths are read from the
// whole file once (StateField), widened as lines are edited and read again a moment
// after typing stops; decorations are only made for the lines in view (ViewPlugin).

import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type StateCommand
} from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { fieldWidth, fitLine, parseLine, quoteMarks, scanDoc, type CsvModel, type Delimiter } from './csv'

const delimiter = Facet.define<Delimiter, Delimiter>({ combine: (values) => values[0] ?? ',' })

/** Read the whole file again (widths may shrink, records over several lines change). */
const rescan = StateEffect.define<null>()

/** How long after the last edit the whole file is read again. */
const RESCAN_DELAY = 300

const modelField = StateField.define<CsvModel>({
  create: (state) => scanDoc(state.doc, state.facet(delimiter)),
  update(model, tr) {
    const delim = tr.state.facet(delimiter)
    if (tr.effects.some((e) => e.is(rescan))) return scanDoc(tr.state.doc, delim)
    if (!tr.docChanged) return model
    // Until the next full read: the records over several lines move with the text, edited lines widen columns.
    const multi = model.multi
      .map((r) => ({ from: tr.changes.mapPos(r.from, -1), to: tr.changes.mapPos(r.to, 1) }))
      .filter((r) => r.from <= r.to)
    const widths = [...model.widths]
    const doc = tr.state.doc
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      for (let pos = fromB; pos <= toB;) {
        const line = doc.lineAt(pos)
        if (!inMulti(multi, line.from, line.to)) {
          const { fields, open } = parseLine(line.text, delim)
          if (!open) fitLine(widths, line.text, fields)
        }
        pos = line.to + 1
      }
    })
    return { widths, multi }
  }
})

/** [from, to] overlaps a record over several lines (`multi` is sorted). */
function inMulti(multi: CsvModel['multi'], from: number, to: number): boolean {
  let lo = 0
  let hi = multi.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (multi[mid].to < from) lo = mid + 1
    else hi = mid
  }
  return lo < multi.length && multi[lo].from <= to
}

/**
 * A delimiter or quote, as a widget: `text` = what shows ("" = nothing). A delimiter always takes its 1 ch
 * (a tab character's own width would vary); a hidden quote isn't drawn at all (the `hide` replacement).
 */
class MarkWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly sep: boolean
  ) {
    super()
  }
  eq(other: MarkWidget): boolean {
    return other.text === this.text && other.sep === this.sep
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    if (this.sep) span.className = 'cm-csv-sep'
    if (this.text) span.classList.add('cm-csv-mark')
    span.textContent = this.text
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

const hide = Decoration.replace({})
const widget = (text: string, sep: boolean) => Decoration.replace({ widget: new MarkWidget(text, sep) })
/** [hidden, shown] */
const SEP: Record<Delimiter, Decoration[]> = {
  ',': [widget('', true), widget(',', true)],
  '\t': [widget('', true), widget('→', true)]
}
const shownQuote = widget('"', false)
const row = Decoration.line({ class: 'cm-csv-row' })
const activeRow = Decoration.line({ class: 'cm-csv-row cm-csv-active' })
const rawLine = Decoration.line({ class: 'cm-csv-raw' })
const cells = new Map<number, Decoration>()
/**
 * A cell `width` ch wide. Text typed at its end is in it (not in the next one, which starts with its delimiter):
 * that's where the marks go while they're only mapped (during an IME composition).
 */
function cell(width: number): Decoration {
  let deco = cells.get(width)
  if (!deco) {
    deco = Decoration.mark({
      class: 'cm-csv-cell',
      // + 1px: a cell its text fills exactly would otherwise, rounded, wrap its last character.
      attributes: { style: `width: calc(${width}ch + 1px)` },
      inclusiveStart: true, // else CodeMirror draws the delimiter widget at its start outside of it
      inclusiveEnd: true
    })
    cells.set(width, deco)
  }
  return deco
}

/** The table view's decorations for the lines in `ranges` (exported for tests). */
export function csvDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  focused: boolean
): DecorationSet {
  const doc = state.doc
  const delim = state.facet(delimiter)
  const model = state.field(modelField)
  const selection = focused ? state.selection.ranges : []
  const out: Range<Decoration>[] = []
  for (const range of ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = doc.lineAt(pos)
      pos = line.to + 1
      const { fields, open } = parseLine(line.text, delim)
      if (open || inMulti(model.multi, line.from, line.to)) {
        out.push(rawLine.range(line.from))
        continue
      }
      const active = selection.some((r) => r.from <= line.to && r.to >= line.from)
      out.push((active ? activeRow : row).range(line.from))
      fields.forEach((f, i) => {
        const from = line.from + f.from - (i > 0 ? 1 : 0) // with the delimiter before it
        const to = line.from + f.to
        const width = model.widths[i] ?? fieldWidth(line.text, f, i)
        if (to > from) out.push(cell(width).range(from, to))
        if (i > 0) out.push(SEP[delim][Number(active)].range(from, from + 1))
        for (const q of quoteMarks(line.text, f)) {
          out.push((active ? shownQuote : hide).range(line.from + q, line.from + q + 1))
        }
      })
    }
  }
  return Decoration.set(out, true)
}

const tableView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    timer: ReturnType<typeof setTimeout> | null = null
    /** Only mapped during a composition: to be rebuilt. */
    stale = false
    constructor(readonly view: EditorView) {
      this.decorations = csvDecorations(view.state, view.visibleRanges, view.hasFocus)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged) this.scheduleRescan()
      if (u.view.composing) {
        // IME: the text being converted is in the document already. Rebuilt, the cells around it would
        // change (a new cell, text at a cell's start moved into it) and the browser's composition breaks —
        // the IME falls back to a window of its own. So only move them along; redrawn once it's done.
        this.decorations = this.decorations.map(u.changes)
        this.stale = true
        return
      }
      const modelChanged = u.startState.field(modelField) !== u.state.field(modelField)
      if (this.stale || u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || modelChanged) {
        this.stale = false
        this.decorations = csvDecorations(u.state, u.view.visibleRanges, u.view.hasFocus)
      }
    }
    /** A composition ended: redraw (CodeMirror may not send an update of its own). */
    compositionEnded(): void {
      setTimeout(() => {
        if (this.stale && !this.view.composing) this.view.dispatch({ effects: rescan.of(null) })
      })
    }
    scheduleRescan(): void {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        this.view.dispatch({ effects: rescan.of(null) })
      }, RESCAN_DELAY)
    }
    destroy(): void {
      if (this.timer) clearTimeout(this.timer)
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      compositionend() {
        this.compositionEnded()
      }
    }
  }
)

/** Tab: the file's delimiter (a tab in TSV, a comma in CSV) — a new cell; no indenting. Also over a selection. */
export const insertDelimiter: StateCommand = ({ state, dispatch }) => {
  dispatch(state.update(state.replaceSelection(state.facet(delimiter)), { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** The table view for a CSV (`,`) or TSV (tab) file. */
export function csvPreview(delim: Delimiter): Extension {
  return [delimiter.of(delim), modelField, tableView]
}

/** The column widths and records over several lines the view works with (for tests). */
export const csvModelOf = (state: EditorState): CsvModel => state.field(modelField)
/** The effect that makes the view read the whole file again (for tests). */
export const rescanEffect = () => rescan.of(null)
