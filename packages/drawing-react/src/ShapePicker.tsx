import { useEffect, useRef, useState } from "react";
import {
  getShapeDefinition,
  type AutoShapeObject,
  type ShapeCategory,
  type ToolKind,
} from "@maca/drawing-core";

/** A tool entry displayed by the reusable shape picker. */
export interface ShapePickerItem {
  id: ToolKind;
  label: string;
  category: ShapeCategory | "Legacy";
}

interface Props {
  items: ShapePickerItem[];
  onSelect: (tool: ToolKind) => void;
  onActivate: () => void;
}

function legacyIcon(tool: ToolKind): { viewBox: string; content: string } {
  const attributes = 'fill="var(--panel)" stroke="var(--text)" stroke-width="1.5"';
  switch (tool) {
    case "rectangle":
      return { viewBox: "0 0 32 22", content: `<rect x="2" y="3" width="28" height="16" ${attributes}/>` };
    case "roundedRectangle":
      return { viewBox: "0 0 32 22", content: `<rect x="2" y="3" width="28" height="16" rx="4" ${attributes}/>` };
    case "ellipse":
      return { viewBox: "0 0 32 22", content: `<ellipse cx="16" cy="11" rx="14" ry="8" ${attributes}/>` };
    case "file":
      return { viewBox: "0 0 32 24", content: `<path d="M5 2h15l7 7v13H5z M20 2v7h7" ${attributes}/>` };
    case "user":
      return { viewBox: "0 0 32 24", content: `<circle cx="16" cy="7" r="5" ${attributes}/><path d="M6 23c0-7 4-10 10-10s10 3 10 10z" ${attributes}/>` };
    default:
      return { viewBox: "0 0 32 22", content: "" };
  }
}

function shapeIcon(tool: ToolKind): { viewBox: string; content: string } {
  if (!tool.startsWith("autoShape:")) return legacyIcon(tool);
  const preset = tool.slice("autoShape:".length);
  const definition = getShapeDefinition(preset);
  if (!definition) return { viewBox: "0 0 32 22", content: "" };
  const shape: AutoShapeObject = {
    id: "preview", type: "autoShape", preset,
    x: 1, y: 1, width: definition.width, height: definition.height,
    rotation: 0, zIndex: 0, style: {},
  };
  return {
    viewBox: `-2 -2 ${definition.width + 6} ${definition.height + 6}`,
    content: definition.render(
      shape,
      'fill="var(--panel)" stroke="var(--text)" stroke-width="2"',
    ),
  };
}

function ShapeIcon({ tool }: { tool: ToolKind }) {
  const icon = shapeIcon(tool);
  return <svg
    className="shape-picker-icon"
    viewBox={icon.viewBox}
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: icon.content }}
  />;
}

export function ShapePicker({ items, onSelect, onActivate }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const toggle = () => {
    onActivate();
    setOpen((current) => !current);
  };

  const choose = (tool: ToolKind) => {
    onSelect(tool);
    setOpen(false);
  };

  const categories: ShapePickerItem["category"][] = ["Legacy", "Basic", "Flowchart", "Arrows"];
  return <div className="shape-picker" ref={rootRef}>
    <button
      type="button"
      className="shape-picker-trigger"
      aria-label="Shape"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >Shape <span aria-hidden="true">▾</span></button>
    {open && <div className="shape-picker-menu" role="menu">
      {categories.map((category) => <div className="shape-picker-category" key={category}>
        <div className="shape-picker-category-label">{category === "Legacy" ? "Basic Shapes" : category}</div>
        {items.filter((item) => item.category === category).map((item) => <button
          type="button"
          role="menuitem"
          className="shape-picker-item"
          key={item.id}
          onClick={() => choose(item.id)}
        >
          <ShapeIcon tool={item.id} />
          <span>{item.label}</span>
        </button>)}
      </div>)}
    </div>}
  </div>;
}
