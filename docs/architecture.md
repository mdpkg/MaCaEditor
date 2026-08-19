# MaCa Editor アーキテクチャ

## 責務分担

```
MaCa Editor
├─ Tauri / Rust
│  ├─ .mdpkg 読み込み
│  ├─ ZIP 読み書き
│  ├─ パス検証
│  ├─ manifest 読み書き
│  ├─ ファイル保存
│  └─ OS / Desktop integration
│
└─ React / TypeScript
   ├─ UI
   ├─ Markdown Editor
   ├─ Markdown Preview
   ├─ File Tree
   └─ Document State
```

## Rust 側（package layer）

| モジュール | 責務 |
|---|---|
| `manifest.rs` | manifest.json のパース。未知フィールドは `unknown` に保持 |
| `path_validator.rs` | パッケージ内パスの検証（path traversal 防止） |
| `package_validation.rs` | manifest の必須フィールド・パス・entrypoint 存在検証 |
| `package_loader.rs` | ZIP から Document Model を読み込む |
| `package_writer.rs` | Document Model から ZIP を生成 |
| `atomic_save.rs` | 一時ファイル → atomic replace の安全な保存 |
| `commands.rs` | Tauri コマンド（open / save / new / import / export） |

## React 側（document UI）

| モジュール | 責務 |
|---|---|
| `lib/document.ts` | Document State（files / manifest / dirty） |
| `lib/fileTree.ts` | フラットパス → ツリー構造 |
| `lib/markdown.ts` | 相対パス解決（パッケージ外参照を拒否） |
| `lib/sanitize.ts` | 危険な HTML の除去 |
| `lib/tauri.ts` | Tauri コマンド呼び出し |
| `components/` | FileTree / Editor / Preview / Toolbar / StatusBar |

## セキュリティ設計

- ZIP エントリ名は読み込み前に検証（ZIP Slip 防止）
- Markdown の raw HTML は sanitize（任意 JS 実行防止）
- 画像・リンクの相対パスはパッケージ内に留める
- 保存は一時ファイル → atomic replace

## 将来の WYSIWYG 作図機能

v2 以降で Canvas 作図を追加する予定です。`resources[].source -> rendered` の関連を壊さない設計にしてあります。作図データ（`.draw.json`）とレンダリング済み画像（`.svg`）を同じモデルで扱えるようにしています。
