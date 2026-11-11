# モジュール構成・依存関係のレビュー（2026-11-11）

## 対象と方法

基準コミットは `1efeb86`。フロントエンド、drawing の2パッケージ、Rust のコマンド登録・履歴転送・保存・Windows ドロップ処理を確認した。TypeScript の本番109モジュールについて、ASTから静的import/exportと文字列の動的importを調べた。全関数の動作や他OSのネイティブ動作を網羅した保証ではない。

## 指摘と修正

| 優先度 | 指摘・影響 | 修正 |
|---|---|---|
| P2 | `mathjax/docIntegration.ts` は PlantUML/Mermaid とほぼ同じ処理を独自実装し、保存時に staleResources を解除せず、欠落したSVGも復元しない。ソースを直接編集した後、保存しても古い図の扱いが残る。 | `textDiagramDocument.ts` に検索・採番・追加・保存を集約。3形式とも `updateRenderedDiagram` を経由する。形式ごとの公開関数・既定ソース・拡張子は従来のモジュールに残した。 |
| P2 | CodeMirrorのstate/view、unified、mdast/unist型を直接importする一方、package.jsonには未宣言。推移的依存の配置に依存しており、親依存の変更で解決できなくなる。 | 3つの実行時依存と2つの型依存を直接宣言。既存lockのバージョンを使用し、依存パッケージの更新はしていない。 |
| P2 | `documentPersistence.ts` が既定実装として `tauri.ts` を実行時importし、文書の保存ユースケースをSDK・イベント・履歴IPCに結合していた。インターフェースも実装のtypeofで定義していた。 | 要求・応答型から `PersistenceCommands` を定義し、明示的に注入する。AppがTauri実装を組み立て、純粋な文書処理からデスクトップSDKへの依存を取り除いた。 |
| P3 | Rustの `commands -> history_transfer -> commands` と `commands -> windows_drop -> commands` が共通ヘルパーを介して循環していた。起動処理もDB配置をコマンド層から取得していた。 | DB配置を `history_storage`、画像拡張子の方針を `image_formats` に移した。IPCコマンド、履歴転送、Windowsの実装がそれぞれ下位の共通モジュールに依存する。SQLite本体へTauri依存は追加していない。 |
| P3 | Appが文書セッションに加えて通知ID採番・履歴50件制限・エラー表示の遷移も直接管理し、独立したUI機能が混在していた。 | `useAppNotifications` に通知の状態と操作をまとめた。文書交換時のリセット、詳細再表示、関連操作だけのエラー解除をメソッドとして公開し、生のsetterをAppに公開しない。 |

## 粒度と依存方向の判断

- `drawing-core` はモデル・編集・幾何・SVG出力に分かれ、Reactやアプリをimportしない。`drawing-react -> drawing-core`、アプリから両パッケージの公開入口、という方向は妥当。今回この境界は変更していない。
- 描画エディタはコールバックとpreferencesでアプリに接続され、mdpkgの保存形式やTauriを知らない。UI実装は大きいが、サイズだけを理由にcoreへイベント処理を移すと境界を悪化させる。
- テキスト図のレンダラーは形式固有のエンジンを所有し、文書への追加・保存はエンジンをimportしない共通ユースケースに分離した。drawingはJSONモデルの直列化も必要なため、テキスト図の共通化には混ぜていない。
- Appは引き続き大きい。今回通知という独立した責務を切り出したが、文書セッション・保存中の編集・履歴・非同期タスクの整合性を持つ調整層は残している。次に分ける場合は文書セッション単位で状態と操作を一緒に移し、行数だけの機械的分割を避ける。
- Rustのsaved_historyはSQLite保存・保守・圧縮コピーに分かれている。DBのトランザクション境界と非公開補助処理を共有しており、行数だけで独立パッケージ化する利点は小さい。OS依存の印刷・ドロップは既存のcfg境界を維持した。
- TypeScriptの静的な実行時循環依存は検出されなかった。`document` と `folderSync` の型参照は実行時に消えるため、実行時循環とは区別した。

## 再発防止

`npm run check:architecture` を追加し、PR・mainへのpushのCIでテストとビルドと共に実行する。

検査対象は、実行時の静的循環依存、パッケージの公開入口を迂回する相対参照、再利用パッケージからアプリへの参照、drawing-coreの外部依存、libからcomponentsへの参照、未宣言の直接依存、文書保存からSDKへの推移的な実行時依存。型だけのimport/exportは実行時グラフから除外し、遅延importは境界検査には含めるが静的循環とは数えない。

計算された動的import、実行時のグローバルアクセス、Rustの依存関係はこのチェックの対象外。Rustの逆依存はソース確認とWindowsでのコンパイル・テストで検証した。

## 検証結果

- MathJaxの回帰テストが修正前に失敗し、修正後に通過することを確認。直接編集後のstale解除とSVG欠落時の再作成を検証。
- `npm test`: 82ファイル・788テスト成功。Appの保存・Undo/Redo・通知履歴・エラー再表示の既存統合テストを含む。
- `npm run build`: 型検査と本番ビルド成功。Viteの大きなチャンクの警告は残る。
- `npm run check:architecture`: 本番109モジュール成功。一時的にSDK依存・循環・パッケージ境界違反・未宣言依存を注入し、4種類とも失敗することを確認してから元に戻した。
- Windowsで `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline`: 217テスト成功。サンドボックス内では一時ファイル置換がアクセス拒否になったため、通常権限で再実行した。
- macOS/Linuxのネイティブビルド・実機UIは今回実施していない。
