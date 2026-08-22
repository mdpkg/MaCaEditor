import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";

interface Props {
  svg: string;
  label: string;
  onClose: () => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

export function SvgPreviewOverlay({ svg, label, onClose }: Props) {
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const zoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect.height > 0 ? rect.top + rect.height / 2 : window.innerHeight / 2;
    setTransform((current) => {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const scale = Math.min(8, Math.max(0.2, Number((current.scale * factor).toFixed(4))));
      const imageX = (event.clientX - centerX - current.x) / current.scale;
      const imageY = (event.clientY - centerY - current.y) / current.scale;
      return {
        scale,
        x: event.clientX - centerX - imageX * scale,
        y: event.clientY - centerY - imageY * scale,
      };
    });
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const currentDrag = drag.current;
    setTransform((current) => ({
      ...current,
      x: currentDrag.originX + event.clientX - currentDrag.startX,
      y: currentDrag.originY + event.clientY - currentDrag.startY,
    }));
  };

  const stopDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  return createPortal(
    <div className="preview-media-overlay" role="dialog" aria-modal="true" aria-label="拡大表示">
      <button
        type="button"
        className="preview-media-close"
        aria-label="拡大表示を閉じる"
        onClick={onClose}
      >×</button>
      <div
        className={`preview-media-content${dragging ? " dragging" : ""}`}
        onWheel={zoom}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div
          className="preview-media-transform"
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          <span
            className="drawing-image"
            role="img"
            aria-label={label}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
