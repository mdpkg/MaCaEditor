import { CodeEditor } from "./CodeEditor";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  onSave?: () => void | Promise<void>;
  vimMode?: boolean;
}

export function MarkdownEditor({ value, onChange, onCursorChange, onSave, vimMode = false }: Props) {
  return (
    <CodeEditor
      className="markdown-editor"
      value={value}
      onChange={onChange}
      onCursorChange={onCursorChange}
      onSave={onSave}
      vimMode={vimMode}
      language="markdown"
      ariaLabel="Markdown source"
    />
  );
}
