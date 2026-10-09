// Lists in markdown notes (keys bound in editor.ts):
//  - Tab / Shift+Tab move a list item — with its sub-items — one level (LIST_INDENT spaces) in / out,
//    then renumber the numbered lists involved: an item that starts a new sub-list becomes 1, the
//    lists around it count on (1. 2. 3.).
//  - Enter continues the list; on an empty item it steps one level out, numbered after its parent
//    item (lang-markdown; `nonTightLists: false` so it never inserts a blank line instead).

import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, getIndentUnit, syntaxTree } from '@codemirror/language'
import type { ChangeSpec, EditorState, Line, StateCommand } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'

/** Spaces per list level (also the editor's indent unit for markdown). */
export const LIST_INDENT = 4

const treeOf = (state: EditorState): Tree => ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state)

/** The list item whose marker begins `line` after indentation only (not in a quote); else null. */
function itemOn(tree: Tree, line: Line): SyntaxNode | null {
  const indent = /^[ \t]*/.exec(line.text)![0].length
  if (indent === line.length) return null
  const mark = tree.resolveInner(line.from + indent, 1)
  if (mark.name !== 'ListMark' || mark.from !== line.from + indent) return null
  return mark.parent?.name === 'ListItem' ? mark.parent : null
}

/**
 * Numbers the ordered lists the items on `itemLines` belong to, and those around and under them:
 * consecutive from the list's first number — or from 1 for a sub-list that a moved item starts or
 * that sits under a moved item.
 */
function renumber(state: EditorState, tree: Tree, itemLines: number[]): ChangeSpec[] {
  const lists = new Map<number, { list: SyntaxNode; fromOne: boolean }>()
  const add = (list: SyntaxNode, fromOne: boolean) => {
    if (list.name !== 'OrderedList') return
    lists.set(list.from, { list, fromOne: fromOne || !!lists.get(list.from)?.fromOne })
  }
  for (const n of itemLines) {
    const item = itemOn(tree, state.doc.line(n))
    if (!item?.parent) continue
    const list = item.parent
    add(list, list.parent?.name === 'ListItem' && list.firstChild?.from === item.from)
    for (let up = list.parent; up; up = up.parent) add(up, false)
    for (const sub of item.getChildren('OrderedList')) add(sub, true)
  }
  const changes: ChangeSpec[] = []
  for (const { list, fromOne } of lists.values()) {
    let next: number | null = fromOne ? 1 : null
    for (const item of list.getChildren('ListItem')) {
      const mark = item.getChild('ListMark')
      const digits = mark && /^\d+/.exec(state.sliceDoc(mark.from, mark.to))
      if (!mark || !digits) continue
      next ??= Number(digits[0])
      if (Number(digits[0]) !== next) {
        changes.push({ from: mark.from, to: mark.from + digits[0].length, insert: String(next) })
      }
      next++
    }
  }
  return changes
}

/** Tab (dir 1) / Shift+Tab (dir -1) on list items; false when the selection has none (plain indenting then). */
function shiftItems(dir: 1 | -1): StateCommand {
  return ({ state, dispatch }) => {
    const { doc } = state
    const tree = treeOf(state)
    const lines = new Set<number>()
    const roots: SyntaxNode[] = []
    for (const r of state.selection.ranges) {
      const first = doc.lineAt(r.from).number
      // A selection ending at a line's start doesn't take that line.
      const last = doc.lineAt(r.to > r.from && doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to).number
      for (let n = first; n <= last; n++) {
        if (lines.has(n)) continue
        lines.add(n)
        const item = itemOn(tree, doc.line(n))
        if (!item) continue
        roots.push(item)
        const end = doc.lineAt(item.to).number // its sub-items move with it
        for (let k = n + 1; k <= end; k++) lines.add(k)
        n = Math.max(n, end)
      }
    }
    if (!roots.length) return false
    // In: only under a previous item (else it'd become code). Out: only from a sub-list.
    const movable = (item: SyntaxNode) =>
      dir === 1 ? item.prevSibling?.name === 'ListItem' : item.parent?.parent?.name === 'ListItem'
    if (!roots.every(movable)) return true

    const unit = getIndentUnit(state)
    const changes: ChangeSpec[] = []
    for (const n of [...lines].sort((a, b) => a - b)) {
      const line = doc.line(n)
      if (dir === 1) {
        if (line.text.trim()) changes.push({ from: line.from, insert: ' '.repeat(unit) })
        continue
      }
      let i = 0
      for (let col = 0; i < line.length && col < unit; i++) {
        const ch = line.text[i]
        if (ch === ' ') col++
        else if (ch === '\t') col = unit
        else break
      }
      if (i) changes.push({ from: line.from, to: line.from + i })
    }
    const moved = state.changes(changes)
    const mid = state.update({ changes: moved }).state
    const numbers = mid.changes(
      renumber(
        mid,
        treeOf(mid),
        roots.map((r) => doc.lineAt(r.from).number)
      )
    )
    const all = moved.compose(numbers)
    dispatch(
      state.update({
        changes: all,
        selection: state.selection.map(all, 1),
        scrollIntoView: true,
        userEvent: dir === 1 ? 'input.indent' : 'delete.dedent'
      })
    )
    return true
  }
}

export const indentListItem = shiftItems(1)
export const dedentListItem = shiftItems(-1)

/** Enter: continue the list / quote; an empty item steps out one level (numbered after its parent). */
export const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false })
