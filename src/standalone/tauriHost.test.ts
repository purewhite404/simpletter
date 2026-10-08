import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTauriHost } from './tauriHost'

// The Tauri side, faked: commands answer from `commands`, events go to whoever `listen`ed.
const commands: Record<string, (args: Record<string, unknown>) => unknown> = {}
let listeners: Record<string, (e: { payload: unknown }) => void> = {}
const unlistened: string[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    const command = commands[cmd]
    if (!command) throw new Error(`no command ${cmd}`)
    return command(args)
  }
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners[event] = handler
    return () => unlistened.push(event)
  }
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }))


const flush = () => new Promise((r) => setTimeout(r, 0))

/** Like the Rust `open_path`: "C:\dir\name" → the folder handle + the name. */
function openPath({ path }: Record<string, unknown>) {
  const p = String(path)
  const cut = p.lastIndexOf('\\')
  const dir = p.slice(0, cut)
  return { folder: { id: dir, label: dir.slice(dir.lastIndexOf('\\') + 1) }, name: p.slice(cut + 1) }
}

describe('onOpenFile (double-clicked files)', () => {
  beforeEach(() => {
    listeners = {}
    unlistened.length = 0
    commands.open_path = openPath
  })

  it('opens the file the app was started with, once', async () => {
    let initial: string | null = 'C:\\notes\\メモ.md'
    commands.initial_file = () => {
      const path = initial
      initial = null
      return path
    }
    const opened: unknown[] = []
    createTauriHost().host.onOpenFile((f) => opened.push(f))
    await flush()
    expect(opened).toEqual([{ folder: { id: 'C:\\notes', label: 'notes' }, name: 'メモ.md' }])
  })

  it('nothing to open when started plainly', async () => {
    commands.initial_file = () => null
    const cb = vi.fn()
    createTauriHost().host.onOpenFile(cb)
    await flush()
    expect(cb).not.toHaveBeenCalled()
  })

  it('opens what later launches hand over, until unsubscribed', async () => {
    commands.initial_file = () => null
    const opened: string[] = []
    const stop = createTauriHost().host.onOpenFile((f) => opened.push(`${f.folder.id}|${f.name}`))
    await flush()
    listeners['open-file']({ payload: 'D:\\a\\b.md' })
    await flush()
    expect(opened).toEqual(['D:\\a|b.md'])
    stop()
    await flush()
    expect(unlistened).toEqual(['open-file'])
  })
})
