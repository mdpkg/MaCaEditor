import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./components/FileTree";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { DrawingEditor } from "./components/DrawingEditor";
import type { DocumentState } from "./lib/document";
import {
  createDocumentState,
  toSaveRequest,
  updateFileContent,
} from "./lib/document";
import {
  createNewPackage,
  exportFolder,
  importFolder,
  openPackage,
  savePackage,
} from "./lib/tauri";
import type { DrawingDocument } from "./lib/drawing/model";
import {
  addDrawingToDocument,
  parseDrawingFile,
  saveDrawingToDocument,
} from "./lib/drawing/docIntegration";
import type { FileInfo } from "./types";

type Mode = "preview" | "split" | "drawing";

export default function App() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [drawingPath, setDrawingPath] = useState<string | null>(null);
  const [drawingDoc, setDrawingDoc] = useState<DrawingDocument | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  const selectedFile: FileInfo | undefined = doc?.files.find(
    (f) => f.path === selectedPath,
  );

  const entrypointFile: FileInfo | undefined = doc?.files.find(
    (f) => f.path === doc.entrypoint,
  );

  const entrypointDir = useCallback(() => {
    if (!doc) return "";
    const idx = doc.entrypoint.lastIndexOf("/");
    return idx >= 0 ? doc.entrypoint.slice(0, idx) : "";
  }, [doc]);

  useEffect(() => {
    if (doc && !selectedPath) {
      setSelectedPath(doc.entrypoint);
    }
  }, [doc, selectedPath]);

  const handleOpen = async () => {
    const result = await openDialog({
      filters: [{ name: "Markdown Package", extensions: ["mdpkg"] }],
    });
    if (typeof result === "string") {
      try {
        const info = await openPackage(result);
        setDoc(createDocumentState(info, result));
        setSelectedPath(info.entrypoint);
        setMode("preview");
        setDrawingDoc(null);
        setDrawingPath(null);
        setError(null);
        setStatus(`Opened ${result}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handleSave = async () => {
    if (!doc) return;
    if (!doc.path) {
      await handleSaveAs();
      return;
    }
    try {
      await savePackage(toSaveRequest(doc));
      setDoc({ ...doc, dirty: false });
      setStatus(`Saved ${doc.path}`);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleSaveAs = async () => {
    if (!doc) return;
    const result = await saveDialog({
      filters: [{ name: "Markdown Package", extensions: ["mdpkg"] }],
      defaultPath: "document.mdpkg",
    });
    if (typeof result === "string") {
      try {
        await savePackage({ ...toSaveRequest(doc), path: result });
        setDoc({ ...doc, path: result, dirty: false });
        setStatus(`Saved ${result}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handleNew = async () => {
    const result = await saveDialog({
      filters: [{ name: "Markdown Package", extensions: ["mdpkg"] }],
      defaultPath: "untitled.mdpkg",
    });
    if (typeof result === "string") {
      try {
        await createNewPackage(result);
        const info = await openPackage(result);
        setDoc(createDocumentState(info, result));
        setSelectedPath(info.entrypoint);
        setMode("preview");
        setDrawingDoc(null);
        setDrawingPath(null);
        setError(null);
        setStatus(`Created ${result}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handleImport = async () => {
    const folder = await openDialog({ directory: true });
    if (typeof folder === "string") {
      const dest = await saveDialog({
        filters: [{ name: "Markdown Package", extensions: ["mdpkg"] }],
        defaultPath: "imported.mdpkg",
      });
      if (typeof dest === "string") {
        try {
          await importFolder(folder, dest);
          const info = await openPackage(dest);
          setDoc(createDocumentState(info, dest));
          setSelectedPath(info.entrypoint);
          setMode("preview");
          setDrawingDoc(null);
          setDrawingPath(null);
          setError(null);
          setStatus(`Imported ${folder}`);
        } catch (e) {
          setError(String(e));
          setStatus("Error");
        }
      }
    }
  };

  const handleExport = async () => {
    if (!doc?.path) return;
    const folder = await openDialog({ directory: true });
    if (typeof folder === "string") {
      try {
        await exportFolder(doc.path, folder);
        setStatus(`Exported to ${folder}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handleEdit = () => {
    setMode("split");
  };

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    if (path.endsWith(".draw.json")) {
      const file = doc?.files.find((f) => f.path === path);
      if (file?.content) {
        try {
          const parsed = parseDrawingFile(file.content);
          setDrawingDoc(parsed);
          setDrawingPath(path);
          setMode("drawing");
          return;
        } catch (e) {
          setError(`Unable to open drawing: ${String(e)}`);
          setStatus("Error");
          return;
        }
      }
    }
    setMode("preview");
  };

  const handleContentChange = (content: string) => {
    if (!doc || !selectedPath) return;
    setDoc(updateFileContent(doc, selectedPath, content));
  };

  const handleInsertDrawing = () => {
    if (!doc) return;
    const baseDir = entrypointDir();
    const empty: DrawingDocument = {
      format: "maca-drawing",
      version: "1.0",
      canvas: { width: 1200, height: 800, gridSize: 10 },
      objects: [],
    };
    const { state, drawPath } = addDrawingToDocument(
      doc,
      empty,
      baseDir,
      "Drawing",
    );
    setDoc(state);
    setDrawingDoc(empty);
    setDrawingPath(drawPath);
    setMode("drawing");
    setStatus("Inserted Drawing");
  };

  const handleDrawingChange = (next: DrawingDocument) => {
    setDrawingDoc(next);
  };

  const handleDrawingDirty = () => {
    if (!doc || !drawingPath || !drawingDoc) return;
    setDoc(saveDrawingToDocument(doc, drawingPath, drawingDoc));
  };

  const handleEditDrawingFromPreview = (drawPath: string) => {
    if (!doc) return;
    const file = doc.files.find((f) => f.path === drawPath);
    if (!file?.content) return;
    try {
      const parsed = parseDrawingFile(file.content);
      setDrawingDoc(parsed);
      setDrawingPath(drawPath);
      setMode("drawing");
      setSelectedPath(drawPath);
    } catch (e) {
      setError(`Unable to open drawing: ${String(e)}`);
      setStatus("Error");
    }
  };

  const resolveDiscard = (discard: boolean) => {
    setError(null);
    if (discard && pendingRef.current) {
      pendingRef.current();
    }
    pendingRef.current = null;
  };

  const displayFile = selectedFile ?? entrypointFile;
  const displayContent = displayFile?.is_text ? displayFile.content ?? "" : "";
  const displayBaseDir = selectedFile
    ? selectedFile.path.includes("/")
      ? selectedFile.path.slice(0, selectedFile.path.lastIndexOf("/"))
      : ""
    : entrypointDir();

  return (
    <div className="app-shell">
      <Toolbar
        dirty={doc?.dirty ?? false}
        hasDocument={doc !== null}
        onOpen={handleOpen}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onNew={handleNew}
        onImport={handleImport}
        onExport={handleExport}
        onInsertDrawing={handleInsertDrawing}
      />
      <div className="main-layout">
        <aside className="sidebar">
          <FileTree
            files={doc?.files ?? []}
            selectedPath={selectedPath}
            onSelect={handleSelect}
          />
        </aside>
        <main className="document-area">
          {!doc && (
            <div className="empty-state">
              <h2>MaCa Editor</h2>
              <p>Markdown Package を開くか、新規作成してください。</p>
            </div>
          )}
          {doc && mode === "drawing" && drawingDoc && drawingPath && (
            <DrawingEditor
              doc={drawingDoc}
              onChange={handleDrawingChange}
              onDirty={handleDrawingDirty}
            />
          )}
          {doc && mode !== "drawing" && displayFile && displayFile.is_text && (
            <>
              {mode === "preview" && (
                <div className="preview-only">
                  <MarkdownPreview
                    markdown={displayContent}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                  />
                  <button className="edit-btn" onClick={handleEdit}>
                    Edit
                  </button>
                </div>
              )}
              {mode === "split" && (
                <div className="split-view">
                  <MarkdownEditor
                    value={displayContent}
                    onChange={handleContentChange}
                  />
                  <MarkdownPreview
                    markdown={displayContent}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                  />
                </div>
              )}
            </>
          )}
          {doc && mode !== "drawing" && displayFile && !displayFile.is_text && (
            <div className="binary-view">
              {displayFile.base64 && (
                <img src={`data:image/png;base64,${displayFile.base64}`} alt="" />
              )}
              <p className="file-info">{displayFile.path}</p>
            </div>
          )}
        </main>
      </div>
      {error && (
        <div className="error-dialog">
          <p>{error}</p>
          {doc?.dirty && (
            <div className="error-actions">
              <button onClick={() => resolveDiscard(true)}>Discard</button>
              <button onClick={() => resolveDiscard(false)}>Cancel</button>
            </div>
          )}
          {!doc?.dirty && (
            <button onClick={() => setError(null)}>OK</button>
          )}
        </div>
      )}
      <StatusBar message={status} />
    </div>
  );
}
