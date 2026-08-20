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
}

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
}: Props) {
  return (
    <div className="toolbar">
      <button onClick={onNew}>New</button>
      <button onClick={onOpen}>Open</button>
      <button onClick={onSave} disabled={!hasDocument}>
        Save
      </button>
      <button onClick={onSaveAs} disabled={!hasDocument}>
        Save As
      </button>
      <button onClick={onImport}>Import Folder</button>
      <button onClick={onExport} disabled={!hasDocument}>
        Export Folder
      </button>
      <button onClick={onInsertDrawing} disabled={!hasDocument}>
        Insert Drawing
      </button>
      {dirty && <span className="dirty-indicator">●</span>}
    </div>
  );
}
