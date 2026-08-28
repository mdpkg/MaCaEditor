# MaCa Editor アーキテクチャ

## 責務分担

```
MaCa Editor
├─ Tauri / Rust
│  ├─ .mdpkg 読み込み
│  ├─ 展開済みフォルダの安全な読み書き
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
| `folder_document.rs` | Folderモードの走査、境界・link検証、ファイル単位atomic save、削除差分反映 |
| `commands.rs` | Tauri コマンド（open / save / new / import / export） |

## React 側（document UI）

| モジュール | 責務 |
|---|---|
| `lib/document.ts` | Document State（files / manifest / dirty / discriminated `DocumentOrigin` / Folder保存ベースライン） |
| `lib/documentPersistence.ts` | originによるPackage/Folder保存経路の振り分け。成功時のみdirty解除 |
| `lib/fileTree.ts` | フラットパス → ツリー構造 |
| `lib/markdown.ts` | 相対パス解決（パッケージ外参照を拒否） |
| `lib/sanitize.ts` | 危険な HTML の除去 |
| `lib/tauri.ts` | Tauri コマンド呼び出し |
| `components/` | FileTree / Editor / Preview / Toolbar / StatusBar / DrawingEditor |

## Drawing レイヤー（v2）

```
MaCa Editor integration (src/lib/drawing)
        ↓ public API only
@maca/drawing-react (packages/drawing-react)
        ↓
@maca/drawing-core (packages/drawing-core)
```

```
Drawing Domain Model (@maca/drawing-core)
   ↓ SVG Renderer (packages/drawing-core/src/svg.ts)
   ↓ JSON Serializer (packages/drawing-core/src/drawing.ts)
```

### 責務

| モジュール | 責務 |
|---|---|
| `packages/drawing-core` | model、validate、編集、幾何計算、SVG生成 |
| `packages/drawing-react` | DrawingEditor、ShapePicker、React integration contract |
| `src/lib/drawing/integration.ts` | `.draw.json` + `.svg` のファイル生成 |
| `src/lib/drawing/docIntegration.ts` | Document / manifest / Markdown への統合 |

### 設計原則

- `.draw.json` が source of truth。`.svg` はそこから完全再生成される一方向関係
- アプリ側は`@maca/drawing-core`と`@maca/drawing-react`の公開APIだけを利用する
- coreはReact、DOM、Tauri、MaCa Document Modelへ依存しない
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
- Folderモードは相対package pathのみ受け入れ、Rust側でcanonical root配下を確認する
- Folder走査・保存ではsymlink/junctionを拒否し、フォルダ外の読み書きを防ぐ
- SVG 生成は静的出力のみ（script / event handler を含めない）

## Document originと保存

`DocumentOrigin`は`package`、`folder`、`untitled`のdiscriminated unionであり、拡張子や文字列からモードを推測しません。Packageモードは従来のZIP writerを使い、Folderモードはオープン時パス一覧と現在のDocument Modelとの差分から削除・renameを反映します。FolderからのPackage exportは同じpackage validation/writerを通しますが、originを変更しません。

FolderモードはRust側の`notify` watcherでrecursiveなfilesystem eventを受け、Tauriイベントとしてフロントへ通知します。短時間の連続イベントをdebounceした後、フォルダ内容のcanonical fingerprintを比較します。clean状態の外部変更はDocument Modelを再読込し、dirty状態ではローカル編集を保持したまま競合としてSaveを停止します。監視通知と競合判断は分離され、`folderSync.ts`はOS固有イベントへ依存しません。
