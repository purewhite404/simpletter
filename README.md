# Simpletter
フォルダの中の ASCII file を一覧・編集するメモ帳です。
[Brighterm](../brighterm) の Notes を切り出したもので、同じコードが Brighterm のプラグインとしても動きます。

## Install
[Releases](https://github.com/purewhite404/simpletter/releases) の `simpletter_x.y.z_x64-setup.exe` を実行します。
SmartScreen が出たら「詳細情報」→「実行」してください。

次の拡張子に関連付け、フォルダの一覧にも出します: `.md` `.markdown` `.csv` `.tsv` `.txt` `.log` `.ini` `.cfg` `.conf`
`.yaml` `.yml` `.json` `.toml`。それ以外はエクスプローラ等外部から開いたときだけ一覧に加わります。

## Feature
- 上のバーにフォルダのパスを入力
- タイトル欄で Enter するとファイル名を変更
- 自動保存
- 実行ファイル（`.exe` `.bat`など）は新規作成不可
- 1 GB を超えるファイルは閲覧編集共に不可

### Live Preview
#### Markdown
- `.md` / `.markdown` を整形
- `#` や `**` などの記号はカーソルのある所のみ表示
- 画像と HTML は未対応

#### CSV / TSV
- Tab で区切り文字を追加
- UTF-8 のみ対応

## Development
- 必須パッケージ: Node.js、Rust（stable-msvc）
- Windowsの場合: Visual Studio Build Tools（C++）

```sh
npm install
npm run tauri dev             # 開発モード
npm run tauri build           # インストーラー → src-tauri\target\release\bundle\nsis\
npm run bump -- patch|minor   # 5 つのファイルのバージョンをまとめて上げる
```

### Test
```sh
npm run typecheck #型チェック
npm test          #Vitest
npm run test:rust #Rust
npm run test:e2e  #実アプリを Playwright で操作
```

### Embedding into Brighterm
`npm run build:brighterm` の出力 `dist-brighterm\` を Brighterm の `plugins-builtin\notes\` にコピーします。
Brighterm の `notes.spec.ts` は本文が textarea の前提なので、`#content .cm-content` に直す必要があります。

### Structure
```
.
├── src/
│   ├── core/        メモ帳本体（ファイル操作は host 経由だけ）
│   ├── standalone/  単体アプリ用: フォルダバー、Tauri とのつなぎ
│   └── brighterm/   Brighterm プラグイン用の入口
├── src-tauri/       Rust: パスの解釈・補完、ファイル操作
└── tests/
    └── e2e/         e2e
```
