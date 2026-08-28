# @maca/drawing-core

ReactやMaCa EditorのDocument管理に依存しない作図コアです。

## 公開する責務

- Drawing Domain Model
- JSONのparse、validate、serialize
- 図形、コネクタ、viewportの幾何計算
- immutableな編集、履歴、clipboard操作
- 静的かつdeterministicなSVG生成
- 画像sourceの検証

```ts
import {
  DRAWING_FORMAT,
  createObject,
  renderSvg,
  type DrawingDocument,
} from "@maca/drawing-core";

const drawing: DrawingDocument = {
  format: DRAWING_FORMAT,
  version: "1.0",
  canvas: { width: 640, height: 480, gridSize: 10 },
  objects: [],
};

drawing.objects.push(createObject(drawing, "rectangle", 40, 40));
const svg = renderSvg(drawing);
```

MaCa Editor固有のmanifest、Markdown、ファイル保存処理は含みません。
