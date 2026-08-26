import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileTree } from "./components/FileTree";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { AboutDialog } from "./components/AboutDialog";
import { AiSettingsDialog } from "./components/AiSettingsDialog";
import { AiSelectionActionDialog } from "./components/AiSelectionActionDialog";
import { AiChatPanel } from "./components/AiChatPanel";
import { AiDiagramEditDialog } from "./components/AiDiagramEditDialog";
import { applyDiagramEdit } from "./lib/aiDiagramEditApply";
import { ThirdPartyLicensesDialog } from "./components/ThirdPartyLicensesDialog";
import { SynchronizedScrollView } from "./components/SynchronizedScrollView";
import packageInfo from "../package.json";
import thirdPartyLicenses from "../THIRD_PARTY_LICENSES.txt?raw";
import {
  NotificationBanners,
  type BannerNotice,
  type NotificationTone,
} from "./components/NotificationBanners";
import type { DocumentState } from "./lib/document";
import {
  createDocumentState,
  createFolderDocumentState,
  addAttachment,
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
  createEmptyFolder,
  exportFolder,
  importFolder,
  openPackage,
  openFolder,
  savePackage,
  readAttachment,
  readImage,
  saveAttachment,
  watchFolder,
  stopWatchingFolder,
  onFolderChanged,
} from "./lib/tauri";
import type { DrawingDocument } from "./lib/drawing/model";
import {
  DEFAULT_DRAWING_DIR,
  addDrawingToDocument,
  parseDrawingFile,
  saveDrawingToDocument,
} from "./lib/drawing/docIntegration";
import type { FileInfo, ImportedFile, ImportedImage } from "./types";
import { isSelectionValid, isEntirelyInsideCodeBlock, type AiSelectionSnapshot, type AiTaskKind } from "./lib/aiSelection";
import { applyAiResult } from "./lib/aiApply";
import {
  insertMarkdownBlock,
  insertMarkdownImages,
  insertMarkdownLinks,
  isMarkdownPath,
} from "./lib/markdown";
import { isSaveShortcut } from "./lib/shortcuts";
import {
  droppedFileToImage,
  importedImageDataUrl,
  isSupportedImageName,
} from "./lib/imageImport";
import {
  downloadAttachment,
  type AttachmentDownloadEvent,
} from "./lib/attachmentDownload";
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
import {
  DEFAULT_MATHJAX_SOURCE,
  addMathJaxToDocument,
  findMathJaxResourceBySource,
  saveMathJaxToDocument,
} from "./lib/mathjax/docIntegration";
import { EMPTY_2X2_MARKDOWN_TABLE } from "./lib/markdownTable";
import {
  loadRspressMode,
  loadShowToc,
  loadVimMode,
  saveRspressMode,
  saveShowToc,
  saveVimMode,
} from "./lib/editorPreferences";
import { exportFolderDocumentPackage, saveDocument } from "./lib/documentPersistence";
import { externalFolderAction, folderInfoFingerprint } from "./lib/folderSync";

const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({
  default: module.MarkdownEditor,
})));
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview").then((module) => ({
  default: module.MarkdownPreview,
})));
const DrawingEditor = lazy(() => import("./components/DrawingEditor").then((module) => ({
  default: module.DrawingEditor,
})));
const PlantUmlEditor = lazy(() => import("./components/PlantUmlEditor").then((module) => ({
  default: module.PlantUmlEditor,
})));
const MermaidEditor = lazy(() => import("./components/MermaidEditor").then((module) => ({
  default: module.MermaidEditor,
})));
const MathJaxEditor = lazy(() => import("./components/MathJaxEditor").then((module) => ({
  default: module.MathJaxEditor,
})));
const MarkdownTableEditor = lazy(() => import("./components/MarkdownTableEditor").then((module) => ({
  default: module.MarkdownTableEditor,
})));

type Mode = "preview" | "split" | "drawing" | "plantuml" | "mermaid" | "mathjax" | "table";

interface TableEditContext {
  path: string;
  start: number;
  end: number;
}

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
  const [mathJaxPath, setMathJaxPath] = useState<string | null>(null);
  const [tableEdit, setTableEdit] = useState<TableEditContext | null>(null);
  const [vimMode, setVimMode] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [rspressMode, setRspressMode] = useState(false);
  const [fileListOpen, setFileListOpen] = useState(true);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [notifications, setNotifications] = useState<BannerNotice[]>([]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [thirdPartyLicensesOpen, setThirdPartyLicensesOpen] = useState(false);
  const [aiSelection, setAiSelection] = useState<{ task: AiTaskKind; snapshot: AiSelectionSnapshot } | null>(null);
  const [aiSelectionRunning, setAiSelectionRunning] = useState(false);
  const [aiDiagramEdit, setAiDiagramEdit] = useState<{ format: "plantuml" | "mermaid"; path: string } | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const editorCursorRef = useRef<number | null>(null);
  const markdownScrollRatiosRef = useRef(new Map<string, number>());
  const documentAreaRef = useRef<HTMLElement>(null);
  const editorSelectionRef = useRef<AiSelectionSnapshot | null>(null);
  const [editorSelection, setEditorSelection] = useState<AiSelectionSnapshot | null>(null);
  const notificationSequenceRef = useRef(0);
  const notificationTimersRef = useRef<number[]>([]);
  const documentRef = useRef<DocumentState | null>(null);
  const externalConflictRef = useRef(false);
  const externalNoticeRef = useRef<string | null>(null);

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
    let active = true;
    void Promise.all([loadVimMode(), loadShowToc(), loadRspressMode()]).then(([
      storedVimMode,
      storedShowToc,
      storedRspressMode,
    ]) => {
      if (!active) return;
      setVimMode(storedVimMode);
      setShowToc(storedShowToc);
      setRspressMode(storedRspressMode);
      setPreferencesLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    notificationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!doc?.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [doc?.dirty]);

  const confirmReplaceDirtyDocument = () =>
    !doc?.dirty || window.confirm("Discard unsaved changes?");

  const showNotification = (message: string, tone: NotificationTone) => {
    notificationSequenceRef.current += 1;
    const notice: BannerNotice = { id: notificationSequenceRef.current, message, tone };
    setNotifications((current) => [...current, notice]);
    const timer = window.setTimeout(() => {
      setNotifications((current) => current.filter((item) => item.id !== notice.id));
      notificationTimersRef.current = notificationTimersRef.current.filter((item) => item !== timer);
    }, 3500);
    notificationTimersRef.current.push(timer);
  };

  useEffect(() => {
    documentRef.current = doc;
  }, [doc]);

  useEffect(() => {
    if (doc?.origin.kind !== "folder") {
      externalConflictRef.current = false;
      externalNoticeRef.current = null;
      void stopWatchingFolder();
      return;
    }
    const folderPath = doc.origin.path;
    let active = true;
    let checking = false;
    let debounceTimer: number | null = null;
    let unlisten: (() => void) | null = null;
    externalConflictRef.current = false;
    externalNoticeRef.current = null;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const current = documentRef.current;
        if (!active || current?.origin.kind !== "folder" || current.origin.path !== folderPath) return;
        const info = await openFolder(folderPath);
        if (!active) return;
        const action = externalFolderAction(current, info);
        if (action === "unchanged") {
          externalConflictRef.current = false;
          externalNoticeRef.current = null;
        } else if (action === "reload") {
          externalConflictRef.current = false;
          externalNoticeRef.current = null;
          const reloaded = createFolderDocumentState(info, folderPath);
          setDoc(reloaded);
          setSelectedPath((selected) =>
            selected && reloaded.files.some((file) => file.path === selected)
              ? selected
              : reloaded.entrypoint,
          );
          setStatus(`Reloaded external changes from ${folderPath}`);
          showNotification("外部エディタによる変更を反映しました", "info");
        } else {
          externalConflictRef.current = true;
          const fingerprint = folderInfoFingerprint(info);
          if (externalNoticeRef.current !== fingerprint) {
            externalNoticeRef.current = fingerprint;
            setStatus("External changes conflict with unsaved edits");
            showNotification("外部変更を検知しました。未保存の編集があるため自動反映していません", "error");
          }
        }
      } catch (e) {
        if (active && externalNoticeRef.current !== String(e)) {
          externalNoticeRef.current = String(e);
          showNotification(`フォルダの再読込に失敗しました: ${String(e)}`, "error");
        }
      } finally {
        checking = false;
      }
    };

    void onFolderChanged((changedPath) => {
      if (!active || changedPath !== folderPath) return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => { void check(); }, 300);
    }).then((dispose) => {
      if (!active) {
        dispose();
        return undefined;
      }
      unlisten = dispose;
      return watchFolder(folderPath);
    }).catch((e) => {
      if (active) showNotification(`フォルダ監視を開始できませんでした: ${String(e)}`, "error");
    });

    return () => {
      active = false;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      unlisten?.();
    };
  }, [
    doc?.origin.kind,
    doc?.origin.kind === "folder" ? doc.origin.path : null,
    doc?.folderSnapshot,
  ]);

  useEffect(() => {
    if (preferencesLoaded) void saveVimMode(vimMode);
  }, [preferencesLoaded, vimMode]);

  useEffect(() => {
    if (preferencesLoaded) void saveShowToc(showToc);
  }, [preferencesLoaded, showToc]);

  useEffect(() => {
    if (preferencesLoaded) void saveRspressMode(rspressMode);
  }, [preferencesLoaded, rspressMode]);

  useEffect(() => {
    if (doc && !selectedPath) {
      setSelectedPath(doc.entrypoint);
    }
  }, [doc, selectedPath]);

  const handleOpen = async () => {
    if (!confirmReplaceDirtyDocument()) return;
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

  const handleOpenFolder = async () => {
    if (!confirmReplaceDirtyDocument()) return;
    const result = await openDialog({ directory: true });
    if (typeof result !== "string") return;
    try {
      const info = await openFolder(result);
      setDoc(createFolderDocumentState(info, result));
      setSelectedPath(info.entrypoint);
      setMode("preview");
      setDrawingDoc(null);
      setDrawingPath(null);
      setPlantUmlPath(null);
      setMermaidPath(null);
      setMathJaxPath(null);
      setError(null);
      setStatus(`Opened folder ${result}`);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleStartWithEmptyFolder = async () => {
    if (!confirmReplaceDirtyDocument()) return;
    const parent = await openDialog({ directory: true });
    if (typeof parent !== "string") return;
    const requestedName = window.prompt("New folder name", "untitled");
    if (requestedName === null) return;
    const name = requestedName.trim();
    if (!name) return;
    const path = `${parent.replace(/[\\/]+$/, "")}/${name}`;
    try {
      const info = await createEmptyFolder(path);
      setDoc(createFolderDocumentState(info, path));
      setSelectedPath(info.entrypoint);
      setMode("split");
      setDrawingDoc(null);
      setDrawingPath(null);
      setPlantUmlPath(null);
      setMermaidPath(null);
      setMathJaxPath(null);
      setError(null);
      setStatus(`Created folder ${path}`);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleSave = async () => {
    if (!doc) return;
    if (doc.origin.kind === "folder" && externalConflictRef.current) {
      setError("External changes conflict with unsaved edits. Reopen the folder before saving.");
      setStatus("Save blocked by external changes");
      return;
    }
    if (doc.origin.kind === "untitled") {
      await handleSaveAs();
      return;
    }
    try {
      setDoc(await saveDocument(doc));
      setStatus(`Saved ${doc.origin.path}`);
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
        setDoc({ ...doc, path: result, origin: { kind: "package", path: result }, dirty: false, originalPaths: doc.files.map((file) => file.path) });
        setStatus(`Saved ${result}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleNew = async () => {
    if (!confirmReplaceDirtyDocument()) return;
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
    if (!confirmReplaceDirtyDocument()) return;
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
    if (!doc || doc.origin.kind !== "package") return;
    const folder = await openDialog({ directory: true });
    if (typeof folder === "string") {
      try {
        await exportFolder(doc.origin.path, folder);
        setStatus(`Exported to ${folder}`);
      } catch (e) {
        setError(String(e));
        setStatus("Error");
      }
    }
  };

  const handleExportPackage = async () => {
    if (!doc || doc.origin.kind !== "folder") return;
    const result = await saveDialog({
      filters: [{ name: "Markdown Package", extensions: ["mdpkg"] }],
      defaultPath: "document.mdpkg",
    });
    if (typeof result !== "string") return;
    try {
      const path = result.toLowerCase().endsWith(".mdpkg") ? result : `${result}.mdpkg`;
      await exportFolderDocumentPackage(doc, path);
      setStatus(`Exported package ${path}`);
      setError(null);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleEdit = () => {
    setMode("split");
  };

  const handleEditMarkdown = (path: string) => {
    if (!/\.(md|markdown)$/i.test(path)) return;
    setAiDiagramEdit(null);
    editorCursorRef.current = null;
    setSelectedPath(path);
    setMode("split");
  };

  const handleSelect = (path: string) => {
    setAiDiagramEdit(null);
    editorCursorRef.current = null;
    setTableEdit(null);
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
    if (path.endsWith(".tex") && findMathJaxResourceBySource(doc?.manifest ?? {}, path)) {
      setMathJaxPath(path);
      setMermaidPath(null);
      setPlantUmlPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("mathjax");
      return;
    }
    setPlantUmlPath(null);
    setMermaidPath(null);
    setMathJaxPath(null);
    setMode("preview");
  };

  const handleContentChange = (content: string) => {
    if (!doc || !selectedPath) return;
    setDoc(updateFileContent(doc, selectedPath, content));
  };

  const handleSelectionChange = (selection: { from: number; to: number; text: string } | null) => {
    editorSelectionRef.current = selection;
    setEditorSelection(selection);
  };

  const handleAiSelection = (task: AiTaskKind) => {
    const selection = editorSelectionRef.current;
    if (!isSelectionValid(selection)) {
      setError("テキストを選択してください。");
      setStatus("Error");
      return;
    }
    const sel = selection as AiSelectionSnapshot;
    if (isEntirelyInsideCodeBlock(displayContent, sel.from, sel.to)) {
      setError("選択範囲がコードブロック内のため AI Action を実行できません。");
      setStatus("Error");
      return;
    }
    setAiSelection({ task, snapshot: sel });
  };

  const handleAiApply = (mode: "replace" | "insert", result: string, snapshot: AiSelectionSnapshot) => {
    if (!doc || !selectedPath) return;
    const file = doc.files.find((f) => f.path === selectedPath);
    const content = file?.is_text ? file.content ?? "" : "";
    const applied = applyAiResult(content, snapshot, result, mode);
    if (!applied.ok) {
      setError("The document has changed since this AI request started. Please select the text again.");
      setStatus("Error");
      return;
    }
    setDoc(updateFileContent(doc, selectedPath, applied.result.content));
    setAiSelection(null);
    setAiSelectionRunning(false);
    setStatus(`AI ${mode === "replace" ? "Replace" : "Insert"} applied`);
    setError(null);
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

  const handleAiDiagramEditApply = (updatedSource: string, snapshot: { path: string; source: string }) => {
    if (!doc || !aiDiagramEdit) return;
    const currentPath = aiDiagramEdit.format === "plantuml" ? plantUmlPath : mermaidPath;
    const currentSource = doc.files.find((file) => file.path === currentPath)?.content ?? "";
    const applied = applyDiagramEdit(currentPath ?? "", currentSource, snapshot, updatedSource);
    if (!applied.ok) {
      setError("The diagram changed while AI generation was running. Run AI Generate again using the latest source.");
      setStatus("Error"); return;
    }
    if (aiDiagramEdit.format === "plantuml") handlePlantUmlSourceChange(applied.source);
    else handleMermaidSourceChange(applied.source);
    setAiDiagramEdit(null); setStatus("AI-generated diagram applied"); setError(null);
  };

  const handleInsertMathJax = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    const placeholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"></svg>';
    const added = addMathJaxToDocument(doc, DEFAULT_MATHJAX_SOURCE, placeholderSvg, "MathJax", {
      markdownPath: markdownFile?.path,
      cursor,
    });
    editorCursorRef.current = added.cursor;
    setDoc(added.state);
    setSelectedPath(added.sourcePath);
    setMathJaxPath(added.sourcePath);
    setMermaidPath(null);
    setPlantUmlPath(null);
    setDrawingDoc(null);
    setDrawingPath(null);
    setMode("mathjax");
    setStatus("Inserted MathJax");
    setError(null);
  };

  const handleMathJaxSourceChange = useCallback((source: string) => {
    setDoc((current) => current && mathJaxPath
      ? updateFileContent(current, mathJaxPath, source)
      : current);
  }, [mathJaxPath]);

  const handleMathJaxRendered = useCallback((source: string, svg: string) => {
    setDoc((current) => current && mathJaxPath
      ? saveMathJaxToDocument(current, mathJaxPath, source, svg)
      : current);
    setStatus("MathJax preview updated");
  }, [mathJaxPath]);

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

  const addImportedAttachments = (attachments: ImportedFile[]) => {
    if (!doc || attachments.length === 0) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = markdownFile?.path === selectedPath ? editorCursorRef.current : null;
    let next = doc;
    const addedPaths: string[] = [];
    for (const attachment of attachments) {
      const added = addAttachment(next, attachment.file_name, attachment.base64);
      next = added.state;
      addedPaths.push(added.path);
    }
    if (markdownFile?.content !== null && markdownFile?.content !== undefined) {
      const inserted = insertMarkdownLinks(markdownFile.content, cursor, markdownFile.path, addedPaths);
      next = updateFileContent(next, markdownFile.path, inserted.content);
      editorCursorRef.current = inserted.cursor;
    }
    setDoc(next);
    setSelectedPath(markdownFile?.path ?? addedPaths[addedPaths.length - 1] ?? null);
    setStatus(`Added ${attachments.length} attachment${attachments.length === 1 ? "" : "s"} to attachments/`);
    setError(null);
  };

  const handleAddAttachment = async () => {
    if (!doc) return;
    const result = await openDialog({ multiple: true });
    const paths = Array.isArray(result) ? result : typeof result === "string" ? [result] : [];
    if (paths.length === 0) return;
    try {
      addImportedAttachments(await Promise.all(paths.map(readAttachment)));
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleDownloadAttachment = async (file: FileInfo) => {
    const notify = (event: AttachmentDownloadEvent, fileName: string) => {
      if (event === "started") {
        showNotification(`ダウンロードを開始しました: ${fileName}`, "info");
      } else if (event === "completed") {
        showNotification(`ダウンロードが完了しました: ${fileName}`, "success");
      } else {
        showNotification(`ダウンロードに失敗しました: ${fileName}`, "error");
      }
    };
    try {
      const saved = await downloadAttachment(
        file,
        async (fileName) => {
          const result = await saveDialog({ defaultPath: fileName });
          return typeof result === "string" ? result : null;
        },
        saveAttachment,
        notify,
      );
      if (saved) setStatus(`Downloaded ${file.path}`);
    } catch (e) {
      setError(String(e));
      setStatus("Error");
    }
  };

  const handleInsertTable = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    if (!markdownFile || markdownFile.content === null) return;
    const cursor = markdownFile.path === selectedPath ? editorCursorRef.current : null;
    const inserted = insertMarkdownBlock(markdownFile.content, cursor, EMPTY_2X2_MARKDOWN_TABLE);
    editorCursorRef.current = inserted.cursor;
    setDoc(updateFileContent(doc, markdownFile.path, inserted.content));
    setSelectedPath(markdownFile.path);
    setTableEdit(null);
    setMode("split");
    setStatus("Inserted 2 × 2 table");
    setError(null);
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
    /^attachments\/[^/]+$/i.test(path) ||
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
      if (mathJaxPath === path) setMathJaxPath(renamed.path);
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
      if (mathJaxPath && !next.files.some((file) => file.path === mathJaxPath)) {
        setMathJaxPath(null);
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

  const handleEditMathJaxFromPreview = (sourcePath: string) => {
    handleSelect(sourcePath);
  };

  const handleEditTable = (path: string, start: number, end: number) => {
    setSelectedPath(path);
    setTableEdit({ path, start, end });
    setMode("table");
  };

  const handleTableChange = (markdown: string) => {
    if (!tableEdit) return;
    setDoc((current) => {
      if (!current) return current;
      const file = current.files.find((candidate) => candidate.path === tableEdit.path);
      if (!file?.is_text || file.content === null) return current;
      const content = `${file.content.slice(0, tableEdit.start)}${markdown}${file.content.slice(tableEdit.end)}`;
      return updateFileContent(current, tableEdit.path, content);
    });
    setTableEdit((current) => current ? { ...current, end: current.start + markdown.length } : current);
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
  const displayIsMarkdown = displayFile ? isMarkdownPath(displayFile.path) : false;
  const displayBaseDir = selectedFile
    ? selectedFile.path.includes("/")
      ? selectedFile.path.slice(0, selectedFile.path.lastIndexOf("/"))
      : ""
    : entrypointDir();

  useEffect(() => {
    const area = documentAreaRef.current;
    if (!area) return;
    if (mode !== "preview") {
      area.scrollTop = 0;
      return;
    }
    if (!displayFile || !displayIsMarkdown) return;
    const frame = requestAnimationFrame(() => {
      const maximum = Math.max(0, area.scrollHeight - area.clientHeight);
      area.scrollTop = maximum * (markdownScrollRatiosRef.current.get(displayFile.path) ?? 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, displayFile?.path, displayIsMarkdown, showToc]);

  const handleDocumentAreaScroll = () => {
    if (mode !== "preview" || !displayFile || !displayIsMarkdown) return;
    const area = documentAreaRef.current;
    if (!area) return;
    const maximum = Math.max(0, area.scrollHeight - area.clientHeight);
    markdownScrollRatiosRef.current.set(
      displayFile.path,
      maximum > 0 ? area.scrollTop / maximum : 0,
    );
  };

  return (
    <div className="app-shell">
      <Toolbar
        dirty={doc?.dirty ?? false}
        fileListOpen={fileListOpen}
        onToggleFileList={() => setFileListOpen((open) => !open)}
        hasDocument={doc !== null}
        onOpen={handleOpen}
        onOpenFolder={handleOpenFolder}
        onStartWithEmptyFolder={handleStartWithEmptyFolder}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onPrint={handlePrint}
        onNew={handleNew}
        onImport={handleImport}
        onExport={handleExport}
        onExportPackage={handleExportPackage}
        documentKind={doc?.origin.kind ?? null}
        onInsertDrawing={handleInsertDrawing}
        onInsertPlantUml={handleInsertPlantUml}
        onInsertMermaid={handleInsertMermaid}
        onInsertMathJax={handleInsertMathJax}
        onInsertTable={handleInsertTable}
        onAddImage={handleAddImage}
        onAddAttachment={handleAddAttachment}
        onAbout={() => setAboutOpen(true)}
        onAiSettings={() => setAiSettingsOpen(true)}
        onThirdPartyLicenses={() => setThirdPartyLicensesOpen(true)}
        aiSelectionEnabled={displayIsMarkdown && mode === "split" && isSelectionValid(editorSelection)}
        aiSelectionRunning={aiSelectionRunning}
        onAiSelection={handleAiSelection}
        aiChatOpen={aiChatOpen}
        aiChatEnabled={displayIsMarkdown}
        onToggleAiChat={() => setAiChatOpen((open) => !open)}
        showToc={showToc}
        onShowTocChange={setShowToc}
        rspressMode={rspressMode}
        onRspressModeChange={setRspressMode}
        vimMode={vimMode}
        onVimModeChange={setVimMode}
        canPrint={displayFile?.is_text === true && (mode === "preview" || mode === "split")}
      />
      <div className="main-layout">
        {(fileListOpen || mode === "drawing") && (
          <aside className={`sidebar ${mode === "drawing" ? "sidebar-with-properties" : ""}`}>
            {fileListOpen && (
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
            )}
            {mode === "drawing" && (
              <div id="drawing-properties-panel" className="sidebar-properties" />
            )}
          </aside>
        )}
        <main
          ref={documentAreaRef}
          className={`document-area ${mode === "split" ? "document-area-editor" : ""}`}
          onScroll={handleDocumentAreaScroll}
        >
          <Suspense fallback={<div className="empty-state">Loading…</div>}>
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
                vimMode={vimMode}
                onSave={handleSave}
                onAiEdit={() => setAiDiagramEdit({ format: "plantuml", path: plantUmlPath })}
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
                vimMode={vimMode}
                onSave={handleSave}
                onAiEdit={() => setAiDiagramEdit({ format: "mermaid", path: mermaidPath })}
              />
            ) : null;
          })()}
          {doc && mode === "mathjax" && mathJaxPath && (() => {
            const sourceFile = doc.files.find((file) => file.path === mathJaxPath);
            const resource = findMathJaxResourceBySource(doc.manifest, mathJaxPath);
            const svgFile = resource
              ? doc.files.find((file) => file.path === resource.rendered)
              : undefined;
            return sourceFile?.content !== null && sourceFile?.content !== undefined ? (
              <MathJaxEditor
                key={mathJaxPath}
                source={sourceFile.content}
                initialSvg={svgFile?.content ?? ""}
                onSourceChange={handleMathJaxSourceChange}
                onRendered={handleMathJaxRendered}
                vimMode={vimMode}
                onSave={handleSave}
              />
            ) : null;
          })()}
          {doc && mode === "table" && tableEdit && (() => {
            const file = doc.files.find((candidate) => candidate.path === tableEdit.path);
            const source = file?.content?.slice(tableEdit.start, tableEdit.end);
            return source ? (
              <MarkdownTableEditor
                key={`${tableEdit.path}:${tableEdit.start}`}
                source={source}
                onChange={handleTableChange}
                onDone={() => {
                  setTableEdit(null);
                  setMode("split");
                }}
              />
            ) : null;
          })()}
          {doc && mode !== "drawing" && mode !== "plantuml" && mode !== "mermaid" && mode !== "mathjax" && mode !== "table" && displayFile && displayFile.is_text && (
            <>
              {mode === "preview" && (
                <div className="preview-only">
                  <MarkdownPreview
                    markdown={displayContent}
                    showToc={showToc && displayIsMarkdown}
                    rspressMode={rspressMode}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                    onEditPlantUml={handleEditPlantUmlFromPreview}
                    onEditMermaid={handleEditMermaidFromPreview}
                    onEditMathJax={handleEditMathJaxFromPreview}
                    onEditTable={(start, end) => handleEditTable(displayFile.path, start, end)}
                    onDownloadAttachment={handleDownloadAttachment}
                  />
                  <button className="edit-btn" onClick={handleEdit}>
                    Edit
                  </button>
                </div>
              )}
              {mode === "split" && (
                <SynchronizedScrollView>
                  <MarkdownEditor
                    value={displayContent}
                    onChange={handleContentChange}
                    onCursorChange={(position) => { editorCursorRef.current = position; }}
                    onSelectionChange={handleSelectionChange}
                    onAiSelection={handleAiSelection}
                    vimMode={vimMode}
                    onSave={handleSave}
                  />
                  <MarkdownPreview
                    markdown={displayContent}
                    scrollRestoreKey={displayFile.path}
                    initialScrollRatio={markdownScrollRatiosRef.current.get(displayFile.path) ?? 0}
                    onScrollRatioChange={(ratio) => markdownScrollRatiosRef.current.set(displayFile.path, ratio)}
                    showToc={showToc && displayIsMarkdown}
                    rspressMode={rspressMode}
                    baseDir={displayBaseDir}
                    files={doc.files}
                    manifest={doc.manifest}
                    onEditDrawing={handleEditDrawingFromPreview}
                    onEditPlantUml={handleEditPlantUmlFromPreview}
                    onEditMermaid={handleEditMermaidFromPreview}
                    onEditMathJax={handleEditMathJaxFromPreview}
                    onEditTable={(start, end) => handleEditTable(displayFile.path, start, end)}
                    onDownloadAttachment={handleDownloadAttachment}
                  />
                </SynchronizedScrollView>
              )}
            </>
          )}
          {doc && mode !== "drawing" && mode !== "plantuml" && mode !== "mermaid" && mode !== "mathjax" && mode !== "table" && displayFile && !displayFile.is_text && (
            <div className="binary-view">
              {displayFile.base64 && (
                <img src={`data:${imageMediaType(displayFile.path)};base64,${displayFile.base64}`} alt="" />
              )}
              <p className="file-info">{displayFile.path}</p>
            </div>
          )}
          </Suspense>
        </main>
        {aiChatOpen && displayFile && displayIsMarkdown && (
          <AiChatPanel
            key={displayFile.path}
            filename={displayFile.path}
            currentDocument={displayContent}
            onOpenAiSettings={() => setAiSettingsOpen(true)}
            onClose={() => setAiChatOpen(false)}
          />
        )}
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
      {aboutOpen && (
        <AboutDialog version={packageInfo.version} onClose={() => setAboutOpen(false)} />
      )}
      {aiSettingsOpen && (
        <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />
      )}
      {aiSelection && (
        <AiSelectionActionDialog
          task={aiSelection.task}
          snapshot={aiSelection.snapshot}
          onApply={handleAiApply}
          onOpenAiSettings={() => { setAiSettingsOpen(true); }}
          onClose={() => { setAiSelection(null); setAiSelectionRunning(false); }}
          onRunningChange={setAiSelectionRunning}
        />
      )}
      {aiDiagramEdit && (() => {
        const source = doc?.files.find((file) => file.path === aiDiagramEdit.path)?.content ?? "";
        return <AiDiagramEditDialog key={aiDiagramEdit.path} format={aiDiagramEdit.format} path={aiDiagramEdit.path}
          currentSource={source} onApply={handleAiDiagramEditApply} onOpenAiSettings={() => setAiSettingsOpen(true)}
          onClose={() => setAiDiagramEdit(null)} />;
      })()}
      {thirdPartyLicensesOpen && (
        <ThirdPartyLicensesDialog
          text={thirdPartyLicenses}
          onClose={() => setThirdPartyLicensesOpen(false)}
        />
      )}
      <StatusBar
        message={status}
        mode={doc?.origin.kind === "package" ? "Package" : doc?.origin.kind === "folder" ? "Folder" : undefined}
        location={doc?.origin.kind === "folder" ? doc.origin.path : undefined}
      />
      <NotificationBanners notices={notifications} />
    </div>
  );
}
