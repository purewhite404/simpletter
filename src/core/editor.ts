// The note's text editor (CodeMirror 6). Markdown notes get the live preview
// (livePreview.ts) and list continuation on Enter; CSV / TSV files show as a table
// (csvPreview.ts); any other file opened from outside (.txt, .log, …) is plain
// monospace text, as before.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit, LanguageSupport } from '@codemirror/language'
import { deleteMarkupBackward, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { csvPreview, insertDelimiter } from './csvPreview'
import { continueList, dedentListItem, indentListItem, LIST_INDENT } from './lists'
import { focusEffect, livePreview } from './livePreview'
import type { FileKind } from './names'

export interface NoteEditor {
  getValue(): string
  /** Shows another file: new text, fresh undo history; does not count as an edit. */
  setValue(text: string, kind: FileKind): void
  focus(): void
}

const PLACEHOLDER = 'ここに書く…（# 見出し、**太字**、- 箇条書き、- [ ] チェックボックス）'

/** The keys every kind of file has (after its own ones). */
const BASE_KEYS = [...defaultKeymap, ...historyKeymap]

function extensions(kind: FileKind, onChange: () => void): Extension[] {
  const base: Extension[] = [
    history(),
    EditorView.contentAttributes.of({ 'aria-label': '本文', spellcheck: 'false' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange()
    })
  ]
  if (kind === 'csv' || kind === 'tsv') {
    // No line wrapping: a wide table scrolls sideways (long cells wrap inside their column). Tab = a new cell.
    return [
      ...base,
      csvPreview(kind === 'csv' ? ',' : '\t'),
      EditorView.editorAttributes.of({ class: 'cm-csv' }),
      keymap.of([{ key: 'Tab', run: insertDelimiter }, ...BASE_KEYS])
    ]
  }
  const common: Extension[] = [...base, EditorView.lineWrapping, placeholder(PLACEHOLDER)]
  if (kind === 'plain') {
    return [...common, EditorView.editorAttributes.of({ class: 'cm-plain' }), keymap.of(BASE_KEYS)]
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
      ...BASE_KEYS
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
