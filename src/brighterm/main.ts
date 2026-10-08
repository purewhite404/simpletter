// Entry of the Brighterm plugin build (npm run build:brighterm → dist-brighterm/):
// the same notes UI, with Brighterm's Host API as its host. Brighterm draws the
// folder bar itself and serves tokens.css (see static/index.html).

import '../core/notes.css'
import type { NotesHost } from '../core/host'
import { startNotes } from '../core/notes'

declare global {
  interface Window {
    brighterm: NotesHost
  }
}

void startNotes(document.getElementById('notes-root')!, window.brighterm)
