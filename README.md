# simpletter

フォルダの中の `.md` ファイルを一覧・表示・編集する、軽量なメモ帳アプリです（Windows、Tauri 2）。
[Brighterm](../brighterm) の Notes タイルを切り出したもので、同じ画面のコードが Brighterm の
Notes プラグインとしても動きます。

## できること

- 上のバーにフォルダのパスを入力（または貼り付け）して Enter。入力中はサブフォルダの候補が出ます
  （Tab で補完、↑↓ で選択）。右端のボタンからフォルダを選ぶウィンドウも開けます。
  エクスプローラーの「パスのコピー」（`"` 付き）、`~`（ホーム）もそのまま使えます。
- 左の一覧から `.md` を開いて編集。入力が止まって 0.4 秒で自動保存されます。
- 「＋ 新規」でメモを追加。タイトル欄を書き換えて Enter でファイル名が変わります。
- 並べ替え（名前 A→Z / Z→A、新しい順 / 古い順）、検索（ファイル名）。
- 一覧の右クリック: コピー / 切り取り / 貼り付け（別のフォルダへも）/ パスのコピー / 名前の変更 / 削除。
- 狭いウィンドウでは一覧が畳まれ、☰ で開きます。
- 最後に開いたフォルダと並べ替えは次回の起動でも残ります。

## 使い方（開発）

PowerShell で:

```powershell
npm install          # 初回だけ
npm run tauri dev    # 開発モードで起動（画面のコードは保存すると即反映、Rust の変更は自動で再ビルド）
npm run tauri build  # インストーラーを作る → src-tauri\target\release\bundle\nsis\
```

必要なもの: Node.js、Rust（`rustup`、stable-msvc）、Visual Studio Build Tools（C++）、WebView2（Windows 11 は標準）。

## テスト

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | TypeScript の型チェック |
| `npm test` | 単体テスト（Vitest。画面全体も偽のファイル操作で動かします） |
| `npm run test:rust` | Rust 側（パスの解釈・ファイル操作）のテスト |
| `npm run test:e2e` | デバッグ版をビルドし、本物のアプリを Playwright で操作（画面外で動くので作業の邪魔をしません） |

## Brighterm に組み込む

```powershell
npm run build:brighterm
```

`dist-brighterm\`（`manifest.json` / `index.html` / `main.js` / `style.css`）が Brighterm の
`plugins-builtin\notes\` と同じ形で出力されます。これを中身ごとコピーすれば Brighterm の Notes が
このリポジトリの版になります（2026-10-08、Brighterm の `tests/e2e/notes.spec.ts` 全 10 件が通ることを確認済み）。

## 構成

```
src/core/        メモ帳本体（一覧・編集・右クリックメニュー）。ファイル操作は host 経由だけ
src/standalone/  単体アプリ用: フォルダバー、Tauri とのつなぎ（tauriHost.ts）、配色（tokens.css）
src/brighterm/   Brighterm プラグイン用の入口と manifest
src-tauri/       Rust: フォルダパスの解釈・補完、ファイルの読み書き、クリップボード
tests/e2e/       実アプリの e2e
```

## ライセンス

MIT
