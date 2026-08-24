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
}

export function MarkdownEditor({ value, onChange, onCursorChange, onSelectionChange, onSave, vimMode = false, onAiSelection }: Props) {
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
    />
  );
}
