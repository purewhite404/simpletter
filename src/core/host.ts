/**
 * What the notes UI needs from whoever runs it — the subset of Brighterm's
 * Host API (`window.brighterm`, see brighterm/packages/sdk/host-api.d.ts) that
 * Notes uses. Keeping exactly that shape is what lets the same UI run as:
 *  - the simpletter app: src/standalone/tauriHost.ts (Tauri commands);
 *  - Brighterm's Notes plugin: src/brighterm/main.ts passes `window.brighterm`.
 */

export interface FolderHandle {
  /** Opaque to the UI (Brighterm: a grant id; simpletter: the folder's path). */
  id: string
  label: string
}

export interface FileEntry {
  name: string
  isDirectory: boolean
  /** ms since 1970, 0 if unknown. */
  modifiedAt: number
}

export interface NotesHost {
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  fs: {
    /** Shows the folder bar above the notes with this folder (null = empty, asking for one). */
    showFolderBar(handle: FolderHandle | null): Promise<void>
    /** The user switched folders in the folder bar. Returns an unsubscribe function. */
    onFolderBarChange(cb: (folder: FolderHandle) => void): () => void
    listFiles(handle: FolderHandle): Promise<FileEntry[]>
    readFile(handle: FolderHandle, name: string): Promise<string>
    writeFile(handle: FolderHandle, name: string, content: string): Promise<void>
    deleteFile(handle: FolderHandle, name: string): Promise<void>
    copyPath(handle: FolderHandle, name: string): Promise<void>
  }
  /** "Open this file" from outside (Brighterm's Files tile). Returns an unsubscribe function. */
  onOpenFile(cb: (file: { folder: FolderHandle; name: string }) => void): () => void
}
