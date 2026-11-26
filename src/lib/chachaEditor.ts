import { Prec, StateEffect, StateField, Transaction, type Extension, type Text, type ChangeSet } from "@codemirror/state";
import { EditorView, GutterMarker, gutter, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { searchPanelOpen } from "@codemirror/search";
import { getCM } from "@replit/codemirror-vim";
import { ChachaEdits } from "./chachaEdits";
import { ChachaSession, type ChachaSnapshot } from "./chachaSession";
import type { ChachaContext } from "./chachaContext";

const refresh = StateEffect.define<ChachaSnapshot>();
const controls = new WeakMap<EditorView, { session: ChachaSession }>();
const modal = () => !!document.querySelector('[aria-modal="true"]');
const restoreFocus = (view: EditorView) => view.contentDOM.focus({ preventScroll: true });
export function continueChachaComment(view: EditorView, commentId?: string): boolean {
  const value = controls.get(view), id = commentId ?? value?.session.snapshot.comment?.id;
  return !!value && !!id && value.session.continue(id);
}
export function dismissChachaComment(view: EditorView): boolean {
  const value = controls.get(view);
  if (!value || value.session.snapshot.phase !== "collapsed") return false;
  const focused = view.dom.querySelector(".cm-chacha-gutter")?.contains(document.activeElement);
  value.session.dismiss(); if (focused) restoreFocus(view); return true;
}
function button(label: string, text: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const element = document.createElement("button"); element.type = "button"; element.textContent = text;
  element.setAttribute("aria-label", label); element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", action); return element;
}
class Marker extends GutterMarker {
  constructor(private readonly comment?: ChachaSnapshot["comment"], private readonly spacer = false) { super(); }
  eq(other: Marker) { return this.comment === other.comment && this.spacer === other.spacer; }
  toDOM(view: EditorView) {
    const dom = document.createElement("div"); dom.className = "cm-chacha-buttons";
    if (this.spacer) { dom.style.height = "0"; return dom; }
    const open = button("茶々入れから会話を開く", "💬", () => { continueChachaComment(view, this.comment?.id); });
    open.title = this.comment?.comment ?? "";
    if (this.comment) open.setAttribute("aria-description", this.comment.comment);
    dom.append(open, button("茶々入れコメントを削除", "×", () => { dismissChachaComment(view); }));
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
      controls.set(view, { session });
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
        || searchPanelOpen(this.view.state) || !!this.view.dom.querySelector(".cm-tooltip, .cm-dialog") || options.blocked?.() === true;
    }
    private targetEdited(context: ChachaContext) {
      if (!this.lastChange) return false;
      const inverse = this.lastChange.changes.invertedDesc, { from, to } = context.anchor;
      return this.lastChange.before.sliceString(inverse.mapPos(from, 1), inverse.mapPos(to, -1)) !== this.view.state.doc.sliceString(from, to);
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
      return comment && value.phase === "collapsed" && view.state.doc.lineAt(comment.context.anchor.from).from === line.from
        ? new Marker(comment) : null;
    }, lineMarkerChange: (update) => update.startState.field(display) !== update.state.field(display),
  }), Prec.lowest(keymap.of([
    { key: "Mod-Alt-Enter", run: (view) => !composingKey && !view.composing && !modal() && continueChachaComment(view) },
    { key: "Mod-Alt-Backspace", run: (view) => !composingKey && !view.composing && !modal() && dismissChachaComment(view) },
  ])), Prec.lowest(EditorView.domEventHandlers({ keydown: (event, view) => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || view.composing || modal() || getCM(view)
      || searchPanelOpen(view.state) || view.dom.querySelector(".cm-tooltip, .cm-dialog")) return false;
    return dismissChachaComment(view);
  } })), EditorView.theme({
    ".cm-chacha-gutter": { display: "none" },
    "&[data-chacha-enabled=true] .cm-chacha-gutter": { display: "block", width: "52px", minWidth: "52px" },
    ".cm-chacha-buttons": { display: "flex", width: "52px", gap: "2px", justifyContent: "center" },
    ".cm-chacha-buttons button": { width: "24px", minWidth: "24px", height: "24px", padding: "0", border: "1px solid var(--border)", borderRadius: "4px", background: "var(--panel)", color: "var(--text)", cursor: "pointer" },
  })];
}
