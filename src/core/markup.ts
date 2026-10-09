/** The notes UI's markup (was Brighterm's plugins-builtin/notes/index.html body). */
export const NOTES_MARKUP = `
<div id="app">
  <div id="picker-screen" class="screen">
    <p>↑ 上のバーに、メモを保存するフォルダのパスを入力して Enter を押してください。</p>
    <p class="hint">入力中はフォルダの候補が出ます（Tab で補完）。エクスプローラーの<span class="nowrap">「パスのコピー」</span>をそのまま貼り付けても大丈夫です。</p>
  </div>
  <div id="notes-screen" class="screen" hidden>
    <div id="sidebar">
      <div id="sidebar-header">
        <div id="sidebar-actions">
          <button id="new-note" title="新規メモ">＋ 新規</button>
          <select id="sort" title="並べ替え（新しい順・古い順は更新日時）" aria-label="並べ替え">
            <option value="name-asc">名前 A→Z</option>
            <option value="name-desc">名前 Z→A</option>
            <option value="date-desc">新しい順</option>
            <option value="date-asc">古い順</option>
          </select>
        </div>
        <input id="search" placeholder="検索…" />
      </div>
      <div id="file-list"></div>
    </div>
    <div id="sidebar-backdrop"></div>
    <div id="editor">
      <div id="editor-header">
        <button id="toggle-sidebar" title="ファイル一覧を表示/隠す" aria-label="ファイル一覧を表示/隠す" aria-expanded="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <input id="title" placeholder="無題のメモ" />
      </div>
      <div id="content"></div>
    </div>
  </div>
</div>
`
