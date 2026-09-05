import { expect, test } from "vitest";
import { connectorGeometry, connectorLabelPoint } from "./connector";
import { updateConnectorLabel, moveObject } from "./edit";
import { parseAndValidate, serializeDrawingDocument } from "./drawing";
import { renderSvg } from "./svg";
import type { ConnectorObject, DrawingDocument } from "./model";

const connector: ConnectorObject = {
  id: "c", type: "connector", x: 0, y: 0, width: 0, height: 0, rotation: 0, zIndex: 2,
  from: { objectId: "a" }, to: { objectId: "b" }, style: {},
};
const doc: DrawingDocument = {
  format: "maca-drawing", version: "1.0", canvas: { width: 500, height: 300, gridSize: 10 },
  objects: [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 40, height: 40, rotation: 0, zIndex: 0, style: {} },
    { id: "b", type: "rectangle", x: 200, y: 0, width: 40, height: 40, rotation: 0, zIndex: 1, style: {} },
    connector,
  ],
};

test("stores labels without changing the original and round-trips them", () => {
  const edited = updateConnectorLabel(doc, "c", "Yes\nHTTP");
  expect(edited.objects[2]).toMatchObject({ label: "Yes\nHTTP" });
  expect(connector).not.toHaveProperty("label");
  expect(parseAndValidate(serializeDrawingDocument(edited))).toEqual(edited);
  expect(() => parseAndValidate(serializeDrawingDocument(doc))).not.toThrow();
});

test("rejects non-string labels", () => {
  expect(() => parseAndValidate(JSON.stringify({ ...doc, objects: [...doc.objects.slice(0, 2), { ...connector, label: 42 }] }))).toThrow(/label/);
});

test("places a straight label at the midpoint and follows connected objects", () => {
  expect(connectorLabelPoint(connectorGeometry(connector, doc.objects)!)).toEqual({ x: 120, y: 20 });
  const moved = moveObject(doc, "b", 100, 0);
  expect(connectorLabelPoint(connectorGeometry(connector, moved.objects)!)).toEqual({ x: 170, y: 20 });
});

test("places curved labels on the curve and elbow labels halfway along the route", () => {
  const curve = connectorGeometry({ ...connector, curve: true, curveOffset: { x: 0, y: 60 } }, doc.objects)!;
  expect(connectorLabelPoint(curve).y).toBeCloseTo(80);
  expect(connectorLabelPoint({ from: { x: 0, y: 0 }, to: { x: 100, y: 200 }, points: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 },
  ] })).toEqual({ x: 100, y: 50 });
});

test.each([{}, { curve: true }, { elbow: true }])("exports escaped multiline labels for %j", (kind) => {
  const labeled = updateConnectorLabel({ ...doc, objects: [...doc.objects.slice(0, 2), { ...connector, ...kind }] }, "c", "<Yes> &\nHTTP");
  const svg = renderSvg(labeled);
  expect(svg).toContain("&lt;Yes&gt; &amp;");
  expect(svg).toContain("HTTP</tspan>");
  expect(svg).toContain('class="connector-label"');
  expect(renderSvg(updateConnectorLabel(labeled, "c", ""))).not.toContain('class="connector-label"');
});

test("includes labels outside shape bounds when fitting the exported SVG", () => {
  const labeled = updateConnectorLabel({ ...doc, objects: [...doc.objects.slice(0, 2), {
    ...connector, curve: true, curveOffset: { x: 0, y: 150 },
  }] }, "c", "HTTP");
  const svg = new DOMParser().parseFromString(renderSvg(labeled, { fitToContent: true }), "image/svg+xml").documentElement;
  const [, y, , height] = svg.getAttribute("viewBox")!.split(" ").map(Number);
  expect(y + height).toBeGreaterThan(180);
});
