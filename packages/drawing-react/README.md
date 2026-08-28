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
