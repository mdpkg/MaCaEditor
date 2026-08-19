# MaCa Editor

**MaCa Editor** is a Markdown Package (`.mdpkg`) editor designed to evolve into a Markdown editor with built-in WYSIWYG diagramming.

## 名前の由来

- **Ma** = Markdown
- **Ca** = Canvas
- **Editor** = Editor

長期的には、Markdown エディタに WYSIWYG 作図ツールが統合されたドキュメントエディタを目指します。

## アプリ概要

MaCa Editor は、Markdown Package（`.mdpkg`）を閲覧・編集・保存するデスクトップアプリケーションです。

`.mdpkg` は ZIP アーカイブで、専用アプリがなくても展開すれば通常の Markdown・画像・図ソースとして利用できます。MaCa Editor はこの設計思想を壊さないように動作します。

## 対応機能 (v1)

- `.mdpkg` を開く / 保存 / 別名保存
- 新規 Markdown Package を作成
- フォルダへ展開（Export Folder）
- フォルダから `.mdpkg` を作成（Import Folder）
- Markdown の編集とプレビュー（GFM 基本）
- パッケージ内の相対画像・リンクの解決
- ファイルツリー表示
- manifest.json の解析・検証・保存（未知フィールドは保持）
- ZIP Slip / パストラバーサル / 危険な HTML の防止

## v1 で未対応の機能

- WYSIWYG 作図エディタ（Canvas）
- PlantUML / Mermaid / Graphviz のレンダリング
- PDF / HTML Export
- リアルタイム共同編集・クラウド同期
- プラグインシステム・Git 統合・AI 機能

## 開発環境

- Node.js / npm
- Rust / Cargo
- Tauri 2
- React 18 + TypeScript + Vite

## 起動方法

```bash
npm install
npm run tauri dev
```

## ビルド方法

```bash
npm run tauri build
```

## テスト方法

```bash
# フロントエンド
npm test

# Rust 側
cd src-tauri
cargo test
```

## 採用した主要ライブラリと採用理由

- **Tauri 2**: 軽量なデスクトップシェル。Rust でネイティブ処理、WebView で UI を実現
- **React + TypeScript**: 文書 UI の構築と型安全性
- **Vite**: 高速な開発サーバーとビルド
- **zip crate**: ZIP 読み書き（`.mdpkg` の実体）
- **Vitest**: フロントエンドのロジックテスト

## アーキテクチャ

```
MaCa Editor
├─ Tauri / Rust
│  ├─ .mdpkg 読み込み (package_loader)
│  ├─ ZIP 読み書き (package_writer / atomic_save)
│  ├─ パス検証 (path_validator)
│  ├─ manifest 読み書き (manifest / package_validation)
│  └─ Tauri commands
└─ React / TypeScript
   ├─ UI (App / components)
   ├─ Markdown Editor / Preview
   ├─ File Tree
   └─ Document State (lib/document)
```

詳細は `docs/architecture.md` を参照してください。
