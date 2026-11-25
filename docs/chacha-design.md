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

## Phase 1：設定・プロンプト

- 人格・頻度を `chachaPreferences` として既存 settings.json に保存する。専用の保存キーを
  検証し、既存4項目の保存と相互に上書きしない。enabled/comment 等は受け付けない。
- AI 設定内に独立した「茶々入れ設定を保存」を置く。既存 AI 接続設定の保存ボタンとは
  独立して保存・適用する。閉じれば未保存の入力は破棄される。
- 文字数は Unicode コードポイント数。10000文字の絵文字も許容し、JS/Rust双方で検証する。
- 固定制約・人格は別の system message、対象文章は JSON の user message とする。
- TDD: 未実装モジュールによる Red、設定型拒否による Rust Red を確認してから実装。
  設定/保存/復元/失敗/文書非永続化の新規フロントテスト12件、Rustテスト1件。
- このフェーズでは自動送信・有効化は接続しない。
- ブラウザで設定ダイアログの縦・横はみ出しを発見し、通常幅/360px幅の Red を確認。
  ダイアログ内スクロールとボタンの折り返しを追加して2件 Green。
  このブラウザ回帰テストを既存 test:browser/CI に組み込む。
- ローカルの全フロント931件、Rust233件が成功。Windows sandbox の atomic rename
  拒否は通常環境で再実行して解消。ブラウザ描画も確認。

## Phase 2：抽出と発火判定

- mdast-util-from-markdown を再利用。先頭 frontmatter は UTF-16 位置を維持してマスクし、
  未閉鎖の場合も保守的に除外。段落と見出しの AST だけを利用する。
- 画像・添付 URL は含めず、リンクは表示文のみ。HTML を含む段落と本文中のローカル
  絶対パスも保守的に除外する。本文や他ファイルを暗黙に読み込まない。
- 2000文字は Unicode コードポイント数。補助段落を途中で切らず、入り切らない場合は
  その補助文脈を省略する（対象→見出し→前→後の優先順）。CM のアンカーは UTF-16。
- 重複判定はファイル ID と実際の送信文脈の完全一致、最大128件。ハッシュ衝突を避ける。
  ファイル切替・停止では編集予算だけを消し、文書セッション内の送信間隔・重複情報は保持。
- IME は変換開始前と確定後の実差分を一度だけ集計。単なる位置・表示変更は編集に含めない。
- TDD: 抽出12件、発火・重複10件、IME/Unicode集計4件で未実装 Red と Green を確認。
  タイマー・通信・エディタ接続は後続フェーズで追加し、この時点では自動送信しない。

## Phase 3：通信・状態・失効

- 文書セッション単位の ChachaSession が唯一の状態を所有する。編集・表示・応答期限は
  単一のタイマーで管理し、busy 条件の固定ポーリングや自動リトライを行わない。
- 中止は AbortSignal と既存 CancellationRegistry、失効は単調な世代番号で独立して保証。
  CM ChangeDesc で範囲を補正し、送信範囲の編集は失効。表示前にも構文・文脈を再確認。
- 未展開180秒、保留30秒、要求60秒。展開中は時間だけでは失効しない。
- 既存 OpenAiCompatibleProvider の設定/認証/リクエスト変換を再利用。茶々入れだけは
  SDK リトライ層を通さず reqwest で一度実行。上限は要求64KiB、HTTP応答8KiB、
  モデル本文4KiB、出力256トークン、コメント120 Unicode文字。Tool/Agent/Searchなし。
- native command は保存済み設定を読む。接続設定（キーも含む）の SHA-256 リビジョンを
  有効化時と送信前・応答後に比較し、変更時には再有効化を要求。接続要約にキーを含めない。
- native の専用 semaphore は茶々入れ1件だけを許可し、明示的な AI 操作は制限しない。
  認証失敗・429・連続3失敗は理由付き停止。Retry-After の秒/HTTP日時を尊重し、再開も明示操作。
- エラーは固定の種別と Retry-After だけ。本文・キー・接続 URL・生成内容を診断へ出さない。
- TDD: 応答/アンカー18件、セッション20件、通信adapter2件、Rust5件。
  開始直前停止、Retry-After迂回、キャンセル未完了の多重送信も Red→Green で修正。
  実LLMは使わず、Fake Timer/遅延Promise/ローカルHTTPサーバーで検証する。
- UI への自動送信接続はまだ行わない。
- 旧設定とのマージ後に既存の64KiB読込上限を超えるケースを Red→Green で修正。
  保存前に総サイズを検証し、通常のエディタ設定が読めないファイルを作らない。

## Phase 4：CodeMirror・吹き出し

- CodeEditor の Compartment にドメイン専用 ViewPlugin/StateField/StateEffect を追加し、
  MarkdownEditor 経由で注入できるようにする。Appの有効化UIへの接続は次フェーズ。
- `gutter({side:"after"})` は有効中52pxを維持。24pxボタン2個。コメントの出現・削除で幅を変えない。
  GutterMarkerを段落位置に配置し、展開時のみTooltipを生成。出力はtextContentのみ。
- CMガターの既定 `aria-hidden=true` は右側の茶々入れコンテナだけ解除し、左ガターは維持する。
  到着時はfocus/selection/scroll/本文/履歴を変更しない。明示キーボード展開時のみnoteへfocusし、
  Esc/削除でeditorへ戻す。本文にリンクや画像を生成せず、到着時の自動読み上げも行わない。
- EscはPrec.lowestのDOMハンドラでIMEイベント自体も検証。既存keymap・検索・補完・Vimを優先。
  Vim有効時のeditor Escは扱わず、専用Mod-Alt-Enter/Mod-Alt-Backspaceを提供する。
  明示展開したnote内のEsc/専用削除キーも処理する。
- 画面外判定はCMのvisibleRanges/lineBlockAtとscroll位置を使用。update中のcoordsAtPosを避ける。
  refresh dispatchはmicrotaskへ遅延し、destroy後のdispatch・listener・timerを残さない。
- 最終ユーザー変更の逆写像で対象の旧/新raw段落を比較し、全段落削除で隣の未編集段落を送らない。
  controlled同期は編集量をリセット。IMEはcomposition確定時に集計する。
- ブラウザでrandomUUID未提供の環境を検出。getRandomValuesでRFC4122 v4を構成する代替を追加。
- TDD: 新規フロント8件、実ブラウザ6件。IMEキー、ガターのA11y隠蔽、note内削除キー、
  UUID互換性をRed→Greenで修正。ライト/ダーク、900px/360px幅、Vim、補完/検索、
  焦点/選択/スクロール/折返し不変、plain text、画面外破棄を確認し、スクリーンショットも目視確認。
- 全フロント1005件、build/tsc/architecture成功。全体並列検証で設定テストの開発サーバー起動が
  30秒を超えたため、既存のVite build+IIFE fixture方式に揃えた。製品の検証項目は維持する。
