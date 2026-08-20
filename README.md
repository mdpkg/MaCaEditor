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

## 対応機能 (v2)

- `.mdpkg` を開く / 保存 / 別名保存
- 新規 Markdown Package を作成
- フォルダへ展開（Export Folder）
- フォルダから `.mdpkg` を作成（Import Folder）
- Markdown の編集とプレビュー（GFM 基本）
- パッケージ内の相対画像・リンクの解決
- ファイルツリー表示
- manifest.json の解析・検証・保存（未知フィールドは保持）
- ZIP Slip / パストラバーサル / 危険な HTML の防止
- **WYSIWYG Drawing Editor（Canvas）**
  - Rectangle / Ellipse / Text / Line / Arrow / Connector
  - Select / Move / Resize / Delete / Copy / Paste / Duplicate
  - Undo / Redo / Z-order / Alignment
  - Zoom / Pan / Grid / Snap
  - `.draw.json`（編集可能ソース）と `.svg`（レンダリング済み）の両方を保持
  - Markdown への図挿入、Preview から Drawing Editor を開く

## Drawing Editor の使い方

1. Markdown を開き、ツールバーの **Insert Drawing** を押す
2. Drawing Editor が開き、`diagrams/drawing-N.draw.json` と `.svg` が生成される
3. ツールバーから Select / Rect / Ellipse / Text / Line / Arrow / Connector を選ぶ
4. Canvas 上で Drag または Click してオブジェクトを作成
5. Select ツールでオブジェクトを選択・移動・リサイズ
6. 右の Properties パネルで位置・サイズ・色・テキストを編集
7. Markdown Preview 上の図をクリックすると Drawing Editor に戻れる
8. Save で `.mdpkg` に保存される

### キーボードショートカット

| 操作 | キー |
|---|---|
| Delete | Delete / Backspace |
| Copy | Ctrl+C |
| Paste | Ctrl+V |
| Duplicate | Ctrl+D |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Move | Arrow Keys（Shift で大きく） |
| Zoom | Ctrl + Wheel |

## Drawing Format（`.draw.json`）

```json
{
  "format": "maca-drawing",
  "version": "1.0",
  "canvas": { "width": 1200, "height": 800, "gridSize": 10 },
  "objects": [
    {
      "id": "rect-1",
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 80,
      "rotation": 0,
      "zIndex": 1,
      "style": { "fill": "#ffffff", "stroke": "#000000", "strokeWidth": 1 },
      "text": "API"
    }
  ]
}
```

`.draw.json` が source of truth で、`.svg` はそこから完全再生成されます。`.svg` は JavaScript を含まない静的 SVG で、通常の Markdown Viewer でも表示できます。

## v2 で未対応の機能

- PlantUML / Mermaid / Graphviz の WYSIWYG 編集
- draw.io / Excalidraw / PowerPoint import/export
- PDF / HTML Export
- リアルタイム共同編集・クラウド同期
- プラグインシステム・AI 機能
- 高度な Connector ルーティング・Group・リッチテキスト

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
- **Drawing Canvas**: 独自の軽量 SVG ベース Canvas を実装。Drawing Library の内部データ形式を `.draw.json` に保存せず、MaCa Editor 独自の domain model と分離

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
   ├─ Document State (lib/document)
   └─ Drawing (lib/drawing)
      ├─ model.ts        Drawing Domain Model
      ├─ drawing.ts      parse / validate / serialize
      ├─ svg.ts          SVG Renderer
      ├─ edit.ts         move / resize / z-order / align / history
      ├─ clipboard.ts    copy / paste
      ├─ factory.ts      object factory
      └─ docIntegration  MDPKG 統合
```

詳細は `docs/architecture.md` を参照してください。
