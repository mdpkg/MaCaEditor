import type { ChatConnection } from "./aiChatSessions";
export type QuotedChat = {
  commentId: string; documentScopeKey: string; path: string;
  context: { target: string; previous?: string; next?: string; heading?: string };
  reaction: string; reactionType: "reaction" | "advice" | "observation";
  personality: string; connection: ChatConnection;
};
export function copyQuotedChat(value: QuotedChat): QuotedChat | undefined {
  const count = (text: string, limit: number) => text.length <= limit * 2 && Array.from(text).length <= limit;
  if (!value.commentId || value.commentId.length > 128 || !value.path || value.path.startsWith("/") || /[\\:]/.test(value.path) ||
      value.path.split("/").some((part) => !part || part === "." || part === "..") ||
      !value.context.target.trim() || !count(Object.values(value.context).join(""), 2000) ||
      !value.reaction.trim() || !count(value.reaction, 120) || !count(value.personality, 10000) ||
      !["reaction", "advice", "observation"].includes(value.reactionType)) return;
  let origin: string;
  try { const url = new URL(value.connection.endpoint); if (!["http:", "https:"].includes(url.protocol)) return; origin = url.origin; } catch { return; }
  return { commentId: value.commentId, documentScopeKey: value.documentScopeKey, path: value.path,
    context: { target: value.context.target, ...(value.context.previous === undefined ? {} : { previous: value.context.previous }),
      ...(value.context.next === undefined ? {} : { next: value.context.next }), ...(value.context.heading === undefined ? {} : { heading: value.context.heading }) },
    reaction: value.reaction, reactionType: value.reactionType, personality: value.personality,
    connection: { endpoint: origin, model: value.connection.model, revision: value.connection.revision } };
}
