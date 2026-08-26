import { useEffect, useRef, useState } from "react";

interface Props {
  dirty: boolean;
  fileListOpen: boolean;
  onToggleFileList: () => void;
  hasDocument: boolean;
  onOpen: () => void;
  onOpenFolder?: () => void;
  onStartWithEmptyFolder?: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onExportPackage?: () => void;
  onAddMarkdown?: () => void;
  onAddFolder?: () => void;
  documentKind?: "package" | "folder" | "untitled" | null;
  onInsertDrawing: () => void;
  onInsertPlantUml: () => void;
  onInsertMermaid: () => void;
  onInsertMathJax: () => void;
  onInsertTable: () => void;
  onAddImage: () => void;
  onAddAttachment: () => void;
  onAbout: () => void;
  onAiSettings: () => void;
  onThirdPartyLicenses: () => void;
  aiSelectionEnabled: boolean;
  aiSelectionRunning: boolean;
  onAiSelection: (task: "Rewrite" | "Summarize" | "Proofread") => void;
  aiChatOpen?: boolean;
  aiChatEnabled?: boolean;
  onToggleAiChat?: () => void;
  showToc: boolean;
  onShowTocChange: (enabled: boolean) => void;
  rspressMode: boolean;
  onRspressModeChange: (enabled: boolean) => void;
  vimMode: boolean;
  onVimModeChange: (enabled: boolean) => void;
  canPrint: boolean;
}

type Menu = "file" | "diagram" | "ai" | "help" | null;

export function Toolbar({
  dirty,
  fileListOpen,
  onToggleFileList,
  hasDocument,
  onOpen,
  onOpenFolder,
  onStartWithEmptyFolder,
  onSave,
  onSaveAs,
  onPrint,
  onNew,
  onImport,
  onExport,
  onExportPackage,
  onAddMarkdown = () => {},
  onAddFolder = () => {},
  documentKind,
  onInsertDrawing,
  onInsertPlantUml,
  onInsertMermaid,
  onInsertMathJax,
  onInsertTable,
  onAddImage,
  onAddAttachment,
  onAbout,
  onAiSettings,
  onThirdPartyLicenses,
  aiSelectionEnabled,
  aiSelectionRunning,
  onAiSelection,
  aiChatOpen = false,
  aiChatEnabled = false,
  onToggleAiChat = () => {},
  showToc,
  onShowTocChange,
  rspressMode,
  onRspressModeChange,
  vimMode,
  onVimModeChange,
  canPrint,
}: Props) {
  const [openMenu, setOpenMenu] = useState<Menu>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  const run = (command: () => void) => {
    setOpenMenu(null);
    command();
  };

  return (
    <div className="toolbar" ref={toolbarRef}>
      <button
        type="button"
        className="toolbar-file-list-toggle"
        aria-label="ファイルリストを開閉"
        aria-pressed={fileListOpen}
        title={fileListOpen ? "ファイルリストを閉じる" : "ファイルリストを開く"}
        onClick={onToggleFileList}
      >☰</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "file"}
          onClick={() => setOpenMenu((current) => current === "file" ? null : "file")}
        >File</button>
        {openMenu === "file" && (
          <div className="toolbar-menu-items" role="menu">
            <button type="button" role="menuitem" onClick={() => run(onNew)}>New</button>
            <button type="button" role="menuitem" onClick={() => run(onOpen)}>Open</button>
            <button type="button" role="menuitem" onClick={() => run(onOpenFolder ?? (() => {}))}>Open Folder...</button>
            <button type="button" role="menuitem" onClick={() => run(onStartWithEmptyFolder ?? (() => {}))}>Start with New Empty Folder</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onSave)}>Save</button>
            <button type="button" role="menuitem" disabled={!hasDocument || documentKind === "folder"} onClick={() => run(onSaveAs)}>Save As</button>
            <button type="button" role="menuitem" disabled={!canPrint} onClick={() => run(onPrint)}>Print</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onAddMarkdown)}>Add Markdown...</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onAddFolder)}>Add Folder...</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => run(onImport)}>Import Folder</button>
            <button type="button" role="menuitem" disabled={documentKind !== "package"} onClick={() => run(onExport)}>Export Folder</button>
            <button type="button" role="menuitem" disabled={documentKind !== "folder"} onClick={() => run(onExportPackage ?? (() => {}))}>Export Package...</button>
          </div>
        )}
      </div>

      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "diagram"}
          disabled={!hasDocument}
          onClick={() => setOpenMenu((current) => current === "diagram" ? null : "diagram")}
        >Insert Diagram</button>
        {openMenu === "diagram" && (
          <div className="toolbar-menu-items" role="menu">
            <button type="button" role="menuitem" onClick={() => run(onInsertDrawing)}>SVG</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertPlantUml)}>PlantUML</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertMermaid)}>Mermaid</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertMathJax)}>MathJax</button>
          </div>
        )}
      </div>

      <button type="button" onClick={onInsertTable} disabled={!hasDocument}>Insert Table</button>
      <button type="button" onClick={onAddImage} disabled={!hasDocument}>Add Image</button>
      <button type="button" onClick={onAddAttachment} disabled={!hasDocument}>Add Attachment</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "ai"}
          disabled={!aiSelectionEnabled || aiSelectionRunning}
          onClick={() => setOpenMenu((current) => current === "ai" ? null : "ai")}
        >AI</button>
        {openMenu === "ai" && (
          <div className="toolbar-menu-items" role="menu">
            <button type="button" role="menuitem" onClick={() => run(() => onAiSelection("Rewrite"))}>Rewrite</button>
            <button type="button" role="menuitem" onClick={() => run(() => onAiSelection("Summarize"))}>Summarize</button>
            <button type="button" role="menuitem" onClick={() => run(() => onAiSelection("Proofread"))}>Proofread</button>
          </div>
        )}
      </div>
      <button type="button" aria-pressed={aiChatOpen} disabled={!aiChatEnabled} onClick={onToggleAiChat}>AI Chat</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "help"}
          onClick={() => setOpenMenu((current) => current === "help" ? null : "help")}
        >Help</button>
        {openMenu === "help" && (
          <div className="toolbar-menu-items" role="menu">
            <button type="button" role="menuitem" onClick={() => run(onAiSettings)}>AI Settings</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => run(onAbout)}>About MaCa Editor</button>
            <button type="button" role="menuitem" onClick={() => run(onThirdPartyLicenses)}>Third party licenses</button>
          </div>
        )}
      </div>
      <label className="toolbar-vim-mode toolbar-toc">
        <input
          type="checkbox"
          checked={showToc}
          onChange={(event) => onShowTocChange(event.target.checked)}
        />
        TOC
      </label>
      <label className="toolbar-vim-mode">
        <input
          type="checkbox"
          checked={rspressMode}
          onChange={(event) => onRspressModeChange(event.target.checked)}
        />
        Rspress
      </label>
      <label className="toolbar-vim-mode">
        <input
          type="checkbox"
          checked={vimMode}
          onChange={(event) => onVimModeChange(event.target.checked)}
        />
        Vim mode
      </label>
      {dirty && <span className="dirty-indicator">●</span>}
    </div>
  );
}
