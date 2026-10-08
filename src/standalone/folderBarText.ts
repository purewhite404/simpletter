/** The last name of a path, as a completion shows it ("C:\Users\a\Notes\" → "Notes", "D:\" → "D:\"). */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const name = trimmed.split(/[\\/]/).pop() ?? ''
  if (!name || /^[a-zA-Z]:$/.test(name)) return path
  return name
}

/** For comparing paths as typed: one separator style, and no case where the OS ignores it. */
const comparable = (path: string, caseInsensitive: boolean): string => {
  const unified = path.replace(/\\/g, '/')
  return caseInsensitive ? unified.toLowerCase() : unified
}

/** What follows the last separator — the name being typed. */
const lastName = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/**
 * The completions still valid for what's typed now. Right after a keystroke
 * the list is the one for the previous input: anything that doesn't start with
 * the new input has to go at once, or Tab/Enter would take it ("Q" + Tab gave
 * the first folder of the old list).
 */
export function stillMatching(candidates: string[], typed: string, caseInsensitive: boolean): string[] {
  const start = comparable(typed, caseInsensitive)
  return candidates.filter((c) => comparable(c, caseInsensitive).startsWith(start))
}

/**
 * What Tab turns the input into, given the completions for it: the only one;
 * else what they all start with, if that's more than what's typed (like a
 * shell); else the first (like Explorer). Null when there's nothing to complete.
 */
export function tabCompletion(typed: string, candidates: string[], caseInsensitive: boolean): string | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const [first, ...rest] = candidates
  let length = first.length
  for (const other of rest) {
    const a = comparable(first, caseInsensitive)
    const b = comparable(other, caseInsensitive)
    let i = 0
    while (i < length && i < b.length && a[i] === b[i]) i++
    length = i
  }
  const common = first.slice(0, length)
  return lastName(common).length > lastName(typed).length ? common : first
}
