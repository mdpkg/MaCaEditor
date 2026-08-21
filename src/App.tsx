import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./components/FileTree";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { DrawingEditor } from "./components/DrawingEditor";
import { PlantUmlEditor } from "./components/PlantUmlEditor";
import { MermaidEditor } from "./components/MermaidEditor";
import type { DocumentState } from "./lib/document";
import {
  createDocumentState,
  addImage,
  deleteAsset,
  imageMediaType,
  isDeletableAsset,
  renameAsset,
  toSaveRequest,
  updateFileContent,
} from "./lib/document";
import {
  createNewPackage,
  exportFolder,
  importFolder,
  openPackage,
  savePackage,
  readImage,
} from "./lib/tauri";
import type { DrawingDocument } from "./lib/drawing/model";
import {
  DEFAULT_DRAWING_DIR,
  addDrawingToDocument,
  parseDrawingFile,
  saveDrawingToDocument,
} from "./lib/drawing/docIntegration";
import type { FileInfo } from "./types";
import { insertMarkdownImages } from "./lib/markdown";
import { isSaveShortcut } from "./lib/shortcuts";
import {
  droppedFileToImage,
  importedImageDataUrl,
  isSupportedImageName,
} from "./lib/imageImport";
import type { ImportedImage } from "./types";
import {
  DEFAULT_PLANTUML_SOURCE,
  addPlantUmlToDocument,
  findPlantUmlResourceBySource,
  savePlantUmlToDocument,
} from "./lib/plantuml/docIntegration";
import { renderPlantUml } from "./lib/plantuml/renderer";
import {
  DEFAULT_MERMAID_SOURCE,
  addMermaidToDocument,
  findMermaidResourceBySource,
  saveMermaidToDocument,
} from "./lib/mermaid/docIntegration";
import { renderMermaid } from "./lib/mermaid/renderer";

type Mode = "preview" | "split" | "drawing" | "plantuml" | "mermaid";

export default function App() {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [drawingPath, setDrawingPath] = useState<string | null>(null);
  const [drawingDoc, setDrawingDoc] = useState<DrawingDocument | null>(null);
  const [plantUmlPath, setPlantUmlPath] = useState<string | null>(null);
  const [mermaidPath, setMermaidPath] = useState<string | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const editorCursorRef = useRef<number | null>(null);

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
        setPlantUmlPath(null);
        setMermaidPath(null);
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
        setPlantUmlPath(null);
        setMermaidPath(null);
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
          setPlantUmlPath(null);
          setMermaidPath(null);
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

  const handleEditMarkdown = (path: string) => {
    if (!/\.(md|markdown)$/i.test(path)) return;
    editorCursorRef.current = null;
    setSelectedPath(path);
    setMode("split");
  };

  const handleSelect = (path: string) => {
    editorCursorRef.current = null;
    setSelectedPath(path);
    if (path.endsWith(".draw.json")) {
      const file = doc?.files.find((f) => f.path === path);
      if (file?.content) {
        try {
          const parsed = parseDrawingFile(file.content);
          setDrawingDoc(parsed);
          setDrawingPath(path);
          setPlantUmlPath(null);
          setMermaidPath(null);
          setMode("drawing");
          return;
        } catch (e) {
          setError(`Unable to open drawing: ${String(e)}`);
          setStatus("Error");
          return;
        }
      }
    }
    if (path.endsWith(".puml") && findPlantUmlResourceBySource(doc?.manifest ?? {}, path)) {
      setPlantUmlPath(path);
      setMermaidPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("plantuml");
      return;
    }
    if (path.endsWith(".mmd") && findMermaidResourceBySource(doc?.manifest ?? {}, path)) {
      setMermaidPath(path);
      setPlantUmlPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("mermaid");
      return;
    }
    setPlantUmlPath(null);
    setMermaidPath(null);
    setMode("preview");
  };

  const handleContentChange = (content: string) => {
    if (!doc || !selectedPath) return;
    setDoc(updateFileContent(doc, selectedPath, content));
  };

  const handleInsertDrawing = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    const baseDir = DEFAULT_DRAWING_DIR;
    const empty: DrawingDocument = {
      format: "maca-drawing",
      version: "1.0",
      canvas: { width: 1200, height: 800, gridSize: 10 },
      objects: [],
    };
    const { state, drawPath, cursor: insertedCursor } = addDrawingToDocument(
      doc,
      empty,
      baseDir,
      "Drawing",
      { markdownPath: markdownFile?.path, cursor },
    );
    editorCursorRef.current = insertedCursor;
    setDoc(state);
    setDrawingDoc(empty);
    setDrawingPath(drawPath);
    setPlantUmlPath(null);
    setMermaidPath(null);
    setMode("drawing");
    setStatus("Inserted Drawing");
  };

  const handleInsertPlantUml = async () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    setStatus("Rendering PlantUML…");
    try {
      const svg = await renderPlantUml(DEFAULT_PLANTUML_SOURCE);
      const added = addPlantUmlToDocument(doc, DEFAULT_PLANTUML_SOURCE, svg, "PlantUML", {
        markdownPath: markdownFile?.path,
        cursor,
      });
      editorCursorRef.current = added.cursor;
      setDoc(added.state);
      setSelectedPath(added.sourcePath);
      setPlantUmlPath(added.sourcePath);
      setMermaidPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("plantuml");
      setStatus("Inserted PlantUML");
      setError(null);
    } catch (reason) {
      setError(`Unable to render PlantUML: ${String(reason)}`);
      setStatus("Error");
    }
  };

  const handlePlantUmlSourceChange = useCallback((source: string) => {
    setDoc((current) => current && plantUmlPath
      ? updateFileContent(current, plantUmlPath, source)
      : current);
  }, [plantUmlPath]);

  const handlePlantUmlRendered = useCallback((source: string, svg: string) => {
    setDoc((current) => current && plantUmlPath
      ? savePlantUmlToDocument(current, plantUmlPath, source, svg)
      : current);
    setStatus("PlantUML preview updated");
  }, [plantUmlPath]);

  const handleInsertMermaid = async () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    setStatus("Rendering Mermaid…");
    try {
      const svg = await renderMermaid(DEFAULT_MERMAID_SOURCE);
      const added = addMermaidToDocument(doc, DEFAULT_MERMAID_SOURCE, svg, "Mermaid", {
        markdownPath: markdownFile?.path,
        cursor,
      });
      editorCursorRef.current = added.cursor;
      setDoc(added.state);
      setSelectedPath(added.sourcePath);
      setMermaidPath(added.sourcePath);
      setPlantUmlPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("mermaid");
      setStatus("Inserted Mermaid");
      setError(null);
    } catch (reason) {
      setError(`Unable to render Mermaid: ${String(reason)}`);
      setStatus("Error");
    }
  };

  const handleMermaidSourceChange = useCallback((source: string) => {
    setDoc((current) => current && mermaidPath
      ? updateFileContent(current, mermaidPath, source)
      : current);
  }, [mermaidPath]);

  const handleMermaidRendered = useCallback((source: string, svg: string) => {
    setDoc((current) => current && mermaidPath
      ? saveMermaidToDocument(current, mermaidPath, source, svg)
      : current);
    setStatus("Mermaid preview updated");
  }, [mermaidPath]);

  const addImportedImages = (images: ImportedImage[]) => {
    if (!doc || images.length === 0) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    let next = doc;
    const addedPaths: string[] = [];
    for (const image of images) {
      const added = addImage(next, image.file_name, image.base64);
      next = added.state;
      addedPaths.push(added.path);
    }
    if (markdownFile?.content !== null && markdownFile?.content !== undefined) {
      const inserted = insertMarkdownImages(markdownFile.content, cursor, markdownFile.path, addedPaths);
      next = updateFileContent(next, markdownFile.path, inserted.content);
      editorCursorRef.current = inserted.cursor;
    }
    setDoc(next);
    setSelectedPath(markdownFile?.path ?? addedPaths[addedPaths.length - 1] ?? null);
    setStatus(`Added ${images.length} image${images.length === 1 ? "" : "s"} to images/`);
    setError(null);
  };

  const handleAddImage = async () => {
    if (!doc) return;
    const result = await openDialog({
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      ],
    });
    const paths = Array.isArray(result) ? result : typeof result === "string" ? [result] : [];
    if (paths.length === 0) return;
    try {
      addImportedImages(await Promise.all(paths.map(readImage)));
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleDropImages = async (files: File[]) => {
    const supported = files.filter((file) => isSupportedImageName(file.name));
    if (supported.length === 0) {
      setError("Drop PNG, JPEG, GIF, WebP, or BMP image files.");
      setStatus("Error");
      return;
    }
    try {
      addImportedImages(await Promise.all(supported.map(droppedFileToImage)));
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const isRenameablePath = (path: string | null) => path !== null && (
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(path) ||
    doc?.manifest.resources instanceof Array && doc.manifest.resources.some((item) =>
      typeof item === "object" && item !== null &&
      ((item as { source?: string }).source === path || (item as { rendered?: string }).rendered === path))
  );
  const handleRename = (path: string | null = selectedPath) => {
    if (!doc || !path || !isRenameablePath(path)) return;
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const currentName = fileName.replace(/\.draw\.json$|\.[^.]+$/i, "");
    const requested = window.prompt("New name", currentName);
    if (requested === null || requested.trim() === "" || requested === currentName) return;
    try {
      const renamed = renameAsset(doc, path, requested);
      setDoc(renamed.state);
      setSelectedPath(renamed.path);
      if (drawingPath === path) setDrawingPath(renamed.path);
      if (plantUmlPath === path) setPlantUmlPath(renamed.path);
      if (mermaidPath === path) setMermaidPath(renamed.path);
      setStatus(`Renamed to ${renamed.path}`);
      setError(null);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleDelete = (path: string | null = selectedPath) => {
    if (!doc || !path || !isDeletableAsset(doc, path)) return;
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    if (!window.confirm(`Delete ${fileName}?`)) return;
    try {
      const next = deleteAsset(doc, path);
      setDoc(next);
      setSelectedPath(next.entrypoint);
      if (drawingPath && !next.files.some((file) => file.path === drawingPath)) {
        setDrawingDoc(null);
        setDrawingPath(null);
        setMode("preview");
      }
      if (plantUmlPath && !next.files.some((file) => file.path === plantUmlPath)) {
        setPlantUmlPath(null);
        setMode("preview");
      }
      if (mermaidPath && !next.files.some((file) => file.path === mermaidPath)) {
        setMermaidPath(null);
        setMode("preview");
      }
      setStatus(`Deleted ${fileName}`);
      setError(null);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleDrawingChange = (next: DrawingDocument) => {
    setDrawingDoc(next);
  };

  const handleDrawingDirty = (next: DrawingDocument) => {
    if (!doc || !drawingPath) return;
    setDoc(saveDrawingToDocument(doc, drawingPath, next));
  };

  const handleDrawingImageRequest = async (): Promise<string | null> => {
    const result = await openDialog({
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      ],
    });
    if (typeof result !== "string") return null;
    try {
      const image = await readImage(result);
      setStatus(`Added ${image.file_name} to drawing`);
      setError(null);
      return importedImageDataUrl(image);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
      return null;
    }
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

  const handleEditPlantUmlFromPreview = (sourcePath: string) => {
    handleSelect(sourcePath);
  };

  const handleEditMermaidFromPreview = (sourcePath: string) => {
    handleSelect(sourcePath);
  };

  const resolveDiscard = (discard: boolean) => {
    setError(null);
    if (discard && pendingRef.current) {
      pendingRef.current();
    }
    pendingRef.current = null;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcut(event)) return;
      event.preventDefault();
      void handleSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);

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
        onInsertPlantUml={handleInsertPlantUml}
        onInsertMermaid={handleInsertMermaid}
        onAddImage={handleAddImage}
      />
      <div className="main-layout">
        <aside className={`sidebar ${mode === "drawing" ? "sidebar-with-properties" : ""}`}>
          <div className="sidebar-tree">
            <FileTree
              files={doc?.files ?? []}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              onEditMarkdown={handleEditMarkdown}
              onDropImages={handleDropImages}
              canRename={isRenameablePath}
              onRename={handleRename}
              canDelete={(path) => doc !== null && isDeletableAsset(doc, path)}
              onDelete={handleDelete}
            />
          </div>
          {mode === "drawing" && (
            <div id="drawing-properties-panel" className="sidebar-properties" />
          )}
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
              onRequestImage={handleDrawingImageRequest}
              propertiesPanelId="drawing-properties-panel"
            />
          )}
          {doc && mode === "plantuml" && plantUmlPath && (() => {
            const sourceFile = doc.files.find((file) => file.path === plantUmlPath);
            const resource = findPlantUmlResourceBySource(doc.manifest, plantUmlPath);
            const svgFile = resource
              ? doc.files.find((file) => file.path === resource.rendered)
              : undefined;
            return sourceFile?.content !== null && sourceFile?.content !== undefined ? (
              <PlantUmlEditor
                key={plantUmlPath}
                source={sourceFile.content}
                initialSvg={svgFile?.content ?? ""}
                onSourceChange={handlePlantUmlSourceChange}
                onRendered={handlePlantUmlRendered}
              />
            ) : null;
          })()}
          {doc && mode === "mermaid" && mermaidPath && (() => {
            const sourceFile = doc.files.find((file) => file.path === mermaidPath);
            const resource = findMermaidResourceBySource(doc.manifest, mermaidPath);
            const svgFile = resource
              ? doc.files.find((file) => file.path === resource.rendered)
              : undefined;
            return sourceFile?.content !== null && sourceFile?.content !== undefined ? (
              <MermaidEditor
                key={mermaidPath}
                source={sourceFile.content}
                initialSvg={svgFile?.content ?? ""}
                onSourceChange={handleMermaidSourceChange}
                onRendered={handleMermaidRendered}
              />
            ) : null;
          })()}
          {doc && mode !== "drawing" && mode !== "plantuml" && mode !== "mermaid" && displayFile && displayFile.is_text && (
            <>
              {mode === "preview" && (
                <div className="preview-only">
                  <MarkdownPreview
                    markdown={displayContent}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                    onEditPlantUml={handleEditPlantUmlFromPreview}
                    onEditMermaid={handleEditMermaidFromPreview}
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
                    onCursorChange={(position) => { editorCursorRef.current = position; }}
                  />
                  <MarkdownPreview
                    markdown={displayContent}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                    onEditPlantUml={handleEditPlantUmlFromPreview}
                    onEditMermaid={handleEditMermaidFromPreview}
                  />
                </div>
              )}
            </>
          )}
          {doc && mode !== "drawing" && mode !== "plantuml" && mode !== "mermaid" && displayFile && !displayFile.is_text && (
            <div className="binary-view">
              {displayFile.base64 && (
                <img src={`data:${imageMediaType(displayFile.path)};base64,${displayFile.base64}`} alt="" />
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
