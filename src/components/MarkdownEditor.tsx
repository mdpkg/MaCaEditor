import { CodeEditor } from "./CodeEditor";
import type { AiTaskKind } from "../lib/aiSelection";
import type { HistoryDirection, TextEditGroup } from "../lib/editHistory";

interface Props {
  value: string;
  onChange: (value: string, group?: TextEditGroup) => void;
  onHistory?: (direction: HistoryDirection) => void;
  onCursorChange?: (position: number) => void;
  onSelectionChange?: (selection: { from: number; to: number; text: string } | null) => void;
  onSave?: () => void | Promise<void>;
  vimMode?: boolean;
  onAiSelection?: (task: AiTaskKind) => void;
  onPackagePathDrop?: (path: string, position: number) => void;
  onMarkdownLinkOpen?: (destination: string) => void;
  initialCursorPosition?: number;
  initialScrollTop?: number;
  onScrollTopChange?: (position: number) => void;
  navigation?: { offset: number; length?: number };
  onNavigationComplete?: () => void;
  diagnosticRanges?: Array<{ from: number; to: number }>;
}

export function MarkdownEditor({ value, onChange, onHistory, onCursorChange, onSelectionChange, onSave, vimMode = false, onAiSelection, onPackagePathDrop, onMarkdownLinkOpen, initialCursorPosition, initialScrollTop, onScrollTopChange, navigation, onNavigationComplete, diagnosticRanges }: Props) {
  return (
    <CodeEditor
      className="markdown-editor"
      value={value}
      onChange={onChange}
      onHistory={onHistory}
      onCursorChange={onCursorChange}
      onSelectionChange={onSelectionChange}
      onSave={onSave}
      vimMode={vimMode}
      language="markdown"
      ariaLabel="Markdown source"
      onAiSelection={onAiSelection}
      onPackagePathDrop={onPackagePathDrop}
      onMarkdownLinkOpen={onMarkdownLinkOpen}
      initialCursorPosition={initialCursorPosition}
      initialScrollTop={initialScrollTop}
      onScrollTopChange={onScrollTopChange}
      navigation={navigation}
      onNavigationComplete={onNavigationComplete}
      diagnosticRanges={diagnosticRanges}
    />
  );
}
