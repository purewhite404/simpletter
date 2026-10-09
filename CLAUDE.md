# simpletter — notes for Claude

A small markdown notebook (Tauri 2, Windows): a folder of `.md` files, listed / edited /
renamed. Split out of Brighterm (`../brighterm`, its `plugins-builtin/notes/`) on 2026-10-08
because the user edits lots of one-off `.md` files and wanted something light. **Notes is
developed here from now on**; Brighterm's copy stays as it was until the user decides how to
bring it back (`npm run build:brighterm`). User-facing docs: `README.md` (Japanese).
Talk to the user in Japanese.

## Commands

| | |
|---|---|
| `npm run tauri dev` | the app, Vite dev server + Rust debug build (the user runs it from PowerShell) |
| `npm run typecheck` | `tsconfig.json` (src) + `tsconfig.node.json` (tests, configs) |
| `npm test` | Vitest: pure helpers + the whole notes UI over a fake host (happy-dom) |
| `npm run test:rust` | `cargo test` of `src-tauri` (folder input, file access) |
| `npm run test:e2e` | debug build, then Playwright drives the real exe over CDP (~10 s) |
| `npm run build:brighterm` | the UI as Brighterm's Notes plugin → `dist-brighterm/` |
| `npm run tauri build` | release + NSIS installer |

What to run: logic → typecheck + unit (+ rust if `src-tauri` changed); UI → also e2e;
before a commit → all of them.

### From WSL

Same rules as Brighterm: `node_modules` and `target/` are **Windows** builds. Run everything
through `cmd.exe /c "…"`, never `npm i` from WSL, use Windows git. Shells started before Rust
was installed (2026-10-08) lack cargo on PATH: `cmd.exe /c "set PATH=%USERPROFILE%\.cargo\bin;%PATH% && …"`.
Temp dirs / screenshots: Windows `%TEMP%` (from WSL: `cmd.exe /c echo %TEMP%`, then `wslpath`).

## Architecture

- **`src/core/`** — the notes UI, ported from Brighterm's `main.js`, behaviour unchanged. It talks
  only to a `NotesHost` (`host.ts`) = the subset of Brighterm's `window.brighterm` Host API that
  Notes uses, **same shape**. Keep it that way: it's what lets the same code be Brighterm's plugin.
  `names.ts` = pure naming/sorting helpers; `markup.ts` = the HTML (was `index.html`).
  `editor.ts` = the text editor (CodeMirror 6) in `#content`: `.md` → `markdownLanguage` (GFM) + live
  preview + list continuation (`insertNewlineContinueMarkup`), anything else → plain mono text. Opening a
  file = `view.setState` (fresh undo history, no change event → no save). Import `markdownLanguage`, never
  `markdown()`: that one drags lang-html/js/css into the bundle.
  `lists.ts` = list keys (tested in `lists.test.ts`, cursor `‸`): Tab / Shift+Tab move an item **with its
  sub-items** `LIST_INDENT` (4) spaces (also the markdown `indentUnit`), then `renumber` the ordered lists in
  the new state's tree (one transaction: `moved.compose(numbers)`): the list the item is in, its ancestors,
  lists under it; a sub-list started by a moved item or under one counts from 1, others from their first
  number. No-op (key eaten) for a first item (4 spaces would make code) / a top-level item out; non-items
  fall through to `indentWithTab`. Enter = lang-markdown with `nonTightLists: false` (else Enter on an empty
  2nd item inserts a blank line instead of stepping out); stepping out already numbers parent + 1.
  `livePreview.ts` = Obsidian-style live preview: a **StateField** (not a ViewPlugin) whose decorations are a
  pure function `previewDecorations(state)` of tree + selection + focus — unit-tested with an EditorState
  alone. Block marks (`#`, `>`, bullets, fences, `---`) show on the cursor's lines, inline marks (`**`,
  `` ` ``, `[](url)`, `\`) while the selection touches the element (ends inclusive); unfocused = all hidden.
  Hidden fences get `cm-lp-fence` (low line). Checkbox = widget with `ignoreEvent() false` + a `mousedown`
  handler that flips `[ ]`/`[x]`.
  **Tables** (top level only): off the cursor's lines the whole table (full lines) is one `block: true`
  replace with `TableWidget` (a StateField may provide block decorations; a ViewPlugin may not). Its data =
  `tableModel(state, node)` (pure, tested): cells split at the row's `TableDelimiter` pipes (empty cells have
  no `TableCell` node), alignment from the delimiter row, cell text as `parts` with offsets **relative to the
  table's first line** — so `eq` compares only the source text and an edit above doesn't redraw it. A click:
  `posAtDOM(wrap)` + the part's offset via `caretRangeFromPoint` (fallback: after the cell's last shown char);
  `view.focus()` **before** the dispatch (focusing re-reads the DOM selection). CM's ↑↓ jump over a replaced
  block: `enterTableDown/Up` (Prec.high keymap) step into its first/last line. In a table the next line
  without a blank line is still a row (GFM). Being edited: raw mono text (`cm-lp-table-src`), not descended;
  nested in a quote/list: no widget, descended like normal text (its `>` marks are inside the Table node).
  Test files mark the cursor with `‸` (tables are full of `|`).
  Styles: `.cm-lp-*` in `notes.css` (`--bt-*` tokens).
- **`src/standalone/`** — the app: `tauriHost.ts` (Rust commands, localStorage for `storage`, a
  folder handle's `id` = the folder's absolute path), `folderBar.ts` (vanilla port of Brighterm's
  `FolderBar.tsx` — Brighterm draws that bar in its shell, here the window does), `folderBarText.ts`
  (copied from Brighterm with its test), `tokens.css` (copy of Brighterm's `packages/sdk/ui/tokens.css`),
  `errorBar.ts` (uncaught errors, like Brighterm's plugin error bar).
- **`src/brighterm/`** — plugin entry (`window.brighterm` as host) + static `index.html`/`manifest.json`;
  `vite.brighterm.config.ts` emits one non-minified IIFE `main.js` (Brighterm statically scans
  plugin sources: no eval/require/process.).
- **`src-tauri/src/`** — `lib.rs` (commands, window creation), `folder_input.rs` (port of Brighterm's
  `folderInput.ts` + `folderSuggest.ts`: quotes, `~`, bare drive, UNC, Japanese errors, completions),
  `files.rs` (list/read/write/delete; a name must be one plain component — no separators, `..`, drive),
  `open_file.rs` (launch args → the file to open; path → folder + name).
- **Opening a file from outside** (`.md` double-click): `tauri.conf.json` `bundle.fileAssociations`
  (md, markdown; ProgID `simpletter.markdown` — NSIS uses `name` as the class key, so not a generic name)
  → Explorer runs `simpletter.exe "<path>"`. `run()` keeps argv's file in `InitialFile`; the UI pulls it
  once with `initial_file` (pull, so no race with the listener). A later launch goes through
  `tauri-plugin-single-instance` → `open-file` event (the path) + window to the front. Either way the UI
  calls `open_path` (checked folder handle + name) and hands it to the core's existing `host.onOpenFile`.
  Commands are `async` (off the main thread). Capabilities: `core:default` + dialog open/message/confirm.

## Gotchas already paid for

- **`tauri-plugin-dialog` replaces `window.alert` / `window.confirm`** with async versions
  (`init-iife.js`): `confirm()` returns a Promise. `if (!confirm(…))` was always false → delete without
  asking. The core `await`s it (works with Brighterm's sync confirm too). They need the
  `dialog:allow-message` / `dialog:allow-confirm` permissions, else nothing shows.
- **Native dialogs can't be seen or clicked over CDP** (and an off-screen window's dialog mustn't pop
  up on the user's screen): e2e swaps alert/confirm for async stand-ins (`stubDialogs` in helpers.ts).
- **e2e test mode** (debug builds only, `lib.rs` `test_mode`): `SIMPLETTER_TEST_DATA_DIR` = own WebView2
  profile, `SIMPLETTER_TEST_CDP_PORT` = `--remote-debugging-port`, window at x=30000 and not focused,
  `CalculateNativeWinOcclusion` disabled (else Chromium marks it hidden — Brighterm's finding).
  `additional_browser_args` replaces wry's defaults, so they're repeated there.
- **Quit with `taskkill` (no /F)** = WM_CLOSE: localStorage is flushed (a hard kill can lose it).
  WebView2 keeps writing the profile for seconds after exit — `removeDir` retries up to 15 s.
- **Playwright names**: the new-note button's accessible name is「＋ 新規」(its title is「新規メモ」).
- **Single instance is off in e2e test mode**: it keys on the app identifier, so a test exe would hand
  its args to the user's running simpletter and quit. Not off in plain debug builds: `npm run tauri dev`
  while an installed simpletter runs just focuses the installed one and exits — close it first.
  The second-launch path (event + focus) has no e2e for that reason; the e2e covers argv at startup.
- **The editor is CodeMirror, not a textarea.** Vitest: `EditorView.findFromDOM($('#content'))` (happy-dom
  runs CM fine). e2e: `editor(page)` = `#content .cm-content` — `fill`/`toHaveText`; the source text with
  markup is checked on disk (the screen hides marks off the cursor line). Don't reach for CM internals
  (`cmView` became `Tile` in 6.4x).
- Vitest's table-click test prints "Calls to EditorView.update are not allowed while an update is in progress"
  (stderr, caught by CM, test passes): happy-dom fires `selectionchange` synchronously when CM writes the
  DOM selection. Not in WebView2 — checked 2026-10-09 with `page.on('console')`: no errors/warnings.
- `view.setState` resets the focus flag of the live preview: `editor.setValue` re-sends `focusEffect(true)`
  when the view still has focus.
- File associations only exist in the installed (NSIS) build, and Windows 10/11 won't let an installer
  become the default app if the user already chose one for `.md` (README explains「プログラムから開く」).
- The window is created in `lib.rs` (`app.windows` is empty in `tauri.conf.json`) so tests can set
  profile/args; the capability still targets the label `main`.

## Status (2026-10-08)

Ported 1:1 from Brighterm's Notes 0.3.0 (user's choice: no new features yet). One deliberate fix: the
title field's rename makes the name safe (`\/:*?"<>|` → `_`) like the menu's rename already did.
Tests: Rust 14, Vitest 32, e2e 5; Brighterm's own `notes.spec.ts` (10) passes with `dist-brighterm/`.

Done (2026-10-08): `.md` file association + single instance (core untouched — it already had `onOpenFile`).
Not yet checked by hand: the installed build's double-click, second launch → same window.

Done (2026-10-09): live preview for `.md` (CodeMirror 6; user's choices: Live Preview only, no source
toggle; basic elements; non-.md stays plain; Brighterm build must keep working). Tests: Vitest 47
(`livePreview.test.ts` 13 + editor 2), e2e 6. `dist-brighterm/main.js` passes the static-scan patterns
(~700 KB unminified); Brighterm's CSP allows CM's inline styles. **Brighterm's `notes.spec.ts` still
assumes a textarea** (`#content` + `toHaveValue`/`fill`) — needs `#content .cm-content` + `toHaveText`
before this build goes into Brighterm (not done: other repo, ask first).

Done (2026-10-09): tables in the live preview (user's choices: a click turns the table back into its text — no
in-cell editing; no column re-alignment; inline formatting in cells). Tests: Vitest 56 (livePreview 21),
e2e 7. `dist-brighterm/main.js` ~711 KB, static-scan clean.
Checked by hand by the user (2026-10-09): works. A wide table doesn't scroll sideways: it fits the width and
cells wrap — the user wants it that way (keep; `overflow-x: auto` on the wrap only matters for unbreakable text).

Checked by hand (2026-10-09): Japanese IME OK; long files OK for the user's notes.

Done (2026-10-09): list keys (user's request): Tab = 4 spaces; numbered sub-lists restart at 1 on Tab,
Enter twice back to the parent level counts on. Tests: Vitest 67 (lists 11), e2e 8.

Next candidates (not started): images / opening links in the preview, a source-mode toggle,
app icon (still Tauri's default icons).
