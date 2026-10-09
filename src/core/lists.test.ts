// Tab / Shift+Tab / Enter in lists, on an EditorState alone. The cursor is "‸".

import { indentUnit, LanguageSupport } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { continueList, dedentListItem, indentListItem, LIST_INDENT } from './lists'

type Step = StateCommand | string // a command, or text typed at the cursor

const TAB = indentListItem
const SHIFT_TAB = dedentListItem
const ENTER = continueList

/** `text` with "‸" as the cursor (or "‸…‸" as a selection), after `steps`. */
function run(text: string, ...steps: Step[]): string {
  const [anchor, head] = [text.indexOf('‸'), text.lastIndexOf('‸') - 1]
  const doc = text.replaceAll('‸', '')
  let state = EditorState.create({
    doc,
    selection: head > anchor ? EditorSelection.range(anchor, head) : EditorSelection.cursor(anchor),
    extensions: [new LanguageSupport(markdownLanguage), indentUnit.of(' '.repeat(LIST_INDENT))]
  })
  for (const step of steps) {
    if (typeof step === 'string') {
      state = state.update(state.replaceSelection(step)).state
      continue
    }
    const before = state
    step({ state, dispatch: (tr) => void (state = tr.state) })
    if (step !== TAB && step !== SHIFT_TAB && state === before) throw new Error('the command did nothing')
  }
  const out = state.doc.toString()
  const { from, to } = state.selection.main
  return from === to
    ? out.slice(0, from) + '‸' + out.slice(from)
    : out.slice(0, from) + '‸' + out.slice(from, to) + '‸' + out.slice(to)
}

describe('Tab / Shift+Tab', () => {
  it('a bullet moves 4 spaces in, and back', () => {
    expect(run('- a\n- b‸', TAB)).toBe('- a\n    - b‸')
    expect(run('- a\n    - b‸', SHIFT_TAB)).toBe('- a\n- b‸')
    expect(run('- a\n- [ ] ta‸sk', TAB)).toBe('- a\n    - [ ] ta‸sk')
  })

  it('a numbered item that starts a sub-list becomes 1; the items after it count on', () => {
    expect(run('1. a\n2. b\n3. c‸\n4. d', TAB)).toBe('1. a\n2. b\n    1. c‸\n3. d')
    // Joining a sub-list that's already there: numbered after it.
    expect(run('1. a\n    1. x\n2. b‸\n3. c', TAB)).toBe('1. a\n    1. x\n    2. b‸\n2. c')
  })

  it('back out: numbered after the parent; what follows in the sub-list starts again at 1', () => {
    expect(run('1. a\n2. b\n    1. c\n    2. d‸\n3. e', SHIFT_TAB)).toBe('1. a\n2. b\n    1. c\n3. d‸\n4. e')
    expect(run('1. a\n    1. b‸\n    2. c\n    3. d\n2. e', SHIFT_TAB)).toBe('1. a\n2. b‸\n    1. c\n    2. d\n3. e')
  })

  it('an item takes its sub-items along', () => {
    expect(run('1. a\n2. b‸\n    1. x\n    2. y\n3. c', TAB)).toBe('1. a\n    1. b‸\n        1. x\n        2. y\n2. c')
    expect(run('- a\n    - b‸\n        - x\n- c', SHIFT_TAB)).toBe('- a\n- b‸\n    - x\n- c')
  })

  it('several selected items move together', () => {
    expect(run('1. a\n2. ‸b\n3. c‸\n4. d', TAB)).toBe('1. a\n    1. ‸b\n    2. c‸\n2. d')
  })

  it("the first item doesn't go in (it'd become code); a top-level one doesn't go out", () => {
    expect(run('1. a‸\n2. b', TAB)).toBe('1. a‸\n2. b')
    expect(run('1. a\n    1. b‸', TAB)).toBe('1. a\n    1. b‸')
    expect(run('- a‸', SHIFT_TAB)).toBe('- a‸')
  })

  it('not a list item: Tab is left to the plain indent command', () => {
    let called = false
    const state = EditorState.create({ doc: 'text', extensions: new LanguageSupport(markdownLanguage) })
    expect(indentListItem({ state, dispatch: () => (called = true) })).toBe(false)
    expect(called).toBe(false)
  })
})

describe('Enter', () => {
  it('continues the list, numbered', () => {
    expect(run('1. a‸', ENTER, 'b')).toBe('1. a\n2. b‸')
    expect(run('- a‸', ENTER, 'b')).toBe('- a\n- b‸')
  })

  it('the whole flow: Tab starts again at 1, Enter twice goes back and counts on', () => {
    const steps: Step[] = [ENTER, TAB, 'c', ENTER, 'd', ENTER, ENTER, 'e']
    expect(run('1. a\n2. b‸', ...steps)).toBe('1. a\n2. b\n    1. c\n    2. d\n3. e‸')
  })

  it('Enter twice under a one-item sub-list also steps out (no blank line)', () => {
    expect(run('1. a\n    1. x‸', ENTER, ENTER, 'b')).toBe('1. a\n    1. x\n2. b‸')
    expect(run('- a\n    - x‸', ENTER, ENTER, 'b')).toBe('- a\n    - x\n- b‸')
  })

  it('an empty top-level item ends the list', () => {
    expect(run('1. a\n2. ‸', ENTER)).toBe('1. a\n‸')
  })
})
