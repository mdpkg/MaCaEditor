export interface ChachaComment { type: "reaction" | "advice" | "observation"; comment: string }

export function parseChachaResponse(raw: string): ChachaComment | null {
  if (new TextEncoder().encode(raw).length > 4096) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const object = value as Record<string, unknown>;
    if (Object.keys(object).length !== 2 || !["reaction", "advice", "observation"].includes(String(object.type))
      || typeof object.comment !== "string" || !object.comment.trim() || Array.from(object.comment).length > 120) return null;
    return { type: object.type as ChachaComment["type"], comment: object.comment };
  } catch { return null; }
}
