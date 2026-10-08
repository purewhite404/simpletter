import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { FileEntry, FolderHandle, NotesHost } from '../core/host'
import type { FolderBar } from './folderBar'

/**
 * The notes UI's host in the simpletter app: files through the Rust commands
 * (src-tauri/src/lib.rs), settings in localStorage, and the folder bar drawn
 * by this window. A folder handle's id is the folder's absolute path.
 */
export function createTauriHost(): { host: NotesHost; attachFolderBar: (bar: FolderBar) => void; changeFolder: (input: string) => Promise<void> } {
  const folderListeners = new Set<(folder: FolderHandle) => void>()
  let bar: FolderBar | null = null

  /** A typed / picked path → a checked folder handle → the notes UI switches to it. */
  async function changeFolder(input: string): Promise<void> {
    const handle = await invoke<FolderHandle>('open_folder', { input })
    for (const cb of folderListeners) cb(handle)
  }

  const host: NotesHost = {
    storage: {
      async get<T>(key: string): Promise<T | null> {
        const raw = localStorage.getItem(key)
        if (raw === null) return null
        try {
          return JSON.parse(raw) as T
        } catch {
          return null
        }
      },
      async set(key, value) {
        localStorage.setItem(key, JSON.stringify(value))
      }
    },
    fs: {
      async showFolderBar(handle) {
        bar?.setPath(handle ? handle.id : '')
        if (!handle) bar?.focus()
      },
      onFolderBarChange(cb) {
        folderListeners.add(cb)
        return () => folderListeners.delete(cb)
      },
      listFiles: (handle) => invoke<FileEntry[]>('list_files', { dir: handle.id }),
      readFile: (handle, name) => invoke<string>('read_file', { dir: handle.id, name }),
      writeFile: (handle, name, content) => invoke('write_file', { dir: handle.id, name, content }),
      deleteFile: (handle, name) => invoke('delete_file', { dir: handle.id, name }),
      copyPath: (handle, name) => invoke('copy_path', { dir: handle.id, name })
    },
    // Nothing opens files from outside yet (file associations would).
    onOpenFile: () => () => {}
  }

  return {
    host,
    attachFolderBar: (folderBar) => {
      bar = folderBar
    },
    changeFolder
  }
}

/** Completions for the folder bar. */
export const suggestFolders = (input: string): Promise<string[]> => invoke<string[]>('suggest_folders', { input })

/** The native folder picker; null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: 'メモのフォルダを選ぶ' })
  return typeof picked === 'string' ? picked : null
}
