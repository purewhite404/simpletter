/** A bar under the folder bar with the last error nobody caught; × closes it. */
export function showError(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason)
  let bar = document.getElementById('error-bar')
  if (!bar) {
    bar = document.createElement('div')
    bar.id = 'error-bar'
    bar.setAttribute('role', 'alert')
    const text = document.createElement('span')
    const close = document.createElement('button')
    close.textContent = '×'
    close.title = '閉じる'
    close.setAttribute('aria-label', '閉じる')
    close.addEventListener('click', () => bar?.remove())
    bar.append(text, close)
    document.getElementById('notes-root')?.before(bar)
  }
  bar.querySelector('span')!.textContent = message
}
