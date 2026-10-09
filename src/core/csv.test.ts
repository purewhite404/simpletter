import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { charWidth, MAX_WIDTH, parseLine, quoteMarks, scanDoc, textWidth } from './csv'

/** The fields of a line as text. */
const fields = (line: string, delim: ',' | '\t' = ',', inQuote = false) =>
  parseLine(line, delim, inQuote).fields.map((f) => line.slice(f.from, f.to))

describe('parseLine', () => {
  it('splits at the delimiter; empty fields, a trailing delimiter, an empty line', () => {
    expect(fields('a,b,c')).toEqual(['a', 'b', 'c'])
    expect(fields('a,,c')).toEqual(['a', '', 'c'])
    expect(fields('a,')).toEqual(['a', ''])
    expect(fields('')).toEqual([''])
    expect(fields('a\tb,c', '\t')).toEqual(['a', 'b,c'])
  })

  it('a quoted field keeps its delimiters and doubled quotes; a quote inside an unquoted one is just text', () => {
    expect(fields('"a,b","say ""hi""",c')).toEqual(['"a,b"', '"say ""hi"""', 'c'])
    expect(fields('ab"c,d')).toEqual(['ab"c', 'd'])
    expect(fields('"a"x,b')).toEqual(['"a"x', 'b']) // text after the closing quote: still the field
    expect(parseLine('"a,b",c', ',').fields.map((f) => f.quoted)).toEqual([true, false])
  })

  it('an unclosed quote runs on into the next line; that line starts inside it', () => {
    expect(parseLine('a,"b', ',')).toMatchObject({ open: true })
    expect(parseLine('a,"b"', ',')).toMatchObject({ open: false })
    expect(fields('c",d', ',', true)).toEqual(['c"', 'd'])
    expect(parseLine('c",d', ',', true).open).toBe(false)
    expect(parseLine('still inside', ',', true).open).toBe(true)
  })

  it('a BOM is not part of the first field (which may still be quoted)', () => {
    const line = '\ufeff"a,b",c'
    expect(fields(line)).toEqual(['"a,b"', 'c'])
    expect(parseLine(line, ',').fields[0]).toEqual({ from: 1, to: 6, quoted: true })
  })
})

describe('quoteMarks', () => {
  it('the opening quote, the first of each pair, the closing one', () => {
    const line = 'x,"a""b"z'
    const [, f] = parseLine(line, ',').fields
    expect(quoteMarks(line, f)).toEqual([2, 4, 7])
    expect(quoteMarks('a', parseLine('a', ',').fields[0])).toEqual([])
    const open = '"no end'
    expect(quoteMarks(open, parseLine(open, ',').fields[0])).toEqual([0])
  })
})

describe('widths', () => {
  it('East Asian wide characters take 2 ch, a BOM none', () => {
    expect(textWidth('abc')).toBe(3)
    expect(textWidth('りんご')).toBe(6)
    expect(textWidth('ＡＢ')).toBe(4)
    expect(textWidth('ｱｲ')).toBe(2) // halfwidth katakana
    expect(textWidth('𠮷')).toBe(2) // outside the BMP
    expect(charWidth(0xfeff)).toBe(0)
  })

  it('scanDoc: each column fits its widest field (+ 1 for the delimiter before it, not in the first), at most MAX_WIDTH', () => {
    const long = 'x'.repeat(100)
    const { widths, multi } = scanDoc(Text.of(['name,qty', '"りんご",3', `${long},12345`, '']), ',')
    expect(widths).toEqual([MAX_WIDTH, 6])
    expect(multi).toEqual([])
    expect(scanDoc(Text.of(['a,b', 'あ']), ',').widths).toEqual([2, 2])
  })

  it('scanDoc: a record over several lines is found (not measured); an unclosed quote runs to the end', () => {
    const doc = Text.of(['a,b', 'c,"one', 'two', 'three",d', 'e,f'])
    const { widths, multi } = scanDoc(doc, ',')
    const lines = multi.map((r) => doc.sliceString(r.from, r.to))
    expect(lines).toEqual(['c,"one\ntwo\nthree",d'])
    expect(widths).toEqual([1, 2])
    const open = Text.of(['a', '"b', 'c'])
    expect(scanDoc(open, ',').multi).toEqual([{ from: 2, to: open.length }])
  })
})
