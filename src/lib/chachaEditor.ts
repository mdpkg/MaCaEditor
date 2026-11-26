import { Prec, StateEffect, StateField, Transaction, type Extension, type Text, type ChangeSet } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap, showTooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { searchPanelOpen } from "@codemirror/search";
import { getCM } from "@replit/codemirror-vim";
import { ChachaEdits } from "./chachaEdits";
import { ChachaSession, type ChachaSnapshot } from "./chachaSession";
import { extractChachaContext, type ChachaContext } from "./chachaContext";

const refresh = StateEffect.define<ChachaSnapshot>();
const controls = new WeakMap<EditorView, { session: ChachaSession; focusNext: boolean }>();
const modal = () => !!document.querySelector('[aria-modal="true"]');
const restoreFocus = (view: EditorView) => view.contentDOM.focus({ preventScroll: true });
export function continueChachaComment(view: EditorView, commentId?: string): boolean {
  const value = controls.get(view), id = commentId ?? value?.session.snapshot.comment?.id;
  return !!value && !!id && value.session.continue(id);
}
export function expandChachaComment(view: EditorView, commentId?: string, focus = false): boolean {
  const value = controls.get(view), id = commentId ?? value?.session.snapshot.comment?.id;
  if (!value || !id) return false;
  value.focusNext = focus;
  if (!value.session.expand(id)) { value.focusNext = false; return false; }
  const target = view.dom.querySelector<HTMLButtonElement>(".cm-chacha-comment");
  if (focus && target) { value.focusNext = false; target.focus({ preventScroll: true }); }
  return true;
}
export function dismissChachaComment(view: EditorView, commentId?: string): boolean {
  const value = controls.get(view);
  if (!value || !["collapsed", "expanded"].includes(value.session.snapshot.phase)) return false;
  if (commentId !== undefined && value.session.snapshot.comment?.id !== commentId) return false;
  const focused = view.dom.querySelector(".cm-chacha-gutter")?.contains(document.activeElement)
    || view.dom.querySelector(".cm-chacha-tooltip")?.contains(document.activeElement);
  value.session.dismiss(); if (focused) restoreFocus(view); return true;
}
function button(label: string, text: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const element = document.createElement("button"); element.type = "button"; element.textContent = text;
  element.setAttribute("aria-label", label); element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", action); return element;
}
class Marker extends GutterMarker {
  constructor(private readonly comment?: ChachaSnapshot["comment"], private readonly spacer = false, private readonly expanded = false) { super(); }
  eq(other: Marker) { return this.comment === other.comment && this.spacer === other.spacer && this.expanded === other.expanded; }
  toDOM(view: EditorView) {
    const dom = document.createElement("div"); dom.className = "cm-chacha-buttons";
    if (this.spacer) { dom.style.height = "0"; return dom; }
    const open = button("茶々入れを表示", "💬", (event) => { expandChachaComment(view, this.comment?.id, event.detail === 0); });
    open.setAttribute("aria-expanded", String(this.expanded));
    open.title = this.comment?.comment ?? "";
    if (this.comment) open.setAttribute("aria-description", this.comment.comment);
    dom.append(open, button("茶々入れコメントを削除", "×", () => { dismissChachaComment(view, this.comment?.id); }));
    return dom;
  }
}

export function createChachaExtension(session: ChachaSession, options: {
  file?: string; controlled?: (transaction: Transaction) => boolean; blocked?: () => boolean;
} = {}): Extension {
  let composingKey = false;
  const display = StateField.define<ChachaSnapshot>({
    create: () => session.snapshot,
    update(value, tr) {
      if (tr.docChanged && value.comment) {
        const context = value.comment.context;
        value = { ...value, comment: { ...value.comment, context: { ...context, anchor: {
          from: tr.changes.mapPos(context.anchor.from, 1), to: tr.changes.mapPos(context.anchor.to, -1),
        } } } };
      }
      for (const effect of tr.effects) if (effect.is(refresh)) value = effect.value;
      return value;
    },
    provide: (field) => [
      EditorView.editorAttributes.compute([field], (state) => ({ "data-chacha-enabled": String(state.field(field).enabled) })),
      showTooltip.compute([field], (state) => {
        const value = state.field(field), comment = value.comment;
        if (value.phase !== "expanded" || !comment) return null;
        return { pos: comment.context.anchor.from, above: true, create(view) {
          const dom = document.createElement("div"); dom.className = "cm-chacha-tooltip";
          dom.setAttribute("role", "note"); dom.setAttribute("aria-label", "茶々入れ");
          const open = button("茶々入れから会話を開く", comment.comment, () => { continueChachaComment(view, comment.id); });
          open.className = "cm-chacha-comment"; open.title = "クリックすると引用会話を開きます。";
          open.setAttribute("aria-description", comment.comment);
          dom.append(open, button("茶々入れコメントを削除", "×", () => { dismissChachaComment(view, comment.id); }));
          dom.addEventListener("keydown", (event) => {
            if ((event.key === "Escape" || (event.key === "Backspace" && (event.ctrlKey || event.metaKey) && event.altKey)) &&
                !event.isComposing && event.keyCode !== 229 && !view.composing && !modal()) {
              event.preventDefault(); event.stopPropagation(); dismissChachaComment(view);
            }
          });
          return { dom, mount() { const control = controls.get(view); if (control?.focusNext) { control.focusNext = false; open.focus({ preventScroll: true }); } } };
        } };
      }),
    ],
  });
  const plugin = ViewPlugin.fromClass(class {
    private alive = true;
    private queued = false;
    private composing = false;
    private readonly edits = new ChachaEdits();
    private lastChange?: { before: Text; changes: ChangeSet };
    private gutterParent?: HTMLElement;
    private previousHidden: string | null = null;
    private readonly unsubscribe: () => void;
    private readonly detach: () => void;
    private readonly pulse = () => session.pulse();
    constructor(private readonly view: EditorView) {
      controls.set(view, { session, focusNext: false });
      this.unsubscribe = session.subscribe(() => this.updateDisplay());
      this.detach = session.attach({ file: options.file ?? "current", source: () => view.state.doc.toString(),
        blocked: () => this.blocked(), visible: (position) => {
          if (!view.visibleRanges.some((range) => range.from <= position && position <= range.to)) return false;
          const top = view.lineBlockAt(position).top, scroll = view.scrollDOM;
          return top >= scroll.scrollTop && top < scroll.scrollTop + scroll.clientHeight;
        }, targetEdited: (context) => this.targetEdited(context) });
      window.addEventListener("focus", this.pulse); window.addEventListener("blur", this.pulse);
      document.addEventListener("visibilitychange", this.pulse);
    }
    private blocked() {
      return this.composing || this.view.composing || !document.hasFocus() || document.visibilityState === "hidden" || modal()
        || searchPanelOpen(this.view.state) || !!this.view.dom.querySelector(".cm-tooltip:not(.cm-chacha-tooltip), .cm-dialog") || options.blocked?.() === true;
    }
    private targetEdited(context: ChachaContext) {
      if (!this.lastChange) return false;
      const inverse = this.lastChange.changes.invertedDesc;
      // Compare whole paragraphs: mapping the new end backwards omits a deleted suffix.
      // The start's positive association skips a removed preceding paragraph.
      const previous = extractChachaContext(this.lastChange.before.toString(), inverse.mapPos(context.anchor.from, 1));
      return previous?.text.target !== context.text.target;
    }
    private updateDisplay() {
      if (this.queued || !this.alive) return; this.queued = true;
      queueMicrotask(() => {
        this.queued = false; if (!this.alive) return;
        this.view.dispatch({ effects: refresh.of(session.snapshot), annotations: Transaction.addToHistory.of(false) });
        const gutter = this.view.dom.querySelector<HTMLElement>(".cm-chacha-gutter"), parent = gutter?.parentElement;
        if (parent) {
          if (this.gutterParent !== parent) { this.gutterParent = parent; this.previousHidden = parent.getAttribute("aria-hidden"); }
          parent.removeAttribute("aria-hidden"); gutter!.setAttribute("role", "group"); gutter!.setAttribute("aria-label", "茶々入れコメント");
        }
      });
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        session.changed(update.changes);
        if (update.transactions.some((tr) => tr.docChanged && options.controlled?.(tr))) {
          this.edits.reset(); this.lastChange = undefined; session.resetEdits();
        } else {
          this.lastChange = { before: update.startState.doc, changes: update.changes };
          const edit = this.edits.change(update.changes, update.startState.doc, update.state.doc, this.composing || update.view.composing);
          if (edit) session.edited(edit);
        }
      }
      session.pulse();
    }
    compositionStart() { this.composing = true; session.pulse(); }
    compositionEnd() {
      queueMicrotask(() => queueMicrotask(() => {
        if (!this.alive) return; this.composing = false;
        if (!this.view.composing) { const edit = this.edits.finish(this.view.state.doc); if (edit) session.edited(edit); }
        session.pulse();
      }));
    }
    destroy() {
      this.alive = false; this.unsubscribe(); this.detach(); controls.delete(this.view);
      if (this.gutterParent && this.previousHidden !== null) this.gutterParent.setAttribute("aria-hidden", this.previousHidden);
      window.removeEventListener("focus", this.pulse); window.removeEventListener("blur", this.pulse);
      document.removeEventListener("visibilitychange", this.pulse);
    }
  }, { eventHandlers: {
    compositionstart() { this.compositionStart(); return false; }, compositionend() { this.compositionEnd(); return false; },
    scroll() { session.pulse(); return false; },
  } });
  return [display, plugin, EditorView.domEventObservers({ keydown(event) { composingKey = event.isComposing || event.keyCode === 229; } }), gutter({ class: "cm-chacha-gutter", side: "after", initialSpacer: () => new Marker(undefined, true),
    lineMarker: (view, line) => {
      const value = view.state.field(display), comment = value.comment;
      return comment && ["collapsed", "expanded"].includes(value.phase) && view.state.doc.lineAt(comment.context.anchor.from).from === line.from
        ? new Marker(comment, false, value.phase === "expanded") : null;
    }, lineMarkerChange: (update) => update.startState.field(display) !== update.state.field(display),
  }), Prec.lowest(keymap.of([
    { key: "Mod-Alt-Enter", run: (view) => !composingKey && !view.composing && !modal() && expandChachaComment(view, undefined, true) },
    { key: "Mod-Alt-Backspace", run: (view) => !composingKey && !view.composing && !modal() && dismissChachaComment(view) },
  ])), Prec.lowest(EditorView.domEventHandlers({ keydown: (event, view) => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || view.composing || modal() || getCM(view)
      || searchPanelOpen(view.state) || view.dom.querySelector(".cm-tooltip:not(.cm-chacha-tooltip), .cm-dialog")) return false;
    return dismissChachaComment(view);
  } })), EditorView.theme({
    ".cm-chacha-gutter": { display: "none" },
    "&[data-chacha-enabled=true] .cm-chacha-gutter": { display: "block", width: "52px", minWidth: "52px" },
    ".cm-chacha-buttons": { display: "flex", width: "52px", gap: "2px", justifyContent: "center" },
    ".cm-chacha-buttons button": { width: "24px", minWidth: "24px", height: "24px", padding: "0", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--panel)", color: "var(--text)", cursor: "pointer" },
    ".cm-chacha-tooltip": { display: "flex", alignItems: "flex-start", gap: "8px", maxWidth: "min(320px, calc(100vw - 16px))", maxHeight: "50vh", overflow: "auto", padding: "8px", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", background: "var(--panel)", boxShadow: "0 3px 12px #0003" },
    ".cm-chacha-tooltip button": { color: "inherit", background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", cursor: "pointer", minHeight: "28px" },
    ".cm-chacha-tooltip .cm-chacha-comment": { flex: "1", minWidth: "0", padding: "4px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", textAlign: "left", font: "14px/1.5 system-ui, sans-serif" },
  })];
}
