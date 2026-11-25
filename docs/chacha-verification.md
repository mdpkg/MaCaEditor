# 茶々入れ機能の検証記録

2026-11-26、Windows開発環境およびGitHub ActionsのWindows/Linuxで検証。実装前のmainは `fd0f1ee`。実LLM APIは自動テストから呼び出していない。

## 構成と確認範囲

| 層 | 主なファイル | 観測した契約 |
|---|---|---|
| 設定 | `chachaSettings.ts`、`chachaPreferences.ts`、`ChachaSettings.tsx`、`editor_preferences.rs` | 指定の初期人格、空欄復元、10,000文字、独立保存、設定総サイズ、既存設定との共存 |
| 抽出・発火 | `chachaContext.ts`、`chachaEdits.ts`、`chachaTrigger.ts` | 段落/補助文脈/除外、2,000文字、UTF-16位置とUnicode文字数、確定IME差分、全プリセット、128件の重複抑制 |
| セッション | `chachaSession.ts`、`chachaAnchor.ts` | 単一要求/タイマー、世代失効、範囲追従、文脈変化、遅延/逆順/キャンセル失敗、30秒/180秒/60秒、停止/再開、100回開閉後の後始末 |
| native通信 | `chachaTransport.ts`、`ai/chacha.rs`、`ai/openai.rs`、`commands.rs` | 既存接続/鍵/キャンセルregistry、同意時revision、無リトライ、native同時実行制限、bounded入出力、認証/429、本文や鍵を含まないエラー |
| CM6 | `chachaEditor.ts`、`CodeEditor.tsx`、`MarkdownEditor.tsx` | after gutter52px、24pxボタン、StateField/Effect、ChangeDesc、Tooltip、ViewPlugin破棄、本文/履歴/選択/焦点/スクロール不変 |
| App | `useChachaRuntime.ts`、`ChachaControls.tsx`、`App.tsx`、既存AI設定/StatusBar | 初期無効、文書単位説明付き同意、切替/閉じる/再起動時の非継承、同一パッケージ内の同意維持、接続変更再同意、設定の確定適用 |

状態は文書モデルから分離し、本文変更なしの表示更新は履歴へ入れない。応答は世代番号で一度失効すると復活しない。対象/補助文脈変更を即時失効させ、外側変更は位置を写像し、構造変更時は抽出文脈を照合する。コメントは最大1件で、キューを持たない。

固定System制約、利用者人格System、JSONの対象文脈Userの3メッセージで合成する。文書の命令を実行するツール、エージェント、Web検索、ファイル操作を通信要求へ付けない。APIキーはnativeの既存資格情報管理から取得する。

## 自動検証

基点と最終フェーズの差分は、フロント101件、Rust7件、ブラウザ13件の計121件。件数はパラメータ化テストを含み、テスト対象は公開動作・入力出力・可視状態を中心とする。

| コマンド | 最終フェーズの対象 |
|---|---|
| `npm test -- src packages` | frontend 1,020件（基点919件） |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` | Rust 239件（基点232件） |
| `npm run test:browser` | Chromium 30件（基点22件） |
| `npm run test:chacha-app` | 実App + Fake Tauri/LLM 5件（新規） |
| `npm run build` | TypeScript型チェックとVite production build |
| `npm run check:architecture` | 既存の依存境界チェック |
| `node --test scripts/release-notes.node-test.cjs` | 既存リリースノート処理の回帰 |

独立したlintコマンドは既存リポジトリにない。architectureと型チェックを実施する。既存の大きなbundleに対するVite警告は残る。jsdomの既存geometry/act警告とテスト失敗は区別する。

Phase 6のローカル実行は上記すべて成功（release-notesは2件）。Rustの初回並列実行では、既存 `saved_history::tests::keeps_shared_payloads_without_requesting_reclaim` が一時DB削除時のWindows共有違反（OS error32）で238/239件となった。全239件の直列再実行は成功し、テスト無効化や期待値の変更は行っていない。CIでは既存の通常並列コマンドを維持する。

CIはfrontend、rust-windows、rust-linuxの3job。frontendに実App5件を組み込み、Linux側は既存のglib security backportテストも実施する。各PhaseのPRとマージ後の対象コミットを照合する。最終mainのCI URL・マージSHA・後片付け結果は完了報告に記録する。

## 実ブラウザの確認

- ライト/ダーク、900px/360px幅の固定ガターと展開ポップオーバー。到着/削除で本文・折返し・焦点・選択・スクロールが変わらない。
- クリック/専用キー/通常Esc/×での展開・削除と焦点復帰。Vim Insert→NormalのEsc、補完・検索のEscを優先。
- HTML/画像/リンク/スクリプト表記を含むコメントを文字列として表示し、DOM要素や外部通信が生まれない。
- 実Appの同意ダイアログ、初期無通信、初回編集条件、人格の保存と反応切替、停止再開、接続変更、ファイル/文書切替、保存データへの非混入。
- 360pxで同意が画面内に収まり、ステータスバーの透明度を継承しない。接続未設定の回復ボタンも画面内で操作できる。
- キャンセルを無視する遅延応答があっても編集/保存/ファイル再訪が可能で、古いコメントが出ない。LLM停止時も編集/保存でき、3回失敗で静かに停止し、再開だけでは再送しない。

スクリーンショットは作業記録の `output/chacha-workflow/` に保持し、collapsed900/light・expanded360/dark・実App同意360を目視確認した。画像とworktreeをリポジトリへ混入しない。

## 設計判断と制約

- 既存AIのSDK自動リトライを自動通信へ持ち込まないため、同じprovider内に小さな無リトライ経路を追加した。通常AIの挙動は維持する。
- 自動通信全体は専用60秒（既存明示AIは既定300秒）。接続は保存値と60秒の小さい方。256出力トークン、8KiB HTTP応答、4KiBコメントJSON、64KiB要求を上限とする。
- コメント120文字・人格10,000文字・送信2,000文字はUnicodeコードポイント数。書記素クラスタ数ではない。アンカーはCMのUTF-16オフセット。
- 補助文脈が上限へ収まらない場合、途中で切らずブロック全体を省く。対象が長すぎる場合は送らない。
- インラインHTMLや絶対パスが疑われる段落を保守的に見送る。POSIXパスの境界が曖昧なため、プレーンテキストに `/` がある段落（`A/B`、裸URLを含む）も除外する。
- Vim有効時のエディタEscは常に既存Vimへ委ねる。コメント専用キーでマウスなし操作を保証する。
- 保存先変更も新しい文書の同意単位とみなす。初回送信は編集/idleが必要だが、直前の送信がなければ送信間隔の追加待ちはない。
- 接続revisionはnativeで保存設定と鍵を含めSHA-256照合し、値そのものを文書や診断へ出さない。本文に利用者が直接記載した秘密を一般に検出する仕組みではない。

## 未確認・利用者による確認が必要な事項

OSの日本語IMEによる実際の変換・候補選択・確定/取消は未確認。合成CompositionEvent、未確定/確定差分、isComposing/keyCode229、Esc競合の自動検証と区別する。Windows WebView2/macOS WebKit/Linux WebKitでの本機能の実操作、OS拡大表示、スクリーンリーダー実機も未確認。

実際のLLM接続先での人格・反応品質・料金・プロバイダー差は未確認。OpenAI互換のFake/Stub/ローカルHTTPサーバーで通信契約を確認した。

長時間の人間による日本語/Vim執筆、吹き出しを無視し続けた際の集中度、頻度の心地よさ、画面の読みやすさは主観評価が必要。反復開閉100回・Fake Clockによる長時間経過・遅延/失敗テストの成功から、その快適さが確認済みとは判断しない。
