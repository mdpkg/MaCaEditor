import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alignObjects,
  distributeObjects,
  smartGuideMove,
  type SmartGuide,
  updateConnectorLabel,
  bringForward,
  bringToFront,
  deleteObjects,
  findObjectById,
  groupObjects,
  insertImageObject,
  moveObject,
  moveObjectsFromDragStart,
  moveObjectsFromDragStartSnapped,
  resizeCanvasFromDrag,
  resizeObjectFromDragStart,
  rotateObjectFromDragStart,
  selectObjectsInRect,
  sendBackward,
  sendToBack,
  updateConnectorEnds,
  updateConnectorEndSizes,
  updateConnectorEndpoint,
  updateConnectorCurveOffset,
  updateAutoShapeAdjustment,
  updateAutoShapeEnds,
  updateObjectOpacity,
  updateObjectRotation,
  ungroupObjects,
  updateShapeText,
  updateShapeTextAlignment,
  copyObjects,
  pasteObjects,
  clientToCanvasPoint,
  drawingViewport,
  LINE_DASH_OPTIONS,
  LINE_WEIGHT_OPTIONS,
  connectorGeometry,
  connectorLabelLayout,
  connectorAnchorForPoint,
  isPointOnConnector,
  getArcArrowGeometry,
  getBraceTailPoint,
  getCalloutTailPoint,
  SHAPE_DEFINITIONS,
  createConnector,
  createObject,
  renderSvg,
  type AlignKind,
  type ConnectorEndMarker,
  type ConnectorEndMarkerSize,
  type DrawingDocument,
  type DrawingObject,
  type History,
  type LineDashStyle,
  type ObjectStyle,
  type ToolKind,
} from "@maca/drawing-core";
import { ShapePicker, type ShapePickerItem } from "./ShapePicker";

/** Host integration contract for the reusable React drawing editor. */
export interface DrawingEditorProps {
  doc: DrawingDocument;
  onChange: (doc: DrawingDocument) => void;
  onDirty: (doc: DrawingDocument) => void;
  onRequestImage?: () => Promise<string | null>;
  propertiesPanelId?: string;
}

type Tool = ToolKind;

const LEGACY_SHAPE_TOOLS: ShapePickerItem[] = [
  { id: "rectangle", label: "Rect", category: "Legacy" },
  { id: "roundedRectangle", label: "Round Rect", category: "Legacy" },
  { id: "ellipse", label: "Ellipse", category: "Legacy" },
  { id: "file", label: "File", category: "Legacy" },
  { id: "user", label: "User", category: "Legacy" },
];

const AUTO_SHAPE_TOOLS = SHAPE_DEFINITIONS.map((shape) => ({
  id: `autoShape:${shape.id}` as Tool,
  label: shape.label,
  category: shape.category,
}));

const SHAPE_TOOLS = [...LEGACY_SHAPE_TOOLS, ...AUTO_SHAPE_TOOLS];

const DIRECT_TOOLS: { id: Tool; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
];

const CONNECTOR_TOOLS: { id: Tool; label: string }[] = [
  { id: "connector", label: "Straight" },
  { id: "curveConnector", label: "Curve" },
  { id: "elbowConnector", label: "Elbow" },
];

const COLOR_PRESETS = [
  { name: "Black", value: "#000000" }, { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#808080" }, { name: "Red", value: "#ff0000" },
  { name: "Light Blue", value: "#00b0f0" }, { name: "Blue", value: "#0070c0" },
  { name: "Light Green", value: "#92d050" }, { name: "Green", value: "#00b050" },
  { name: "Yellow", value: "#ffff00" }, { name: "Orange", value: "#ffc000" },
  { name: "Purple", value: "#7030a0" }, { name: "Dark Navy", value: "#1f4e78" },
] as const;

function ColorPicker({ kind, value, onChange }: {
  kind: "fill" | "stroke"; value: string; onChange: (color: string) => void;
}) {
  return <div className="color-picker-with-presets">
    <input aria-label={`${kind === "fill" ? "Fill" : "Line"} color`} type="color" value={value}
      onChange={(event) => onChange(event.target.value)} />
    <div className="color-presets">{COLOR_PRESETS.map((preset) => <button
      key={preset.value} type="button" className="color-preset" data-color-kind={kind}
      title={preset.name} aria-label={`${kind} ${preset.name}`}
      style={{ backgroundColor: preset.value }} onClick={() => onChange(preset.value)}
    />)}</div>
  </div>;
}

const TEXT_SHAPE_TYPES = ["rectangle", "roundedRectangle", "ellipse", "file", "user", "autoShape"];

function isTextShapeType(type: string): boolean {
  return TEXT_SHAPE_TYPES.includes(type);
}

function pointBeforeRotation(object: DrawingObject, x: number, y: number) {
  if (!object.rotation) return { x, y };
  const cx = object.x + object.width / 2;
  const cy = object.y + object.height / 2;
  const radians = -object.rotation * Math.PI / 180;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: cy + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function DrawingEditor({
  doc,
  onChange,
  onDirty,
  onRequestImage,
  propertiesPanelId,
}: DrawingEditorProps) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState(true);
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  const [undoStack, setUndoStack] = useState<History>([]);
  const [redoStack, setRedoStack] = useState<History>([]);
  const [clipboard, setClipboard] = useState<DrawingObject[]>([]);
  const [connectorStart, setConnectorStart] = useState<string | null>(null);
  const [textFocusRequest, setTextFocusRequest] = useState(0);
  const [selectionMarquee, setSelectionMarquee] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    objectId: string;
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = useState<{
    type: "move" | "resize" | "rotate" | "connectorEndpoint" | "curveAdjust" | "arcAdjust" | "calloutAdjust" | "braceAdjust" | "create" | "canvasResize" | "marquee";
    id?: string;
    ids?: string[];
    startX: number;
    startY: number;
    origX?: number;
    origY?: number;
    origW?: number;
    origH?: number;
    handle?: string;
    before?: DrawingDocument;
    selectionBase?: string[];
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const shapeTextRef = useRef<HTMLTextAreaElement>(null);
  const dragPreviewRef = useRef<DrawingDocument | null>(null);

  useEffect(() => {
    if (textFocusRequest === 0 || !shapeTextRef.current) return;
    shapeTextRef.current.focus();
    shapeTextRef.current.setSelectionRange(
      shapeTextRef.current.value.length,
      shapeTextRef.current.value.length,
    );
  }, [textFocusRequest]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  const selectedObjects = useMemo(
    () => selectedIds
      .map((id) => findObjectById(doc.objects, id))
      .filter((object): object is DrawingObject => object !== undefined),
    [doc.objects, selectedIds],
  );

  const commit = useCallback(
    (next: DrawingDocument) => {
      setUndoStack((u) => [...u, { before: doc, after: next }]);
      setRedoStack([]);
      onChange(next);
      onDirty(next);
    },
    [doc, onChange, onDirty],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, entry]);
    setUndoStack((u) => u.slice(0, u.length - 1));
    onChange(entry.before);
    onDirty(entry.before);
  }, [undoStack, onChange, onDirty]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, entry]);
    setRedoStack((r) => r.slice(0, r.length - 1));
    onChange(entry.after);
    onDirty(entry.after);
  }, [redoStack, onChange, onDirty]);

  const addImage = useCallback(async () => {
    if (!onRequestImage) return;
    const src = await onRequestImage();
    if (!src) return;
    const next = insertImageObject(
      doc,
      Math.max(0, (doc.canvas.width - 160) / 2),
      Math.max(0, (doc.canvas.height - 120) / 2),
      src,
    );
    const image = next.objects[next.objects.length - 1];
    commit(next);
    setSelectedIds([image.id]);
    setTool("select");
  }, [commit, doc, onRequestImage]);

  const snapValue = useCallback(
    (v: number) => (snap ? Math.round(v / doc.canvas.gridSize) * doc.canvas.gridSize : v),
    [snap, doc.canvas.gridSize],
  );

  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return clientToCanvasPoint(
        { x: clientX, y: clientY },
        rect,
        doc.canvas,
      );
    },
    [doc.canvas],
  );

  const hitInObjects = useCallback(
    (objects: DrawingObject[], x: number, y: number): DrawingObject | null => {
      const sorted = [...objects].sort((a, b) => b.zIndex - a.zIndex);
      for (const obj of sorted) {
        if (obj.type === "connector") {
          const geometry = connectorGeometry(obj, doc.objects);
          const tolerance = Math.max(12 / zoom, (obj.style.strokeWidth ?? 1) / 2 + 6 / zoom);
          if (geometry && isPointOnConnector(geometry, x, y, tolerance)) return obj;
          if (geometry && obj.label) {
            const label = connectorLabelLayout(obj.label, geometry);
            if (x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height) return obj;
          }
          continue;
        }
        if (obj.type === "line" || obj.type === "arrow") {
          const line = obj as DrawingObject & { x2: number; y2: number };
          const dist = Math.abs(
            (line.y2 - obj.y) * x - (line.x2 - obj.x) * y + line.x2 * obj.y - line.y2 * obj.x,
          ) / Math.sqrt((line.y2 - obj.y) ** 2 + (line.x2 - obj.x) ** 2);
          if (dist < 8) return obj;
          continue;
        }
        const local = pointBeforeRotation(obj, x, y);
        if (
          local.x >= obj.x &&
          local.x <= obj.x + obj.width &&
          local.y >= obj.y &&
          local.y <= obj.y + obj.height
        ) {
          return obj;
        }
      }
      return null;
    },
    [doc.objects, zoom],
  );

  const hitTest = useCallback(
    (x: number, y: number): DrawingObject | null => hitInObjects(doc.objects, x, y),
    [doc.objects, hitInObjects],
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    editorRef.current?.focus();
    setContextMenu(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    const canvasResize = (e.target as SVGElement).dataset.canvasResize;
    if (canvasResize === "width" || canvasResize === "height" || canvasResize === "both") {
      setSelectedIds([]);
      setDragging({
        type: "canvasResize",
        handle: canvasResize,
        startX: e.clientX,
        startY: e.clientY,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);
    const connectorEndpoint = (e.target as SVGElement).dataset.connectorEndpoint;
    const connectorObjectId = (e.target as SVGElement).dataset.objectId;
    if ((connectorEndpoint === "from" || connectorEndpoint === "to") && connectorObjectId) {
      setSelectedIds([connectorObjectId]);
      setDragging({
        type: "connectorEndpoint",
        id: connectorObjectId,
        handle: connectorEndpoint,
        startX: x,
        startY: y,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const curveObjectId = (e.target as SVGElement).dataset.curveAdjust;
    if (curveObjectId) {
      setSelectedIds([curveObjectId]);
      setDragging({
        type: "curveAdjust",
        id: curveObjectId,
        startX: x,
        startY: y,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const braceObjectId = (e.target as SVGElement).dataset.braceTail;
    if (braceObjectId) {
      setSelectedIds([braceObjectId]);
      setDragging({
        type: "braceAdjust",
        id: braceObjectId,
        startX: x,
        startY: y,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const calloutObjectId = (e.target as SVGElement).dataset.calloutTail;
    if (calloutObjectId) {
      setSelectedIds([calloutObjectId]);
      setDragging({
        type: "calloutAdjust",
        id: calloutObjectId,
        startX: x,
        startY: y,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const arcAdjust = (e.target as SVGElement).dataset.arcAdjust;
    const arcObjectId = (e.target as SVGElement).dataset.objectId;
    if ((arcAdjust === "start" || arcAdjust === "end") && arcObjectId) {
      setSelectedIds([arcObjectId]);
      setDragging({
        type: "arcAdjust",
        id: arcObjectId,
        handle: arcAdjust,
        startX: x,
        startY: y,
        before: doc,
      });
      dragPreviewRef.current = doc;
      return;
    }
    const rotateObjectId = (e.target as SVGElement).dataset.objectRotate;
    if (rotateObjectId) {
      const object = findObjectById(doc.objects, rotateObjectId);
      if (object) {
        setSelectedIds([rotateObjectId]);
        setDragging({
          type: "rotate",
          id: rotateObjectId,
          startX: x,
          startY: y,
          before: doc,
        });
        dragPreviewRef.current = doc;
        return;
      }
    }
    const objectResize = (e.target as SVGElement).dataset.objectResize;
    const objectId = (e.target as SVGElement).dataset.objectId;
    if (objectResize && objectId) {
      const object = findObjectById(doc.objects, objectId);
      if (object) {
        setSelectedIds([objectId]);
        setDragging({
          type: "resize",
          id: objectId,
          handle: objectResize,
          startX: x,
          startY: y,
          origX: object.x,
          origY: object.y,
          origW: object.width,
          origH: object.height,
          before: doc,
        });
        dragPreviewRef.current = doc;
        return;
      }
    }
    const selectedNestedObject = selectedIds.length === 1
      ? findObjectById(doc.objects, selectedIds[0])
      : undefined;
    const nestedHit = selectedNestedObject &&
      !doc.objects.some((object) => object.id === selectedNestedObject.id)
      ? hitInObjects([selectedNestedObject], x, y)
      : null;
    const hit = nestedHit ?? hitTest(x, y);

    if (tool === "connector" || tool === "curveConnector" || tool === "elbowConnector") {
      if (connectorStart === null && hit && hit.type !== "connector") {
        setConnectorStart(hit.id);
        setSelectedIds([hit.id]);
        return;
      }
      if (connectorStart !== null && hit && hit.type !== "connector" && hit.id !== connectorStart) {
        const conn = createConnector(
          doc,
          connectorStart,
          hit.id,
          tool === "curveConnector",
          tool === "elbowConnector",
        );
        commit({ ...doc, objects: [...doc.objects, conn] });
        setConnectorStart(null);
        setSelectedIds([conn.id]);
        setTool("select");
        return;
      }
      setConnectorStart(null);
      return;
    }

    if (tool === "select") {
      if (hit) {
        const multi = e.ctrlKey || e.metaKey || e.shiftKey;
        if (multi) {
          setSelectedIds((prev) =>
            prev.includes(hit.id)
              ? prev.filter((id) => id !== hit.id)
              : [...prev, hit.id],
          );
        }
        if (multi) return;
        const dragIds = selectedIds.includes(hit.id) ? selectedIds : [hit.id];
        setSelectedIds(dragIds);
        if (hit.type === "connector") return;
        setDragging({
          type: "move",
          id: hit.id,
          ids: dragIds,
          startX: x,
          startY: y,
          origX: hit.x,
          origY: hit.y,
          before: doc,
        });
        dragPreviewRef.current = doc;
        return;
      }
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      const selectionBase = additive ? selectedIds : [];
      if (!additive) setSelectedIds([]);
      setDragging({
        type: "marquee",
        startX: x,
        startY: y,
        before: doc,
        selectionBase,
      });
      setSelectionMarquee({ startX: x, startY: y, currentX: x, currentY: y });
      return;
    }

    // 作成ツール
    const obj = createObject(doc, tool, snapValue(x), snapValue(y));
    const next = { ...doc, objects: [...doc.objects, obj] };
    commit(next);
    dragPreviewRef.current = next;
    setSelectedIds([obj.id]);
    setDragging({
      type: "create",
      id: obj.id,
      startX: x,
      startY: y,
      origX: obj.x,
      origY: obj.y,
      origW: obj.width,
      origH: obj.height,
    });
  };

  const handleContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);
    const selectedObject = selectedIds.length === 1
      ? findObjectById(doc.objects, selectedIds[0])
      : undefined;
    const selectedHit = selectedObject &&
      !doc.objects.some((object) => object.id === selectedObject.id)
      ? hitInObjects([selectedObject], x, y)
      : null;
    const hit = selectedHit ?? hitTest(x, y);
    if (!hit) {
      setContextMenu(null);
      return;
    }
    setSelectedIds([hit.id]);
    setContextMenu({ objectId: hit.id, x: e.clientX, y: e.clientY });
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    if (dragging.type === "canvasResize" && dragging.before && dragging.handle) {
      const next = resizeCanvasFromDrag(
        dragging.before,
        dragging.handle as "width" | "height" | "both",
        (e.clientX - dragging.startX) / zoom,
        (e.clientY - dragging.startY) / zoom,
        snap,
      );
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);

    if (dragging.type === "marquee" && dragging.before) {
      setSelectionMarquee({
        startX: dragging.startX,
        startY: dragging.startY,
        currentX: x,
        currentY: y,
      });
      const inRect = selectObjectsInRect(
        dragging.before,
        { x: dragging.startX, y: dragging.startY },
        { x, y },
      );
      setSelectedIds([...new Set([...(dragging.selectionBase ?? []), ...inRect])]);
      return;
    }

    if (dragging.type === "resize" && dragging.id && dragging.handle && dragging.before) {
      const next = resizeObjectFromDragStart(
        dragging.before,
        dragging.id,
        dragging.handle as "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w",
        { x: dragging.startX, y: dragging.startY },
        { x, y },
        snap,
      );
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "rotate" && dragging.id && dragging.before) {
      const next = rotateObjectFromDragStart(
        dragging.before,
        dragging.id,
        { x: dragging.startX, y: dragging.startY },
        { x, y },
        snap,
      );
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "arcAdjust" && dragging.id && dragging.handle && dragging.before) {
      const object = findObjectById(dragging.before.objects, dragging.id);
      if (!object || object.type !== "autoShape" || object.preset !== "arcArrow") return;
      const local = pointBeforeRotation(object, x, y);
      const cx = object.x + object.width / 2;
      const cy = object.y + object.height / 2;
      const rx = object.width * 0.42;
      const ry = object.height * 0.38;
      const angle = ((Math.atan2((local.y - cy) / ry, (local.x - cx) / rx) * 180 / Math.PI) % 360 + 360) % 360;
      const startAngle = ((object.adjustments?.startAngle ?? 200) % 360 + 360) % 360;
      let next = dragging.before;
      if (dragging.handle === "start") {
        const endAngle = (startAngle + (object.adjustments?.sweepAngle ?? 220)) % 360;
        const sweepAngle = (endAngle - angle + 360) % 360 || 359;
        next = updateAutoShapeAdjustment(next, object.id, "startAngle", angle);
        next = updateAutoShapeAdjustment(next, object.id, "sweepAngle", sweepAngle);
      } else {
        const sweepAngle = (angle - startAngle + 360) % 360 || 359;
        next = updateAutoShapeAdjustment(next, object.id, "sweepAngle", sweepAngle);
      }
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "curveAdjust" && dragging.id && dragging.before) {
      const object = findObjectById(dragging.before.objects, dragging.id);
      if (!object || object.type !== "connector" || !object.curve) return;
      const geometry = connectorGeometry(object, dragging.before.objects);
      if (!geometry) return;
      const midpoint = {
        x: (geometry.from.x + geometry.to.x) / 2,
        y: (geometry.from.y + geometry.to.y) / 2,
      };
      const next = updateConnectorCurveOffset(dragging.before, object.id, {
        x: x - midpoint.x,
        y: y - midpoint.y,
      });
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "connectorEndpoint" && dragging.id && dragging.handle && dragging.before) {
      const connector = findObjectById(dragging.before.objects, dragging.id);
      if (!connector || connector.type !== "connector") return;
      const end = dragging.handle as "from" | "to";
      const currentEndpoint = connector[end];
      const hovered = hitInObjects(
        dragging.before.objects.filter((object) => object.type !== "connector"),
        x,
        y,
      );
      const target = hovered && hovered.id !== connector[end === "from" ? "to" : "from"].objectId
        ? hovered
        : findObjectById(dragging.before.objects, currentEndpoint.objectId);
      if (!target || target.type === "connector") return;
      const next = updateConnectorEndpoint(
        dragging.before,
        connector.id,
        end,
        target.id,
        connectorAnchorForPoint(target, { x, y }),
      );
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "calloutAdjust" && dragging.id && dragging.before) {
      const object = findObjectById(dragging.before.objects, dragging.id);
      if (!object || object.type !== "autoShape" || object.preset !== "callout") return;
      const local = pointBeforeRotation(object, x, y);
      const cx = object.x + object.width / 2;
      const cy = object.y + object.height / 2;
      const angle = ((Math.atan2(local.y - cy, local.x - cx) * 180 / Math.PI) % 360 + 360) % 360;
      const next = updateAutoShapeAdjustment(dragging.before, object.id, "tailAngle", angle);
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "braceAdjust" && dragging.id && dragging.before) {
      const object = findObjectById(dragging.before.objects, dragging.id);
      if (!object || object.type !== "autoShape" || !["leftBrace", "rightBrace"].includes(object.preset)) return;
      const local = pointBeforeRotation(object, x, y);
      const tailPosition = Math.max(0.15, Math.min(0.85, (local.y - object.y) / object.height));
      const next = updateAutoShapeAdjustment(dragging.before, object.id, "tailPosition", tailPosition);
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "move" && dragging.id) {
      const original = dragging.before ?? doc;
      const start = { x: dragging.startX, y: dragging.startY };
      const current = { x, y };
      const ids = dragging.ids ?? [dragging.id];
      let next = snap
        ? moveObjectsFromDragStartSnapped(
          original,
          ids,
          dragging.id,
          start,
          current,
          doc.canvas.gridSize,
        )
        : moveObjectsFromDragStart(original, ids, start, current);
      if (smartGuidesEnabled && !e.altKey) {
        const guided = smartGuideMove(original, ids, { x: x - start.x, y: y - start.y }, 6 / zoom);
        const anchor = findObjectById(original.objects, dragging.id)!;
        const gridAnchor = findObjectById(next.objects, dragging.id)!;
        next = moveObjectsFromDragStart(original, ids, start, {
          x: start.x + (guided.guides.some(g => g.axis === "x") ? guided.delta.x : gridAnchor.x - anchor.x),
          y: start.y + (guided.guides.some(g => g.axis === "y") ? guided.delta.y : gridAnchor.y - anchor.y),
        });
        setSmartGuides(guided.guides);
      } else {
        setSmartGuides([]);
      }
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }

    if (dragging.type === "create" && dragging.id) {
      const obj = doc.objects.find((o) => o.id === dragging.id);
      if (!obj) return;
      const width = Math.max(snap ? doc.canvas.gridSize : 10, snapValue(x) - obj.x);
      const height = Math.max(snap ? doc.canvas.gridSize : 10, snapValue(y) - obj.y);
      const next = {
        ...doc,
        objects: doc.objects.map((o) =>
          o.id === dragging.id ? { ...o, width, height } : o,
        ),
      };
      dragPreviewRef.current = next;
      onChange(next);
      return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setSmartGuides([]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (dragging?.type === "move" && dragging.id && dragging.before) {
      const after = dragPreviewRef.current ?? doc;
      setUndoStack((stack) => [...stack, { before: dragging.before!, after }]);
      setRedoStack([]);
      onChange(after);
      onDirty(after);
    } else if (dragging?.type === "canvasResize" && dragging.before) {
      const after = dragPreviewRef.current ?? doc;
      setUndoStack((stack) => [...stack, { before: dragging.before!, after }]);
      setRedoStack([]);
      onChange(after);
      onDirty(after);
    } else if ((dragging?.type === "resize" || dragging?.type === "rotate" || dragging?.type === "connectorEndpoint" || dragging?.type === "curveAdjust" || dragging?.type === "arcAdjust" || dragging?.type === "calloutAdjust" || dragging?.type === "braceAdjust") && dragging.before) {
      const after = dragPreviewRef.current ?? doc;
      setUndoStack((stack) => [...stack, { before: dragging.before!, after }]);
      setRedoStack([]);
      onChange(after);
      onDirty(after);
    } else if (dragging?.type === "create") {
      const after = dragPreviewRef.current ?? doc;
      onChange(after);
      onDirty(after);
      setTool("select");
    }
    dragPreviewRef.current = null;
    setSelectionMarquee(null);
    setDragging(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.matches("input, textarea, select") || target.isContentEditable)
    ) {
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      commit(deleteObjects(doc, selectedIds));
      setSelectedIds([]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      setClipboard(copyObjects(doc, selectedIds));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      const pasted = pasteObjects(doc, clipboard);
      commit(pasted);
      setSelectedIds(
        pasted.objects
          .filter((o) => !doc.objects.some((d) => d.id === o.id))
          .map((o) => o.id),
      );
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const dup = pasteObjects(doc, copyObjects(doc, selectedIds));
      commit(dup);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "ArrowLeft") {
      const dx = e.shiftKey ? -10 : -1;
      const next = selectedIds.reduce(
        (acc, id) => moveObject(acc, id, dx, 0),
        doc,
      );
      commit(next);
    } else if (e.key === "ArrowRight") {
      const dx = e.shiftKey ? 10 : 1;
      const next = selectedIds.reduce(
        (acc, id) => moveObject(acc, id, dx, 0),
        doc,
      );
      commit(next);
    } else if (e.key === "ArrowUp") {
      const dy = e.shiftKey ? -10 : -1;
      const next = selectedIds.reduce(
        (acc, id) => moveObject(acc, id, 0, dy),
        doc,
      );
      commit(next);
    } else if (e.key === "ArrowDown") {
      const dy = e.shiftKey ? 10 : 1;
      const next = selectedIds.reduce(
        (acc, id) => moveObject(acc, id, 0, dy),
        doc,
      );
      commit(next);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.min(3, Math.max(0.2, z * factor)));
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const connectorEndpoint = (e.target as SVGElement).dataset.connectorEndpoint;
    const connectorObjectId = (e.target as SVGElement).dataset.objectId;
    if ((connectorEndpoint === "from" || connectorEndpoint === "to") && connectorObjectId) {
      const connector = findObjectById(doc.objects, connectorObjectId);
      if (connector?.type === "connector") {
        commit(updateConnectorEndpoint(
          doc,
          connector.id,
          connectorEndpoint,
          connector[connectorEndpoint].objectId,
        ));
      }
      return;
    }
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);
    if (selectedIds.length === 1) {
      const selected = findObjectById(doc.objects, selectedIds[0]);
      if (selected?.type === "group") {
        const member = hitInObjects(selected.members, x, y);
        if (member) {
          setSelectedIds([member.id]);
          return;
        }
      }
    }
    const hit = hitTest(x, y);
    if (!hit || (!isTextShapeType(hit.type) && hit.type !== "text" && hit.type !== "connector")) return;
    setSelectedIds([hit.id]);
    setTextFocusRequest((request) => request + 1);
  };

  const updateText = (text: string) => {
    const next = selectedIds.reduce(
      (current, id) => updateShapeText(current, id, text),
      doc,
    );
    commit(next);
  };

  const updateFill = (fill: string) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), fill } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateStroke = (stroke: string) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), stroke } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateStrokeWidth = (strokeWidth: number) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), strokeWidth } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateOpacity = (kind: "fill" | "stroke", percent: number) => {
    commit(updateObjectOpacity(doc, selectedIds, kind, percent / 100));
  };

  const updateDashStyle = (dashStyle: LineDashStyle) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), dashStyle } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateConnectorEnd = (end: "start" | "end", marker: ConnectorEndMarker) => {
    if (!selected || selected.type !== "connector") return;
    commit(updateConnectorEnds(
      doc,
      selected.id,
      end === "start" ? marker : selected.startMarker ?? "none",
      end === "end" ? marker : selected.endMarker ?? "arrow",
    ));
  };

  const updateConnectorEndSize = (end: "start" | "end", size: ConnectorEndMarkerSize) => {
    if (!selected || selected.type !== "connector") return;
    commit(updateConnectorEndSizes(
      doc,
      selected.id,
      end === "start" ? size : selected.startMarkerSize ?? "medium",
      end === "end" ? size : selected.endMarkerSize ?? "medium",
    ));
  };

  const updateRotation = (rotation: number) => {
    if (!selected) return;
    commit(updateObjectRotation(doc, selected.id, rotation));
  };

  const updateCalloutTailAngle = (angle: number) => {
    if (!selected || selected.type !== "autoShape" || selected.preset !== "callout") return;
    commit(updateAutoShapeAdjustment(doc, selected.id, "tailAngle", angle));
  };

  const updateArcArrowAngle = (name: "startAngle" | "sweepAngle", angle: number) => {
    if (!selected || selected.type !== "autoShape" || selected.preset !== "arcArrow") return;
    commit(updateAutoShapeAdjustment(doc, selected.id, name, angle));
  };

  const updateArcArrowEnd = (end: "start" | "end", marker: ConnectorEndMarker) => {
    if (!selected || selected.type !== "autoShape" || selected.preset !== "arcArrow") return;
    commit(updateAutoShapeEnds(
      doc,
      selected.id,
      end === "start" ? marker : selected.startMarker ?? "none",
      end === "end" ? marker : selected.endMarker ?? "arrow",
    ));
  };

  const updateFontSize = (fontSize: number) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), fontSize } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateTextAlign = (align: "left" | "center" | "right") => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id)
          ? { ...o, style: { ...(o.style as Record<string, unknown>), align } }
          : o,
      ),
    } as DrawingDocument;
    commit(next);
  };

  const updateShapeHorizontalAlign = (align: "left" | "center" | "right") => {
    if (!selected || !isTextShapeType(selected.type)) return;
    const verticalAlign = "textStyle" in selected
      ? selected.textStyle?.verticalAlign ?? "middle"
      : "middle";
    commit(updateShapeTextAlignment(doc, selected.id, align, verticalAlign));
  };

  const updateShapeVerticalAlign = (verticalAlign: "top" | "middle" | "bottom") => {
    if (!selected || !isTextShapeType(selected.type)) return;
    const align = "textStyle" in selected ? selected.textStyle?.align ?? "center" : "center";
    commit(updateShapeTextAlignment(doc, selected.id, align, verticalAlign));
  };

  const updatePosition = (field: "x" | "y", value: number) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id) ? { ...o, [field]: value } : o,
      ),
    };
    commit(next);
  };

  const updateSize = (field: "width" | "height", value: number) => {
    const next = {
      ...doc,
      objects: doc.objects.map((o) =>
        selectedIds.includes(o.id) ? { ...o, [field]: value } : o,
      ),
    };
    commit(next);
  };

  const applyAlign = (kind: AlignKind) => {
    commit(alignObjects(doc, selectedIds, kind));
  };

  const groupSelection = () => {
    if (selectedIds.length < 2) return;
    const next = groupObjects(doc, selectedIds);
    const group = next.objects.find(
      (object) => object.type === "group" && !doc.objects.some((before) => before.id === object.id),
    );
    if (!group) return;
    commit(next);
    setSelectedIds([group.id]);
  };

  const ungroupSelection = () => {
    const groups = selectedObjects.filter((object) => object.type === "group");
    if (groups.length === 0) return;
    const memberIds = groups.flatMap((group) => group.type === "group"
      ? group.members.map((member) => member.id)
      : []);
    const next = groups.reduce((current, group) => ungroupObjects(current, group.id), doc);
    commit(next);
    setSelectedIds(memberIds);
  };

  const selected = selectedObjects[0];

  const gridLines = useMemo(() => {
    if (!gridVisible) return null;
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const gs = doc.canvas.gridSize;
    for (let x = 0; x <= doc.canvas.width; x += gs) {
      lines.push({ x1: x, y1: 0, x2: x, y2: doc.canvas.height });
    }
    for (let y = 0; y <= doc.canvas.height; y += gs) {
      lines.push({ x1: 0, y1: y, x2: doc.canvas.width, y2: y });
    }
    return lines;
  }, [gridVisible, doc.canvas]);

  const svg = useMemo(() => renderSvg(doc), [doc]);
  const viewport = drawingViewport(doc.canvas, zoom);

  return (
    <div ref={editorRef} className="drawing-editor" onKeyDown={handleKeyDown} tabIndex={0}>
      <div className="drawing-toolbar">
        <button
          className={tool === "select" ? "active" : ""}
          onClick={() => {
            setTool("select");
            setConnectorStart(null);
          }}
          title="Select"
        >
          Select
        </button>
        <ShapePicker
          items={SHAPE_TOOLS}
          onActivate={() => {
            setTool("select");
            setConnectorStart(null);
          }}
          onSelect={(nextTool) => {
            setTool(nextTool);
            setConnectorStart(null);
          }}
        />
        <select
          aria-label="Connector"
          title="Connector"
          className={CONNECTOR_TOOLS.some((connector) => connector.id === tool) ? "active" : ""}
          value={CONNECTOR_TOOLS.some((connector) => connector.id === tool) ? tool : ""}
          onChange={(event) => {
            setTool(event.target.value ? event.target.value as Tool : "select");
            setConnectorStart(null);
          }}
        >
          <option value="">Connector</option>
          {CONNECTOR_TOOLS.map((connector) => (
            <option key={connector.id} value={connector.id}>{connector.label}</option>
          ))}
        </select>
        {DIRECT_TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : ""}
            onClick={() => {
              setTool(t.id);
              setConnectorStart(null);
            }}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
        {onRequestImage && (
          <button onClick={() => void addImage()} title="Add Image">Image</button>
        )}
        <span className="drawing-toolbar-spacer" />
        <button onClick={() => setZoom(1)} title="Reset Zoom">100%</button>
        <button onClick={() => setZoom(1)} title="Fit to Canvas">Fit</button>
        <button onClick={() => setGridVisible((g) => !g)} title="Toggle Grid">
          Grid {gridVisible ? "On" : "Off"}
        </button>
        <button onClick={() => setSnap((s) => !s)} title="Toggle Snap">
          Snap {snap ? "On" : "Off"}
        </button>
        <button aria-label="Smart guides" aria-pressed={smartGuidesEnabled}
          title="Align to shape edges and centers (Alt to bypass)"
          onClick={() => { setSmartGuidesEnabled(value => !value); setSmartGuides([]); }}>
          Guides {smartGuidesEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="drawing-canvas-wrap">
        <svg
          ref={svgRef}
          className="drawing-canvas"
          width={viewport.width}
          height={viewport.height}
          viewBox={viewport.viewBox}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={(event) => {
            if (dragging?.before) onChange(dragging.before);
            dragPreviewRef.current = null;
            setDragging(null);
            setSelectionMarquee(null);
            setSmartGuides([]);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
        >
          <rect
            x={0}
            y={0}
            width={doc.canvas.width}
            height={doc.canvas.height}
            fill="#ffffff"
          />
          {gridLines &&
            gridLines.map((l, i) => (
              <line
                key={i}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke="#e0e0e0"
                strokeWidth={1}
              />
            ))}
          <g>
            <g dangerouslySetInnerHTML={{ __html: svg.replace(/<svg[^>]*>|<\/svg>/g, "") }} />
            {smartGuides.map((guide, i) => <line key={i} data-smart-guide={guide.axis}
              x1={guide.axis === "x" ? guide.value : guide.start - 8 / zoom}
              y1={guide.axis === "y" ? guide.value : guide.start - 8 / zoom}
              x2={guide.axis === "x" ? guide.value : guide.end + 8 / zoom}
              y2={guide.axis === "y" ? guide.value : guide.end + 8 / zoom}
              stroke="#d63384" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              pointerEvents="none" />)}
            {selectedIds.map((id) => {
              const obj = findObjectById(doc.objects, id);
              if (obj?.type === "connector") {
                const geometry = connectorGeometry(obj, doc.objects);
                if (!geometry) return null;
                const selectionProps = {
                  className: "connector-selection",
                  fill: "none",
                  stroke: "#2d6cdf",
                  strokeWidth: 3 / zoom,
                  strokeDasharray: `${6 / zoom} ${3 / zoom}`,
                  pointerEvents: "none" as const,
                };
                const selection = geometry.points
                  ? <polyline
                    points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")}
                    {...selectionProps}
                  />
                  : geometry.c1 && geometry.c2
                    ? <path
                      d={`M ${geometry.from.x} ${geometry.from.y} C ${geometry.c1.x} ${geometry.c1.y} ${geometry.c2.x} ${geometry.c2.y} ${geometry.to.x} ${geometry.to.y}`}
                      {...selectionProps}
                    />
                    : <line
                      x1={geometry.from.x}
                      y1={geometry.from.y}
                      x2={geometry.to.x}
                      y2={geometry.to.y}
                      {...selectionProps}
                    />;
                return <g key={id}>
                  {selection}
                  {geometry.curveHandle && <circle
                      className="curve-connector-adjust-handle"
                      data-curve-adjust={id}
                      aria-label="Curve connector adjustment handle"
                      cx={geometry.curveHandle.x}
                      cy={geometry.curveHandle.y}
                      r={7 / zoom}
                      fill="#ffc000"
                      stroke="#7f6000"
                      strokeWidth={2 / zoom}
                  />}
                  {(["from", "to"] as const).map((end) => <circle
                    key={end}
                    className="connector-endpoint-handle"
                    data-connector-endpoint={end}
                    data-object-id={id}
                    aria-label={`Connector ${end} endpoint handle`}
                    cx={geometry[end].x}
                    cy={geometry[end].y}
                    r={7 / zoom}
                    fill="#ffffff"
                    stroke="#2d6cdf"
                    strokeWidth={2 / zoom}
                  />)}
                </g>;
              }
              if (
                !obj ||
                ![...TEXT_SHAPE_TYPES, "text", "image", "group"].includes(obj.type)
              ) return null;
              return (
                <g
                  key={id}
                  className="selection-box"
                  transform={obj.rotation
                    ? `rotate(${obj.rotation} ${obj.x + obj.width / 2} ${obj.y + obj.height / 2})`
                    : undefined}
                >
                  <rect
                    x={obj.x - 4}
                    y={obj.y - 4}
                    width={obj.width + 8}
                    height={obj.height + 8}
                    fill="none"
                    stroke="#2d6cdf"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                  />
                  <line
                    className="object-rotate-stem"
                    x1={obj.x + obj.width / 2}
                    y1={obj.y - 4}
                    x2={obj.x + obj.width / 2}
                    y2={obj.y - 24}
                    stroke="#2d6cdf"
                    strokeWidth={1 / zoom}
                    pointerEvents="none"
                  />
                  <circle
                    className="object-rotate-handle"
                    data-object-rotate={obj.id}
                    cx={obj.x + obj.width / 2}
                    cy={obj.y - 28}
                    r={6 / zoom}
                    fill="#ffffff"
                    stroke="#2d6cdf"
                    strokeWidth={2 / zoom}
                  />
                  {obj.type === "autoShape" && obj.preset === "arcArrow" && (() => {
                    const geometry = getArcArrowGeometry(obj);
                    return <>
                      <circle
                        className="arc-adjust-handle arc-adjust-handle-start"
                        data-arc-adjust="start"
                        data-object-id={obj.id}
                        aria-label="Arc arrow start handle"
                        cx={geometry.start[0]}
                        cy={geometry.start[1]}
                        r={6 / zoom}
                        fill="#2da44e"
                        stroke="#ffffff"
                        strokeWidth={2 / zoom}
                      />
                      <circle
                        className="arc-adjust-handle arc-adjust-handle-end"
                        data-arc-adjust="end"
                        data-object-id={obj.id}
                        aria-label="Arc arrow end handle"
                        cx={geometry.end[0]}
                        cy={geometry.end[1]}
                        r={6 / zoom}
                        fill="#cf5c00"
                        stroke="#ffffff"
                        strokeWidth={2 / zoom}
                      />
                    </>;
                  })()}
                  {obj.type === "autoShape" && obj.preset === "callout" && (() => {
                    const tail = getCalloutTailPoint(obj);
                    return <circle
                      className="callout-tail-handle"
                      data-callout-tail={obj.id}
                      aria-label="Callout tail handle"
                      cx={tail[0]}
                      cy={tail[1]}
                      r={6 / zoom}
                      fill="#8250df"
                      stroke="#ffffff"
                      strokeWidth={2 / zoom}
                    />;
                  })()}
                  {obj.type === "autoShape" && ["leftBrace", "rightBrace"].includes(obj.preset) && (() => {
                    const tail = getBraceTailPoint(obj);
                    return <circle
                      className="brace-tail-handle"
                      data-brace-tail={obj.id}
                      aria-label="Brace tail handle"
                      cx={tail[0]}
                      cy={tail[1]}
                      r={6 / zoom}
                      fill="#8250df"
                      stroke="#ffffff"
                      strokeWidth={2 / zoom}
                    />;
                  })()}
                  {obj.type !== "group" && [
                    "nw",
                    "n",
                    "ne",
                    "e",
                    "se",
                    "s",
                    "sw",
                    "w",
                  ].map((h) => {
                    const hx =
                      h.includes("w")
                        ? obj.x
                        : h.includes("e")
                          ? obj.x + obj.width
                          : obj.x + obj.width / 2;
                    const hy =
                      h.includes("n")
                        ? obj.y
                        : h.includes("s")
                          ? obj.y + obj.height
                          : obj.y + obj.height / 2;
                    return (
                      <rect
                        key={h}
                        className="object-resize-handle"
                        data-object-resize={h}
                        data-object-id={obj.id}
                        x={hx - 4}
                        y={hy - 4}
                        width={8}
                        height={8}
                        fill="#2d6cdf"
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>
          {selectionMarquee && (
            <rect
              className="selection-marquee"
              x={Math.min(selectionMarquee.startX, selectionMarquee.currentX)}
              y={Math.min(selectionMarquee.startY, selectionMarquee.currentY)}
              width={Math.abs(selectionMarquee.currentX - selectionMarquee.startX)}
              height={Math.abs(selectionMarquee.currentY - selectionMarquee.startY)}
              fill="rgba(45, 108, 223, 0.12)"
              stroke="#2d6cdf"
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${2 / zoom}`}
              pointerEvents="none"
            />
          )}
          <rect
            className="canvas-resize-handle canvas-resize-handle-width"
            data-canvas-resize="width"
            x={doc.canvas.width - 8 / zoom}
            y={0}
            width={8 / zoom}
            height={doc.canvas.height - 14 / zoom}
          />
          <rect
            className="canvas-resize-handle canvas-resize-handle-height"
            data-canvas-resize="height"
            x={0}
            y={doc.canvas.height - 8 / zoom}
            width={doc.canvas.width - 14 / zoom}
            height={8 / zoom}
          />
          <rect
            className="canvas-resize-handle canvas-resize-handle-both"
            data-canvas-resize="both"
            x={doc.canvas.width - 14 / zoom}
            y={doc.canvas.height - 14 / zoom}
            width={14 / zoom}
            height={14 / zoom}
          />
        </svg>
      </div>
      <div className="drawing-statusbar">
        <span>{Math.round(zoom * 100)}%</span>
        <span>Grid {gridVisible ? "On" : "Off"}</span>
        <span>Snap {snap ? "On" : "Off"}</span>
        <span>{Math.round(doc.canvas.width)} × {Math.round(doc.canvas.height)}</span>
      </div>
      {contextMenu && (() => {
        const object = findObjectById(doc.objects, contextMenu.objectId);
        if (!object) return null;
        const supportsLine = ([...TEXT_SHAPE_TYPES, "line", "arrow", "connector"] as string[])
          .includes(object.type);
        const style = object.style as ObjectStyle;
        return createPortal(
          <div
            className="drawing-context-menu drawing-inspector"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {isTextShapeType(object.type) && <>
              <div className="inspector-row">
                <label>Fill</label>
                <ColorPicker kind="fill" value={toColor(style.fill)} onChange={updateFill} />
              </div>
              <div className="inspector-row">
                <label>Fill opacity</label>
                <input aria-label="Fill opacity" type="number" min="0" max="100"
                  value={Math.round((style.fillOpacity ?? 1) * 100)}
                  onChange={(event) => updateOpacity("fill", Number(event.target.value))} />
                <span>%</span>
              </div>
            </>}
            {supportsLine && <>
              <div className="inspector-row">
                <label>Color</label>
                <ColorPicker kind="stroke" value={toColor(style.stroke)} onChange={updateStroke} />
              </div>
              <div className="inspector-row">
                <label>Weight</label>
                <select
                  aria-label="Line weight"
                  value={style.strokeWidth ?? 1}
                  onChange={(event) => updateStrokeWidth(Number(event.target.value))}
                >
                  {LINE_WEIGHT_OPTIONS.map((weight) =>
                    <option key={weight} value={weight}>{weight}</option>)}
                </select>
              </div>
              <div className="inspector-row">
                <label>Line opacity</label>
                <input aria-label="Line opacity" type="number" min="0" max="100"
                  value={Math.round((style.strokeOpacity ?? 1) * 100)}
                  onChange={(event) => updateOpacity("stroke", Number(event.target.value))} />
                <span>%</span>
              </div>
              <div className="inspector-row">
                <label>Dashes</label>
                <select value={style.dashStyle ?? "solid"}
                  onChange={(event) => updateDashStyle(event.target.value as LineDashStyle)}>
                  {LINE_DASH_OPTIONS.map((option) =>
                    <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </>}
            {isTextShapeType(object.type) && <>
              <div className="inspector-row">
                <label>H Align</label>
                <select
                  aria-label="H Align"
                  value={(object as DrawingObject & { textStyle?: { align?: string } }).textStyle?.align ?? "center"}
                  onChange={(event) => updateShapeHorizontalAlign(
                    event.target.value as "left" | "center" | "right",
                  )}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div className="inspector-row">
                <label>V Align</label>
                <select
                  aria-label="V Align"
                  value={(object as DrawingObject & { textStyle?: { verticalAlign?: string } }).textStyle?.verticalAlign ?? "middle"}
                  onChange={(event) => updateShapeVerticalAlign(
                    event.target.value as "top" | "middle" | "bottom",
                  )}
                >
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </select>
              </div>
              <div className="inspector-arrange">
                <button aria-label="Bring to Front"
                  onClick={() => commit(bringToFront(doc, selectedIds))}>Front</button>
                <button aria-label="Bring Forward"
                  onClick={() => commit(bringForward(doc, selectedIds))}>Fwd</button>
                <button aria-label="Send Backward"
                  onClick={() => commit(sendBackward(doc, selectedIds))}>Back</button>
                <button aria-label="Send to Back"
                  onClick={() => commit(sendToBack(doc, selectedIds))}>Back</button>
              </div>
            </>}
            {(object.type === "image" || object.type === "group") && (
              <div className="inspector-arrange">
                <button aria-label="Bring to Front"
                  onClick={() => commit(bringToFront(doc, selectedIds))}>Front</button>
                <button aria-label="Bring Forward"
                  onClick={() => commit(bringForward(doc, selectedIds))}>Fwd</button>
                <button aria-label="Send Backward"
                  onClick={() => commit(sendBackward(doc, selectedIds))}>Back</button>
                <button aria-label="Send to Back"
                  onClick={() => commit(sendToBack(doc, selectedIds))}>Back</button>
              </div>
            )}
            {object.type === "connector" && <>
              <div className="inspector-row">
                <label>Start</label>
                <select value={object.startMarker ?? "none"}
                  onChange={(event) => updateConnectorEnd("start", event.target.value as ConnectorEndMarker)}>
                  <option value="none">None</option><option value="arrow">Arrow</option>
                  <option value="crowFoot">Crow's Foot</option>
                </select>
              </div>
              <div className="inspector-row">
                <label>Start size</label>
                <select aria-label="Connector start size" value={object.startMarkerSize ?? "medium"}
                  onChange={(event) => updateConnectorEndSize("start", event.target.value as ConnectorEndMarkerSize)}>
                  <option value="small">Small</option><option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div className="inspector-row">
                <label>End</label>
                <select value={object.endMarker ?? "arrow"}
                  onChange={(event) => updateConnectorEnd("end", event.target.value as ConnectorEndMarker)}>
                  <option value="none">None</option><option value="arrow">Arrow</option>
                  <option value="crowFoot">Crow's Foot</option>
                </select>
              </div>
              <div className="inspector-row">
                <label>End size</label>
                <select aria-label="Connector end size" value={object.endMarkerSize ?? "medium"}
                  onChange={(event) => updateConnectorEndSize("end", event.target.value as ConnectorEndMarkerSize)}>
                  <option value="small">Small</option><option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </>}
          </div>,
          document.body,
        );
      })()}
      {(() => {
        const inspector = <div className="drawing-inspector">
        <h4>Properties</h4>
        {selected ? (
          <>
            {selected.type !== "connector" && <><div className="inspector-row">
              <label>X</label>
              <input
                type="number"
                value={selected.x}
                onChange={(e) => updatePosition("x", Number(e.target.value))}
              />
            </div>
            <div className="inspector-row">
              <label>Y</label>
              <input
                type="number"
                value={selected.y}
                onChange={(e) => updatePosition("y", Number(e.target.value))}
              />
            </div>
            <div className="inspector-row">
              <label>W</label>
              <input
                type="number"
                value={selected.width}
                onChange={(e) => updateSize("width", Number(e.target.value))}
              />
            </div>
            <div className="inspector-row">
              <label>H</label>
              <input
                type="number"
                value={selected.height}
                onChange={(e) => updateSize("height", Number(e.target.value))}
              />
            </div></>}
            {([...TEXT_SHAPE_TYPES, "text", "image", "group"] as string[]).includes(selected.type) && (
              <div className="inspector-row">
                <label>Rotation</label>
                <input
                  aria-label="Rotation"
                  type="number"
                  step="1"
                  value={selected.rotation}
                  onChange={(e) => updateRotation(Number(e.target.value))}
                />
              </div>
            )}
            {isTextShapeType(selected.type) && (
              <>
                <div className="inspector-row">
                  <label>Fill</label>
                  <ColorPicker
                    kind="fill"
                    value={toColor((selected.style as { fill?: string }).fill)}
                    onChange={updateFill}
                  />
                </div>
                <div className="inspector-row">
                  <label>Fill opacity</label>
                  <input
                    aria-label="Fill opacity"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(((selected.style as { fillOpacity?: number }).fillOpacity ?? 1) * 100)}
                    onChange={(e) => updateOpacity("fill", Number(e.target.value))}
                  />
                  <span>%</span>
                </div>
              </>
            )}
            {([...TEXT_SHAPE_TYPES, "line", "arrow", "connector"] as string[]).includes(selected.type) && (
              <>
                <div className="inspector-row">
                  <label>Color</label>
                  <ColorPicker
                    kind="stroke"
                    value={toColor((selected.style as { stroke?: string }).stroke)}
                    onChange={updateStroke}
                  />
                </div>
                <div className="inspector-row">
                  <label>Weight</label>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    list="line-weight-options"
                    value={(selected.style as { strokeWidth?: number }).strokeWidth ?? 1}
                    onChange={(e) => updateStrokeWidth(Number(e.target.value))}
                  />
                  <datalist id="line-weight-options">
                    {LINE_WEIGHT_OPTIONS.map((weight) => <option key={weight} value={weight} />)}
                  </datalist>
                </div>
                <div className="inspector-row">
                  <label>Line opacity</label>
                  <input
                    aria-label="Line opacity"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(((selected.style as { strokeOpacity?: number }).strokeOpacity ?? 1) * 100)}
                    onChange={(e) => updateOpacity("stroke", Number(e.target.value))}
                  />
                  <span>%</span>
                </div>
                <div className="inspector-row">
                  <label>Dashes</label>
                  <select
                    value={(selected.style as { dashStyle?: LineDashStyle }).dashStyle ?? "solid"}
                    onChange={(e) => updateDashStyle(e.target.value as LineDashStyle)}
                  >
                    {LINE_DASH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {selected.type === "connector" && (
              <>
                <div className="inspector-row">
                  <label htmlFor="connector-label-input">Label</label>
                  <textarea ref={shapeTextRef} id="connector-label-input" aria-label="Connector label" rows={3}
                    value={selected.label ?? ""}
                    onChange={event => commit(updateConnectorLabel(doc, selected.id, event.target.value))} />
                </div>
                <div className="inspector-row">
                  <label>Start</label>
                  <select
                    aria-label="Connector start"
                    value={selected.startMarker ?? "none"}
                    onChange={(e) => updateConnectorEnd("start", e.target.value as ConnectorEndMarker)}
                  >
                    <option value="none">None</option>
                    <option value="arrow">Arrow</option>
                    <option value="crowFoot">Crow's Foot</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>Start size</label>
                  <select
                    aria-label="Connector start size"
                    value={selected.startMarkerSize ?? "medium"}
                    onChange={(e) => updateConnectorEndSize("start", e.target.value as ConnectorEndMarkerSize)}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>End</label>
                  <select
                    aria-label="Connector end"
                    value={selected.endMarker ?? "arrow"}
                    onChange={(e) => updateConnectorEnd("end", e.target.value as ConnectorEndMarker)}
                  >
                    <option value="none">None</option>
                    <option value="arrow">Arrow</option>
                    <option value="crowFoot">Crow's Foot</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>End size</label>
                  <select
                    aria-label="Connector end size"
                    value={selected.endMarkerSize ?? "medium"}
                    onChange={(e) => updateConnectorEndSize("end", e.target.value as ConnectorEndMarkerSize)}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              </>
            )}
            {selected.type === "autoShape" && selected.preset === "callout" && (
              <div className="inspector-row">
                <label>Tail direction</label>
                <input
                  aria-label="Callout tail direction"
                  type="range"
                  min="0"
                  max="359"
                  value={Math.round(selected.adjustments?.tailAngle ?? 90)}
                  onChange={(e) => updateCalloutTailAngle(Number(e.target.value))}
                />
                <span>{Math.round(selected.adjustments?.tailAngle ?? 90)}°</span>
              </div>
            )}
            {selected.type === "autoShape" && selected.preset === "arcArrow" && (
              <>
                <div className="inspector-row">
                  <label>Start</label>
                  <select
                    aria-label="Arc arrow start marker"
                    value={selected.startMarker ?? "none"}
                    onChange={(e) => updateArcArrowEnd("start", e.target.value as ConnectorEndMarker)}
                  >
                    <option value="none">None</option>
                    <option value="arrow">Arrow</option>
                    <option value="crowFoot">Crow's Foot</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>End</label>
                  <select
                    aria-label="Arc arrow end marker"
                    value={selected.endMarker ?? "arrow"}
                    onChange={(e) => updateArcArrowEnd("end", e.target.value as ConnectorEndMarker)}
                  >
                    <option value="none">None</option>
                    <option value="arrow">Arrow</option>
                    <option value="crowFoot">Crow's Foot</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>Start angle</label>
                  <input
                    aria-label="Arc arrow start angle"
                    type="range"
                    min="0"
                    max="359"
                    value={Math.round(selected.adjustments?.startAngle ?? 200)}
                    onChange={(e) => updateArcArrowAngle("startAngle", Number(e.target.value))}
                  />
                  <span>{Math.round(selected.adjustments?.startAngle ?? 200)}°</span>
                </div>
                <div className="inspector-row">
                  <label>Arc angle</label>
                  <input
                    aria-label="Arc arrow sweep angle"
                    type="range"
                    min="1"
                    max="359"
                    value={Math.round(selected.adjustments?.sweepAngle ?? 220)}
                    onChange={(e) => updateArcArrowAngle("sweepAngle", Number(e.target.value))}
                  />
                  <span>{Math.round(selected.adjustments?.sweepAngle ?? 220)}°</span>
                </div>
              </>
            )}
            {(isTextShapeType(selected.type) || selected.type === "text") && (
              <div className="inspector-row">
                <label>Text</label>
                <textarea
                  ref={shapeTextRef}
                  rows={4}
                  value={(selected as DrawingObject & { text?: string }).text ?? ""}
                  onChange={(e) => updateText(e.target.value)}
                />
              </div>
            )}
            {isTextShapeType(selected.type) && (
              <>
                <div className="inspector-row">
                  <label>H Align</label>
                  <select
                    value={(selected as DrawingObject & { textStyle?: { align?: string } }).textStyle?.align ?? "center"}
                    onChange={(e) => updateShapeHorizontalAlign(e.target.value as "left" | "center" | "right")}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="inspector-row">
                  <label>V Align</label>
                  <select
                    value={(selected as DrawingObject & { textStyle?: { verticalAlign?: string } }).textStyle?.verticalAlign ?? "middle"}
                    onChange={(e) => updateShapeVerticalAlign(e.target.value as "top" | "middle" | "bottom")}
                  >
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </div>
              </>
            )}
            {selected.type === "text" && (
              <div className="inspector-row">
                <label>Size</label>
                <input
                  type="number"
                  value={(selected as DrawingObject & { style: { fontSize?: number } }).style.fontSize ?? 16}
                  onChange={(e) => updateFontSize(Number(e.target.value))}
                />
              </div>
            )}
            {selected.type === "text" && (
              <div className="inspector-row">
                <label>Align</label>
                <select
                  value={(selected as DrawingObject & { style: { align?: string } }).style.align ?? "left"}
                  onChange={(e) =>
                    updateTextAlign(e.target.value as "left" | "center" | "right")
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
            )}
          </>
        ) : (
          <p className="inspector-empty">Select an object</p>
        )}
        {selectedIds.length > 1 && (
          <div className="inspector-align">
            <button onClick={() => applyAlign("left")}>L</button>
            <button onClick={() => applyAlign("center")}>C</button>
            <button onClick={() => applyAlign("right")}>R</button>
            <button onClick={() => applyAlign("top")}>T</button>
            <button onClick={() => applyAlign("middle")}>M</button>
            <button onClick={() => applyAlign("bottom")}>B</button>
            <button aria-label="Distribute horizontally" title="Equal horizontal gaps"
              disabled={selectedObjects.filter(o => o.type !== "connector").length < 3}
              onClick={() => commit(distributeObjects(doc, selectedIds, "horizontal"))}>H gaps</button>
            <button aria-label="Distribute vertically" title="Equal vertical gaps"
              disabled={selectedObjects.filter(o => o.type !== "connector").length < 3}
              onClick={() => commit(distributeObjects(doc, selectedIds, "vertical"))}>V gaps</button>
          </div>
        )}
        <div className="inspector-group">
          {selectedIds.length > 1 && <button onClick={groupSelection}>Group</button>}
          {selectedObjects.some((object) => object.type === "group") && (
            <button onClick={ungroupSelection}>Ungroup</button>
          )}
        </div>
        {selectedIds.length > 0 && (
          <div className="inspector-arrange">
            <button onClick={() => commit(bringToFront(doc, selectedIds))}>Front</button>
            <button onClick={() => commit(bringForward(doc, selectedIds))}>Fwd</button>
            <button onClick={() => commit(sendBackward(doc, selectedIds))}>Back</button>
            <button onClick={() => commit(sendToBack(doc, selectedIds))}>Back</button>
          </div>
        )}
        </div>;
        const panel = propertiesPanelId ? document.getElementById(propertiesPanelId) : null;
        return panel ? createPortal(inspector, panel) : inspector;
      })()}
    </div>
  );
}

function toColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000";
}
