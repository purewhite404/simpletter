# simpletter — notes for Claude

A small markdown notebook (Tauri 2, Windows): a folder of `.md` files, listed / edited /
renamed. Split out of Brighterm (`../brighterm`, its `plugins-builtin/notes/`) on 2026-10-08
because the user edits lots of one-off `.md` files and wanted something light. **Notes is
developed here from now on**; Brighterm's copy stays as it was until the user decides how to
bring it back (`npm run build:brighterm`). User-facing docs: `README.md` (Japanese).
**README style (user's request, 2026-10-09):** short — cut wherever possible. Only what a user can't guess (keys, limits like UTF-8 only, setup).
No behaviour that's obvious from using it, no "why it's better than a naive design", no OS how-tos, no
per-version migration notes, no license section (LICENSE is enough), never the user's real name / account folder.
Headings: 使い方 (### ライブプレビュー, ### CSV / TSV), 開発 (### テスト, ### Brighterm に組み込む, ### 構成).
Talk to the user in Japanese. Commit messages in English (user's request, 2026-10-09).

**Identity (user's request, 2026-10-09):** published as **purewhite404** — no real name anywhere (LICENSE,
`Cargo.toml` authors, `tauri.conf.json` `bundle.publisher` / `copyright`, test paths use `me`). Identifier
`com.purewhite404.simpletter` since 0.3.0 (was `com.satoshi.simpletter`: the WebView2 profile = localStorage moved
with it; the user chose not to migrate — last folder / sort order reset once; said in the v0.3.0 release notes only). Commits: repo-local
`git config` user.name `purewhite404`, email `61584839+purewhite404@users.noreply.github.com` — keep it. The whole
history was rewritten to that on 2026-10-09 (`git filter-repo` mailmap + replace-text; backup bundle in
`..\simpletter-backup-2026-10-09.bundle`); old versions keep `com.satoshi.simpletter` as the identifier they had.

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
| `npm run format` | Prettier over the TS / JS / CSS / JSON (`format:check` = only check); Rust: `cargo fmt` in `src-tauri` |

What to run: logic → typecheck + unit (+ rust if `src-tauri` changed); UI → also e2e;
before a commit → all of them, and `npm run format:check` + `cargo fmt --check`.

Style (2026-10-09, user's choice: a formatter rather than by hand): Prettier `.prettierrc.json` (single quotes,
no semicolons, 120 columns, `endOfLine: auto` — the checkout is CRLF/LF mixed with `autocrlf=true`), rustfmt
`src-tauri/rustfmt.toml` (120 columns). Brace an `if`/`for` body that Prettier would put on a line of its own.
`.prettierignore` keeps Brighterm's copies (`tokens.css`, `folderBarText*.ts`) and `*.md` untouched.
Icons: only what the NSIS build uses (32x32, 128x128, 128x128@2x, icon.ico) — `tauri icon` makes the full set.

### Versions (user's request, 2026-10-09: decide and bump them myself)

The version is in 5 files (package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock):
`npm run bump` prints it (fails if they disagree), `npm run bump -- patch|minor|major|x.y.z` sets all of
them (only the version lines). Brighterm's `src/brighterm/static/manifest.json` (0.3.0) counts on its own —
not bumped with the app.

**When:** not per commit — only when a build is handed out: the user asks for an installer
(`npm run tauri build`) or says リリース. Then look at `git log <last tag>..HEAD` and pick, without asking:
- something the user can now do that they couldn't (a feature, a new file type, a setting) → **minor**
  (patch back to 0). Also minor, while 0.x: a change in behaviour or in what's stored that the user
  would notice (settings lost / moved, a default changed).
- only fixes to things that should already have worked (display glitches, wrong saves, IME…) → **patch**.
- nothing a user would see (docs, tests, refactors) → no bump, no new installer needed.
- 1.0.0 only when the user says so.
Then: all checks → `npm run bump -- …` → commit `simpletter: x.y.z` (body: what's in it since the last
tag, in English) → `git tag -a vx.y.z` → build. Tell the user which bump and why (they can overrule).
No push unless asked (then `git push --follow-tags`). Tags so far: v0.2.0, v0.2.1, v0.2.2, v0.3.0.
**GitHub release (since 0.3.0, user's choice):** pushing a `v*` tag runs `.github/workflows/release.yml`
(windows-latest: format / typecheck / unit / rust / `cargo fmt --check`, then `tauri-action@v1` builds NSIS and
attaches it to a **draft** release named `simpletter vx.y.z`; text = the tagged commit's body + an install / SmartScreen
note). The user checks and publishes it on GitHub. e2e isn't in CI (run it locally before tagging). Unsigned
installer. Hand out only the CI build: a local release exe has `C:\Users\<account>\.cargo\registry\…` paths in it
(panic locations of dependencies). No `gh` CLI here: follow the run on github.com (Actions tab) / ask the user. A failed run: fix, then
move the tag (`git tag -d`, re-tag, `git push -f origin vx.y.z`) only after asking. GitHub sends **no** tag event when
> 3 tags are pushed at once (first push 2026-10-09: v0.2.0–v0.3.0 together, nothing ran; fixed by deleting the remote
v0.3.0 and pushing it alone — same tag object). First run: ~11 min, all green. Unauthenticated API calls don't see
draft releases (`/releases` = 0 is normal); `/actions/runs` works (the repo is public).

### From WSL

Same rules as Brighterm: `node_modules` and `target/` are **Windows** builds. Run everything
through `cmd.exe /c "…"`, never `npm i` from WSL, use Windows git. Shells started before Rust
was installed (2026-10-08) lack cargo on PATH: `cmd.exe /c "set PATH=%USERPROFILE%\.cargo\bin;%PATH% && …"`.
Temp dirs / screenshots: Windows `%TEMP%` (from WSL: `cmd.exe /c echo %TEMP%`, then `wslpath`).

## Architecture

- **`src/core/`** — the notes UI, ported from Brighterm's `main.js`, behaviour unchanged. It talks
  only to a `NotesHost` (`host.ts`) = the subset of Brighterm's `window.brighterm` Host API that
  Notes uses, **same shape**. Keep it that way: it's what lets the same code be Brighterm's plugin.
  `names.ts` = pure naming/sorting helpers, `fileKind` (md + markdown / csv / tsv / plain, a `Map` lookup;
  `isListed` = all but plain + `TEXT_EXTENSIONS` txt log ini cfg conf yaml yml json toml = exactly the associated
  extensions, `names.test.ts` checks it against `tauri.conf.json`); a renamed note keeps `.markdown` (`noteExtension`), anything else becomes `.md`.
  The file list shows full names (user's request, 2026-10-09); `displayName` (no `.md` / `.markdown`) is only for
  the title field, the rename box and the sort order.
  `markup.ts` = the HTML (was `index.html`). `errorText.ts` = the one `err → message` (also used by standalone).
  `notes.ts`: `closeNote()` (no note open, a pending read dropped) and `cancelSave()` are the only places that
  do that — use them rather than resetting `currentFile` / the timer by hand.
  **Save mode (2026-10-09, user's request):** `#autosave` check box right of the title field (storage `autoSave`,
  default on = as before). Ctrl+S saves in both modes (document `keydown`). Manual: edits only `updateStatus()`;
  `isDirty()` = editor ≠ `savedText` (`editor.hasValue`: length first — runs per keystroke); **every way of
  leaving the file** (row click, ＋ 新規, folder bar — cancel puts the bar back —, `onOpenFile`, window close via
  `beforeClose()`) goes through `leaveCurrent()` = `flushSave()` in auto, else `askSave` → save / discard / cancel.
  `useFolder` doesn't ask: callers do (after "discard" the editor still holds the text). Clicking the open file while
  dirty does nothing (a re-read would drop the changes). Title-field rename in manual moves the file **as on disk**
  (read, not the editor text), changes stay unsaved; menu rename / paste read from disk anyway. To auto: saves at once.
  `askSave` = `window.askSave` (standalone `dialogs.ts`: plugin `message` with yes/no/cancel labels → it returns the
  label; Esc = "Cancel") or, in Brighterm, `confirm` (OK = save, Cancel = don't save). `startNotes(root, host,
  { onStatus })` reports `{ name, dirty }` (only on change; auto is never dirty — user's choice) → `main.ts` sets
  the window title `memo.md - simpletter` / `*memo.md - simpletter` / `*無題 - simpletter` / `simpletter`
  (`core:window:allow-set-title`). Brighterm passes no `onStatus`.
  `editor.ts` = the text editor (CodeMirror 6) in `#content`: `.md` → `markdownLanguage` (GFM) + live
  preview + list continuation (`insertNewlineContinueMarkup`), `.csv`/`.tsv` → the table view (no line
  wrapping: scrolls sideways; Tab = the delimiter, `insertDelimiter`), anything else → plain mono text. Opening a
  file = `view.setState` (fresh undo history, no change event → no save). Import `markdownLanguage`, never
  `markdown()`: that one drags lang-html/js/css into the bundle.
  **Search (Ctrl+F, 2026-10-09):** every kind has `@codemirror/search` (`search({ top: true })` + `searchKeymap`,
  phrases in Japanese = `PHRASES`; replace included, user's choice). The WebView's own find bar only sees the DOM =
  the lines CM has drawn (and not text inside widgets) — that was the bug. `notes.ts` has a document `keydown`:
  Ctrl+F not taken by CM (focus outside the editor) → the file filter `#search` (sidebar shown first, user's choice);
  F3 / Ctrl+G outside → `preventDefault` only. Never the WebView's find bar. While the panel is open
  (`searchPanelOpen(state)`) live preview and CSV count as focused, so the current match (in a table, a hidden URL,
  behind a `,` widget) shows as text even though the focus is in the panel's input.
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
  Mark / line decorations come from `markClass` / `lineClass`, made once per class (the field rebuilds on every
  cursor move — don't build `Decoration.mark` inline there).
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
  `csv.ts` (pure, `csv.test.ts`) + `csvPreview.ts` (`csvPreview.test.ts`) = CSV/TSV as a table, **line by
  line** (user's choice over a grid with its own editing): each line a row, each cell a `Decoration.mark`
  `.cm-csv-cell` = inline-block `width: calc(Nch + 1px)` (mono font; East Asian wide = 2 ch; the +1px: else a
  cell its text fills exactly wraps its last char — e2e checks row heights). The text stays CM's text:
  click / select / IME / undo as usual, saved as is. **A cell = the delimiter before its field + the field**
  (the 1st column has none); width = that, widest in the file (quotes included), max 40 (longer wraps
  inside), so nothing moves when the cursor's row shows its marks. An **empty 1st field** (line starts with the
  delimiter; a mark can't be empty) = `EmptyCell`, a widget `.cm-csv-cell.cm-csv-empty` as wide as the column,
  `side: -1` (side > 0 would be drawn inside the 2nd cell's inclusive-start mark); before 2026-10-10 it took no room
  and the row's other cells sat left of their columns. A click on it = the plugin's `mousedown` → cursor at its
  position (CM alone put it after the `,`, typing into the 2nd cell). An empty line: no cell. Delimiters and quotes are **widgets**
  (`MarkWidget`), never text spans: a delimiter = 1 ch `.cm-csv-sep`, empty off the cursor's lines (or
  unfocused), `,` / `→` dimmed on them; quotes / the 1st of `""` replaced away, or a dimmed `"` widget.
  **IME (user report 2026-10-09: composing text not shown, IME window at the screen's top-left):** the old
  layout (delimiter = a mark span at the *end* of the cell before) made the browser type text composed right
  after a `,` into the `,`'s text node — the narrow cell before, wrapping a char a line. Now: delimiter leads
  the cell, it's a widget (nothing to type into), and the cell mark is `inclusiveStart: true` (else CM draws
  the widget at a mark's start *outside* the mark — the caret then sits between cells); `inclusiveEnd: true`.
  While `view.composing` the ViewPlugin only maps its decorations (no cells appear / move under the
  composition; `stale` → rebuilt by a `compositionend` handler's rescan dispatch). e2e covers it with CDP
  `Input.imeSetComposition` (cell the composing text is in + cells' x unchanged); it fails without
  `inclusiveStart`. CDP's composition doesn't break the way TSF does — check DOM placement, not "does it
  commit". Leftover: composing in an *empty first* cell shows in the 2nd cell until committed.
  A record over several lines (quoted line break) = raw lines (`cm-csv-raw`). Big files
  (50k lines = 3.7 MB: full scan ~30 ms, edit ~0.1 ms, viewport decorations ~1 ms): `modelField`
  (StateField: widths + multi-line ranges) is scanned on create, on an edit only widened from the changed
  lines (multi ranges mapped), rescanned `RESCAN_DELAY` (300 ms) after typing stops (ViewPlugin timer →
  effect); decorations come from a ViewPlugin over `visibleRanges` only (focus = `view.hasFocus`, a parameter
  of the pure `csvDecorations`). No header row, UTF-8 only (Shift_JIS shows garbled), CRLF → LF on save like
  every file (user's choices). Tests: `RangeSet.between` goes layer by layer — sort before comparing.
  **Columns (2026-10-10, user's request):** `csvColumns.ts` (pure, `csvColumns.test.ts`, `‸` cursor, `«…»`
  selections): `recordsOf` = every record with document-wide field spans (a quoted line break joins lines),
  `selectedColumns` = the cursor's column / all columns any range touches (a cell = delimiter + field: right after a
  `,` = the next column; a range starting at a field's end / ending right after a `,` doesn't take that cell),
  `insertColumn` left of the leftmost / right of the rightmost (short rows **padded** with delimiters up to it; cursor
  into the new cell of its row), `deleteColumns` (rows without the column untouched; all columns → empty line; cursor
  to the cell that took the place). Empty lines never touched. `csvPreview.ts` wraps them as commands
  (`insertColumnLeft/Right`, `deleteColumn`: one dispatch + `rescan` effect = widths at once + `isolateHistory`
  'full' = own undo step, else typing / Backspace right after joins it). Only from the **right-click menu** (user's
  choice, no keys): CSV / TSV's `contextmenu` handler replaces the WebView's menu with ours = 切り取り / コピー /
  貼り付け (`navigator.clipboard`; wry allows clipboard-read; cut / copy greyed out when nothing is selected) +
  左に列を挿入 / 右に列を挿入 / 列を削除. A mouse right-click outside a non-empty selection moves the cursor there;
  the menu key / Shift+F10 (button ≠ 2) keeps it and opens at the cursor. md / plain keep the WebView's menu.
  `menu.ts` = the one `.ctx-menu` (`openMenu(x, y, entries)`, `null` = separator; `mousedown` on an item is
  prevented so the editor keeps the focus) — the file list's menu uses it too. e2e: no clipboard (the off-screen
  window has no focus: `navigator.clipboard` refuses), unit test with a stub.
- **`src/standalone/`** — the app: `tauriHost.ts` (Rust commands, localStorage for `storage`, a
  folder handle's `id` = the folder's absolute path), `folderBar.ts` (vanilla port of Brighterm's
  `FolderBar.tsx` — Brighterm draws that bar in its shell, here the window does), `folderBarText.ts`
  (copied from Brighterm with its test — its paths now say `me`, Brighterm's copy still has the user's name), `tokens.css` (copy of Brighterm's `packages/sdk/ui/tokens.css`),
  `errorBar.ts` (uncaught errors, like Brighterm's plugin error bar).
- **`src/brighterm/`** — plugin entry (`window.brighterm` as host) + static `index.html`/`manifest.json`;
  `vite.brighterm.config.ts` emits one non-minified IIFE `main.js` (Brighterm statically scans
  plugin sources: no eval/require/process.).
- **`src-tauri/src/`** — `lib.rs` (commands, window creation), `folder_input.rs` (port of Brighterm's
  `folderInput.ts` + `folderSuggest.ts`: quotes, `~`, bare drive, UNC, Japanese errors, completions),
  `files.rs` (list/read/write/delete; a name must be one plain component — no separators, `..`, drive),
  `open_file.rs` (launch args → the file to open; path → folder + name).
- **Opening a file from outside** (`.md` double-click): `tauri.conf.json` `bundle.fileAssociations`
  (md, markdown; ProgID `simpletter.markdown` — NSIS uses `name` as the class key, so not a generic name;
  csv, tsv → `simpletter.table`; txt → `.text`, log → `.log`, ini cfg conf → `.config`, yaml yml → `.yaml`,
  json → `.json`, toml → `.toml`; one ProgID per `description` = Windows's own type names, e.g. 「テキスト ドキュメント」,
  because Tauri's NSIS sets `HKCU\Software\Classes\.ext`'s default to our ProgID (old one kept as
  `<ProgID>_backup`, restored on uninstall): Explorer's 種類 column / 新規作成 may show our description even when
  another app is the default)
  → Explorer runs `simpletter.exe "<path>"`. `run()` keeps argv's file in `InitialFile`; the UI pulls it
  once with `initial_file` (pull, so no race with the listener). A later launch goes through
  `tauri-plugin-single-instance` → `open-file` event (the path) + window to the front. Either way the UI
  calls `open_path` (checked folder handle + name) and hands it to the core's existing `host.onOpenFile`.
  Commands are `async` (off the main thread). Capabilities: `core:default` + dialog open/message/confirm.

## Gotchas already paid for

- **Security model (review 2026-10-09, before the first push):** the file commands (`list_files` / `read_file` /
  `write_file` / `delete_file` / `copy_path` / `open_path`) work on **any** absolute folder — by design: the user
  edits config files anywhere (user's choice; an allow-list of opened folders wouldn't help either, `open_folder`
  is callable from JS too). So the one thing that keeps it safe is **no script injection into the WebView**:
  file contents are only ever shown as text (`textContent`, CM text, widgets built with `createElement`) — never
  `innerHTML` with file data, never HTML rendering of notes (keep that in mind for "images / links in the
  preview"), and the CSP (`tauri.conf.json`: `default-src 'self'`, `object-src` / `base-uri` / `form-action` /
  `frame-ancestors 'none'`; Tauri adds `script-src 'self' 'sha256-…'` — no inline scripts). Defence in depth
  in `files.rs`: `inside` refuses `<>:"|?*`, control chars (":" = an alternate data stream), trailing dot /
  space (Windows drops them: `x.bat.` = `x.bat`), device names (`CON`, `nul.txt`, `COM1`, `LPT¹`…); `write`
  never **creates** a file with an `EXECUTABLE` extension (exe, bat, cmd, ps1, vbs, js, lnk, url, reg… — an
  existing one is written / read / deleted like any text, user's choice); `read` stops at 1 GB (user's choice;
  past ~500 MB the WebView's string limit may fail first). The TS side mirrors both (`names.ts`: `safeName`,
  `isExecutable` — keep the lists in step) so a rename is refused **before** anything is written (a case-only
  rename refused half-way would leave the note under its `.renaming-` temp name). Non-UTF-8 files still open
  lossily and are rewritten on the first edit (user's choice: kept as is).
  e2e can't test `eval` against the CSP (code evaluated over CDP may eval) — it checks an inline `<script>`.
  Audits 2026-10-09: `npm audit` 0; `cargo audit` 0 vulnerabilities, 2 warnings (glib = Linux only,
  proc-macro-error = build time). `cargo-audit` is installed (Windows cargo).

- **Saving (`notes.ts`, fixed 2026-10-09 after a review of disk writes):** the save waits 0.4 s for typing
  to stop. Opening another note used to leave that timer running: the old note lost its last words, the new
  one was rewritten with its own text (CRLF → LF), and with a slow read the old text was written *into* the
  new note. Now: `currentFile`, the title and the editor only change together, in the synchronous `show()`;
  `flushSave()` before it takes the old note's name and text before its first await; `openRequest` drops a
  read that finished after another note was clicked; `savedText` (= what's on disk, as the editor has it)
  skips writes of unchanged text; `edits` keeps what was typed into the open note while it was read again.
  A new note is shown right after its file is written (no read) — else a title typed at once renamed the
  *previous* note. `startNotes` resolves to `{ flush }`: `main.ts` calls it on `onCloseRequested`
  (needs `core:window:allow-destroy`; a failed save asks before closing). `files::write` = temp file next
  to the note (`.name.simpletter-pid-n.tmp`, not listed) + `ReplaceFileW` (keeps the on-disk name's case —
  passed the real name via `canonicalize` —, attributes, ACL), `rename` as fallback; symlinks written through.
  Live preview measured: 500 lines 1.2 ms, 10k 10 ms, 50k 61 ms per cursor move (whole doc) — left as is.

- **`tauri-plugin-dialog` replaces `window.alert` / `window.confirm`** with async versions
  (`init-iife.js`): `confirm()` returns a Promise. `if (!confirm(…))` was always false → delete without
  asking. The core `await`s it (works with Brighterm's sync confirm too). They need the
  `dialog:allow-message` permission, else nothing shows.
  **Since plugin 2.7 its `window.confirm` is broken** (user report 2026-10-09: delete from the menu →
  "Command plugin:dialog|confirm not allowed by ACL"): it still invokes `plugin:dialog|confirm`, but the Rust
  side only has `open` / `save` / `message` (`allow-confirm` is just an alias of `allow-message`) — no capability
  fixes that. `src/standalone/dialogs.ts` (`installDialogs()`, first thing in `main.ts`) replaces alert / confirm
  with the JS API's `message` / `confirm` (→ `plugin:dialog|message`). Also fixed the close-after-failed-save
  confirm. e2e checks `String(window.confirm)` isn't the plugin's (fails without the fix).
- **Native dialogs can't be seen or clicked over CDP** (and an off-screen window's dialog mustn't pop
  up on the user's screen): e2e swaps alert/confirm for async stand-ins (`stubDialogs` in helpers.ts).
- **e2e test mode** (debug builds only, `lib.rs` `test_mode`): `SIMPLETTER_TEST_DATA_DIR` = own WebView2
  profile, `SIMPLETTER_TEST_CDP_PORT` = `--remote-debugging-port`, window off screen, not focused, no
  taskbar button, `CalculateNativeWinOcclusion` disabled (else Chromium marks it hidden — Brighterm's
  finding). `additional_browser_args` replaces wry's defaults, so they're repeated there.
  **Off screen (user report 2026-10-09: test windows came up in front of their work):** the builder's
  `.position(30000, 0)` did nothing — tao keeps a position only if it's on some monitor, else
  `CW_USEDEFAULT` (on screen, top of the z-order; `focused(false)` only kept the focus). And a later
  `show()` takes the focus (tao drops `focused(false)` after creation → `SW_SHOW`). So: build hidden +
  `skip_taskbar`, `set_position` past every monitor's right edge (not clamped after creation), then
  Win32 `ShowWindow(SW_SHOWNOACTIVATE)` (`show_off_screen`). e2e checks it via the window plugin's
  commands (visible, not focused, overlaps no monitor, rAF runs) — that test failed before the fix.
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
  become the default app if the user already chose one for `.md` (「プログラムから開く」→ 常に使う). Dev mode has no association: `npx.cmd tauri dev -- -- C:\path\note.md`.
- The window is created in `lib.rs` (`app.windows` is empty in `tauri.conf.json`) so tests can set
  profile/args; the capability still targets the label `main`.
- **The NSIS installer is our own template** (`src-tauri/nsis/installer.nsi`, `bundle.windows.nsis.template`; user's
  request 2026-10-09: simpletter starts by opening a file, so no shortcuts / "run"): Tauri has no setting for
  that. = Tauri's template from tauri-bundler 2.10.1 (CLI 2.12.1) minus the finish page (run / desktop check
  boxes), the start menu page and all shortcut creation (also /P, /S), /NS, /R; the install / uninstall progress
  pages close themselves when done (`SetAutoClose true` always, user's choice; welcome / folder / uninstall confirm
  pages kept). Install deletes `simpletter.lnk`
  in Start menu / desktop if it points to our exe (an older version's uninstaller keeps them on update).
  The commit "Add Tauri's NSIS template as is" is upstream unchanged — **after a Tauri CLI update**, diff the new
  upstream template against that and carry the changes over. `startMenuFolder` does nothing.

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

Done (2026-10-09): CSV / TSV as a table (user's choices: line-by-line live view, cursor row keeps the
columns with dimmed marks, sideways scroll + 40 ch cap, multi-line records raw, listed always, file
association added, no header row, UTF-8 only, line endings as before). Tests: Vitest 85 (csv 9,
csvPreview 8), e2e 10. `dist-brighterm/main.js` ~726 KB, static-scan clean — Brighterm's Notes would list
csv/tsv too. Checked by hand by the user (2026-10-09, notes written into the test CSV): widths, multi-line
records raw (fine: their CSVs have none), empty cells, TSV, saving — OK. Asked for: Tab in CSV = `,` (done),
IME composing inside the cell (fixed as above — re-checked by hand by the user: OK). Not yet checked: the
installed build's csv association.

Done (2026-10-09): e2e windows really off screen (see Gotchas). e2e 11, all pass off screen.

Done (2026-10-09): saving fixes (see Gotchas: switching notes, close, atomic write) → 0.2.1 (patch, tag v0.2.1,
installer built). Checked by hand by the user with the installed 0.2.1: typing then Alt+F4 at once keeps the
text; opening CRLF .md / .csv, moving the cursor and clicking a table leaves them untouched (mtime, CRLF).
Tests: Vitest 92, Rust 16, e2e 12. Not pushed.

Done (2026-10-09): refactoring (user's request: drop what's unused, simplify, one style). No change a user sees
except one fix: unused icons (Store / macOS) and `serde_json` removed; Rust: `FolderHandle::of`, test mode read
once, folder completions sorted with `sort_by_cached_key`; Prettier + rustfmt (see Commands); TS: shared
`errorText`, `closeNote` / `cancelSave`, decorations made once per class, unused exports / params / CSS gone,
`vite.config.ts` without the mobile `TAURI_DEV_HOST` part. Fix: **`.markdown` files are notes** (associated by
the installer, but opened as plain text and not listed before) → the next release is at least a **patch**.
Tests: Vitest 94, Rust 16, e2e 12. → 0.2.2 (patch, tag v0.2.2, installer built). Not pushed.
Not yet checked by hand: the installed 0.2.2 opening a double-clicked `.markdown`.

Done (2026-10-09): the file list shows `.md` / `.markdown` too (user's choice: the list only — title field and
rename box stay without it; delete confirm shows the full name). Brighterm's `notes.spec.ts` would need full names
in its row checks as well. User-visible → next release is a **minor** (while 0.x: a change the user notices).

Done (2026-10-09): fix — delete from the menu (and the close-after-failed-save question) failed with an ACL error
(see Gotchas: the dialog plugin's `window.confirm`). Tests: Vitest 96 (dialogs 2), e2e 13. Not yet checked by hand:
the real dialog (OK / キャンセル) — CDP can't click it.

Done (2026-10-09): security review (see Gotchas: Security model) — name checks, no new executables, 1 GB read cap,
stricter CSP, `list_files` wants an absolute path; also fixed: a title-field rename finishing after another note
was opened no longer makes that note's saves go to the renamed file. Tests: Rust 19, Vitest 99, e2e 14.
User-visible (refused names, `_CON`) → the next release is at least a **patch** (minor already due, see above).

Done (2026-10-09): associations + always listed (user's request / choice): txt, log, ini, cfg, conf, yaml, yml, json,
toml besides md / markdown / csv / tsv (13); shown as plain text; other files still only listed once opened from
outside (`extraFile`; tests now use `.bak` for those). Brighterm's Notes would list them too. Tests: Vitest 102,
e2e 14; the generated `installer.nsi` has the 13 `APP_ASSOCIATE` lines. Next release: **minor** (was due anyway).
Not yet checked by hand: the installed build's double-click for the new types.

Done (2026-10-09): installer without the finish page (no "run simpletter" / desktop shortcut check boxes) and without
any shortcut (see Gotchas: NSIS template). Pages: welcome → folder → progress (closes itself; uninstall too). makensis: 0 warnings;
13 `APP_ASSOCIATE` kept. Not yet checked by hand: the pages, auto-close (and a failure staying open), no shortcuts, 0.3.0's shortcuts removed on install
over it, `.md` double-click, uninstall. User-visible → part of the next (minor) release.

Done (2026-10-09): Ctrl+F searches the whole note (user report: text off screen wasn't found) — CodeMirror's
search / replace panel, see Architecture. Tests: Vitest 105 (search 3), e2e 15. Checked by hand by the user
(2026-10-09): OK (the WebView's find bar never shows — CDP can't see it). User-visible (replace is new) → part of the next (minor) release.

Done (2026-10-09): auto / manual save switch + window title `<file> - simpletter`, `*` while unsaved (user's request;
choices: check box by the title, default auto, leaving asks save / don't save / cancel, no `*` in auto mode, full file
name) — see Architecture. Tests: Vitest 111 (manual save 5, dialogs 3), e2e 16 (closing with cancel = the test kills
the window, +5 s). Not yet checked by hand: the real 3-button dialog. User-visible → part of the next (minor) release.

Done (2026-10-10): fix — a CSV / TSV line starting with the delimiter (empty first cell) was drawn shifted left (see
Architecture: `EmptyCell`). Tests: Vitest 112, e2e 16 (the CSV test has a `,7` row: lined up, click → typed into the
1st cell). User-visible fix → part of the next release (minor already due).

Done (2026-10-10): CSV / TSV column insert / delete from a right-click menu (see Architecture: Columns; user's choices:
menu only, the WebView's menu replaced incl. cut / copy / paste, all touched columns deleted, short rows padded on
insert, no row ops / column moves). Tests: Vitest 127 (csvColumns 13), e2e 17. Not yet checked by hand: cut / copy /
paste from the menu (real clipboard). User-visible → part of the next (minor) release.

Next candidates (not started): images / opening links in the preview, a source-mode toggle,
app icon (still Tauri's default icons; `tauri icon <png>` makes the set, keep only what NSIS uses).
