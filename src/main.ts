// simpletter: the folder bar on top, the notes UI (src/core, shared with
// Brighterm's Notes plugin) under it, files through Tauri.

import './standalone/tokens.css'
import './core/notes.css'
import './standalone/standalone.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { startNotes } from './core/notes'
import { FolderBar } from './standalone/folderBar'
import { createTauriHost, pickFolder, suggestFolders } from './standalone/tauriHost'
import { showError } from './standalone/errorBar'

const { host, attachFolderBar, changeFolder } = createTauriHost()

const bar = new FolderBar({
  suggest: suggestFolders,
  submit: changeFolder,
  browse: async () => {
    const picked = await pickFolder()
    if (picked) await changeFolder(picked)
  }
})
document.body.prepend(bar.element)
attachFolderBar(bar)

// Errors nobody caught (a save that failed, a folder that vanished…) — Brighterm shows them in the tile's error bar.
window.addEventListener('unhandledrejection', (e) => showError(e.reason))
window.addEventListener('error', (e) => showError(e.error ?? e.message))

const notes = startNotes(document.getElementById('notes-root')!, host)

// Closing the window: what was typed in the last moment (the save waits 0.4 s for typing to stop) is saved
// first. If that fails, the window stays open unless the user says otherwise — the text is still on screen.
void getCurrentWindow().onCloseRequested(async (event) => {
  try {
    await (await notes).flush()
  } catch (err) {
    showError(err)
    if (
      !(await confirm(
        `保存できませんでした。保存せずに閉じますか？\n\n${err instanceof Error ? err.message : String(err)}`
      ))
    ) {
      event.preventDefault()
    }
  }
})
