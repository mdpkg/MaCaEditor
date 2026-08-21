import { useEffect, useRef, useState } from "react";

interface Props {
  dirty: boolean;
  hasDocument: boolean;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onInsertDrawing: () => void;
  onInsertPlantUml: () => void;
  onInsertMermaid: () => void;
  onInsertTable: () => void;
  onAddImage: () => void;
}

type Menu = "file" | "diagram" | null;

export function Toolbar({
  dirty,
  hasDocument,
  onOpen,
  onSave,
  onSaveAs,
  onNew,
  onImport,
  onExport,
  onInsertDrawing,
  onInsertPlantUml,
  onInsertMermaid,
  onInsertTable,
  onAddImage,
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
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onSave)}>Save</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onSaveAs)}>Save As</button>
            <div className="toolbar-menu-separator" role="separator" />
            <button type="button" role="menuitem" onClick={() => run(onImport)}>Import Folder</button>
            <button type="button" role="menuitem" disabled={!hasDocument} onClick={() => run(onExport)}>Export Folder</button>
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
          </div>
        )}
      </div>

      <button type="button" onClick={onInsertTable} disabled={!hasDocument}>Insert Table</button>
      <button type="button" onClick={onAddImage} disabled={!hasDocument}>Add Image</button>
      {dirty && <span className="dirty-indicator">●</span>}
    </div>
  );
}
