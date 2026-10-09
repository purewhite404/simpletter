import { chromium, expect, type Browser, type Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Drives the real simpletter.exe (a debug build: `npm run test:e2e` builds it) over
 * the Chrome DevTools Protocol of its WebView2. Each launch gets its own WebView2
 * profile and port, and its window shows off screen, without the focus or a taskbar button
 * (src-tauri/src/lib.rs, test_mode / show_off_screen) — the user keeps working while tests run,
 * and no test window comes up over theirs.
 */

const EXE = resolve('src-tauri/target/debug/simpletter.exe')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function tempDir(prefix = 'simpletter-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** WebView2's processes keep writing the profile for a few seconds after the app quits: retry up to 15 s. */
export async function removeDir(dir: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      if (i >= 75) throw err
      await sleep(200)
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => done(port))
    })
  })
}

export interface App {
  page: Page
  pageErrors: string[]
  /** Quits like the window's × (settings are flushed), then cleans up. `killed`: it didn't quit in 5 s. */
  close(): Promise<{ killed: boolean }>
}

/**
 * Starts the app; `dataDir` = reuse a profile (a restart), else a fresh one removed on close.
 * `args` = its command line (a file path = what Explorer passes for a double-clicked file).
 */
export async function launch(dataDir?: string, args: string[] = []): Promise<App> {
  const profile = dataDir ?? tempDir('simpletter-e2e-profile-')
  const port = await freePort()
  const proc = spawn(EXE, args, {
    env: { ...process.env, SIMPLETTER_TEST_DATA_DIR: profile, SIMPLETTER_TEST_CDP_PORT: String(port) },
    stdio: 'ignore'
  })
  const exited = new Promise<void>((r) => proc.once('exit', () => r()))

  let browser: Browser | null = null
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await sleep(100)
    }
  }
  if (!browser) {
    proc.kill()
    throw new Error(`simpletter didn't open its DevTools port (${EXE} built? npm run test:e2e builds it)`)
  }
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await expect(page.locator('#app')).toBeAttached({ timeout: 10_000 })

  return {
    page,
    pageErrors,
    async close() {
      await browser.close().catch(() => {})
      // taskkill without /F = WM_CLOSE, like clicking ×: WebView2 writes localStorage out.
      spawnSync('taskkill', ['/PID', String(proc.pid)], { stdio: 'ignore' })
      const timedOut = await Promise.race([exited.then(() => false), sleep(5000).then(() => true)])
      if (timedOut) proc.kill()
      if (!dataDir) await removeDir(profile)
      return { killed: timedOut }
    }
  }
}

/** Types a folder into the folder bar and presses Enter. */
export async function typeFolder(page: Page, path: string): Promise<void> {
  const bar = page.getByRole('combobox', { name: 'フォルダのパス' })
  await bar.click()
  await bar.fill(path)
  await bar.press('Enter')
  await expect(page.locator('#notes-screen')).toBeVisible()
  await expect(bar).toHaveValue(path)
}

/**
 * alert / confirm become native Windows dialogs in the app (Tauri's dialog plugin makes them
 * async), which CDP can't see or click — and an off-screen window's dialog must not pop up on the
 * user's screen. Tests swap them for async stand-ins: `dialogs(page)` = the messages so far,
 * `answerConfirm(page, true)` = OK from now on (default: cancel).
 */
export async function stubDialogs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __dialogs: string[]; __confirm: boolean }
    w.__dialogs = []
    w.__confirm = false
    window.alert = (m?: unknown) => void w.__dialogs.push(String(m))
    ;(window as unknown as { confirm: (m: string) => Promise<boolean> }).confirm = async (m: string) => {
      w.__dialogs.push(String(m))
      return w.__confirm
    }
  })
}
export const dialogs = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __dialogs: string[] }).__dialogs)
export const answerConfirm = (page: Page, ok: boolean): Promise<void> =>
  page.evaluate((v) => void ((window as unknown as { __confirm: boolean }).__confirm = v), ok)

/** The note's text area (CodeMirror's contenteditable). */
export const editor = (page: Page) => page.locator('#content .cm-content')

export const rows = (page: Page) => page.locator('.file-row')
/** The list row of file `name` (the full name: the list shows the extension). */
export const row = (page: Page, name: string) =>
  page.locator('.file-row', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
