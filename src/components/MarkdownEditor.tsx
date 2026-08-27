import { CodeEditor } from "./CodeEditor";
import type { AiTaskKind } from "../lib/aiSelection";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  onSelectionChange?: (selection: { from: number; to: number; text: string } | null) => void;
  onSave?: () => void | Promise<void>;
  vimMode?: boolean;
  onAiSelection?: (task: AiTaskKind) => void;
  onPackagePathDrop?: (path: string, position: number) => void;
  onMarkdownLinkOpen?: (destination: string) => void;
}

export function MarkdownEditor({ value, onChange, onCursorChange, onSelectionChange, onSave, vimMode = false, onAiSelection, onPackagePathDrop, onMarkdownLinkOpen }: Props) {
  return (
    <CodeEditor
      className="markdown-editor"
      value={value}
      onChange={onChange}
      onCursorChange={onCursorChange}
      onSelectionChange={onSelectionChange}
      onSave={onSave}
      vimMode={vimMode}
      language="markdown"
      ariaLabel="Markdown source"
      onAiSelection={onAiSelection}
      onPackagePathDrop={onPackagePathDrop}
      onMarkdownLinkOpen={onMarkdownLinkOpen}
    />
  );
}
