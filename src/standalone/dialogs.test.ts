// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDialogs } from './dialogs'

// The dialog plugin's JS API, faked: what it was called with, and the answer the user "clicks".
const calls: { fn: string; text: string; options: unknown }[] = []
let answer = false
let clicked = 'Ok'
vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: async (text: string, options: unknown) => (calls.push({ fn: 'confirm', text, options }), answer),
  message: async (text: string, options: unknown) => (calls.push({ fn: 'message', text, options }), clicked)
}))

describe('installDialogs', () => {
  const original = { alert: window.alert, confirm: window.confirm }
  beforeEach(() => {
    calls.length = 0
    installDialogs()
  })
  afterEach(() => {
    Object.assign(window, original)
    delete window.askSave
  })

  it("confirm() goes through the plugin's JS confirm (the `message` command) and resolves to the answer", async () => {
    const ask = window.confirm as unknown as (text: string) => Promise<boolean>
    answer = true
    expect(await ask('「a.md」を削除しますか？')).toBe(true)
    answer = false
    expect(await ask('again?')).toBe(false)
    expect(calls).toEqual([
      { fn: 'confirm', text: '「a.md」を削除しますか？', options: { title: 'simpletter', kind: 'warning' } },
      { fn: 'confirm', text: 'again?', options: { title: 'simpletter', kind: 'warning' } }
    ])
  })

  it("askSave(): save / don't save / cancel buttons; the label clicked → the answer, Esc = cancel", async () => {
    const results = []
    for (const label of ['保存', '保存しない', 'キャンセル', 'Cancel']) {
      clicked = label
      results.push(await window.askSave!('「a.md」への変更を保存しますか？'))
    }
    clicked = 'Ok'
    expect(results).toEqual(['save', 'discard', 'cancel', 'cancel'])
    expect(calls[0]).toEqual({
      fn: 'message',
      text: '「a.md」への変更を保存しますか？',
      options: {
        title: 'simpletter',
        kind: 'warning',
        buttons: { yes: '保存', no: '保存しない', cancel: 'キャンセル' }
      }
    })
  })

  it("alert() shows the plugin's message", () => {
    window.alert('同じ名前のファイルがあります: a.md')
    expect(calls).toEqual([
      { fn: 'message', text: '同じ名前のファイルがあります: a.md', options: { title: 'simpletter' } }
    ])
  })
})
