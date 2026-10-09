// alert / confirm as native dialogs. The core calls the plain window.alert / window.confirm (Brighterm's
// are the browser's); here they become the dialog plugin's, async — the core awaits confirm().
//
// Not the plugin's own stand-ins (its init script replaces both at page load): since tauri-plugin-dialog
// 2.7 its window.confirm still invokes `plugin:dialog|confirm`, a command the plugin no longer has —
// "Command plugin:dialog|confirm not allowed by ACL", whatever the capability says. The JS API's
// confirm() goes through `plugin:dialog|message` (permission `dialog:allow-message`).
//
// window.askSave (manual save, leaving a file with unsaved changes): save / don't save / cancel, a message
// dialog with custom buttons — it answers with the label clicked (Esc / × = "Cancel").

import { confirm, message } from '@tauri-apps/plugin-dialog'
import type { SaveAnswer } from '../core/notes'

const title = 'simpletter'
const SAVE = '保存'
const DISCARD = '保存しない'

export function installDialogs(): void {
  window.alert = (text?: unknown) => void message(String(text), { title })
  ;(window as unknown as { confirm: (text?: unknown) => Promise<boolean> }).confirm = (text) =>
    confirm(String(text), { title, kind: 'warning' })
  window.askSave = async (text): Promise<SaveAnswer> => {
    const answer = await message(text, {
      title,
      kind: 'warning',
      buttons: { yes: SAVE, no: DISCARD, cancel: 'キャンセル' }
    })
    return answer === SAVE ? 'save' : answer === DISCARD ? 'discard' : 'cancel'
  }
}
