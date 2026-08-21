import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ConnectorEndMarker, DrawingDocument, DrawingObject, LineDashStyle } from "../lib/drawing/model";
import { renderSvg } from "../lib/drawing/svg";
import { createConnector, createObject, type ToolKind } from "../lib/drawing/factory";
import {
  alignObjects,
  bringForward,
  bringToFront,
  deleteObjects,
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
  type AlignKind,
  type History,
  updateConnectorEnds,
  updateObjectOpacity,
  updateObjectRotation,
  ungroupObjects,
  updateShapeText,
  updateShapeTextAlignment,
} from "../lib/drawing/edit";
import { copyObjects, pasteObjects } from "../lib/drawing/clipboard";
import { clientToCanvasPoint, drawingViewport } from "../lib/drawing/viewport";
import { LINE_DASH_OPTIONS, LINE_WEIGHT_OPTIONS } from "../lib/drawing/lineStyle";
import { connectorGeometry, isPointOnConnector } from "../lib/drawing/connector";

export interface DrawingEditorProps {
  doc: DrawingDocument;
  onChange: (doc: DrawingDocument) => void;
  onDirty: (doc: DrawingDocument) => void;
  onRequestImage?: () => Promise<string | null>;
  propertiesPanelId?: string;
}

type Tool = ToolKind;

const SHAPE_TOOLS: { id: Tool; label: string }[] = [
  { id: "rectangle", label: "Rect" },
  { id: "roundedRectangle", label: "Round Rect" },
  { id: "ellipse", label: "Ellipse" },
  { id: "file", label: "File" },
  { id: "user", label: "User" },
];

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

const TEXT_SHAPE_TYPES = ["rectangle", "roundedRectangle", "ellipse", "file", "user"];

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
  const [dragging, setDragging] = useState<{
    type: "move" | "resize" | "rotate" | "create" | "canvasResize" | "marquee";
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

  const selectedObjects = useMemo(
    () => doc.objects.filter((o) => selectedIds.includes(o.id)),
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

  const hitTest = useCallback(
    (x: number, y: number): DrawingObject | null => {
      const sorted = [...doc.objects].sort((a, b) => b.zIndex - a.zIndex);
      for (const obj of sorted) {
        if (obj.type === "connector") {
          const geometry = connectorGeometry(obj, doc.objects);
          const tolerance = Math.max(12 / zoom, (obj.style.strokeWidth ?? 1) / 2 + 6 / zoom);
          if (geometry && isPointOnConnector(geometry, x, y, tolerance)) return obj;
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

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
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
    const rotateObjectId = (e.target as SVGElement).dataset.objectRotate;
    if (rotateObjectId) {
      const object = doc.objects.find((candidate) => candidate.id === rotateObjectId);
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
      const object = doc.objects.find((candidate) => candidate.id === objectId);
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
    const hit = hitTest(x, y);

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

    if (dragging.type === "move" && dragging.id) {
      const original = dragging.before ?? doc;
      const start = { x: dragging.startX, y: dragging.startY };
      const current = { x, y };
      const ids = dragging.ids ?? [dragging.id];
      const next = snap
        ? moveObjectsFromDragStartSnapped(
          original,
          ids,
          dragging.id,
          start,
          current,
          doc.canvas.gridSize,
        )
        : moveObjectsFromDragStart(original, ids, start, current);
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
    } else if ((dragging?.type === "resize" || dragging?.type === "rotate") && dragging.before) {
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
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (!hit || !isTextShapeType(hit.type)) return;
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

  const updateRotation = (rotation: number) => {
    if (!selected) return;
    commit(updateObjectRotation(doc, selected.id, rotation));
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
    <div className="drawing-editor" onKeyDown={handleKeyDown} tabIndex={0}>
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
        <select
          aria-label="Shape"
          title="Shape"
          className={SHAPE_TOOLS.some((shape) => shape.id === tool) ? "active" : ""}
          value={SHAPE_TOOLS.some((shape) => shape.id === tool) ? tool : ""}
          onChange={(event) => {
            setTool(event.target.value ? event.target.value as Tool : "select");
            setConnectorStart(null);
          }}
        >
          <option value="">Shape</option>
          {SHAPE_TOOLS.map((shape) => (
            <option key={shape.id} value={shape.id}>{shape.label}</option>
          ))}
        </select>
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
            {selectedIds.map((id) => {
              const obj = doc.objects.find((o) => o.id === id);
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
                if (geometry.points) {
                  return <polyline
                    key={id}
                    points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")}
                    {...selectionProps}
                  />;
                }
                if (geometry.c1 && geometry.c2) {
                  return <path
                    key={id}
                    d={`M ${geometry.from.x} ${geometry.from.y} C ${geometry.c1.x} ${geometry.c1.y} ${geometry.c2.x} ${geometry.c2.y} ${geometry.to.x} ${geometry.to.y}`}
                    {...selectionProps}
                  />;
                }
                return <line
                  key={id}
                  x1={geometry.from.x}
                  y1={geometry.from.y}
                  x2={geometry.to.x}
                  y2={geometry.to.y}
                  {...selectionProps}
                />;
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
                  <input
                    type="color"
                    value={toColor((selected.style as { fill?: string }).fill)}
                    onChange={(e) => updateFill(e.target.value)}
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
                  <input
                    type="color"
                    value={toColor((selected.style as { stroke?: string }).stroke)}
                    onChange={(e) => updateStroke(e.target.value)}
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
