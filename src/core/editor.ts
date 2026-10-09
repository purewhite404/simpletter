// The note's text editor (CodeMirror 6). Markdown notes get the live preview
// (livePreview.ts) and list continuation on Enter; any other file opened from
// outside (.txt, .log, …) is plain monospace text, as before.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit, LanguageSupport } from '@codemirror/language'
import { deleteMarkupBackward, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { continueList, dedentListItem, indentListItem, LIST_INDENT } from './lists'
import { focusEffect, livePreview } from './livePreview'

export type EditorKind = 'markdown' | 'plain'

export interface NoteEditor {
  getValue(): string
  /** Shows another file: new text, fresh undo history; does not count as an edit. */
  setValue(text: string, kind: EditorKind): void
  focus(): void
}

const PLACEHOLDER = 'ここに書く…（# 見出し、**太字**、- 箇条書き、- [ ] チェックボックス）'

function extensions(kind: EditorKind, onChange: () => void): Extension[] {
  const common: Extension[] = [
    history(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': '本文', spellcheck: 'false' }),
    placeholder(PLACEHOLDER),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange()
    })
  ]
  if (kind === 'plain') {
    return [...common, EditorView.editorAttributes.of({ class: 'cm-plain' }), keymap.of([...defaultKeymap, ...historyKeymap])]
  }
  return [
    ...common,
    new LanguageSupport(markdownLanguage),
    indentUnit.of(' '.repeat(LIST_INDENT)),
    livePreview(),
    EditorView.editorAttributes.of({ class: 'cm-markdown' }),
    keymap.of([
      { key: 'Enter', run: continueList },
      { key: 'Backspace', run: deleteMarkupBackward },
      { key: 'Tab', run: indentListItem, shift: dedentListItem }, // list items (lists.ts)
      indentWithTab, // other lines
      ...defaultKeymap,
      ...historyKeymap
    ])
  ]
}

/** An editor inside `parent`; `onChange` runs after every edit by the user. */
export function createEditor(parent: HTMLElement, onChange: () => void): NoteEditor {
  const view = new EditorView({ parent, state: EditorState.create({ extensions: extensions('markdown', onChange) }) })
  return {
    getValue: () => view.state.doc.toString(),
    setValue(text, kind) {
      view.setState(EditorState.create({ doc: text, extensions: extensions(kind, onChange) }))
      // A new state starts "unfocused"; the view may well still have the focus.
      if (view.hasFocus) view.dispatch({ effects: focusEffect(true) })
    },
    focus: () => view.focus()
  }
}
