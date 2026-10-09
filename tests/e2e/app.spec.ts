import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  answerConfirm,
  dialogs,
  editor,
  launch,
  removeDir,
  row,
  rows,
  stubDialogs,
  tempDir,
  typeFolder
} from './helpers'

const mdFiles = (dir: string) =>
  readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()

test('under test the window is off every display, without the focus, and still paints', async () => {
  const app = await launch()
  try {
    const state = await app.page.evaluate(async () => {
      type Rect = { x: number; y: number; width: number; height: number }
      const invoke = (
        window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: object) => Promise<unknown> } }
      ).__TAURI_INTERNALS__.invoke
      const win = (cmd: string) => invoke(`plugin:window|${cmd}`, { label: 'main' })
      const pos = (await win('outer_position')) as { x: number; y: number }
      const size = (await win('outer_size')) as { width: number; height: number }
      const monitors = (await win('available_monitors')) as {
        position: { x: number; y: number }
        size: { width: number; height: number }
      }[]
      const b: Rect = { ...pos, ...size }
      const overlaps = (d: Rect) =>
        b.x < d.x + d.width && d.x < b.x + b.width && b.y < d.y + d.height && d.y < b.y + b.height
      // Off screen must not mean "hidden" (CalculateNativeWinOcclusion is off): frames still come.
      const frames = await new Promise<number>((done) => {
        let n = 0
        const tick = () => (++n >= 3 ? done(n) : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
        setTimeout(() => done(n), 2000)
      })
      return {
        visible: await win('is_visible'),
        focused: await win('is_focused'),
        overlapsADisplay: monitors.some((m) => overlaps({ ...m.position, ...m.size })),
        visibilityState: document.visibilityState,
        frames
      }
    })
    expect(state).toEqual({
      visible: true,
      focused: false,
      overlapsADisplay: false,
      visibilityState: 'visible',
      frames: 3
    })
  } finally {
    await app.close()
  }
})

test('a folder typed into the bar lists its notes; typing saves to disk', async () => {
  const dir = tempDir('simpletter-notes-')
  writeFileSync(join(dir, 'b.md'), 'note B')
  writeFileSync(join(dir, 'a.md'), 'note A')
  writeFileSync(join(dir, 'skip.txt'), 'not a note')
  const app = await launch()
  try {
    await expect(app.page.locator('#picker-screen')).toBeVisible()
    await typeFolder(app.page, dir)
    await expect(rows(app.page)).toHaveText(['a.md', 'b.md'])
    await expect(editor(app.page)).toHaveText('note A') // the first note opens

    await row(app.page, 'b.md').click()
    await expect(editor(app.page)).toHaveText('note B')
    await editor(app.page).fill('note B, edited')
    await expect.poll(() => readFileSync(join(dir, 'b.md'), 'utf-8')).toBe('note B, edited')

    await app.page.getByRole('button', { name: '＋ 新規' }).click()
    await expect(app.page.locator('#title')).toHaveValue(/^Untitled-/) // the new note shows (as the user would see)
    await app.page.locator('#title').fill('買い物')
    await app.page.locator('#title').press('Enter')
    await expect(row(app.page, '買い物.md')).toBeVisible()
    expect(mdFiles(dir)).toEqual(['a.md', 'b.md', '買い物.md'])
    expect(readFileSync(join(dir, 'b.md'), 'utf-8')).toBe('note B, edited')
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('closing the window right after typing saves the last words first', async () => {
  const dir = tempDir('simpletter-close-')
  writeFileSync(join(dir, 'a.md'), 'note A')
  const app = await launch()
  let closed = false
  try {
    await typeFolder(app.page, dir)
    await expect(editor(app.page)).toHaveText('note A')
    await editor(app.page).fill('last words')
    const { killed } = await app.close() // at once: well within the 0.4 s the save waits for
    closed = true
    expect(killed).toBe(false) // the window still closes by itself
    expect(readFileSync(join(dir, 'a.md'), 'utf-8')).toBe('last words')
  } finally {
    await (closed ? Promise.resolve() : app.close()).finally(() => removeDir(dir))
  }
})

test('a file given on the command line (a double-click in Explorer) opens in its folder', async () => {
  const profile = tempDir('simpletter-e2e-profile-')
  const other = tempDir('simpletter-other-')
  const dir = tempDir('simpletter-open-')
  writeFileSync(join(other, 'elsewhere.md'), 'elsewhere')
  writeFileSync(join(dir, 'a.md'), '# A')
  writeFileSync(join(dir, '日本語 メモ.md'), 'opened from Explorer')
  writeFileSync(join(dir, 'log.txt'), 'a text file')
  let app = await launch(profile)
  try {
    await typeFolder(app.page, other) // a folder remembered from before
    await app.close()

    app = await launch(profile, [join(dir, '日本語 メモ.md')])
    await expect(editor(app.page)).toHaveText('opened from Explorer')
    await expect(app.page.locator('#title')).toHaveValue('日本語 メモ')
    await expect(app.page.getByRole('combobox', { name: 'フォルダのパス' })).toHaveValue(dir)
    await expect(rows(app.page)).toHaveText(['a.md', '日本語 メモ.md']) // the list shows the extension, the title doesn't
    await expect(app.page.locator('.file-row--active')).toHaveText('日本語 メモ.md')
    await app.close()

    // Not a note: opened and listed alongside the notes (like Brighterm's "Open in Notes").
    app = await launch(profile, [join(dir, 'log.txt')])
    await expect(editor(app.page)).toHaveText('a text file')
    await expect(app.page.locator('#content .cm-plain')).toBeVisible() // not a note: plain text
    await expect(rows(app.page)).toHaveText(['a.md', 'log.txt', '日本語 メモ.md'])
    await app.close()

    // A file that's gone: the error bar says so, the remembered folder stays.
    app = await launch(profile, [join(dir, 'missing.md')])
    await expect(app.page.getByRole('alert')).toContainText(`ファイルが見つかりません: ${join(dir, 'missing.md')}`)
    await expect(app.page.getByRole('combobox', { name: 'フォルダのパス' })).toHaveValue(dir)
  } finally {
    await app.close().finally(() => Promise.all([removeDir(profile), removeDir(other), removeDir(dir)]))
  }
})

test('live preview: markup shows only on the cursor line; checkboxes and lists work', async () => {
  const dir = tempDir('simpletter-preview-')
  const file = join(dir, 'lp.md')
  writeFileSync(file, '# Title\n\nSome **bold** text\n\n- [ ] milk\n- item\n')
  const app = await launch()
  try {
    await typeFolder(app.page, dir)
    const page = app.page
    await expect(editor(page)).toContainText('Some')
    await page.locator('#content .cm-line', { hasText: 'item' }).click()
    await page.keyboard.press('End')

    // Elsewhere: formatted, the markup hidden.
    const heading = page.locator('#content .cm-lp-h1')
    await expect(heading).toHaveText('Title')
    await expect(page.locator('#content .cm-lp-strong')).toHaveText('bold')
    await expect(page.locator('#content .cm-line', { hasText: 'Some' })).toHaveText('Some bold text')
    await expect(page.locator('#content .cm-lp-task')).toHaveCount(1)
    await expect(page.locator('#content .cm-line', { hasText: 'item' })).toHaveText('- item') // the cursor's line

    // Click into the heading: its "#" shows; the list's bullet turns into "•".
    await heading.click()
    await expect(heading).toHaveText('# Title')
    await expect(page.locator('#content .cm-line', { hasText: 'item' })).toHaveText('• item')

    // The checkbox ticks the task in the file.
    await page.locator('#content .cm-lp-task').click()
    await expect.poll(() => readFileSync(file, 'utf-8')).toContain('- [x] milk')

    // Enter at the end of a list item continues the list.
    await page.locator('#content .cm-line', { hasText: 'item' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('次の項目')
    await expect
      .poll(() => readFileSync(file, 'utf-8'))
      .toBe('# Title\n\nSome **bold** text\n\n- [x] milk\n- item\n- 次の項目\n')
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('live preview: tables are drawn; a click edits the source; arrow keys step in and out', async () => {
  const dir = tempDir('simpletter-table-')
  const file = join(dir, 't.md')
  const source = 'before\n\n| 左 | 中 | 右 |\n|:--|:-:|--:|\n| **太字** | b | 1 |\n| x | y | 22 |\n\nafter\n'
  writeFileSync(file, source)
  const app = await launch()
  try {
    const page = app.page
    const table = page.locator('#content .cm-lp-table')
    const line = (text: string) => page.locator('#content .cm-line', { hasText: text })
    await typeFolder(page, dir)
    await line('after').click()

    // Drawn as a table: header, alignment, formatting in cells.
    await expect(table.locator('th')).toHaveText(['左', '中', '右'])
    await expect(table.locator('td')).toHaveText(['太字', 'b', '1', 'x', 'y', '22'])
    await expect(table.locator('td .cm-lp-strong')).toHaveText('太字')
    await expect(table.locator('th').nth(1)).toHaveCSS('text-align', 'center')
    await expect(table.locator('th').nth(2)).toHaveCSS('text-align', 'right')

    // A click on a cell: the table turns back into its text, the cursor where clicked.
    const cell = table.locator('td', { hasText: /^x$/ })
    const box = (await cell.boundingBox())!
    await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2) // right of the "x"
    await expect(table).toHaveCount(0)
    await expect(line('| x | y | 22 |')).toBeVisible()
    await page.keyboard.type('!')
    await expect.poll(() => readFileSync(file, 'utf-8')).toBe(source.replace('| x |', '| x! |'))

    // Out of it: drawn again, with the edit.
    await line('after').click()
    await expect(table.locator('td').nth(3)).toHaveText('x!')

    // ↓ from the blank line above steps into the table's first line; ↑ back out draws it again.
    await line('before').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(table).toHaveCount(0)
    await page.keyboard.type('#')
    await expect.poll(() => readFileSync(file, 'utf-8')).toContain('#| 左 |')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('ArrowUp')
    await expect(table).toHaveCount(1)
    // ↑ from the blank line below: into its last line.
    await line('after').click()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(table).toHaveCount(0)
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect.poll(() => readFileSync(file, 'utf-8')).toContain('| x! | y | 22 |!\n')
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('lists: Tab goes 4 spaces in and numbers from 1; Enter twice comes back and counts on', async () => {
  const dir = tempDir('simpletter-lists-')
  const file = join(dir, 'l.md')
  writeFileSync(file, '1. a')
  const app = await launch()
  try {
    const page = app.page
    await typeFolder(page, dir)
    await page.locator('#content .cm-line', { hasText: 'a' }).click()
    await page.keyboard.press('End')
    for (const key of [
      'Enter',
      'b',
      'Enter',
      'Tab',
      'c',
      'Enter',
      'd',
      'Enter',
      'Enter',
      'e',
      'Enter',
      'Tab',
      'Shift+Tab'
    ]) {
      if (key.length === 1) await page.keyboard.type(key)
      else await page.keyboard.press(key)
    }
    await page.keyboard.type('f')
    await expect.poll(() => readFileSync(file, 'utf-8')).toBe('1. a\n2. b\n    1. c\n    2. d\n3. e\n4. f')
    await expect(editor(page)).toBeFocused()
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('CSV / TSV: listed and drawn as lined-up cells; a click types into the cell; Tab = a new cell', async () => {
  const dir = tempDir('simpletter-csv-')
  const file = join(dir, 'data.csv')
  // "bananabanana!" is the widest of its column (the first: no delimiter before it): it fills the cell exactly.
  const source = 'name,qty\n"りんご, 赤",3\nbananabanana!,12\n'
  writeFileSync(file, source)
  writeFileSync(join(dir, 'a.md'), 'note')
  writeFileSync(join(dir, 't.tsv'), 'x\ty')
  const app = await launch()
  try {
    const page = app.page
    await typeFolder(page, dir)
    await expect(rows(page)).toHaveText(['a.md', 'data.csv', 't.tsv'])
    await row(page, 'data.csv').click()
    await expect(page.locator('#content .cm-csv')).toBeVisible()
    const cells = page.locator('#content .cm-csv-cell')
    await expect(cells).toHaveCount(6)
    /** Where each row's second column starts (they line up) and how wide the first column is. */
    const layout = async () => {
      const boxes = await Promise.all([0, 1, 2, 3, 4, 5].map(async (i) => (await cells.nth(i).boundingBox())!))
      return {
        secondX: new Set([1, 3, 5].map((i) => Math.round(boxes[i].x))).size,
        firstW: new Set([0, 2, 4].map((i) => Math.round(boxes[i].width))).size
      }
    }
    expect(await layout()).toEqual({ secondX: 1, firstW: 1 })
    const heights = await page
      .locator('#content .cm-csv-row')
      .evaluateAll((rs) => rs.slice(0, 3).map((r) => r.getBoundingClientRect().height))
    expect(Math.max(...heights)).toBeLessThan(Math.min(...heights) * 1.5) // nothing wrapped onto a 2nd line
    await expect(cells.nth(2)).toHaveText('りんご, 赤') // the quotes are hidden
    await expect(cells.nth(3).locator('.cm-csv-sep')).toHaveText('') // the delimiter: there (its 1 ch), not seen

    // A click right of "3": the cursor goes after it; that row shows its quotes, the columns stay put.
    const qty = (await cells.nth(3).boundingBox())!
    await page.mouse.click(qty.x + qty.width - 4, qty.y + qty.height / 2)
    await page.keyboard.type('0')
    await expect.poll(() => readFileSync(file, 'utf-8')).toBe(source.replace(',3\n', ',30\n'))
    await expect(page.locator('#content .cm-csv-active')).toHaveCount(1)
    await expect(cells.nth(2)).toHaveText('"りんご, 赤"')
    await expect(cells.nth(3)).toHaveText(',30') // a cell = the delimiter before it + its field
    expect(await layout()).toEqual({ secondX: 1, firstW: 1 })

    // ↓: the next row, the same place in the same column (after "30" → after "12").
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('!')
    await expect.poll(() => readFileSync(file, 'utf-8')).toContain('\nbananabanana!,12!\n')

    // Tab in CSV: a comma — a new cell.
    await page.keyboard.press('Tab')
    await page.keyboard.type('x')
    await expect.poll(() => readFileSync(file, 'utf-8')).toContain('\nbananabanana!,12!,x\n')
    await expect(editor(page)).toBeFocused()

    // TSV: Tab types a tab — a new cell; the focus stays in the editor.
    await row(page, 't.tsv').click()
    await expect(cells).toHaveText(['x', 'y'])
    await cells.nth(1).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await page.keyboard.type('z')
    await expect.poll(() => readFileSync(join(dir, 't.tsv'), 'utf-8')).toBe('x\ty\tz')
    await expect(editor(page)).toBeFocused()
    await expect(cells).toHaveCount(3)
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('CSV: Japanese typed with the IME goes into the cell at the cursor; the row stays put while converting', async () => {
  // Was: text composed right after a "," landed in the ","'s span — the narrow cell before — wrapping a
  // character a line, and the IME showed its own window. (CDP's composition stands in for the IME.)
  const dir = tempDir('simpletter-csv-ime-')
  const file = join(dir, 'd.csv')
  writeFileSync(file, 'id,name,qty\n2,x,4\n5,,6\n')
  const app = await launch()
  try {
    const page = app.page
    await typeFolder(page, dir)
    await row(page, 'd.csv').click()
    const cdp = await page.context().newCDPSession(page)
    const line = (n: number) => page.locator('#content .cm-line').nth(n)
    /** Converts 「にほん」 to 「日本」 at the cursor; during it: the cell the text is in, where the row's cells start. */
    const compose = async (n: number) => {
      const lefts = () =>
        line(n)
          .locator('.cm-csv-cell')
          .evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().left)))
      const before = await lefts()
      for (const text of ['に', 'にほ', 'にほん']) {
        await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
      }
      const cell = await page.evaluate(
        () => getSelection()!.anchorNode!.parentElement!.closest('.cm-csv-cell')?.textContent ?? null
      )
      expect(await lefts()).toEqual(before)
      await cdp.send('Input.insertText', { text: '日本' })
      return cell
    }
    await line(1).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight') // 2,|x
    expect(await compose(1)).toBe(',にほんx')
    await page.keyboard.press('End')
    await page.keyboard.press('Tab') // a new, empty last cell
    expect(await compose(1)).toBe(',にほん')
    await line(2).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight') // 5,|,6
    expect(await compose(2)).toBe(',にほん')
    await expect.poll(() => readFileSync(file, 'utf-8')).toBe('id,name,qty\n2,日本x,4,日本\n5,日本,6\n')
    await expect(line(1).locator('.cm-csv-cell')).toHaveText(['2', '日本x', '4', '日本']) // not the cursor's row: no "," shown
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('the bar explains a wrong path and completes subfolders from the disk', async () => {
  const dir = tempDir('simpletter-bar-')
  mkdirSync(join(dir, 'Notebooks'))
  mkdirSync(join(dir, 'Music'))
  writeFileSync(join(dir, 'Notes.md'), '')
  const app = await launch()
  try {
    const bar = app.page.getByRole('combobox', { name: 'フォルダのパス' })
    await bar.click()
    await bar.fill(join(dir, 'missing'))
    await bar.press('Enter')
    await expect(app.page.getByRole('alert')).toHaveText(`フォルダが見つかりません: ${join(dir, 'missing')}`)
    await expect(app.page.locator('#picker-screen')).toBeVisible()

    await bar.fill(join(dir, 'no'))
    await bar.press('Tab')
    await expect(bar).toHaveValue(join(dir, 'Notebooks') + '\\')
    await bar.fill(dir + '\\')
    await expect(app.page.getByRole('option')).toHaveCount(2) // folders only, no Notes.md
    await bar.press('ArrowDown')
    await bar.press('Enter')
    await expect(bar).toHaveValue(join(dir, 'Music'))
    await expect(app.page.locator('#notes-screen')).toBeVisible()
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})

test('the folder and the sort order survive a restart', async () => {
  const profile = tempDir('simpletter-e2e-profile-')
  const dir = tempDir('simpletter-sort-')
  for (const [name, daysAgo] of [
    ['old', 3],
    ['new', 1],
    ['mid', 2]
  ] as const) {
    const file = join(dir, `${name}.md`)
    writeFileSync(file, name)
    const when = new Date(Date.now() - daysAgo * 86_400_000)
    utimesSync(file, when, when)
  }
  let app = await launch(profile)
  try {
    await typeFolder(app.page, dir)
    await expect(rows(app.page)).toHaveText(['mid.md', 'new.md', 'old.md'])
    await app.page.getByRole('combobox', { name: '並べ替え' }).selectOption({ label: '新しい順' })
    await expect(rows(app.page)).toHaveText(['new.md', 'mid.md', 'old.md'])
    await app.close()

    app = await launch(profile)
    await expect(rows(app.page)).toHaveText(['new.md', 'mid.md', 'old.md'])
    await expect(app.page.getByRole('combobox', { name: 'フォルダのパス' })).toHaveValue(dir)
    await expect(app.page.getByRole('combobox', { name: '並べ替え' })).toHaveValue('date-desc')
  } finally {
    await app.close().finally(() => Promise.all([removeDir(profile), removeDir(dir)]))
  }
})

test('menu: rename (case only too), refused names, delete asks first, copy path', async () => {
  const dir = tempDir('simpletter-menu-')
  writeFileSync(join(dir, 'note.md'), 'my note')
  writeFileSync(join(dir, 'other.md'), 'other note')
  const app = await launch()
  const menuItem = async (name: string, item: string) => {
    await row(app.page, name).click({ button: 'right' })
    await app.page.locator('.ctx-menu').getByRole('button', { name: item }).click()
  }
  const box = app.page.locator('.file-rename')
  const lastDialog = async () => (await dialogs(app.page)).at(-1)
  try {
    await stubDialogs(app.page)
    await typeFolder(app.page, dir)

    // Only the case changes (the same file on Windows): the note must survive.
    await menuItem('note.md', '名前の変更')
    await box.fill('Note')
    await box.press('Enter')
    await expect(row(app.page, 'Note.md')).toBeVisible()
    expect(mdFiles(dir)).toEqual(['Note.md', 'other.md'])
    expect(readFileSync(join(dir, 'Note.md'), 'utf-8')).toBe('my note')

    // Another note's name is refused.
    await menuItem('Note.md', '名前の変更')
    await box.fill('OTHER')
    await box.press('Enter')
    await expect.poll(lastDialog).toBe('同じ名前のファイルがあります: OTHER.md')
    expect(readFileSync(join(dir, 'other.md'), 'utf-8')).toBe('other note')

    // Copy path → the OS clipboard (through the Rust side).
    await menuItem('other.md', 'パスのコピー')
    const clipboard = () =>
      spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf-8' }).stdout.trim()
    await expect.poll(clipboard).toBe(join(dir, 'other.md'))

    // Delete asks first; cancel keeps the note.
    await menuItem('Note.md', '削除')
    await expect.poll(lastDialog).toBe('「Note.md」を削除しますか？')
    await app.page.waitForTimeout(300)
    expect(existsSync(join(dir, 'Note.md'))).toBe(true)
    await answerConfirm(app.page, true)
    await menuItem('Note.md', '削除')
    await expect(row(app.page, 'Note.md')).toHaveCount(0)
    expect(mdFiles(dir)).toEqual(['other.md'])
    await expect(app.page.getByRole('alert')).toHaveCount(0) // no uncaught errors
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})
