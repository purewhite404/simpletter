// Obsidian-style live preview for markdown notes: the text is shown formatted, and
// the markup (#, **, `, [](url), > …) only appears where the cursor is — block
// marks on the cursor's line, inline marks while the cursor touches that element.
// With the editor unfocused, everything is shown formatted.
//
// The decorations are a pure function of the state (doc + syntax tree + selection +
// focus), kept in a StateField: testable with an EditorState alone, no DOM needed.
// (A StateField may also provide block decorations: a whole table is replaced by a
// <table> widget, which a ViewPlugin couldn't do.)

import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, StateEffect, StateField, type Extension, type Range, type StateCommand } from '@codemirror/state'
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** The editor gained (true) or lost (false) focus. */
const setFocused = StateEffect.define<boolean>()

const focusField = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) focused = e.value
    return focused
  }
})

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-bullet'
    span.textContent = '•'
    return span
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? '完了' : '未完了')
    return box
  }
  // The editor must see the mousedown: the handler below toggles the box.
  ignoreEvent(): boolean {
    return false
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lp-hr'
    return span
  }
}

// ---- Tables (GFM): shown as a <table> unless the cursor is in them; then the raw text.

export type Align = 'left' | 'center' | 'right' | null

/** A run of a cell's text as shown: `from` = where its first character is, relative to the table's first line. */
export interface TablePart {
  from: number
  text: string
  cls: string
}

/**
 * One cell; `from` = where its source starts, `to` = right after its last shown character (both relative);
 * empty: where to type (from === to).
 */
export interface TableCellModel {
  from: number
  to: number
  parts: TablePart[]
}

export interface TableModel {
  /** The table's source text (whole lines): a widget is redrawn only when this changes. */
  source: string
  align: Align[]
  head: TableCellModel[]
  /** Each body row: its line's start (relative) and its cells, as many as the header has. */
  rows: { from: number; cells: TableCellModel[] }[]
}

function alignOf(spec: string): Align {
  const s = spec.trim()
  const left = s.startsWith(':')
  const right = s.endsWith(':') && s.length > 1
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

/** A cell's inline markdown as shown: marks dropped, styles as classes (like the body text, unfocused). */
function cellParts(state: EditorState, cell: SyntaxNode, base: number): TablePart[] {
  const hidden: [number, number][] = []
  const styled: [number, number, string][] = []
  const walk = (n: SyntaxNode): void => {
    const name = n.name
    if (name in INLINE_MARK) {
      styled.push([n.from, n.to, (INLINE_STYLE[name].spec as { class: string }).class])
      for (const m of n.getChildren(INLINE_MARK[name])) hidden.push([m.from, m.to])
      if (name === 'InlineCode') {
        // In a table even code writes "|" as "\|" (GFM): the backslash isn't shown.
        const code = state.sliceDoc(n.from, n.to)
        for (let i = code.indexOf('\\|'); i >= 0; i = code.indexOf('\\|', i + 2)) hidden.push([n.from + i, n.from + i + 1])
      }
    } else if (name === 'Link') {
      const [open, close] = n.getChildren('LinkMark')
      if (open && close) {
        styled.push([open.to, close.from, 'cm-lp-link'])
        hidden.push([open.from, open.to], [close.from, n.to])
      }
    } else if (name === 'Autolink') {
      styled.push([n.from, n.to, 'cm-lp-link'])
      for (const m of n.getChildren('LinkMark')) hidden.push([m.from, m.to])
      return
    } else if (name === 'URL' && n.parent?.name !== 'Link' && n.parent?.name !== 'Image') {
      styled.push([n.from, n.to, 'cm-lp-link'])
    } else if (name === 'Image') {
      styled.push([n.from, n.to, 'cm-lp-url'])
      return
    } else if (name === 'Escape') {
      hidden.push([n.from, n.from + 1])
    }
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c)
  }
  walk(cell)

  const points = new Set([cell.from, cell.to])
  for (const [a, b] of [...hidden, ...styled]) points.add(a).add(b)
  const cuts = [...points].filter((p) => p >= cell.from && p <= cell.to).sort((a, b) => a - b)
  const parts: TablePart[] = []
  let prevEnd = -1
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]]
    if (hidden.some(([h, k]) => h <= a && b <= k)) continue
    const cls = styled.filter(([s, e]) => s <= a && b <= e).map(([, , c]) => c).join(' ')
    const text = state.sliceDoc(a, b)
    const last = parts.at(-1)
    if (last && last.cls === cls && prevEnd === a) last.text += text
    else parts.push({ from: a - base, text, cls })
    prevEnd = b
  }
  return parts
}

/** The cells of a header or body row, split at its "|"s (an empty cell has no TableCell node). */
function rowCells(state: EditorState, row: SyntaxNode, base: number): TableCellModel[] {
  const pipes = row.getChildren('TableDelimiter').map((p) => p.from)
  const nodes = row.getChildren('TableCell')
  const bounds = [row.from - 1, ...pipes, row.to]
  const cells: TableCellModel[] = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    const from = bounds[i] + 1
    const to = bounds[i + 1]
    const blank = !state.sliceDoc(from, to).trim()
    // The text before a leading "|" and after a trailing one isn't a cell.
    if (blank && pipes.length && (i === 0 || i === bounds.length - 2)) continue
    const node = nodes.find((n) => n.from >= from && n.to <= to)
    if (node) {
      const parts = cellParts(state, node, base)
      const last = parts.at(-1)
      // `to`: right after the last character shown ("**bold|**", not after the marks).
      cells.push({ from: node.from - base, to: last ? last.from + last.text.length : node.to - base, parts })
    } else {
      const at = Math.min(from + 1, to) - base // "|   |": type after one space
      cells.push({ from: at, to: at, parts: [] })
    }
  }
  return cells
}

/** What a <table> widget needs to show the table `node` (a Table node of the syntax tree). */
export function tableModel(state: EditorState, node: SyntaxNode): TableModel {
  const doc = state.doc
  const base = doc.lineAt(node.from).from
  const end = doc.lineAt(node.to).to
  const header = node.getChild('TableHeader')
  const head = header ? rowCells(state, header, base) : []
  const delim = node.getChildren('TableDelimiter').find((d) => d.to - d.from > 1)
  const specs = delim ? doc.sliceString(delim.from, delim.to).trim().replace(/^\|/, '').replace(/\|$/, '').split('|') : []
  const n = head.length
  const rows = node.getChildren('TableRow').map((row) => {
    const lineEnd = doc.lineAt(row.from).to - base
    const cells = rowCells(state, row, base).slice(0, n)
    while (cells.length < n) cells.push({ from: lineEnd, to: lineEnd, parts: [] })
    return { from: doc.lineAt(row.from).from - base, cells }
  })
  return {
    source: doc.sliceString(base, end),
    align: Array.from({ length: n }, (_, i) => alignOf(specs[i] ?? '')),
    head,
    rows
  }
}

class TableWidget extends WidgetType {
  constructor(readonly model: TableModel) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.model.source === this.model.source
  }
  get estimatedHeight(): number {
    return (this.model.rows.length + 1) * 33 + 8
  }
  toDOM(): HTMLElement {
    const { model } = this
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-lp-table'
    const addRow = (parent: HTMLElement, from: number, cells: TableCellModel[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr')
      tr.dataset.from = String(from)
      cells.forEach((cell, i) => {
        const td = document.createElement(tag)
        td.dataset.to = String(cell.to)
        if (model.align[i]) td.style.textAlign = model.align[i]!
        for (const part of cell.parts) {
          const span = document.createElement('span')
          if (part.cls) span.className = part.cls
          span.dataset.part = String(part.from)
          span.textContent = part.text
          td.appendChild(span)
        }
        tr.appendChild(td)
      })
      parent.appendChild(tr)
    }
    const thead = document.createElement('thead')
    addRow(thead, 0, model.head, 'th')
    const tbody = document.createElement('tbody')
    for (const row of model.rows) addRow(tbody, row.from, row.cells, 'td')
    table.append(thead, tbody)
    wrap.appendChild(table)
    return wrap
  }
  // The editor must see the mousedown: the handler below puts the cursor into the source.
  ignoreEvent(event: Event): boolean {
    return event.type !== 'mousedown'
  }
}

/** Where in the table's source (relative) a click on its widget at `target` goes. */
function tableClickOffset(target: HTMLElement, event: MouseEvent): number {
  const cell = target.closest<HTMLElement>('td, th')
  if (!cell) return Number(target.closest<HTMLElement>('tr')?.dataset.from ?? 0)
  // On a character: that character (each shown part is a run of the source as is).
  const doc = cell.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null }
  const caret = doc.caretRangeFromPoint?.(event.clientX, event.clientY)
  const part = caret?.startContainer.parentElement?.closest<HTMLElement>('[data-part]')
  if (caret && part && cell.contains(part)) return Number(part.dataset.part) + caret.startOffset
  return Number(cell.dataset.to) // elsewhere in the cell: after its text
}

const hide = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const rule = Decoration.replace({ widget: new RuleWidget() })
const checkbox = [false, true].map((c) => Decoration.replace({ widget: new CheckboxWidget(c) }))
const markClass = (cls: string) => Decoration.mark({ class: cls })
const lineClass = (cls: string) => Decoration.line({ class: cls })

const INLINE_STYLE: Record<string, Decoration> = {
  Emphasis: markClass('cm-lp-em'),
  StrongEmphasis: markClass('cm-lp-strong'),
  Strikethrough: markClass('cm-lp-strike'),
  InlineCode: markClass('cm-lp-code')
}
const INLINE_MARK: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  InlineCode: 'CodeMark'
}

/** All the live-preview decorations for `state` (exported for tests). */
export function previewDecorations(state: EditorState): DecorationSet {
  const doc = state.doc
  const focused = state.field(focusField, false) ?? false
  const ranges = focused ? state.selection.ranges : []
  /** The cursor/selection touches [from, to]. */
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  /** The cursor/selection is on one of the lines of [from, to]. */
  const onLines = (from: number, to: number) => touches(doc.lineAt(from).from, doc.lineAt(to).to)
  const out: Range<Decoration>[] = []
  /** A mark or replacement over [from, to] — skipped when empty. */
  const add = (deco: Decoration, from: number, to: number) => {
    if (from < to) out.push(deco.range(from, to))
  }
  const addLines = (cls: string, from: number, to: number) => {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      out.push(lineClass(cls).range(line.from))
      pos = line.to + 1
    }
  }
  /** The child marks of `node` called `name`. */
  const marks = (node: SyntaxNode, name: string) => node.getChildren(name)
  /** `to` extended over the spaces right after it. */
  const spacesAfter = (to: number) => {
    let end = to
    while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++
    return end
  }

  syntaxTree(state).iterate({
    enter(ref) {
      const node = ref.node
      const name = ref.name
      const heading = /^(ATX|Setext)Heading(\d)$/.exec(name)
      if (heading) {
        addLines(`cm-lp-h${heading[2]}`, node.from, node.to)
        if (onLines(node.from, node.to)) return
        for (const m of marks(node, 'HeaderMark')) {
          const line = doc.lineAt(m.from)
          if (heading[1] === 'Setext') add(hide, m.from, m.to)
          else if (m.from === line.from) add(hide, m.from, spacesAfter(m.to))
          else {
            // Closing #s: hide them and the spaces before.
            let start = m.from
            while (start > line.from && doc.sliceString(start - 1, start) === ' ') start--
            add(hide, start, m.to)
          }
        }
        return
      }
      if (name in INLINE_STYLE) {
        add(INLINE_STYLE[name], node.from, node.to)
        if (!touches(node.from, node.to)) for (const m of marks(node, INLINE_MARK[name])) add(hide, m.from, m.to)
        return
      }
      switch (name) {
        case 'Link': {
          const linkMarks = marks(node, 'LinkMark')
          if (linkMarks.length < 2) return
          const open = linkMarks[0]
          const close = linkMarks[1] // the "]"
          add(markClass('cm-lp-link'), open.to, close.from)
          if (!touches(node.from, node.to)) {
            add(hide, open.from, open.to)
            add(hide, close.from, node.to)
          } else {
            add(markClass('cm-lp-url'), close.from, node.to)
          }
          return
        }
        case 'Autolink': {
          add(markClass('cm-lp-link'), node.from, node.to)
          if (!touches(node.from, node.to)) for (const m of marks(node, 'LinkMark')) add(hide, m.from, m.to)
          return false
        }
        case 'URL':
          // A bare URL (GFM autolink); the ones inside links are handled above.
          if (node.parent?.name !== 'Link' && node.parent?.name !== 'Image') add(markClass('cm-lp-link'), node.from, node.to)
          return
        case 'Image':
          add(markClass('cm-lp-url'), node.from, node.to)
          return false
        case 'Blockquote':
          addLines('cm-lp-quote', node.from, node.to)
          return
        case 'QuoteMark':
          if (!onLines(node.from, node.to)) add(hide, node.from, spacesAfter(node.to))
          return
        case 'ListMark': {
          const item = node.parent
          if (!item || item.name !== 'ListItem') return
          if (item.parent?.name === 'OrderedList') {
            add(markClass('cm-lp-listmark'), node.from, node.to)
            return
          }
          if (onLines(node.from, node.to)) return
          const taskStart = item.getChild('Task')?.getChild('TaskMarker')?.from
          // A task item shows only its checkbox; a plain one a bullet.
          if (taskStart !== undefined && doc.lineAt(taskStart).number === doc.lineAt(node.from).number) {
            add(hide, node.from, taskStart)
          } else {
            add(bullet, node.from, node.to)
          }
          return
        }
        case 'TaskMarker': {
          // Raw "[ ]" only while the cursor is inside it; otherwise a checkbox, even on the cursor's line.
          if (ranges.some((r) => r.to > node.from && r.from < node.to)) return
          const checked = /x/i.test(doc.sliceString(node.from, node.to))
          add(checkbox[Number(checked)], node.from, node.to)
          if (checked) {
            const line = doc.lineAt(node.from)
            add(markClass('cm-lp-done'), spacesAfter(node.to), line.to)
          }
          return
        }
        case 'HorizontalRule':
          if (!onLines(node.from, node.to)) add(rule, node.from, node.to)
          return
        case 'FencedCode': {
          const first = doc.lineAt(node.from)
          const last = doc.lineAt(node.to)
          addLines('cm-lp-codeblock', node.from, node.to)
          out.push(lineClass('cm-lp-codeblock-first').range(first.from))
          out.push(lineClass('cm-lp-codeblock-last').range(last.from))
          if (!onLines(node.from, node.to)) {
            const fences = marks(node, 'CodeMark')
            for (const m of fences) {
              const line = doc.lineAt(m.from)
              add(hide, m.from, line.to) // the fence and its info string ("```js")
              out.push(lineClass('cm-lp-fence').range(line.from)) // an emptied fence line: keep it low
            }
          }
          return false
        }
        case 'CodeBlock':
          addLines('cm-lp-codeblock', node.from, node.to)
          return false
        case 'Escape':
          if (!touches(node.from, node.to)) add(hide, node.from, node.from + 1)
          return
        case 'Table': {
          const from = doc.lineAt(node.from).from
          const to = doc.lineAt(node.to).to
          // In a list or quote it stays text (a block widget there would swallow the > / - marks).
          if (node.parent?.name === 'Document' && !onLines(from, to)) {
            out.push(Decoration.replace({ widget: new TableWidget(tableModel(state, node)), block: true }).range(from, to))
            return false
          }
          addLines('cm-lp-table-src', from, to)
          const delim = node.getChildren('TableDelimiter').find((d) => d.to - d.from > 1)
          if (delim) out.push(lineClass('cm-lp-table-delim').range(doc.lineAt(delim.from).from))
          for (const row of [...node.getChildren('TableHeader'), ...node.getChildren('TableRow')]) {
            for (const pipe of row.getChildren('TableDelimiter')) add(markClass('cm-lp-table-pipe'), pipe.from, pipe.to)
          }
          // Being edited: the raw text, all of it (columns are easier to line up). Nested: like any text
          // (its > / list marks are inside the table node).
          return node.parent?.name === 'Document' ? false : undefined
        }
      }
    }
  })
  return Decoration.set(out, true)
}

const previewField = StateField.define<DecorationSet>({
  create: (state) => previewDecorations(state),
  update(decos, tr) {
    const focusChanged = tr.effects.some((e) => e.is(setFocused))
    if (tr.docChanged || tr.selection || focusChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return previewDecorations(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Clicking a task's checkbox toggles "[ ]" ⇄ "[x]" in the text (and so gets saved). */
const toggleTask = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    if (!target.classList?.contains('cm-lp-task')) return false
    const pos = view.posAtDOM(target)
    const marker = view.state.doc.sliceString(pos, pos + 3)
    if (!/^\[[ xX]\]$/.test(marker)) return false
    const insert = marker[1] === ' ' ? 'x' : ' '
    view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert } })
    event.preventDefault()
    return true
  }
})

/**
 * ↑ / ↓ next to a table shown as a <table>: CodeMirror's own motion jumps over a replaced block, so step
 * into its last / first line instead (same column, as far as it goes) — the table turns back into text.
 */
function enterTable(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const sel = state.selection.main
    if (state.selection.ranges.length > 1 || !sel.empty) return false
    const line = state.doc.lineAt(sel.head)
    const n = line.number + dir
    if (n < 1 || n > state.doc.lines) return false
    const next = state.doc.line(n)
    let target: { from: number; to: number } | null = null
    state.field(previewField).between(next.from, next.to, (from, to, deco) => {
      if (!(deco.spec.widget instanceof TableWidget)) return
      if (dir === 1 ? from === next.from : to === next.to) target = { from, to }
    })
    if (!target) return false
    const into = state.doc.lineAt(dir === 1 ? (target as { from: number }).from : (target as { to: number }).to)
    const pos = into.from + Math.min(sel.head - line.from, into.length)
    dispatch(state.update({ selection: EditorSelection.cursor(pos), scrollIntoView: true, userEvent: 'select' }))
    return true
  }
}
/** ↓ / ↑ into a table shown as a <table> (exported for tests). */
export const enterTableDown = enterTable(1)
export const enterTableUp = enterTable(-1)

/** Clicking a table puts the cursor there in its source (the table turns back into text). */
const editTable = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement
    const wrap = target.closest?.<HTMLElement>('.cm-lp-table-wrap')
    if (!wrap || event.button !== 0) return false
    const start = view.posAtDOM(wrap)
    const pos = Math.min(start + tableClickOffset(target, event), view.state.doc.length)
    event.preventDefault()
    // Focus first: gaining focus may take the browser's selection — then put the cursor where clicked.
    view.focus()
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    return true
  }
})

/** The live-preview extension (markdown notes only). */
export function livePreview(): Extension {
  return [
    focusField,
    previewField,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
    toggleTask,
    editTable,
    Prec.high(keymap.of([{ key: 'ArrowDown', run: enterTableDown }, { key: 'ArrowUp', run: enterTableUp }]))
  ]
}

/** The effect the editor dispatches when it gains or loses focus (also for tests). */
export const focusEffect = (focused: boolean) => setFocused.of(focused)
