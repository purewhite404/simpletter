# simpletter

フォルダの中の `.md` / `.csv` / `.tsv` を一覧・編集するメモ帳です（Windows、Tauri 2）。
[Brighterm](../brighterm) の Notes を切り出したもので、同じコードが Brighterm のプラグインとしても動きます。

## インストール

[Releases](https://github.com/purewhite404/simpletter/releases) の `simpletter_x.y.z_x64-setup.exe` を実行します。
SmartScreen が出たら「詳細情報」→「実行」。

## 使い方

- 上のバーにフォルダのパスを入力して Enter（Tab で補完）。
- 編集は 0.4 秒で自動保存。タイトル欄で Enter するとファイル名が変わります。
- 実行ファイル（`.exe` `.bat` `.ps1` `.lnk` など）は新しく作れません。1 GB を超えるファイルは開きません。

### ライブプレビュー

`.md` / `.markdown` は Obsidian 風に整形して表示し、`#` や `**` などの記号はカーソルのある所だけ出ます。
画像と HTML は未対応、リンクはクリックしても開きません。

- Tab / Shift+Tab: リストの項目を下の項目ごと 4 スペース下げる・戻す（番号は振り直し）。

### CSV / TSV

- Tab で区切り文字（CSV は `,`、TSV はタブ）。
- UTF-8 のみ（Shift_JIS は文字化けします）。

## 開発

必要なもの: Node.js、Rust（stable-msvc）、Visual Studio Build Tools（C++）。PowerShell で:

```powershell
npm install
npm run tauri dev             # 開発モード
npm run tauri build           # インストーラー → src-tauri\target\release\bundle\nsis\
npm run bump -- patch|minor   # 5 つのファイルのバージョンをまとめて上げる
```

`v*` のタグを push すると、GitHub Actions がインストーラー付きの下書きリリースを作ります。

### テスト

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | 型チェック |
| `npm test` | Vitest |
| `npm run test:rust` | Rust |
| `npm run test:e2e` | 実アプリを Playwright で操作 |

### Brighterm に組み込む

`npm run build:brighterm` の出力 `dist-brighterm\` を Brighterm の `plugins-builtin\notes\` にコピーします。
Brighterm の `notes.spec.ts` は本文が textarea の前提なので、`#content .cm-content` に直す必要があります。

### 構成

```
src/core/        メモ帳本体（ファイル操作は host 経由だけ）
src/standalone/  単体アプリ用: フォルダバー、Tauri とのつなぎ
src/brighterm/   Brighterm プラグイン用の入口
src-tauri/       Rust: パスの解釈・補完、ファイル操作
tests/e2e/       e2e
```
