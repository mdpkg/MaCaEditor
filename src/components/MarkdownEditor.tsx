import { CodeEditor } from "./CodeEditor";
import type { ComponentProps } from "react";
import type { AiTaskKind } from "../lib/aiSelection";
import type { HistoryDirection, TextEditGroup } from "../lib/editHistory";

interface Props extends Pick<ComponentProps<typeof CodeEditor>, "onImagePaste" | "onImagePasteError" | "chachaSession" | "chachaFileId" | "chachaBlocked"> {
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

export function MarkdownEditor({ value, onChange, onHistory, onCursorChange, onSelectionChange, onSave, vimMode = false, onAiSelection, onPackagePathDrop, onImagePaste, onImagePasteError, onMarkdownLinkOpen, initialCursorPosition, initialScrollTop, onScrollTopChange, navigation, onNavigationComplete, diagnosticRanges, chachaSession, chachaFileId, chachaBlocked }: Props) {
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
      onImagePaste={onImagePaste}
      onImagePasteError={onImagePasteError}
      onMarkdownLinkOpen={onMarkdownLinkOpen}
      initialCursorPosition={initialCursorPosition}
      initialScrollTop={initialScrollTop}
      onScrollTopChange={onScrollTopChange}
      navigation={navigation}
      onNavigationComplete={onNavigationComplete}
      diagnosticRanges={diagnosticRanges}
      chachaSession={chachaSession}
      chachaFileId={chachaFileId}
      chachaBlocked={chachaBlocked}
    />
  );
}
