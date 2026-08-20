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
  onAddImage: () => void;
  canRename: boolean;
  onRename: () => void;
  canDelete: boolean;
  onDelete: () => void;
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
  onAddImage,
  canRename,
  onRename,
  canDelete,
  onDelete,
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
      <button onClick={onAddImage} disabled={!hasDocument}>
        Add Image
      </button>
      <button onClick={onRename} disabled={!canRename}>
        Rename
      </button>
      <button onClick={onDelete} disabled={!canDelete}>
        Delete
      </button>
      {dirty && <span className="dirty-indicator">●</span>}
    </div>
  );
}
