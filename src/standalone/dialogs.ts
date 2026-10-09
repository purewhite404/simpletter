// alert / confirm as native dialogs. The core calls the plain window.alert / window.confirm (Brighterm's
// are the browser's); here they become the dialog plugin's, async — the core awaits confirm().
//
// Not the plugin's own stand-ins (its init script replaces both at page load): since tauri-plugin-dialog
// 2.7 its window.confirm still invokes `plugin:dialog|confirm`, a command the plugin no longer has —
// "Command plugin:dialog|confirm not allowed by ACL", whatever the capability says. The JS API's
// confirm() goes through `plugin:dialog|message` (permission `dialog:allow-message`).

import { confirm, message } from '@tauri-apps/plugin-dialog'

const title = 'simpletter'

export function installDialogs(): void {
  window.alert = (text?: unknown) => void message(String(text), { title })
  ;(window as unknown as { confirm: (text?: unknown) => Promise<boolean> }).confirm = (text) =>
    confirm(String(text), { title, kind: 'warning' })
}
