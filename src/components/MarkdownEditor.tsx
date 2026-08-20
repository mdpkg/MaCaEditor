interface Props {
  value: string;
  onChange: (value: string) => void;
  onCursorChange?: (position: number) => void;
}

export function MarkdownEditor({ value, onChange, onCursorChange }: Props) {
  const reportCursor = (element: HTMLTextAreaElement) => {
    onCursorChange?.(element.selectionStart);
  };
  return (
    <textarea
      className="markdown-editor"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        reportCursor(e.target);
      }}
      onClick={(e) => reportCursor(e.currentTarget)}
      onKeyUp={(e) => reportCursor(e.currentTarget)}
      onSelect={(e) => reportCursor(e.currentTarget)}
      spellCheck={false}
    />
  );
}
