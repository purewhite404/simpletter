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
  `files.rs` (list/read/write/delete; a name must be one plain component — no separators, `..`, drive).
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
- The window is created in `lib.rs` (`app.windows` is empty in `tauri.conf.json`) so tests can set
  profile/args; the capability still targets the label `main`.

## Status (2026-10-08)

Ported 1:1 from Brighterm's Notes 0.3.0 (user's choice: no new features yet). One deliberate fix: the
title field's rename makes the name safe (`\/:*?"<>|` → `_`) like the menu's rename already did.
Tests: Rust 11, Vitest 29, e2e 4; Brighterm's own `notes.spec.ts` (10) passes with `dist-brighterm/`.

Next candidates (from the original plan, not started): `.md` file association + single instance
(open a file by double-click), markdown preview, app icon (still Tauri's default icons).
