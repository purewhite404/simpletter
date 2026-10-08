// simpletter: the folder bar on top, the notes UI (src/core, shared with
// Brighterm's Notes plugin) under it, files through Tauri.

import './standalone/tokens.css'
import './core/notes.css'
import './standalone/standalone.css'
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

void startNotes(document.getElementById('notes-root')!, host)
