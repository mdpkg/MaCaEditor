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
   ├─ Document State
   └─ Drawing Editor
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
| `components/` | FileTree / Editor / Preview / Toolbar / StatusBar / DrawingEditor |

## Drawing レイヤー（v2）

```
Drawing Domain Model (lib/drawing/model.ts)
        ↕
Drawing UI Adapter (components/DrawingEditor.tsx)
        ↕
Canvas Library (SVG ベースの軽量 Canvas)
```

```
Drawing Domain Model
   ↓ SVG Renderer (lib/drawing/svg.ts)
   ↓ JSON Serializer (lib/drawing/drawing.ts)
```

### 責務

| モジュール | 責務 |
|---|---|
| `model.ts` | Drawing Domain Model（discriminated union） |
| `drawing.ts` | `.draw.json` の parse / validate / serialize |
| `svg.ts` | Drawing → 静的 SVG の deterministic 生成 |
| `edit.ts` | move / resize / delete / z-order / align / history |
| `clipboard.ts` | copy / paste（Connector 参照 ID の再マッピング） |
| `factory.ts` | ツール別オブジェクト生成 |
| `integration.ts` | `.draw.json` + `.svg` のファイル生成 |
| `docIntegration.ts` | Document / manifest / Markdown への統合 |

### 設計原則

- `.draw.json` が source of truth。`.svg` はそこから完全再生成される一方向関係
- Drawing Library の内部データ形式を `.draw.json` に保存しない（domain model と分離）
- Selection / Zoom / Pan などの UI state は `.draw.json` に保存しない
- SVG は JavaScript を含まない静的・deterministic な出力

## MDPKG Integration

```
.draw.json
   ↓ manifest.resources[] (type: "drawing")
   ↓ .svg
   ↓ Markdown ![alt](diagrams/xxx.svg)
```

## セキュリティ設計

- ZIP エントリ名は読み込み前に検証（ZIP Slip 防止）
- Markdown の raw HTML は sanitize（任意 JS 実行防止）
- 画像・リンクの相対パスはパッケージ内に留める
- 保存は一時ファイル → atomic replace
- SVG 生成は静的出力のみ（script / event handler を含めない）
