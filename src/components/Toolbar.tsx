import { uiText } from "../lib/uiText";
import { hasAiConfiguration } from "../lib/tauri";
import { Menu } from "./Menu";
import { useEffect, useRef, useState } from "react";

interface Props {
  dirty: boolean;
  fileListOpen: boolean;
  onToggleFileList: () => void;
  hasDocument: boolean;
  fileTaskInProgress?: boolean;
  folderConflict?: boolean;
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
  onValidatePackage?: () => void;
  onUndoFileOperation?: () => void;
  onRedoFileOperation?: () => void;
  canUndoFileOperation?: boolean;
  canRedoFileOperation?: boolean;
  onEditManifest?: () => void;
  onSearchPackage?: () => void;
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
  aiDisabledReason?: string;
  onShortcuts?: () => void;
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
  fileTaskInProgress = false,
  folderConflict = false,
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
  onValidatePackage = () => {},
  onUndoFileOperation = () => {},
  onRedoFileOperation = () => {},
  canUndoFileOperation = false,
  canRedoFileOperation = false,
  onEditManifest = () => {},
  onSearchPackage = () => {},
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
  aiDisabledReason,
  onShortcuts = () => {},
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
  const [aiConfiguration, setAiConfiguration] = useState<"checking" | "ready" | "missing" | "error">("checking");
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openMenu !== "ai") return;
    let active = true;
    void hasAiConfiguration().then(
      (configured) => { if (active) setAiConfiguration(configured ? "ready" : "missing"); },
      () => { if (active) setAiConfiguration("error"); },
    );
    return () => { active = false; };
  }, [openMenu]);

  const openAiMenu = () => {
    if (openMenu === "ai") return;
    setAiConfiguration("checking");
    setOpenMenu("ai");
  };
  const aiMenuHint = aiConfiguration === "ready" ? aiDisabledReason
    : aiConfiguration === "missing" ? uiText("AI is not configured.")
    : aiConfiguration === "error" ? uiText("AI settings could not be loaded.")
    : uiText("Checking AI settings…");

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
        aria-label={uiText("Toggle file list")}
        aria-pressed={fileListOpen}
        title={fileListOpen ? uiText("Close file list") : uiText("Open file list")}
        onClick={onToggleFileList}
      >☰</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "file"}
          onClick={(event) => {
            event.currentTarget.focus();
            setOpenMenu((current) => current === "file" ? null : "file");
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setOpenMenu("file");
          }}
        >{uiText("File")}</button>
        {openMenu === "file" && (
          <Menu className="toolbar-menu-items" label={uiText("File")} onClose={() => setOpenMenu(null)}>
            <button type="button" role="menuitem" onClick={() => run(onNew)}>{uiText("New")}</button>
            <button type="button" role="menuitem" onClick={() => run(onOpen)}>{uiText("Open")}</button>
            <button type="button" role="menuitem" onClick={() => run(onOpenFolder ?? (() => {}))}>{uiText("Open Folder...")}</button>
            <button type="button" role="menuitem" onClick={() => run(onStartWithEmptyFolder ?? (() => {}))}>{uiText("Start with New Empty Folder")}</button>
            <button type="button" role="menuitem" disabled={!hasDocument || fileTaskInProgress || folderConflict} data-shortcut="Ctrl/Cmd+S" aria-keyshortcuts="Control+S Meta+S" onClick={() => run(onSave)}>{uiText("Save")}</button>
            <button type="button" role="menuitem" disabled={!hasDocument || fileTaskInProgress || documentKind === "folder"} onClick={() => run(onSaveAs)}>{uiText("Save As")}</button>
            <button type="button" role="menuitem" disabled={!canPrint} onClick={() => run(onPrint)}>{uiText("Print")}</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onAddMarkdown)}>{uiText("Add Markdown...")}</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onAddFolder)}>{uiText("Add Folder...")}</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => run(onImport)}>{uiText("Import Folder")}</button>
            <button type="button" role="menuitem" disabled={documentKind !== "package"} onClick={() => run(onExport)}>{uiText("Export Folder")}</button>
            <button type="button" role="menuitem" disabled={fileTaskInProgress || documentKind !== "folder"} onClick={() => run(onExportPackage ?? (() => {}))}>{uiText("Export Package...")}</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onValidatePackage)}>{uiText("Validate Package...")}</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onEditManifest)}>{uiText("Edit Manifest...")}</button>
            <button type="button" role="menuitem" disabled={!hasDocument} data-shortcut="Ctrl/Cmd+Shift+F" aria-keyshortcuts="Control+Shift+F Meta+Shift+F" title="Ctrl/Cmd+Shift+F" onClick={() => run(onSearchPackage)}>{uiText("Search Package...")}</button>
            <button type="button" role="menuitem" disabled={!canUndoFileOperation} onClick={() => run(onUndoFileOperation)}>{uiText("Undo File Operation")}</button>
            <button type="button" role="menuitem" disabled={!canRedoFileOperation} onClick={() => run(onRedoFileOperation)}>{uiText("Redo File Operation")}</button>
          </Menu>
        )}
      </div>

      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "diagram"}
          disabled={!hasDocument}
          onClick={(event) => {
            event.currentTarget.focus();
            setOpenMenu((current) => current === "diagram" ? null : "diagram");
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setOpenMenu("diagram");
          }}
        >{uiText("Insert Diagram")}</button>
        {openMenu === "diagram" && (
          <Menu className="toolbar-menu-items" label={uiText("Insert Diagram")} onClose={() => setOpenMenu(null)}>
            <button type="button" role="menuitem" onClick={() => run(onInsertDrawing)}>SVG</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertPlantUml)}>PlantUML</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertMermaid)}>Mermaid</button>
            <button type="button" role="menuitem" onClick={() => run(onInsertMathJax)}>MathJax</button>
          </Menu>
        )}
      </div>

      <button type="button" onClick={onInsertTable} disabled={!hasDocument}>{uiText("Insert Table")}</button>
      <button type="button" onClick={onAddImage} disabled={!hasDocument}>{uiText("Add Image")}</button>
      <button type="button" onClick={onAddAttachment} disabled={!hasDocument}>{uiText("Add Attachment")}</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "ai"}
          title={aiDisabledReason ?? uiText("AI actions and settings")}
          onClick={(event) => {
            event.currentTarget.focus();
            if (openMenu === "ai") setOpenMenu(null);
            else openAiMenu();
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            openAiMenu();
          }}
        >AI</button>
        {openMenu === "ai" && (
          <Menu className="toolbar-menu-items" label="AI" onClose={() => setOpenMenu(null)}>
            {aiMenuHint && <p className="menu-hint">{aiMenuHint}</p>}
            {aiConfiguration === "ready" && <>
              {(["Rewrite", "Summarize", "Proofread"] as const).map((task) => (
                <button key={task} type="button" role="menuitem" tabIndex={-1}
                  disabled={!aiSelectionEnabled || aiSelectionRunning} title={aiDisabledReason}
                  onClick={() => run(() => onAiSelection(task))}>{uiText(task)}</button>
              ))}
              <div className="toolbar-menu-separator" role="separator" />
            </>}
            <button type="button" role="menuitem" onClick={() => run(onAiSettings)}>
              {uiText(aiConfiguration === "ready" || aiConfiguration === "checking" ? "AI Settings" : "Set up AI")}
            </button>
          </Menu>
        )}
      </div>
      <button type="button" aria-pressed={aiChatOpen} disabled={!aiChatEnabled} onClick={onToggleAiChat}>{uiText("AI Chat")}</button>
      <div className="toolbar-menu">
        <button
          type="button"
          className="toolbar-menu-trigger"
          aria-haspopup="menu"
          aria-expanded={openMenu === "help"}
          onClick={(event) => {
            event.currentTarget.focus();
            setOpenMenu((current) => current === "help" ? null : "help");
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setOpenMenu("help");
          }}
        >{uiText("Help")}</button>
        {openMenu === "help" && (
          <Menu className="toolbar-menu-items" label={uiText("Help")} onClose={() => setOpenMenu(null)}>
            <button type="button" role="menuitem" onClick={() => run(onShortcuts)}>{uiText("Keyboard shortcuts")}</button>
            <button type="button" role="menuitem" onClick={() => run(onAiSettings)}>{uiText("AI Settings")}</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => run(onAbout)}>{uiText("About MaCa Editor")}</button>
            <button type="button" role="menuitem" onClick={() => run(onThirdPartyLicenses)}>{uiText("Third party licenses")}</button>
          </Menu>
        )}
      </div>
      <label className="toolbar-vim-mode toolbar-toc">
        <input
          type="checkbox"
          checked={showToc}
          onChange={(event) => onShowTocChange(event.target.checked)}
        />
        {uiText("TOC")}</label>
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
        {uiText("Vim mode")}</label>
      {dirty && <span className="dirty-indicator">●</span>}
    </div>
  );
}
