import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, test } from "vitest";
import { StatusBar } from "./StatusBar";

describe("StatusBar document mode", () => {
  test("shows Folder mode and location", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(StatusBar, { message: "Ready", mode: "Folder", location: "C:/docs/book" })));
    expect(host.textContent).toContain("Folder — C:/docs/book");
    act(() => root.unmount());
  });

  test("shows Package mode", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(StatusBar, { message: "Ready", mode: "Package" })));
    expect(host.textContent).toContain("Package");
    act(() => root.unmount());
  });
});
