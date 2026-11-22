# Marp プレビュー

先頭 YAML frontmatter のトップレベルが boolean の `marp: true` の場合、Markdown を Marp Core 4.4.0 で表示します。文字列の `"true"`、不正な YAML、重複キーは通常 Markdown 表示になります。不正な YAML には警告を表示します。Markdown 以外には適用しません。

標準の `default`・`gaia`・`uncover`、16:9・4:3、ページ番号、ヘッダー／フッター、クラス、背景、MathJax SVG 数式、パッケージ内の画像と SVG に対応します。[サンプル](../example/marp-example/slides.md) のフォルダをフォルダモードで開けます。原文、Document Model、manifest、Package／Folder の保存経路は変更しません。

## 責務と再利用

- `DocumentPreview` は内容から形式を判定し、通常文書は既存の `MarkdownPreview` へ渡します。通常 Markdown の描画・印刷・精密スクロール同期は従来の実装を使用します。
- `MarpPreview` は 250ms debounce、遅延読み込み、更新の破棄、警告、再試行、表示位置、前後移動と CodeMirror のスライド単位同期を管理します。生成 HTML/CSS は UI の一時状態だけです。
- `lib/marp/render.ts` は原文全体を公式 Marp Core に渡します。独自の Markdown 解析・スライド分割・レイアウトは行いません。
- `resources.ts` は生成結果の DOM と CSS AST の URL を既存の `FileInfo[]`、`resolvePackagePath`、`imageMediaType`、SVG の `sanitizeHtml` に接続します。一般的な CSS サニタイザーではありません。
- 文書移動と添付ファイルは既存のコールバック、外部リンクは検証済み http(s)/mailto を親画面で開きます。iframe はリンク先へ遷移しません。同一文書の見出し ID／スライド番号アンカーは対象スライドへ移動します。

## 原文位置とスクロール同期

公開の `Marp.use`／markdown-it core ruler 拡張を使い、Marpit が作成した `marpit_slide_open` の `map[0]`（開始行）を読み取ります。行を UTF-16 文字オフセットへ変換し、次の開始位置を exclusive end とします。BOM・CRLF・絵文字、コードフェンス内の区切りをテストしています。

このトークン名・map は Marpit の API ソースで説明されていますが、独立した安定版ソースマップ API ではありません。トークン構造への依存はこの一点に限定し、Core 4.4.0 と Marpit 3.2.3 を lockfile で固定しています。未知のテーマはテーマ存在判定と Marpit の型付き `renderStyle` 拡張点で default に戻します。アップデート時は原文対応・描画・安全性の契約テストを再実行します。単純な `---` の正規表現分割は使用しません。

エディターからは最初の十分に見える行ブロックの原文位置をスライドへ対応付けます。プレビューからは代表スライドの開始位置へ移動します。同じスライドは再同期せず、CodeMirror のプログラムによるスクロール反射を描画フレームで抑止します。本文と変換結果が一致しない debounce 中には古い位置表を適用しません。

表示位置は原文と開始オフセットを文書単位の UI state として保持します。変更後も残る原文の末尾部分でアンカーを追従し、それが残らない場合は共通の先頭・末尾から変更範囲を推定して近い位置へクランプします。複数箇所を同時に置き換える編集では近似になります。スライド番号だけを保存する方式ではありません。

## iframe とセキュリティ

同じ iframe を更新間で再利用します。`sandbox="allow-scripts"` のみを許可し、`allow-same-origin`、フォーム、ポップアップ、親画面遷移は許可しません。固定の同梱補助コードのみ nonce 付き CSP で実行します。`default-src 'none'`、`connect-src 'none'`、`font-src 'none'`、`img-src data:` を指定します。親画面の CSP や Tauri 権限を緩和する変更はありません。

文書 HTML は `html:false`、Marp の補助コードは `script:false` です。Phase 0 で `html:false` でも文書の `<style>` が CSS に追加される挙動を再現したため、公開 ruler API から `marpit_style_assign` を無効化します。`style:` ディレクティブも適用しません。MathJax SVG を固定して外部フォントを不要にし、CDN の絵文字画像を無効化します。CSS・テーマは同梱の標準テーマだけです。

生成 HTML は DOMPurify を通します。Marp 自身が必要とする SVG `foreignObject` と HTML の接続だけを専用 purifier で許可し、パッケージ由来 SVG は既存のより厳しいサニタイズ（foreignObject・スクリプト・イベント・スタイルシートの除外）を維持します。SVG 内の非ローカル参照も削除します。

パッケージ画像以外の URL は data URL に変換せず、警告して省略します。ラスター画像の拡張子と先頭バイトを照合します。CSS は css-tree で構文解析して URL を接続し、import と font-face を除外します。外部通信の最終境界は iframe CSP です。テーマ同梱の固定 data URL アイコンは保持します。

通信は `event.source`、ランダムなフレームセッション、描画世代、メッセージ種別・構造・数値範囲・リンク長を検証します。iframe が要求できるのは表示スライドと検証済みリンクだけです。Tauri コマンドや認証情報を payload に渡しません。初期化／更新の応答が 10 秒以内に得られない場合は再試行を表示します。

実 WebView2 では、Wry 0.55.1 が `for_main_frame_only` を無視して子フレームにも Tauri 初期化を注入することを確認しました。sandbox/CSP だけではこのネイティブ注入を阻止できません。そのため、既存バージョンの Wry を `src-tauri/vendor/wry` に保持し、Windows の main-only 初期化と IPC ブリッジにトップフレーム判定を加えています。ソースとの差分は `webview2/mod.rs` の 2 箇所だけです。既存の公開フラグを実際に守る修正であり、独自 IPC や描画基盤は追加しません。経緯と更新時の注意は同ディレクトリの `README.maca.md` に記載しています。他 OS の実装は変更しません。

## 制約と容量

- YAML は UTF-8 64 KiB まで。エイリアス・重複キー・不明なタグは拒否します。
- 本文は 1,048,576 UTF-16 文字、500 スライドまで。ディレクティブ／URL 属性の値は 8192 文字までです。
- 画像の入力表現は 8 MiB、data URL 展開量は重複参照も含め 24 MiB、送信 HTML/CSS は 32 MiB までです。容量超過は警告またはエラーになります。
- 独自 CSS、任意 HTML、外部画像／フォント／CSS、Mermaid 直接描画、全画面発表、発表者モード、スライド印刷／エクスポートには対応しません。通常 Markdown の印刷は維持します。
- 数式は同梱 MathJax SVG を使います。Marp の自動フィッティング補助スクリプトは実行しないため、長すぎる内容は Markdown 側で調整してください。
- 全文変換を行い、Worker・差分描画・永続キャッシュは導入していません。

## 検証記録（2026-11-22）

Phase 0 の技術検証は、実 API／ブラウザーの挙動を調べるため単体 TDD の例外としました。それ以外は判定、原文位置、レンダラー、画像、コンポーネント、印刷分岐、容量制限について、失敗確認後に実装し成功へ進めました。主要な小コミットは `7af92c3`（判定）、`8e2445f`（位置）、`2f2466a`（描画・隔離）、`f605465`（リソース）、`2e0a83a`（編集統合）です。実ブラウザーで見つかった同期の境界問題は、その再現テストを使って修正しました。

Windows Chromium の本番モードで標準テーマ、サイズ、数式、画像／SVG 背景、高 DPI、リサイズ、iframe の不透明 origin、CSP による外部アクセス遮断、文書由来 JS の不実行、双方向同期、追加後の復元、アンカー／文書／添付リンクを検証しました。`npm run test:browser` に既存の画像サイズ・SVG 安全性テストと合わせて組み込んでいます。

最終のローカル検証は `npm test` 852 件、`npm run test:browser` 15 件、Windows Rust 227 件が成功しました。`npm run check:architecture`、`npm run build`、`git diff --check` も成功しています。既存の大きなバンドルに加えて Marp の遅延チャンクが約 2.1MB（gzip 約 654KB）あるため、Vite のサイズ警告は残ります。

同じ環境の簡単な見出し・箇条書きの文書で、ウォームアップ後の全文変換とイベントループ遅延を測定しました。

| スライド | 変換 | イベントループ遅延 | JS heap（処理後） | HTML/CSS 文字数 |
|---:|---:|---:|---:|---:|
| 5 | 42ms | 43ms | 約 31MB | 42,303 |
| 50 | 40ms | 40ms | 約 38MB | 54,254 |
| 200 | 71ms | 71ms | 約 47MB | 94,555 |

GC・初回読み込み・端末性能・画像量で変わる単発測定です。heap はピークや保持メモリではありません。250ms debounce 後の全文処理中は main thread を使用するため、大きな数式／画像文書では入力遅延が増える可能性があります。重複画像の膨張は別の容量テストで抑止しています。この測定では Worker 化は見送ります。

Windows WebView2 157.0.4341.60 の、本番フロントエンドを埋め込んだ Tauri バイナリを実機で検証しました。OS のファイル選択から実際のパッケージを開き、標準 3 テーマ、両サイズ、MathJax、SVG、背景、前後移動、プレビューのみ／左右分割、印刷の無効化を確認しました。修正後の iframe には `__TAURI_INTERNALS__` と `ipc` が存在せず、スクリプトは固定補助コード 1 個、CSP も確認しました。ネイティブの再現チェックは `tests/browser/marp-webview2.mjs` です。ローカルの Windows Rust テストは 227 件成功しています。macOS／Linux の GUI 実機確認はこの環境では実施できません。CI の Rust Linux 検証は GUI 実機確認とは区別します。

参照: [Marp Core v4.4.0](https://github.com/marp-team/marp-core/tree/v4.4.0)、[Marpit API](https://marpit-api.marp.app/marpit/)、[スライド map の実装](https://marpit-api.marp.app/source/markdown/slide-js/)、[style 処理](https://marpit-api.marp.app/source/markdown/style/parse-js/)。
