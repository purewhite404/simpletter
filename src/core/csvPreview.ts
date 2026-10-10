// CSV / TSV files shown as a table, line by line: each line is a row, each field a
// cell as wide as its column (inline-blocks of fixed width in `ch`, the font being
// monospace). The text stays the editor's own text — clicking, selecting, the IME
// and undo work as anywhere — and the file is saved as it is.
//
// A cell = the delimiter before its field (none in the first column) + the field (an empty
// first field: a spacer widget as wide as the column): text
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
// While the search panel is open, the cursor's lines show their marks as if focused.
//
// Right-click: our own menu instead of the WebView's — cut / copy / paste, insert a column left /
// right, delete the selected columns (csvColumns.ts).

import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
  type StateCommand,
  type TransactionSpec
} from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { searchPanelOpen } from '@codemirror/search'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { fieldWidth, fitLine, parseLine, quoteMarks, scanDoc, type CsvModel, type Delimiter } from './csv'
import { deleteColumns, insertColumn } from './csvColumns'
import { openMenu } from './menu'

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

/**
 * An empty first cell (the line starts with a delimiter): a mark can't cover nothing, so a spacer as wide as the
 * column stands in for it — else the row's other cells would start that much further left.
 */
class EmptyCell extends WidgetType {
  constructor(readonly width: number) {
    super()
  }
  eq(other: EmptyCell): boolean {
    return other.width === this.width
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-csv-cell cm-csv-empty'
    span.style.width = cellWidth(this.width)
    return span
  }
  // The editor must see the mousedown: the plugin's handler puts the cursor at the line's start.
  ignoreEvent(): boolean {
    return false
  }
}

// + 1px: a cell its text fills exactly would otherwise, rounded, wrap its last character.
const cellWidth = (width: number): string => `calc(${width}ch + 1px)`

const emptyCells = new Map<number, Decoration>()
/** side -1: drawn before the next cell's mark (an inclusive-start mark takes a widget with side > 0 in). */
function emptyCell(width: number): Decoration {
  let deco = emptyCells.get(width)
  if (!deco) {
    deco = Decoration.widget({ widget: new EmptyCell(width), side: -1 })
    emptyCells.set(width, deco)
  }
  return deco
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
      attributes: { style: `width: ${cellWidth(width)}` },
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
        else if (fields.length > 1) out.push(emptyCell(width).range(from)) // an empty first cell
        if (i > 0) out.push(SEP[delim][Number(active)].range(from, from + 1))
        for (const q of quoteMarks(line.text, f)) {
          out.push((active ? shownQuote : hide).range(line.from + q, line.from + q + 1))
        }
      })
    }
  }
  return Decoration.set(out, true)
}

/** Whether the cursor's marks show: the editor has the focus, or the search panel is open. */
const focused = (view: EditorView): boolean => view.hasFocus || searchPanelOpen(view.state)

const tableView = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    timer: ReturnType<typeof setTimeout> | null = null
    /** Only mapped during a composition: to be rebuilt. */
    stale = false
    constructor(readonly view: EditorView) {
      this.decorations = csvDecorations(view.state, view.visibleRanges, focused(view))
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
      const panelChanged = searchPanelOpen(u.state) !== searchPanelOpen(u.startState)
      if (
        this.stale ||
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.focusChanged ||
        modelChanged ||
        panelChanged
      ) {
        this.stale = false
        this.decorations = csvDecorations(u.state, u.view.visibleRanges, focused(u.view))
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
      },
      // A click into an empty first cell: the cursor before the delimiter (CodeMirror itself would pick the
      // nearest text — after it, in the 2nd cell).
      mousedown(event, view) {
        const target = event.target as HTMLElement
        if (!target.classList?.contains('cm-csv-empty') || event.button !== 0) return false
        const pos = view.posAtDOM(target)
        event.preventDefault()
        // Focus first: gaining focus may take the browser's selection — then put the cursor where clicked.
        view.focus()
        const anchor = event.shiftKey ? view.state.selection.main.anchor : pos
        view.dispatch({ selection: { anchor, head: pos } })
        return true
      },
      contextmenu(event, view) {
        event.preventDefault()
        let { clientX: x, clientY: y } = event
        if (event.button === 2) {
          // The mouse: a click outside the selection moves the cursor there (as a left click would).
          const target = event.target as HTMLElement
          const pos = target.classList?.contains('cm-csv-empty') ? view.posAtDOM(target) : view.posAtCoords({ x, y })
          view.focus()
          if (pos !== null && !view.state.selection.ranges.some((r) => !r.empty && r.from <= pos && pos <= r.to)) {
            view.dispatch({ selection: { anchor: pos } })
          }
        } else {
          // The keyboard (menu key, Shift+F10): at the cursor.
          const at = view.coordsAtPos(view.state.selection.main.head)
          if (at) ({ left: x, bottom: y } = at)
        }
        openMenu(x, y, editMenu(view))
        return true
      }
    }
  }
)

/** The selected text (several ranges: one per line), '' = nothing selected. */
const selectedText = (state: EditorState): string =>
  state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => state.sliceDoc(r.from, r.to))
    .join(state.lineBreak)

function editMenu(view: EditorView) {
  const run = (command: StateCommand) => () => command(view)
  const nothing = !selectedText(view.state)
  return [
    { label: '切り取り', action: () => cut(view), disabled: nothing },
    { label: 'コピー', action: () => navigator.clipboard.writeText(selectedText(view.state)), disabled: nothing },
    { label: '貼り付け', action: () => paste(view) },
    null,
    { label: '左に列を挿入', action: run(insertColumnLeft) },
    { label: '右に列を挿入', action: run(insertColumnRight) },
    { label: '列を削除', action: run(deleteColumn) }
  ]
}

async function cut(view: EditorView): Promise<void> {
  await navigator.clipboard.writeText(selectedText(view.state))
  view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true })
}

async function paste(view: EditorView): Promise<void> {
  const text = await navigator.clipboard.readText()
  view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true })
}

/**
 * A column edit: an undo step of its own (typing right after it isn't joined to it); the columns' widths are read
 * again at once (a deleted one may have been the widest).
 */
function columnCommand(
  make: (state: EditorState, delim: Delimiter) => TransactionSpec,
  userEvent: string
): StateCommand {
  return ({ state, dispatch }) => {
    const spec = make(state, state.facet(delimiter))
    dispatch(
      state.update(spec, {
        effects: rescan.of(null),
        annotations: isolateHistory.of('full'),
        userEvent,
        scrollIntoView: true
      })
    )
    return true
  }
}

/** A new empty column left of the cursor's (the selection's leftmost); the cursor goes into it. */
export const insertColumnLeft = columnCommand((state, delim) => insertColumn(state, delim, 'left'), 'input')
/** A new empty column right of the cursor's (the selection's rightmost); the cursor goes into it. */
export const insertColumnRight = columnCommand((state, delim) => insertColumn(state, delim, 'right'), 'input')
/** Deletes the cursor's column / every column the selection touches, in all rows. */
export const deleteColumn = columnCommand(deleteColumns, 'delete')

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
