// Obsidian-style live preview for markdown notes: the text is shown formatted, and
// the markup (#, **, `, [](url), > …) only appears where the cursor is — block
// marks on the cursor's line, inline marks while the cursor touches that element.
// With the editor unfocused, everything is shown formatted.
//
// The decorations are a pure function of the state (doc + syntax tree + selection +
// focus), kept in a StateField: testable with an EditorState alone, no DOM needed.

import { syntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
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

/** The live-preview extension (markdown notes only). */
export function livePreview(): Extension {
  return [
    focusField,
    previewField,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
    toggleTask
  ]
}

/** The effect the editor dispatches when it gains or loses focus (also for tests). */
export const focusEffect = (focused: boolean) => setFocused.of(focused)
