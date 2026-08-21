import { CodeEditor } from "./CodeEditor";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
  vimMode?: boolean;
}

export function MarkdownEditor({ value, onChange, onCursorChange, vimMode = false }: Props) {
  return (
    <CodeEditor
      className="markdown-editor"
      value={value}
      onChange={onChange}
      onCursorChange={onCursorChange}
      vimMode={vimMode}
      language="markdown"
      ariaLabel="Markdown source"
    />
  );
}
