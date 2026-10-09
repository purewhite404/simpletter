// The live preview's decorations, from an EditorState alone (no DOM): what text
// is left showing, which widgets replace what, and which lines get which classes.

import { ensureSyntaxTree, LanguageSupport, syntaxTree } from '@codemirror/language'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  enterTableDown,
  enterTableUp,
  focusEffect,
  livePreview,
  previewDecorations,
  tableModel,
  type TableModel
} from './livePreview'

/** `doc` with the cursor where "‸" is (no "‸": the editor is unfocused). */
function stateOf(text: string): EditorState {
  const cursor = text.indexOf('‸')
  const doc = text.replace('‸', '')
  let state = EditorState.create({ doc, extensions: [new LanguageSupport(markdownLanguage), livePreview()] })
  ensureSyntaxTree(state, doc.length, 5000)
  if (cursor >= 0) {
    state = state.update({ selection: EditorSelection.cursor(cursor), effects: focusEffect(true) }).state
  }
  return state
}

const WIDGET_TEXT: Record<string, string> = { BulletWidget: '•', RuleWidget: '—', TableWidget: '[table]' }

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
    expect(shown('# Ti‸tle\n## Sub\ntext')).toBe('# Title\nSub\ntext')
    expect(shown('# Title\n## Sub\nte‸xt')).toBe('Title\nSub\ntext')
    expect(lineClasses('# A\n### B\nplain')).toEqual(['cm-lp-h1', 'cm-lp-h3', ''])
  })

  it('setext headings: the underline hides, both lines styled', () => {
    expect(shown('Title\n===\n\nnext‸')).toBe('Title\n\n\nnext')
    expect(lineClasses('Title\n---\n')).toEqual(['cm-lp-h2', 'cm-lp-h2', ''])
  })

  it('unfocused: everything is formatted, wherever the cursor was', () => {
    expect(shown('# A\n**b**')).toBe('A\nb')
  })
})

describe('inline', () => {
  it('bold / italic / strike / code: marks hide unless the cursor touches the element', () => {
    const text = 'a **bold** *it* ~~gone~~ `code` z'
    expect(shown(text + '‸')).toBe('a bold it gone code z')
    expect(shown('a **bo‸ld** *it* ~~gone~~ `code` z')).toBe('a **bold** it gone code z')
    expect(shown('a **bold**‸ *it* ~~gone~~ `code` z')).toBe('a **bold** it gone code z') // right after
    expect(shown('a **bold** *it* ~~gone~~ `co‸de` z')).toBe('a bold it gone `code` z')
    expect(marked(text, 'cm-lp-strong')).toEqual(['**bold**'])
    expect(marked(text, 'cm-lp-em')).toEqual(['*it*'])
    expect(marked(text, 'cm-lp-strike')).toEqual(['~~gone~~'])
    expect(marked(text, 'cm-lp-code')).toEqual(['`code`'])
  })

  it('nested: ***both*** and **bold with *italic***', () => {
    expect(shown('***both*** and **bold *it***\n‸')).toBe('both and bold it\n')
  })

  it('links show their text; the url only while editing them; bare urls are links too', () => {
    expect(shown('see [docs](https://x.dev "t") now‸')).toBe('see docs now')
    expect(shown('see [do‸cs](https://x.dev) now')).toBe('see [docs](https://x.dev) now')
    expect(marked('[docs](https://x.dev)', 'cm-lp-link')).toEqual(['docs'])
    expect(shown('<https://x.dev> ok‸')).toBe('https://x.dev ok')
    expect(marked('go to https://x.dev now', 'cm-lp-link')).toEqual(['https://x.dev'])
  })

  it('a backslash escape hides its backslash', () => {
    expect(shown('\\*not italic\\* \\_‸x')).toBe('*not italic* \\_x') // the cursor touches the second
  })

  it('Japanese text around marks', () => {
    expect(shown('今日は**晴れ**です。‸')).toBe('今日は晴れです。')
  })
})

describe('blocks', () => {
  it('bullets become •, numbers stay; the cursor line shows its "-"', () => {
    expect(shown('- one\n- two\n1. first‸')).toBe('• one\n• two\n1. first')
    expect(shown('- one‸\n- two')).toBe('- one\n• two')
    expect(marked('1. first', 'cm-lp-listmark')).toEqual(['1.'])
  })

  it('tasks: a checkbox (also on the cursor line), raw only with the cursor inside it', () => {
    expect(shown('- [ ] todo\n- [x] done\nend‸')).toBe('☐ todo\n☑ done\nend')
    expect(shown('- [ ] to‸do')).toBe('- ☐ todo')
    expect(shown('- [‸ ] todo')).toBe('- [ ] todo')
    expect(marked('- [x] done', 'cm-lp-done')).toEqual(['done'])
  })

  it('quotes: ">" hides off the cursor line; every quoted line is styled', () => {
    expect(shown('> one\n> two‸')).toBe('one\n> two')
    expect(lineClasses('> one\n> two\n\nafter')).toEqual(['cm-lp-quote', 'cm-lp-quote', '', ''])
  })

  it('a horizontal rule becomes a line', () => {
    expect(shown('a\n\n---\n\nb‸')).toBe('a\n\n—\n\nb')
    expect(shown('a\n\n---‸\n\nb')).toBe('a\n\n---\n\nb')
  })

  it('code blocks: fences hide unless the cursor is in the block; contents untouched', () => {
    const text = '```js\nconst a = **1**\n```\n'
    expect(shown(text + 'after‸')).toBe('\nconst a = **1**\n\nafter')
    expect(shown('```js\nconst‸ a = **1**\n```\n')).toBe(text)
    expect(lineClasses(text)).toEqual([
      'cm-lp-codeblock cm-lp-codeblock-first cm-lp-fence', // fences hidden: low lines
      'cm-lp-codeblock',
      'cm-lp-codeblock cm-lp-codeblock-last cm-lp-fence',
      ''
    ])
    expect(lineClasses('```\n‸x\n```')).toEqual([
      'cm-lp-codeblock cm-lp-codeblock-first',
      'cm-lp-codeblock',
      'cm-lp-codeblock cm-lp-codeblock-last'
    ])
  })
})

describe('tables', () => {
  const TABLE = '| 名前 | 数 |\n| --- | ---: |\n| りんご | 3 |\n| みかん | 10 |'

  /** The model of the first top-level table in `text`. */
  function model(text: string): TableModel {
    const state = stateOf(text)
    const node = syntaxTree(state).topNode.getChild('Table')
    if (!node) throw new Error('no table')
    return tableModel(state, node)
  }
  /** Each row's cells as shown (header first). */
  const cellTexts = (m: TableModel) => [m.head, ...m.rows.map((r) => r.cells)].map((cells) => cells.map((c) => c.parts.map((p) => p.text).join('')))

  it('a table becomes one widget unless the cursor is on its lines (unfocused: always)', () => {
    expect(shown(`before\n\n${TABLE}\n\nafter‸`)).toBe('before\n\n[table]\n\nafter')
    expect(shown(`${TABLE}\n\nafter`)).toBe('[table]\n\nafter')
    expect(shown(`| 名前 | 数 |\n| --- | ---: |\n| りん‸ご | 3 |\n| みかん | 10 |`)).toBe(TABLE)
  })

  it('with the cursor inside: the raw text, mono lines, a faint delimiter row; inline marks stay raw', () => {
    const text = '| **a** | b |\n|---|---|\n| 1| 2 |'
    expect(shown('| **a** | b |\n|---|---|\n| 1| 2 |'.replace('1', '1‸'))).toBe(text)
    expect(lineClasses(text.replace('1', '1‸'))).toEqual(['cm-lp-table-src', 'cm-lp-table-src cm-lp-table-delim', 'cm-lp-table-src'])
    expect(marked(text.replace('1', '1‸'), 'cm-lp-table-pipe')).toHaveLength(6)
  })

  it('tables in a list or a quote stay text', () => {
    expect(shown('> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nx‸')).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\nx') // only the > hides
    expect(shown('- | a | b |\n  |---|---|\n  | 1 | 2 |\n\nx‸')).not.toContain('[table]')
  })

  it('↓ / ↑ step into a table shown as a <table> (CodeMirror would jump over it)', () => {
    const run = (text: string, cmd: typeof enterTableDown) => {
      let next: EditorState | null = null
      const ok = cmd({ state: stateOf(text), dispatch: (tr) => void (next = tr.state) })
      if (!ok || !next) return null
      const s = next as EditorState
      const doc = s.doc.toString()
      return doc.slice(0, s.selection.main.head) + '‸' + doc.slice(s.selection.main.head)
    }
    const doc = `ab\n${TABLE}\n\nzz`
    expect(run(doc.replace('ab', 'a‸b'), enterTableDown)).toBe(doc.replace('| 名前', '|‸ 名前')) // the same column
    expect(run(doc.replace('\n\nzz', '\n‸\nzz'), enterTableUp)).toBe(doc.replace('| みかん', '‸| みかん'))
    // Not next to a table, or the table already shown as text: CodeMirror's own motion.
    expect(run(doc.replace('zz', 'z‸z'), enterTableUp)).toBeNull()
    expect(run(doc.replace('ab', 'a‸b'), enterTableUp)).toBeNull()
    expect(run(doc.replace('りんご', 'り‸んご'), enterTableDown)).toBeNull()
    // A line right after a table (no blank line) is one of its rows (GFM).
    expect(shown(`${TABLE}\nzz\n\nend‸`)).toBe('[table]\n\nend')
  })

  it('model: cells, alignment, Japanese text', () => {
    const m = model('| 左 | 中 | 右 | 無 |\n|:--|:-:|--:|---|\n| a | b | c | d |')
    expect(m.align).toEqual(['left', 'center', 'right', null])
    expect(cellTexts(m)).toEqual([['左', '中', '右', '無'], ['a', 'b', 'c', 'd']])
    expect(cellTexts(model(TABLE))).toEqual([['名前', '数'], ['りんご', '3'], ['みかん', '10']])
  })

  it('model: positions point into the source, relative to the first line', () => {
    const text = 'intro\n\n' + TABLE
    const m = model(text)
    const base = text.indexOf('|')
    const at = (n: number) => text.slice(base + n)
    expect(at(m.head[1].from)).toMatch(/^数 \|/)
    expect(at(m.rows[1].cells[0].to)).toMatch(/^ \| 10 \|$/) // after "みかん"
    expect(at(m.rows[1].from)).toBe('| みかん | 10 |')
    expect(m.rows[0].cells[0].parts[0].from).toBe(m.rows[0].cells[0].from)
    expect(m.source).toBe(TABLE)
  })

  it('model: bold / code / links / escaped pipes are shown formatted', () => {
    const m = model('| a | b |\n|---|---|\n| **太字** と `x\\|y` | [文書](https://x.dev) \\| <https://y.dev> |')
    const [first, second] = m.rows[0].cells
    expect(first.parts.map((p) => [p.text, p.cls])).toEqual([
      ['太字', 'cm-lp-strong'],
      [' と ', ''],
      ['x', 'cm-lp-code'], // "\|" in code: the backslash goes too
      ['|y', 'cm-lp-code']
    ])
    expect(second.parts.map((p) => [p.text, p.cls])).toEqual([
      ['文書', 'cm-lp-link'],
      [' ', ''],
      ['| ', ''], // "\|": the backslash goes
      ['https://y.dev', 'cm-lp-link']
    ])
  })

  it('model: empty cells, and rows with too few or too many cells', () => {
    const text = '| a | b | c |\n|---|---|---|\n|  | x |\n| 1 | 2 | 3 | 4 |\n|||y|'
    const m = model(text)
    expect(cellTexts(m)).toEqual([['a', 'b', 'c'], ['', 'x', ''], ['1', '2', '3'], ['', '', 'y']])
    const base = 0
    const empty = m.rows[0].cells[0]
    expect(empty.from).toBe(empty.to)
    expect(text.slice(base + m.rows[0].from, base + empty.from)).toBe('| ') // typing lands inside the cell
    const padded = m.rows[0].cells[2]
    expect(text.slice(0, padded.from).endsWith('| x |')).toBe(true) // the row's end
  })
})
