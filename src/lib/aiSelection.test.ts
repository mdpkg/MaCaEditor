import { describe, expect, test } from "vitest";
import {
  aiErrorMessage,
  isAiConfigured,
  isEntirelyInsideCodeBlock,
  isSelectionValid,
  type AiSelectionSnapshot,
} from "./aiSelection";
import type { AiConfig } from "../types";

function snapshot(from: number, to: number, text: string): AiSelectionSnapshot {
  return { from, to, text };
}

const configured: AiConfig = {
  provider: "OpenAiCompatible",
  base_url: "http://localhost:11434/v1",
  api_key: null,
  model: "qwen2.5",
  temperature: 0.7,
  max_output_tokens: 4096,
  connect_timeout_seconds: 10,
  request_timeout_seconds: 300,
};

describe("isSelectionValid", () => {
  test("accepts a non-empty selection", () => {
    expect(isSelectionValid(snapshot(0, 3, "abc"))).toBe(true);
  });

  test("rejects a null snapshot", () => {
    expect(isSelectionValid(null)).toBe(false);
  });

  test("rejects an empty selection", () => {
    expect(isSelectionValid(snapshot(2, 2, ""))).toBe(false);
  });

  test("rejects whitespace-only selection", () => {
    expect(isSelectionValid(snapshot(0, 3, "   "))).toBe(false);
  });

  test("rejects newline-only selection", () => {
    expect(isSelectionValid(snapshot(0, 2, "\n\n"))).toBe(false);
  });

  test("accepts Unicode / Japanese text", () => {
    expect(isSelectionValid(snapshot(0, 4, "日本語"))).toBe(true);
  });

  test("accepts Markdown-containing selection", () => {
    expect(isSelectionValid(snapshot(0, 10, "# Heading"))).toBe(true);
  });
});

describe("isEntirelyInsideCodeBlock", () => {
  test("returns false when selection is outside a code block", () => {
    expect(isEntirelyInsideCodeBlock("hello world", 0, 5)).toBe(false);
  });

  test("returns true when selection is entirely inside a fenced code block", () => {
    const content = "```\ncode here\n```";
    expect(isEntirelyInsideCodeBlock(content, 4, 12)).toBe(true);
  });

  test("returns false when selection contains the whole code block", () => {
    const content = "```\ncode\n```";
    expect(isEntirelyInsideCodeBlock(content, 0, content.length)).toBe(false);
  });
});

describe("isAiConfigured", () => {
  test("returns true when base url and model are set", () => {
    expect(isAiConfigured(configured)).toBe(true);
  });

  test("returns false when model is empty", () => {
    expect(isAiConfigured({ ...configured, model: "" })).toBe(false);
  });

  test("returns false when base url is empty", () => {
    expect(isAiConfigured({ ...configured, base_url: "" })).toBe(false);
  });
});

describe("aiErrorMessage", () => {
  test("maps each error kind to a user-friendly message", () => {
    expect(aiErrorMessage("ConnectionFailed")).toContain("connect");
    expect(aiErrorMessage("AuthenticationFailed")).toContain("API key");
    expect(aiErrorMessage("ModelNotFound")).toContain("model");
    expect(aiErrorMessage("RateLimited")).toContain("rate limited");
    expect(aiErrorMessage("Timeout")).toContain("timed out");
    expect(aiErrorMessage("ServerError")).toContain("server");
    expect(aiErrorMessage("Cancelled")).toContain("cancelled");
    expect(aiErrorMessage("Unknown")).toContain("unknown");
  });
});
