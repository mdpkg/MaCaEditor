import { useCallback, useMemo, useRef, useState } from "react";
import type { DrawingDocument, DrawingObject, LineDashStyle } from "../lib/drawing/model";
import { renderSvg } from "../lib/drawing/svg";
import { createConnector, createObject, type ToolKind } from "../lib/drawing/factory";
import {
  alignObjects,
  bringForward,
  bringToFront,
  deleteObjects,
  moveObject,
  moveObjectFromDragStart,
  moveObjectFromDragStartSnapped,
  sendBackward,
  sendToBack,
  type AlignKind,
  type History,
  updateShapeText,
} from "../lib/drawing/edit";
import { copyObjects, pasteObjects } from "../lib/drawing/clipboard";
import { clientToCanvasPoint, drawingViewport } from "../lib/drawing/viewport";
import { LINE_DASH_OPTIONS, LINE_WEIGHT_OPTIONS } from "../lib/drawing/lineStyle";
import { connectorGeometry, isPointOnConnector } from "../lib/drawing/connector";

export interface DrawingEditorProps {
  doc: DrawingDocument;
  onChange: (doc: DrawingDocument) => void;
  onDirty: () => void;
}

type Tool = ToolKind;

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "rectangle", label: "Rect" },
  { id: "roundedRectangle", label: "Round Rect" },
  { id: "ellipse", label: "Ellipse" },
  { id: "text", label: "Text" },
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
  { id: "connector", label: "Connector" },
  { id: "curveConnector", label: "Curve" },
];

export function DrawingEditor({ doc, onChange, onDirty }: DrawingEditorProps) {
  const [tool, setTool] = useState<Tool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const [undoStack, setUndoStack] = useState<History>([]);
  const [redoStack, setRedoStack] = useState<History>([]);
  const [clipboard, setClipboard] = useState<DrawingObject[]>([]);
  const [connectorStart, setConnectorStart] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{
    type: "move" | "resize" | "create";
    id?: string;
    startX: number;
    startY: number;
    origX?: number;
    origY?: number;
    origW?: number;
    origH?: number;
    handle?: string;
    before?: DrawingDocument;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragPreviewRef = useRef<DrawingDocument | null>(null);

  const selectedObjects = useMemo(
    () => doc.objects.filter((o) => selectedIds.includes(o.id)),
    [doc.objects, selectedIds],
  );

  const commit = useCallback(
    (next: DrawingDocument) => {
      setUndoStack((u) => [...u, { before: doc, after: next }]);
      setRedoStack([]);
      onChange(next);
      onDirty();
    },
    [doc, onChange, onDirty],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, entry]);
    setUndoStack((u) => u.slice(0, u.length - 1));
    onChange(entry.before);
  }, [undoStack, onChange]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, entry]);
    setRedoStack((r) => r.slice(0, r.length - 1));
    onChange(entry.after);
  }, [redoStack, onChange]);

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
          const tolerance = Math.max(8, (obj.style.strokeWidth ?? 1) / 2 + 4);
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
        if (
          x >= obj.x &&
          x <= obj.x + obj.width &&
          y >= obj.y &&
          y <= obj.y + obj.height
        ) {
          return obj;
        }
      }
      return null;
    },
    [doc.objects],
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);
    const hit = hitTest(x, y);

    if (tool === "connector" || tool === "curveConnector") {
      if (connectorStart === null && hit && hit.type !== "connector") {
        setConnectorStart(hit.id);
        setSelectedIds([hit.id]);
        return;
      }
      if (connectorStart !== null && hit && hit.type !== "connector" && hit.id !== connectorStart) {
        const conn = createConnector(doc, connectorStart, hit.id, tool === "curveConnector");
        commit({ ...doc, objects: [...doc.objects, conn] });
        setConnectorStart(null);
        setSelectedIds([conn.id]);
        return;
      }
      setConnectorStart(null);
      return;
    }

    if (tool === "select") {
      if (hit) {
        const multi = e.shiftKey;
        setSelectedIds((prev) =>
          multi && prev.includes(hit.id)
            ? prev.filter((id) => id !== hit.id)
            : multi
              ? [...prev, hit.id]
              : [hit.id],
        );
        if (hit.type === "connector") return;
        setDragging({
          type: "move",
          id: hit.id,
          startX: x,
          startY: y,
          origX: hit.x,
          origY: hit.y,
          before: doc,
        });
        dragPreviewRef.current = doc;
        return;
      }
      setSelectedIds([]);
      return;
    }

    // 作成ツール
    const obj = createObject(doc, tool, snapValue(x), snapValue(y));
    commit({ ...doc, objects: [...doc.objects, obj] });
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
    const { x, y } = toCanvasPoint(e.clientX, e.clientY);

    if (dragging.type === "move" && dragging.id) {
      const original = dragging.before ?? doc;
      const start = { x: dragging.startX, y: dragging.startY };
      const current = { x, y };
      const next = snap
        ? moveObjectFromDragStartSnapped(original, dragging.id, start, current, doc.canvas.gridSize)
        : moveObjectFromDragStart(original, dragging.id, start, current);
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
      onDirty();
    }
    dragPreviewRef.current = null;
    setDragging(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    if (!hit || !["rectangle", "roundedRectangle", "ellipse"].includes(hit.type)) return;
    const currentText = "text" in hit && typeof hit.text === "string" ? hit.text : "";
    const text = window.prompt("Shape text", currentText);
    if (text === null || text === currentText) return;
    commit(updateShapeText(doc, hit.id, text));
    setSelectedIds([hit.id]);
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
        {TOOLS.map((t) => (
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
              if (!obj || obj.type === "connector") return null;
              return (
                <g key={id} className="selection-box">
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
                  {[
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
        </svg>
      </div>
      <div className="drawing-statusbar">
        <span>{Math.round(zoom * 100)}%</span>
        <span>Grid {gridVisible ? "On" : "Off"}</span>
        <span>Snap {snap ? "On" : "Off"}</span>
      </div>
      <div className="drawing-inspector">
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
            {(["rectangle", "roundedRectangle", "ellipse"] as string[]).includes(selected.type) && (
              <div className="inspector-row">
                <label>Fill</label>
                <input
                  type="color"
                  value={toColor((selected.style as { fill?: string }).fill)}
                  onChange={(e) => updateFill(e.target.value)}
                />
              </div>
            )}
            {(["rectangle", "roundedRectangle", "ellipse", "line", "arrow", "connector"] as string[]).includes(selected.type) && (
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
            {(selected.type === "rectangle" ||
              selected.type === "roundedRectangle" ||
              selected.type === "ellipse" ||
              selected.type === "text") && (
              <div className="inspector-row">
                <label>Text</label>
                <input
                  type="text"
                  value={(selected as DrawingObject & { text?: string }).text ?? ""}
                  onChange={(e) => updateText(e.target.value)}
                />
              </div>
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
        {selectedIds.length > 0 && (
          <div className="inspector-arrange">
            <button onClick={() => commit(bringToFront(doc, selectedIds))}>Front</button>
            <button onClick={() => commit(bringForward(doc, selectedIds))}>Fwd</button>
            <button onClick={() => commit(sendBackward(doc, selectedIds))}>Back</button>
            <button onClick={() => commit(sendToBack(doc, selectedIds))}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

function toColor(color: string | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#000000";
}
