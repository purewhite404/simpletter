// The app's version lives in five files; this keeps them the same.
//
//   node scripts/version.mjs                  → prints the version (fails if the files disagree)
//   node scripts/version.mjs patch|minor|major → bumps it (0.2.0 → 0.2.1 / 0.3.0 / 1.0.0)
//   node scripts/version.mjs 1.2.3             → sets it
//
// Only the version lines are rewritten (no re-formatting). Committing and tagging are left to git.
// Not Brighterm's plugin manifest (src/brighterm/static/manifest.json): that one counts on its own.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Each file: the pattern of its version line (group 1 = before the number, 2 = the number). */
const FILES = [
  ['package.json', /^(  "version": ")(\d+\.\d+\.\d+)"/m],
  // The root's version, then packages[""]'s — the first two in the file.
  ['package-lock.json', /^(  "version": ")(\d+\.\d+\.\d+)"/m],
  ['package-lock.json', /^(  "packages": \{\n    "": \{\n      "name": "simpletter",\n      "version": ")(\d+\.\d+\.\d+)"/m],
  ['src-tauri/tauri.conf.json', /^(  "version": ")(\d+\.\d+\.\d+)"/m],
  ['src-tauri/Cargo.toml', /^(\[package\]\nname = "simpletter"\nversion = ")(\d+\.\d+\.\d+)"/m],
  ['src-tauri/Cargo.lock', /^(\[\[package\]\]\nname = "simpletter"\nversion = ")(\d+\.\d+\.\d+)"/m]
]

const read = (file) => readFileSync(join(root, file), 'utf-8').replace(/\r\n/g, '\n')

function current() {
  const found = FILES.map(([file, re]) => {
    const m = re.exec(read(file))
    if (!m) throw new Error(`${file}: バージョンの行が見つかりません`)
    return [file, m[2]]
  })
  const versions = new Set(found.map(([, v]) => v))
  if (versions.size > 1) throw new Error('バージョンがそろっていません:\n' + found.map(([f, v]) => `  ${f}: ${v}`).join('\n'))
  return found[0][1]
}

function next(version, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how
  const [a, b, c] = version.split('.').map(Number)
  if (how === 'patch') return `${a}.${b}.${c + 1}`
  if (how === 'minor') return `${a}.${b + 1}.0`
  if (how === 'major') return `${a + 1}.0.0`
  throw new Error(`patch / minor / major か x.y.z を指定してください: ${how}`)
}

try {
  const version = current()
  const how = process.argv[2]
  if (!how) {
    console.log(version)
  } else {
    const to = next(version, how)
    for (const file of new Set(FILES.map(([f]) => f))) {
      let text = readFileSync(join(root, file), 'utf-8')
      const crlf = text.includes('\r\n')
      text = text.replace(/\r\n/g, '\n')
      for (const [f, re] of FILES) if (f === file) text = text.replace(re, `$1${to}"`)
      writeFileSync(join(root, file), crlf ? text.replace(/\n/g, '\r\n') : text)
    }
    if (current() !== to) throw new Error('書き換えに失敗しました')
    console.log(`${version} → ${to}`)
  }
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
