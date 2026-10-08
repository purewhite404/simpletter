import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { answerConfirm, dialogs, launch, removeDir, row, rows, stubDialogs, tempDir, typeFolder } from './helpers'

const mdFiles = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.md')).sort()

test('a folder typed into the bar lists its notes; typing saves to disk', async () => {
  const dir = tempDir('simpletter-notes-')
  writeFileSync(join(dir, 'b.md'), 'note B')
  writeFileSync(join(dir, 'a.md'), '# A')
  writeFileSync(join(dir, 'skip.txt'), 'not a note')
  const app = await launch()
  try {
    await expect(app.page.locator('#picker-screen')).toBeVisible()
    await typeFolder(app.page, dir)
    await expect(rows(app.page)).toHaveText(['a', 'b'])
    await expect(app.page.locator('#content')).toHaveValue('# A') // the first note opens

    await row(app.page, 'b').click()
    await expect(app.page.locator('#content')).toHaveValue('note B')
    await app.page.locator('#content').fill('note B, edited')
    await expect.poll(() => readFileSync(join(dir, 'b.md'), 'utf-8')).toBe('note B, edited')

    await app.page.getByRole('button', { name: '＋ 新規' }).click()
    await app.page.locator('#title').fill('買い物')
    await app.page.locator('#title').press('Enter')
    await expect(row(app.page, '買い物')).toBeVisible()
    expect(mdFiles(dir)).toEqual(['a.md', 'b.md', '買い物.md'])
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
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
    await expect(app.page.locator('#content')).toHaveValue('opened from Explorer')
    await expect(app.page.locator('#title')).toHaveValue('日本語 メモ')
    await expect(app.page.getByRole('combobox', { name: 'フォルダのパス' })).toHaveValue(dir)
    await expect(rows(app.page)).toHaveText(['a', '日本語 メモ'])
    await expect(app.page.locator('.file-row--active')).toHaveText('日本語 メモ')
    await app.close()

    // Not a note: opened and listed alongside the notes (like Brighterm's "Open in Notes").
    app = await launch(profile, [join(dir, 'log.txt')])
    await expect(app.page.locator('#content')).toHaveValue('a text file')
    await expect(rows(app.page)).toHaveText(['a', 'log.txt', '日本語 メモ'])
    await app.close()

    // A file that's gone: the error bar says so, the remembered folder stays.
    app = await launch(profile, [join(dir, 'missing.md')])
    await expect(app.page.getByRole('alert')).toContainText(`ファイルが見つかりません: ${join(dir, 'missing.md')}`)
    await expect(app.page.getByRole('combobox', { name: 'フォルダのパス' })).toHaveValue(dir)
  } finally {
    await app.close().finally(() => Promise.all([removeDir(profile), removeDir(other), removeDir(dir)]))
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
  for (const [name, daysAgo] of [['old', 3], ['new', 1], ['mid', 2]] as const) {
    const file = join(dir, `${name}.md`)
    writeFileSync(file, name)
    const when = new Date(Date.now() - daysAgo * 86_400_000)
    utimesSync(file, when, when)
  }
  let app = await launch(profile)
  try {
    await typeFolder(app.page, dir)
    await expect(rows(app.page)).toHaveText(['mid', 'new', 'old'])
    await app.page.getByRole('combobox', { name: '並べ替え' }).selectOption({ label: '新しい順' })
    await expect(rows(app.page)).toHaveText(['new', 'mid', 'old'])
    await app.close()

    app = await launch(profile)
    await expect(rows(app.page)).toHaveText(['new', 'mid', 'old'])
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
    await menuItem('note', '名前の変更')
    await box.fill('Note')
    await box.press('Enter')
    await expect(row(app.page, 'Note')).toBeVisible()
    expect(mdFiles(dir)).toEqual(['Note.md', 'other.md'])
    expect(readFileSync(join(dir, 'Note.md'), 'utf-8')).toBe('my note')

    // Another note's name is refused.
    await menuItem('Note', '名前の変更')
    await box.fill('OTHER')
    await box.press('Enter')
    await expect.poll(lastDialog).toBe('同じ名前のファイルがあります: OTHER.md')
    expect(readFileSync(join(dir, 'other.md'), 'utf-8')).toBe('other note')

    // Copy path → the OS clipboard (through the Rust side).
    await menuItem('other', 'パスのコピー')
    const clipboard = () =>
      spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf-8' }).stdout.trim()
    await expect.poll(clipboard).toBe(join(dir, 'other.md'))

    // Delete asks first; cancel keeps the note.
    await menuItem('Note', '削除')
    await expect.poll(lastDialog).toBe('「Note」を削除しますか？')
    await app.page.waitForTimeout(300)
    expect(existsSync(join(dir, 'Note.md'))).toBe(true)
    await answerConfirm(app.page, true)
    await menuItem('Note', '削除')
    await expect(row(app.page, 'Note')).toHaveCount(0)
    expect(mdFiles(dir)).toEqual(['other.md'])
    await expect(app.page.getByRole('alert')).toHaveCount(0) // no uncaught errors
    expect(app.pageErrors).toEqual([])
  } finally {
    await app.close().finally(() => removeDir(dir))
  }
})
