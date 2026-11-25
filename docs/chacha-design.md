# 茶々入れ機能：調査・設計・検証計画

## 実装前調査（Phase 0）

基点は main `fd0f1ee`。リポジトリおよび親ディレクトリに AGENTS.md はない。
既存の設計文書は docs、利用者向け説明は README.md / README_en.md に配置する。

| 調査対象 | 既存機構と採用方針 |
|---|---|
| アーキテクチャ | React/TypeScript UI、Tauri/Rust による設定・通信・保存。文書モデルに茶々入れ状態を追加しない |
| エディタ | CodeEditor が CM6 を所有し MarkdownEditor がラップ。view 6.43.9、state 6.7.1、lang-markdown 6.3.4（package.json の範囲） |
| キーマップ | basicSetup、Prec.highest の既存 DOM ハンドラ、Compartment 内の codemirror-vim。茶々入れ Esc は Prec.lowest のキー処理。Vim 有効時は Esc を処理しない保守的方針 |
| IME | compositionstart/end と確定後の onChange。未確定トランザクションを集計せず、確定前後の差分を一度計上する |
| 補完・検索 | basicSetup の補完、@codemirror/search のパネル。既存状態 API とダイアログの aria-modal を送信・表示双方で確認 |
| ダイアログ | Dialog/useDialog がフォーカス復元・Esc・モーダルを管理。既存 AI 設定ダイアログに設定を追加 |
| 構文解析 | mdast-util-from-markdown と unified/remark-frontmatter を再利用。段落ノードのみ抽出し code/html/yaml を除外 |
| ライフサイクル | App.documentSessionRef は文書置換時に増加、ファイル key によりエディタが再生成。文書セッション内だけ有効化し、editor 破棄時に通信とタイマーを解放 |
| 設定 | 固定 settings.json の read_editor_preferences/save_editor_preferences。Rust 側で許容キー・型を検証。人格と頻度のみ追加永続化 |
| LLM | AiConfig/保存済み API キーと OpenAiCompatibleProvider、CancellationRegistry を再利用。既存会話履歴を使わない |
| 通信の差異 | 既存 Provider は SDK リトライ層を使用し、既定 timeout は300秒。茶々入れ専用の無リトライ・60秒制限・サイズ上限を既存 AI モジュールに追加する |
| Undo/Redo | App の共有履歴と controlledChange。本文と別の ViewPlugin/UI 状態に保持し、本文変更を伴わない操作を履歴へ入れない |
| テーマ・A11y | 既存 CSS 変数と Dialog、24px 以上のボタン、aria-label/expanded、プレーンテキスト、到着時に読み上げ・フォーカス変更しない |
| CI | Vitest/jsdom、Playwright ブラウザ、architecture、tsc/vite、Rust Windows/Linux。独立 lint script はない |

## 採用設計

設定・プロンプト、段落抽出、状態管理、通信 adapter、CM ViewPlugin に責務を分ける。
時刻・タイマーは fake timer で検証し、通信は fake を注入する。
有効化・pause は文書セッションのみ、重複抑制は上限付きセッションメモリ。
リクエストは一件。世代番号で失効させ、キャンセル失敗後の応答も破棄する。
送信範囲は CM ChangeDesc で追従し、送信範囲に触れる変更は即時失効。
最低間隔は送信開始から計測。初回も編集量・idle 条件を必須とする。

右側ガターはインストール済み @codemirror/view の `gutter({side:"after"})` を使用できる。
有効な間は一定幅を確保し、GutterMarker を段落アンカーへ配置する。
本文は Tooltip に textContent で表示する。Esc は既存キー処理より低優先度で、
IME/補完/検索/モーダル/Vim 中は処理しない。専用展開・削除操作を別途提供する。

## フェーズと安全な公開境界

各フェーズは専用 worktree、細粒度 Green commit、PR、CI、マージ、main CI、後片付けを完結する。

0. この調査・設計・テスト計画。機能動作変更なし。
1. 設定・人格プロンプト・頻度・保存検証と設定 UI。自動送信は未接続。
2. 段落抽出、除外、上限、編集量・発火判定・重複抑制。自動送信は未接続。
3. 無リトライ通信・構造検証・状態/寿命/失効・エラー制御。自動送信は未接続。
4. CM 右ガター・Tooltip・範囲追従・破棄・キーボード操作。自動送信は未接続。
5. 文書単位の説明付き opt-in、pause/resume、設定/接続変更の停止と全体統合。
6. 統合/回帰/UI 検証、利用者向け文書、レビュー。

## TDD・検証計画

各振る舞いを先にテストし、意図した Red を確認してから最小実装し Green を確認する。
通常テストから実 LLM を呼ばない。遅延・キャンセル失敗・逆順応答は fake で再現する。

- 設定：初期値、空白、10000文字上限、保存/キャンセル/復元、既存設定の保持。
- 抽出：段落と前後、見出し、frontmatter/code/html、2000文字、日本語・絵文字、空/長文。
- 発火：全プリセット、編集のみ、確定 IME、idle/最低間隔、busy 条件、重複/上限。
- 通信：構造・120文字・サイズ、無リトライ、timeout/cancel、認証/429/3連続失敗。
- 競合：送信文脈変更、外側変更の map、文書/ファイル/設定切替、破棄・世代・Undo。
- UI：未展開/展開/削除、固定幅、焦点/選択/スクロール保持、画面外、180秒/30秒。
- 操作：IME、補完、検索、モーダル、Vim の Esc 優先と専用コマンド。
- 保存：コメント・同意・履歴が文書/dirty/manifest/mdpkg に混入しない。
- 回帰：npm test、build（tsc含む）、check:architecture、browser、release notes、cargo test --locked --lib。
- ブラウザ UI は fake 通信で確認し、実 IME・主観的な執筆体験と機械検証を区別して報告する。

仕様の数値は変更しない。実装で必要になった判断・検証証跡はこの文書に追記する。
