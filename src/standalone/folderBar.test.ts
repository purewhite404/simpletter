// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderBar } from './folderBar'

const FOLDERS = ['/home/me/', '/home/me/Notes/', '/home/me/Notebooks/', '/home/me/Music/']

/** Fake completions: every known folder that starts with what's typed. */
const suggest = async (input: string) => FOLDERS.filter((f) => f.startsWith(input))

let submitted: string[]
let bar: FolderBar
let input: HTMLInputElement

function key(k: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}
function type(value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input'))
}
const options = () => [...bar.element.querySelectorAll('li')].map((li) => li.querySelector('.folderbar-option-path')!.textContent)
const error = () => bar.element.querySelector<HTMLElement>('.folderbar-error')!

beforeEach(() => {
  document.body.innerHTML = ''
  submitted = []
  bar = new FolderBar({
    suggest,
    submit: async (path) => {
      if (!FOLDERS.includes(path.endsWith('/') ? path : path + '/')) throw new Error(`フォルダが見つかりません: ${path}`)
      submitted.push(path)
      bar.setPath(path)
    },
    browse: async () => {}
  })
  document.body.append(bar.element)
  input = bar.element.querySelector('input')!
  bar.setPath('/home/me/Notes')
})

describe('FolderBar', () => {
  it('shows the current folder; Esc after editing puts it back', () => {
    expect(input.value).toBe('/home/me/Notes')
    input.focus()
    type('/tmp/x')
    key('Escape')
    expect(input.value).toBe('/home/me/Notes')
    expect(document.activeElement).not.toBe(input)
  })

  it('Tab completes what all completions share, then the only one', async () => {
    input.focus()
    type('/home/me/N')
    key('Tab')
    await vi.waitFor(() => expect(input.value).toBe('/home/me/Note'))
    expect(document.activeElement).toBe(input) // Tab stays in the bar
    type('/home/me/Noteb')
    key('Tab')
    await vi.waitFor(() => expect(input.value).toBe('/home/me/Notebooks/'))
  })

  it('lists completions while typing; ↓ + Enter switches to one', async () => {
    input.focus()
    type('/home/me/M')
    await vi.waitFor(() => expect(options()).toEqual(['/home/me/Music/']))
    key('ArrowDown')
    key('Enter')
    await vi.waitFor(() => expect(submitted).toEqual(['/home/me/Music/']))
    expect(options()).toEqual([])
  })

  it('a wrong path is explained, stays typed and keeps the focus', async () => {
    input.focus()
    type('/nowhere')
    key('Enter')
    await vi.waitFor(() => expect(error().hidden).toBe(false))
    expect(error().textContent).toBe('フォルダが見つかりません: /nowhere')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.value).toBe('/nowhere')
    expect(document.activeElement).toBe(input)
    expect(submitted).toEqual([])
    // Typing again clears the message.
    type('/home')
    expect(error().hidden).toBe(true)
  })
})
