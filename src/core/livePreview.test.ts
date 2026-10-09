// The live preview's decorations, from an EditorState alone (no DOM): what text
// is left showing, which widgets replace what, and which lines get which classes.

import { ensureSyntaxTree, LanguageSupport } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { focusEffect, livePreview, previewDecorations } from './livePreview'

/** `doc` with the cursor where "|" is (no "|": the editor is unfocused). */
function stateOf(text: string): EditorState {
  const cursor = text.indexOf('|')
  const doc = text.replace('|', '')
  let state = EditorState.create({ doc, extensions: [new LanguageSupport(markdownLanguage), livePreview()] })
  ensureSyntaxTree(state, doc.length, 5000)
  if (cursor >= 0) {
    state = state.update({ selection: EditorSelection.cursor(cursor), effects: focusEffect(true) }).state
  }
  return state
}

const WIDGET_TEXT: Record<string, string> = { BulletWidget: '•', RuleWidget: '—' }

/** The text as shown: hidden ranges dropped, widgets as symbols. */
function shown(text: string): string {
  const state = stateOf(text)
  const doc = state.doc.toString()
  const replaced: { from: number; to: number; text: string }[] = []
  previewDecorations(state).between(0, doc.length, (from, to, deco) => {
    if (deco.spec.class || deco.spec.attributes || (!deco.spec.widget && from === to)) return // marks and lines
    const widget = deco.spec.widget as { constructor: { name: string }; checked?: boolean } | undefined
    const symbol = !widget ? '' : 'checked' in widget ? (widget.checked ? '☑' : '☐') : WIDGET_TEXT[widget.constructor.name]
    replaced.push({ from, to, text: symbol })
  })
  let out = ''
  let pos = 0
  for (const r of replaced.sort((a, b) => a.from - b.from)) {
    out += doc.slice(pos, r.from) + r.text
    pos = r.to
  }
  return out + doc.slice(pos)
}

/** The classes given to each line. */
function lineClasses(text: string): string[] {
  const state = stateOf(text)
  const byLine = new Map<number, string[]>()
  previewDecorations(state).between(0, state.doc.length, (from, to, deco) => {
    if (from !== to || !deco.spec.class || deco.spec.widget) return
    const n = state.doc.lineAt(from).number
    byLine.set(n, [...(byLine.get(n) ?? []), deco.spec.class])
  })
  return Array.from({ length: state.doc.lines }, (_, i) => (byLine.get(i + 1) ?? []).join(' '))
}

/** The [from, to) text of each mark decoration with class `cls`. */
function marked(text: string, cls: string): string[] {
  const state = stateOf(text)
  const out: string[] = []
  previewDecorations(state).between(0, state.doc.length, (from, to, deco) => {
    if (from < to && deco.spec.class === cls) out.push(state.sliceDoc(from, to))
  })
  return out
}

describe('headings', () => {
  it('hide their #s unless the cursor is on the line; every line gets its level', () => {
    expect(shown('# Title\n## Sub ##\ntext')).toBe('Title\nSub\ntext')
    expect(shown('# Ti|tle\n## Sub\ntext')).toBe('# Title\nSub\ntext')
    expect(shown('# Title\n## Sub\nte|xt')).toBe('Title\nSub\ntext')
    expect(lineClasses('# A\n### B\nplain')).toEqual(['cm-lp-h1', 'cm-lp-h3', ''])
  })

  it('setext headings: the underline hides, both lines styled', () => {
    expect(shown('Title\n===\n\nnext|')).toBe('Title\n\n\nnext')
    expect(lineClasses('Title\n---\n')).toEqual(['cm-lp-h2', 'cm-lp-h2', ''])
  })

  it('unfocused: everything is formatted, wherever the cursor was', () => {
    expect(shown('# A\n**b**')).toBe('A\nb')
  })
})

describe('inline', () => {
  it('bold / italic / strike / code: marks hide unless the cursor touches the element', () => {
    const text = 'a **bold** *it* ~~gone~~ `code` z'
    expect(shown(text + '|')).toBe('a bold it gone code z')
    expect(shown('a **bo|ld** *it* ~~gone~~ `code` z')).toBe('a **bold** it gone code z')
    expect(shown('a **bold**| *it* ~~gone~~ `code` z')).toBe('a **bold** it gone code z') // right after
    expect(shown('a **bold** *it* ~~gone~~ `co|de` z')).toBe('a bold it gone `code` z')
    expect(marked(text, 'cm-lp-strong')).toEqual(['**bold**'])
    expect(marked(text, 'cm-lp-em')).toEqual(['*it*'])
    expect(marked(text, 'cm-lp-strike')).toEqual(['~~gone~~'])
    expect(marked(text, 'cm-lp-code')).toEqual(['`code`'])
  })

  it('nested: ***both*** and **bold with *italic***', () => {
    expect(shown('***both*** and **bold *it***\n|')).toBe('both and bold it\n')
  })

  it('links show their text; the url only while editing them; bare urls are links too', () => {
    expect(shown('see [docs](https://x.dev "t") now|')).toBe('see docs now')
    expect(shown('see [do|cs](https://x.dev) now')).toBe('see [docs](https://x.dev) now')
    expect(marked('[docs](https://x.dev)', 'cm-lp-link')).toEqual(['docs'])
    expect(shown('<https://x.dev> ok|')).toBe('https://x.dev ok')
    expect(marked('go to https://x.dev now', 'cm-lp-link')).toEqual(['https://x.dev'])
  })

  it('a backslash escape hides its backslash', () => {
    expect(shown('\\*not italic\\* \\_|x')).toBe('*not italic* \\_x') // the cursor touches the second
  })

  it('Japanese text around marks', () => {
    expect(shown('今日は**晴れ**です。|')).toBe('今日は晴れです。')
  })
})

describe('blocks', () => {
  it('bullets become •, numbers stay; the cursor line shows its "-"', () => {
    expect(shown('- one\n- two\n1. first|')).toBe('• one\n• two\n1. first')
    expect(shown('- one|\n- two')).toBe('- one\n• two')
    expect(marked('1. first', 'cm-lp-listmark')).toEqual(['1.'])
  })

  it('tasks: a checkbox (also on the cursor line), raw only with the cursor inside it', () => {
    expect(shown('- [ ] todo\n- [x] done\nend|')).toBe('☐ todo\n☑ done\nend')
    expect(shown('- [ ] to|do')).toBe('- ☐ todo')
    expect(shown('- [| ] todo')).toBe('- [ ] todo')
    expect(marked('- [x] done', 'cm-lp-done')).toEqual(['done'])
  })

  it('quotes: ">" hides off the cursor line; every quoted line is styled', () => {
    expect(shown('> one\n> two|')).toBe('one\n> two')
    expect(lineClasses('> one\n> two\n\nafter')).toEqual(['cm-lp-quote', 'cm-lp-quote', '', ''])
  })

  it('a horizontal rule becomes a line', () => {
    expect(shown('a\n\n---\n\nb|')).toBe('a\n\n—\n\nb')
    expect(shown('a\n\n---|\n\nb')).toBe('a\n\n---\n\nb')
  })

  it('code blocks: fences hide unless the cursor is in the block; contents untouched', () => {
    const text = '```js\nconst a = **1**\n```\n'
    expect(shown(text + 'after|')).toBe('\nconst a = **1**\n\nafter')
    expect(shown('```js\nconst| a = **1**\n```\n')).toBe(text)
    expect(lineClasses(text)).toEqual([
      'cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence', // fences hidden: low lines
      'cm-lp-codeblock',
      'cm-lp-codeblock cm-lp-codeblock-last cm-lp-fence',
      ''
    ])
    expect(lineClasses('```\n|x\n```')).toEqual([
      'cm-lp-codeblock cm-lp-codeblock-first',
      'cm-lp-codeblock',
      'cm-lp-codeblock cm-lp-codeblock-last'
    ])
  })
})
