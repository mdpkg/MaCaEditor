# AIチャット通信契約

Phase 0（2026-11-26）。通常チャットのUIは単一会話のまま、後続のセッション化に先立って通信を分離する。

- `ai_document_chat` はUIが事前発行したUUIDを受け取り、ストリーム終了まで待つ。成功値は `{ request_id, content }`。確定回答全文を返す。
- Channelは開始・途中経過の表示に利用する。Channelの終端で回答や送信枠を確定しない。command成功値で途中表示を置き換え、以後のイベントを無視する。
- `ChatTransport` のアプリ共通の物理送信枠と、nativeのチャット専用Semaphoreは待ち行列を持たない。論理失効後もcommand終了まで物理枠を保持する。
- 停止・消去・アンマウントは先に論理失効し、その後キャンセルを試す。キャンセル失敗でもnativeの全体期限（既定300秒、最大600秒）が接続開始を含めて有効になる。接続期限は既定10秒、最大60秒。
- CancellationRegistryは登録前キャンセルと終了済みIDを60秒・最大256件記録する。記録の検査と登録は同一ロック内で行う。上限超過時は古い記録から破棄する。実行中IDの再登録は拒否する。
- 正常完了した質問・回答の組だけを次回のAPI履歴に含める。停止・失敗・未完了ターンは表示用に保持し、送信履歴から組ごと除外する。手動再試行は最後の失敗回答だけを置き換える。
- nativeはシリアライズ済み要求を1MiB、回答を64KiB UTF-8に制限する。UIでも途中受信と確定回答の64KiB制限を確認する。
- 選択範囲AIと図編集の既存の開始時返却契約は変更しない。

自動検証はFake Channel、制御可能なPromise、mock provider、停止したTokio Clockを使用する。実LLMは呼ばない。クライアントの通信終了は接続先内部の推論停止を保証しない。

マルチセッション・文書寿命・接続revision同意・茶々入れ継続・時間制御は後続Phaseで扱う。

Phase 1:
- App owns the memory-only session controller using documentSessionRef, independent of save destination and panel mounts.
- RequestOwner identity checks include document scope, session, generation, request ID and terminal state.
- Session limits: 20 sessions; 10,000 Unicode characters per question; 1MiB UTF-8 draft; 200 messages with two reserved at begin; 64KiB answer; 8MiB total session strings with answer reservation. No truncation, eviction or summarization.
- chat_connection exposes only origin, model and revision. ai_document_chat accepts the expected revision, reloads and validates saved configuration, then uses that same owned snapshot for provider/model/key/timeouts. Blank saved keys explicitly override environment defaults. No connection credentials are sent from chat UI.
- Every existing session requires its own confirmation when revision changes. Confirmation alone never sends an LLM request. External changes are checked natively on every send and refreshed on window focus.
- Tabs, file-operation tracking and visibility-only panel close are introduced in Phase 2. Until then the selected session is presented through the existing single-conversation layout and close still cancels.

保持量上限付近でもエラーで要求を終端できるように、実行中は回答64KiBに加えてエラー詳細用16KiBも予約する。エラー詳細は4,096 UTF-16コード単位までに制限し、8MiB上限を超える下書きの追加を拒否して既存内容を保護する。
