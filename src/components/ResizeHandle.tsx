import { useRef } from "react";

export function ResizeHandle({ label, value, min, max, initial, onChange, ratio = false }: {
  label: string; value: number; min: number; max: number; initial: number;
  onChange: (value: number) => void; ratio?: boolean;
}) {
  const drag = useRef<{ x: number; value: number; scale: number } | null>(null);
  const change = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  return <div className="resize-handle" role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical"
    aria-valuenow={Math.round(value * (ratio ? 100 : 1))} aria-valuemin={min * (ratio ? 100 : 1)} aria-valuemax={max * (ratio ? 100 : 1)}
    title={`${label}（矢印キーで調整、ダブルクリックで初期値）`}
    onDoubleClick={() => change(initial)}
    onKeyDown={(event) => {
      const step = ratio ? 0.02 : 16;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      change(event.key === "Home" ? min : event.key === "End" ? max : value + (event.key === "ArrowRight" ? step : -step));
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;
      drag.current = { x: event.clientX, value, scale: ratio ? 1 / Math.max(1, width - 8) : 1 };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => { if (drag.current) change(drag.current.value + (event.clientX - drag.current.x) * drag.current.scale); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }} />;
}
