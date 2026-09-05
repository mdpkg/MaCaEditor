# @maca/drawing-react

`@maca/drawing-core`を編集するためのReact UIです。

```tsx
import { DrawingEditor } from "@maca/drawing-react";

<DrawingEditor
  doc={drawing}
  onChange={setDrawing}
  onDirty={saveDrawing}
  onRequestImage={selectImage}
/>
```

ホストアプリとの契約は`DrawingEditorProps`に限定しています。現段階ではMaCa Editorの
`drawing-*` CSS classを利用しているため、別アプリへ組み込む際は対応するスタイルを
提供してください。

移動中のスマートガイドは画面上6px以内の図形の端・中心へ吸着します。`Guides`で
切り替え、Altキーで一時解除できます。グリッドスナップと併用すると、ガイドが
見つかった軸ではガイドを優先します。

3個以上を選択するとPropertiesの`H gaps`／`V gaps`で図形間の余白を均等化できます。
両端の図形は固定し、グループは内部要素ごと移動します。接続線は配置対象から除外します。

コネクタの`Label`は複数行に対応し、線のダブルクリックからも編集できます。
ラベルは接続先に追従し、JSON保存・SVG出力・Undo／Redoの対象です。
