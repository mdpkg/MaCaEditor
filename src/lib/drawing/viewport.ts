export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Size {
  left: number;
  top: number;
}

export function drawingViewport(canvas: Size, zoom: number) {
  return {
    width: canvas.width * zoom,
    height: canvas.height * zoom,
    viewBox: `0 0 ${canvas.width} ${canvas.height}`,
  };
}

export function clientToCanvasPoint(
  client: { x: number; y: number },
  bounds: Bounds,
  canvas: Size,
) {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
  return {
    x: (client.x - bounds.left) * canvas.width / bounds.width,
    y: (client.y - bounds.top) * canvas.height / bounds.height,
  };
}
