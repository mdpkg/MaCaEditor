import { useAppNotifications, errorDetail } from "./hooks/useAppNotifications";
import { ResizeHandle } from "./components/ResizeHandle";
import { useStoredLayoutNumber } from "./lib/layoutPreferences";
import { uiText } from "./lib/uiText";
import { useActionDialog } from "./components/ActionDialog";
import { Dialog } from "./components/Dialog";
import { ErrorDetails } from "./components/ErrorDetails";
import { loadRecentDocuments, saveRecentDocuments, type RecentDocument } from "./lib/recentDocuments";
import { fileTreeStateKey, loadCollapsedPaths, saveCollapsedPaths } from "./lib/fileTreeState";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FileTree, type TreeAddKind } from "./components/FileTree";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { AboutDialog } from "./components/AboutDialog";
import { AiSettingsDialog } from "./components/AiSettingsDialog";
import { AiSelectionActionDialog } from "./components/AiSelectionActionDialog";
import { AiChatPanel } from "./components/AiChatPanel";
import { AiDiagramEditDialog } from "./components/AiDiagramEditDialog";
import { applyDiagramEdit } from "./lib/aiDiagramEditApply";
import { ThirdPartyLicensesDialog } from "./components/ThirdPartyLicensesDialog";
import { PackageDiagnosticsDialog } from "./components/PackageDiagnosticsDialog";
import { BacklinksDialog } from "./components/BacklinksDialog";
import { ManifestEditorDialog } from "./components/ManifestEditorDialog";
import { InferredManifestDialog } from "./components/InferredManifestDialog";
import { V1MigrationDialog } from "./components/V1MigrationDialog";
import { PackageSearchDialog } from "./components/PackageSearchDialog";
import { SynchronizedScrollView } from "./components/SynchronizedScrollView";
import packageInfo from "../package.json";
import thirdPartyLicenses from "../THIRD_PARTY_LICENSES.txt?raw";
import { NotificationBanners } from "./components/NotificationBanners";
import { NotificationHistoryDialog } from "./components/NotificationHistoryDialog";
import { SavedEditHistoriesDialog } from "./components/SavedEditHistoriesDialog";
import type { DocumentState } from "./lib/document";
import {
  createDocumentState,
  createFolderDocumentState,
  addAttachment,
  addDirectory,
  addImage,
  addMarkdown,
  applyPathMove,
  deletePath,
  imageMediaType,
  movePath,
  pathReferenceCount,
  planPathMove,
  resourceDirectoryForMarkdown,
  setEntrypoint,
  updateFileContent,
  updateManifestMetadata,
  validateNewPackagePath,
} from "./lib/document";
import {
  createNewPackage,
  createEmptyFolder,
  exportFolder,
  importFolder,
  openPackage,
  openFolder,
  clearSavedEditHistory,
  savePackage,
  saveFolder,
  exportPackage,
  readAttachment,
  readImage,
  saveAttachment,
  watchFolder,
  watchPrint,
  closePrintPreview,
  usesMacPreparedPrint,
  printPreparedPages,
  stopWatchingFolder,
  onFolderChanged,
  onNativeFileDrop,
  setImageDropEnabled,
  type NativeFileDropAction,
  updateWindowTitle,
} from "./lib/tauri";
import type { DrawingDocument } from "@maca/drawing-core";
import {
  DEFAULT_DRAWING_DIR,
  addDrawingToDocument,
  parseDrawingFile,
  saveDrawingToDocument,
} from "./lib/drawing/docIntegration";
import type { FileInfo, ImportedFile, ImportedImage, PackageInfo } from "./types";
import { isSelectionValid, isEntirelyInsideCodeBlock, type AiSelectionSnapshot, type AiTaskKind } from "./lib/aiSelection";
import { applyAiResult } from "./lib/aiApply";
import {
  insertMarkdownBlock,
  insertMarkdownImages,
  insertMarkdownLinks,
  isMarkdownPath,
  packageFileMarkdownLink,
} from "./lib/markdown";
import { historyShortcut, isPackageSearchShortcut, isSaveShortcut } from "./lib/shortcuts";
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
  loadDrawingPreferences,
  saveEditorPreferences,
  loadShowToc,
  loadVimMode,
} from "./lib/editorPreferences";
import type { DrawingPreferences } from "@maca/drawing-react";
import { applySavedBaseline, exportFolderDocumentPackage, saveDocument } from "./lib/documentPersistence";
import { captureEditCheckpoint, restoreEditCheckpoint } from "./lib/editCheckpoint";
import {
  applyEditHistoryEntry, createEditHistory, fileHistoryEntry, recordEdit, reuseAttachmentPayload, sameSavedContent,
  textHistoryEntry, type HistoryDirection, type EditHistoryEntry, type EditHistoryFocus, type TextEditGroup,
} from "./lib/editHistory";
import { blocksFolderSave, externalFolderAction, folderInfoFingerprint } from "./lib/folderSync";
import { supportsPrintPageMargins } from "./lib/printPageMargins";
import { diagnosePackage, diagnoseRelatedMarkdown, type PackageDiagnostic } from "./lib/packageDiagnostics";
import { findBacklinks, resolveMarkdownLink } from "./lib/packageNavigation";
import { inferManifest, type ManifestInference } from "./lib/manifestInference";

const MarkdownEditor = lazy(() => import("./components/MarkdownEditor").then((module) => ({
  default: module.MarkdownEditor,
})));
const MarkdownPreview = lazy(() => import("./components/MarkdownPreview").then((module) => ({
  default: module.MarkdownPreview,
})));
const DrawingEditor = lazy(() => import("@maca/drawing-react").then((module) => ({
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

const persistenceCommands = { savePackage, saveFolder, exportPackage };
const saveEditorSettingsOperation = uiText("Save editor settings");

type Mode = "preview" | "split" | "drawing" | "plantuml" | "mermaid" | "mathjax" | "table";

interface TableEditContext {
  path: string;
  start: number;
  end: number;
  content: string;
}

interface PendingInferredFolder {
  path: string;
  info: PackageInfo;
  inference: ManifestInference;
  destination?: string;
}

function needsDiagramRender(state: DocumentState, renderedPath: string | undefined): boolean {
  return !!renderedPath && (state.staleResources?.includes(renderedPath) === true ||
    !state.files.some((file) => file.path === renderedPath && file.content));
}

export default function App() {
  const [doc, setDocumentState] = useState<DocumentState | null>(null);
  const [fileTask, setFileTask] = useState<string | null>(null);
  const [folderConflict, setFolderConflictState] = useState(false);
  const { ask, dialog: actionDialog } = useActionDialog();
  const [recentDocuments, setRecentDocuments] = useState(loadRecentDocuments);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(new Set<string>());
  const treeStatesRef = useRef(new Map<string, Set<string>>());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const nativeDropRef = useRef<(paths: string[], action?: NativeFileDropAction) => void>(() => {});
  const nativeImportImagesRef = useRef<(images: ImportedImage[]) => void>(() => {});
  const openSequenceRef = useRef(0);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [status, setStatus] = useState(uiText("Ready"));
  const {
    error, notifications, notificationHistory, reportError, clearError, dismissError,
    showNotification, dismissNotification, resetDocumentNotifications, showErrorDetails,
  } = useAppNotifications(setStatus);
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
  const [sidebarWidth, setSidebarWidth] = useStoredLayoutNumber("maca.sidebarWidth", 240, 120, 480);
  const [splitRatio, setSplitRatio] = useStoredLayoutNumber("maca.splitRatio", 0.5, 0.2, 0.8);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [drawingPreferences, setDrawingPreferences] = useState<DrawingPreferences>({
    gridVisible: true, snap: false, smartGuidesEnabled: true,
  });
  const [notificationHistoryOpen, setNotificationHistoryOpen] = useState(false);
  const [savedEditHistoriesOpen, setSavedEditHistoriesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [thirdPartyLicensesOpen, setThirdPartyLicensesOpen] = useState(false);
  const [packageDiagnostics, setPackageDiagnostics] = useState<PackageDiagnostic[] | null>(null);
  const [liveDiagnostics, setLiveDiagnostics] = useState<{
    document: DocumentState;
    wholePackage: boolean;
    diagnostics: PackageDiagnostic[];
  } | null>(null);
  const [backlinksTarget, setBacklinksTarget] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{ path: string; offset: number; length?: number } | null>(null);
  const [manifestEditorOpen, setManifestEditorOpen] = useState(false);
  const [v1MigrationOpen, setV1MigrationOpen] = useState(false);
  const [packageSearchOpen, setPackageSearchOpen] = useState(false);
  const [pendingInferredFolder, setPendingInferredFolder] = useState<PendingInferredFolder | null>(null);
  const editHistoryRef = useRef(createEditHistory());
  const savedDocumentRef = useRef<DocumentState | null>(null);
  const typingRef = useRef<{ group: TextEditGroup; path: string; before: string; stale: string[] | undefined } | null>(null);
  const [aiSelection, setAiSelection] = useState<{
    task: AiTaskKind; snapshot: AiSelectionSnapshot; path: string; session: number;
  } | null>(null);
  const [aiSelectionRunning, setAiSelectionRunning] = useState(false);
  const [aiDiagramEdit, setAiDiagramEdit] = useState<{
    format: "plantuml" | "mermaid"; path: string; session: number;
  } | null>(null);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const editorCursorsRef = useRef(new Map<string, number>());
  const editorScrollTopsRef = useRef(new Map<string, number>());
  const markdownScrollRatiosRef = useRef(new Map<string, number>());
  const documentAreaRef = useRef<HTMLElement>(null);
  const editorSelectionRef = useRef<AiSelectionSnapshot | null>(null);
  const [editorSelection, setEditorSelection] = useState<AiSelectionSnapshot | null>(null);
  const documentRef = useRef<DocumentState | null>(null);
  const documentSessionRef = useRef(0);
  const fileTaskRef = useRef(false);
  const preferencesSaveRef = useRef(Promise.resolve());
  const printDialogRef = useRef(false);
  const folderConflictRef = useRef(false);

  const setFolderConflict = (conflict: boolean) => {
    folderConflictRef.current = conflict;
    setFolderConflictState(conflict);
  };

  const applyDocumentState = (next: DocumentState | null) => {
    documentRef.current = next;
    setDocumentState(next);
  };

  const setDoc = (update: DocumentState | ((current: DocumentState | null) => DocumentState | null)) => {
    const next = typeof update === "function" ? update(documentRef.current) : update;
    if (next && next !== documentRef.current) {
      // Editors outside the shared history can replace files independently of the recorded edits.
      editHistoryRef.current = createEditHistory();
      typingRef.current = null;
    }
    applyDocumentState(next);
  };

  const withDocumentDirty = (next: DocumentState) => {
    const saved = savedDocumentRef.current;
    return { ...next, dirty: !saved || !sameSavedContent(next, saved) };
  };

  const replaceDocument = (next: DocumentState, history = createEditHistory()) => {
    const key = fileTreeStateKey(next.origin);
    const collapsed = key ? treeStatesRef.current.get(key) ?? loadCollapsedPaths(key) : new Set<string>();
    if (key) treeStatesRef.current.set(key, collapsed);
    setTreeCollapsed(collapsed);
    setSelectedFolder(null);
    documentSessionRef.current += 1;
    editorCursorsRef.current.clear();
    editorScrollTopsRef.current.clear();
    markdownScrollRatiosRef.current.clear();
    setLiveDiagnostics(null);
    setPackageDiagnostics(null);
    setNavigationTarget(null);
    setTableEdit(null);
    setAiSelection(null);
    setAiSelectionRunning(false);
    setAiDiagramEdit(null);
    editHistoryRef.current = history;
    typingRef.current = null;
    savedDocumentRef.current = next.dirty ? null : next;
    setFolderConflict(false);
    resetDocumentNotifications();
    applyDocumentState(next);

  };

  useEffect(() => { saveRecentDocuments(recentDocuments); }, [recentDocuments]);
  const originKind = doc?.origin.kind;
  const originPath = doc?.origin.kind === "untitled" ? undefined : doc?.origin.path;
  useEffect(() => {
    if (!originPath || (originKind !== "package" && originKind !== "folder")) return;
    const recent: RecentDocument = { path: originPath, kind: originKind };
    setRecentDocuments((current) => [recent, ...current.filter((item) => item.path !== recent.path || item.kind !== recent.kind)].slice(0, 8));
  }, [originKind, originPath]);
  const documentName = doc?.path?.split(/[\\/]/).pop() || uiText("Untitled");
  const windowTitle = doc ? `${doc.dirty ? "*" : ""}${documentName} — MaCa Editor` : "MaCa Editor";
  useEffect(() => { void updateWindowTitle(windowTitle).catch(() => {}); }, [windowTitle]);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void onNativeFileDrop((paths, action) => nativeDropRef.current(paths, action)).then((unlisten) => {
      if (active) dispose = unlisten;
      else unlisten();
    });
    return () => { active = false; dispose?.(); };
  }, []);
  const canImportImages = doc !== null;
  useEffect(() => {
    void setImageDropEnabled(canImportImages).catch((error) => console.warn("Failed to update the Windows drop target", error));
  }, [canImportImages]);

  const treeStateKey = fileTreeStateKey(doc?.origin);
  useEffect(() => {
    if (!treeStateKey || treeStatesRef.current.get(treeStateKey) === treeCollapsed) return;
    treeStatesRef.current.set(treeStateKey, treeCollapsed);
    saveCollapsedPaths(treeStateKey, treeCollapsed);
  }, [treeStateKey, treeCollapsed]);

  useEffect(() => {
    if (!selectedPath?.includes("/")) return;
    setTreeCollapsed((current) => {
      const parents = selectedPath.split("/").slice(0, -1);
      const next = new Set(current);
      for (let index = 1; index <= parents.length; index++) next.delete(parents.slice(0, index).join("/"));
      return next.size === current.size ? current : next;
    });
  }, [selectedPath, treeStateKey]);

  const selectedFile: FileInfo | undefined = doc?.files.find(
    (f) => f.path === selectedPath,
  );
  const recordDocumentOperation = (next: DocumentState, label: string, focus?: EditHistoryFocus) => {
    const current = documentRef.current;
    if (!current) return;
    const entry = fileHistoryEntry(current, next, label, focus);
    if (!entry) return;
    typingRef.current = null;
    recordEdit(editHistoryRef.current, entry);
    applyDocumentState(withDocumentDirty(next));
    return entry;
  };
  const applyEditHistory = (direction: HistoryDirection, expectedEntry?: EditHistoryEntry) => {
    const current = documentRef.current;
    const currentMode = modeRef.current;
    if (!current || currentMode === "table") return;
    const undo = direction === "undo";
    const history = editHistoryRef.current;
    const entry = history.entries[undo ? history.cursor - 1 : history.cursor];
    if (expectedEntry && entry !== expectedEntry) {
      showNotification(uiText("Only the latest edit can be undone from this notification."), "warning");
      return;
    }
    if (!entry) return;
    const operation = uiText(undo ? "Undo" : "Redo");
    try {
      const next = withDocumentDirty(applyEditHistoryEntry(current, entry, direction));
      const requestedFocus = entry.kind === "files" ? entry.focus : undefined;
      const focusFile = requestedFocus && next.files.find((file) => file.path === requestedFocus.path);
      const diagramResource = requestedFocus?.mode === "plantuml" ? findPlantUmlResourceBySource(next.manifest, requestedFocus.path)
        : requestedFocus?.mode === "mermaid" ? findMermaidResourceBySource(next.manifest, requestedFocus.path) : undefined;
      const focus = focusFile && !needsDiagramRender(next, diagramResource?.rendered) ? requestedFocus : undefined;
      const drawingSource = focus?.mode === "drawing" ? focusFile?.content : null;
      const restoredDrawing = drawingSource ? parseDrawingFile(drawingSource) : null;
      typingRef.current = null;
      history.cursor += undo ? -1 : 1;
      applyDocumentState(next);
      setSelectedFolder(null);
      setSelectedPath(entry.kind === "text" ? entry.path : focus?.path ?? next.entrypoint);
      if (entry.kind === "files") {
        setDrawingDoc(restoredDrawing);
        setDrawingPath(restoredDrawing && focus ? focus.path : null);
        setPlantUmlPath(focus?.mode === "plantuml" ? focus.path : null);
        setMermaidPath(focus?.mode === "mermaid" ? focus.path : null);
        setMode(focus?.mode === "drawing" && !restoredDrawing ? "preview" : focus?.mode ?? "preview");
      } else if (currentMode !== "split") {
        setMode("preview");
      }
      clearError(operation);
      setStatus(`${entry.label}を${undo ? "元に戻しました" : "やり直しました"}`);
    } catch (reason) {
      reportError(operation, reason);
    }
  };

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
    void Promise.all([loadVimMode(), loadShowToc(), loadRspressMode(), loadDrawingPreferences()]).then(([
      storedVimMode,
      storedShowToc,
      storedRspressMode,
      storedDrawingPreferences,
    ]) => {
      if (!active) return;
      setVimMode(storedVimMode);
      setShowToc(storedShowToc);
      setRspressMode(storedRspressMode);
      setDrawingPreferences(storedDrawingPreferences);
      setPreferencesLoaded(true);
    });
    return () => { active = false; };
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

  const confirmReplaceDirtyDocument = async (message = uiText("Discard unsaved changes before opening another document?")) => {
    const current = documentRef.current;
    if (!current?.dirty) return true;
    const response = await ask({ title: uiText("Unsaved changes"), message, confirmLabel: uiText("Discard and continue") });
    return response !== null && documentRef.current === current;
  };

  const newPathError = (value: string, source?: string): string | null => {
    try {
      const path = validateNewPackagePath(value);
      if (path === source) return null;
      const current = documentRef.current;
      if (current?.files.some((file) => file.path.toLocaleLowerCase() === path.toLocaleLowerCase()) ||
          current?.directories?.some((directory) => directory.toLocaleLowerCase() === path.toLocaleLowerCase())) return uiText("This path already exists.");
      if (current?.files.some((file) => path.toLocaleLowerCase().startsWith(file.path.toLocaleLowerCase() + "/"))) return uiText("A parent path is a file.");
      return null;
    } catch { return "有効なパッケージ内の相対パスを入力してください。"; }
  };

  const nameError = (value: string) => {
    if (!value.trim() || /[\\/]/.test(value)) return uiText("Enter a name without path separators.");
    try { validateNewPackagePath(value); return null; } catch { return "ファイル名に使用できない文字が含まれています。"; }
  };

  useEffect(() => {
    if (doc?.origin.kind !== "folder") {
      void stopWatchingFolder();
      return;
    }
    const folderPath = doc.origin.path;
    let active = true;
    let checking = false;
    let debounceTimer: number | null = null;
    let unlisten: (() => void) | null = null;
    let lastError: string | null = null;

    const scheduleCheck = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => { void check(); }, 300);
    };

    const check = async () => {
      const origin = documentRef.current?.origin;
      if (!active || origin?.kind !== "folder" || origin.path !== folderPath) return;
      if (checking || fileTaskRef.current) {
        scheduleCheck();
        return;
      }
      checking = true;
      const session = documentSessionRef.current;
      const baseline = documentRef.current?.folderSnapshot;
      try {
        const info = await openFolder(folderPath);
        const current = documentRef.current;
        if (!active || session !== documentSessionRef.current ||
            current?.origin.kind !== "folder" || current.origin.path !== folderPath) return;
        if (fileTaskRef.current || current.folderSnapshot !== baseline) {
          scheduleCheck();
          return;
        }
        lastError = null;
        const action = externalFolderAction(current, info, editHistoryRef.current.entries.length > 0);
        setFolderConflict(action === "conflict");
        if (action === "reload") {
          const reloaded = createFolderDocumentState(info, folderPath);
          replaceDocument(reloaded);
          setSelectedPath((selected) =>
            selected && reloaded.files.some((file) => file.path === selected)
              ? selected
              : reloaded.entrypoint,
          );
          setStatus(`${folderPath} の外部変更を反映しました`);
          showNotification("外部エディタによる変更を反映しました。", "info");
        }
      } catch (e) {
        if (active && session === documentSessionRef.current &&
            (fileTaskRef.current || documentRef.current?.folderSnapshot !== baseline)) {
          scheduleCheck();
          return;
        }
        if (active && session === documentSessionRef.current && lastError !== String(e)) {
          lastError = String(e);
          if (blocksFolderSave(e)) setFolderConflict(true);
          showNotification("フォルダを再読込できませんでした。", "error", { detail: lastError });
        }
      } finally {
        checking = false;
      }
    };

    void onFolderChanged((changedPath) => {
      if (active && changedPath === folderPath) scheduleCheck();
    }).then((dispose) => {
      if (!active) {
        dispose();
        return undefined;
      }
      unlisten = dispose;
      return watchFolder(folderPath);
    }).catch((e) => {
      if (active) showNotification("フォルダの監視を開始できませんでした。", "error", { detail: String(e) });
    });

    return () => {
      active = false;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      unlisten?.();
    };
  }, [
    doc?.origin.kind,
    doc?.origin.kind === "folder" ? doc.origin.path : null,
  ]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    let active = true;
    preferencesSaveRef.current = preferencesSaveRef.current.then(async () => {
      if (!active) return;
      try {
        await saveEditorPreferences({ vimMode, showToc, rspressMode, drawingPreferences });
        if (!active) return;
        clearError(saveEditorSettingsOperation);
        setStatus((current) => current.startsWith(`${saveEditorSettingsOperation}に失敗しました。`)
          ? uiText("Editor settings saved.")
          : current);
      } catch (reason) {
        if (active) reportError(saveEditorSettingsOperation, reason);
      }
    });
    return () => { active = false; };
  }, [preferencesLoaded, vimMode, showToc, rspressMode, drawingPreferences, clearError, reportError]);

  useEffect(() => {
    if (doc && !selectedPath) {
      setSelectedPath(doc.entrypoint);
    }
  }, [doc, selectedPath]);

  const openDocument = async (path: string, kind: RecentDocument["kind"], editOnOpen = false) => {
    const sequence = ++openSequenceRef.current;
    try {
      const info = await (kind === "package" ? openPackage(path) : openFolder(path, true));
      if (sequence !== openSequenceRef.current || !await confirmReplaceDirtyDocument()) return;
      if (sequence !== openSequenceRef.current) return;
      if (kind === "folder" && info.manifest_generated) {
        setPendingInferredFolder({ path, info, inference: inferManifest(info.files) });
        clearError(uiText("Open folder"));
        setStatus(uiText("Review generated manifest"));
        return;
      }
      const state = kind === "folder" ? createFolderDocumentState(info, path) : createDocumentState(info, path);
      if (info.edit_history) {
        try {
          const restored = restoreEditCheckpoint(state, info.edit_history);
          replaceDocument(restored.state, restored.history);
        } catch (reason) {
          replaceDocument(state);
          showNotification(uiText("Could not restore saved edit history."), "warning", { detail: errorDetail(reason) });
        }
      } else {
        replaceDocument(state);
      }
      if (info.edit_history_warning) {
        showNotification(uiText("Could not restore saved edit history."), "warning", { detail: info.edit_history_warning });
      }
      setSelectedPath(info.entrypoint);
      const editEntrypoint = editOnOpen && info.files.some((file) => file.path === info.entrypoint && file.is_text);
      setMode(editEntrypoint ? "split" : "preview");
      if (editEntrypoint) setNavigationTarget({ path: info.entrypoint, offset: 0, length: 0 });
      setDrawingDoc(null);
      setDrawingPath(null);
      setPlantUmlPath(null);
      setMermaidPath(null);
      setMathJaxPath(null);
      setStatus(`${path} を開きました`);
    } catch (reason) { reportError(kind === "folder" ? uiText("Open folder") : uiText("Open package"), reason); }
  };

  const handleOpen = async (editOnOpen = false) => {
    const path = await openDialog({ filters: [{ name: "Markdown パッケージ", extensions: ["mdpkg"] }] });
    if (typeof path === "string") await openDocument(path, "package", editOnOpen);
  };

  const handleOpenFolder = async () => {
    const path = await openDialog({ directory: true });
    if (typeof path === "string") await openDocument(path, "folder");
  };

  const handleStartWithEmptyFolder = async () => {
    if (!await confirmReplaceDirtyDocument()) return;
    const approvedDocument = documentRef.current;
    const parent = await openDialog({ directory: true });
    if (typeof parent !== "string") return;
    const requestedName = await ask({
      title: uiText("Create folder"), label: uiText("Folder name"), initialValue: "untitled", confirmLabel: uiText("Create"),
      validate: nameError,
    });
    if (requestedName === null) return;
    const name = requestedName.trim();
    if (!name) return;
    const path = `${parent.replace(/[\\/]+$/, "")}/${name}`;
    try {
      const info = await createEmptyFolder(path);
      if (documentRef.current !== approvedDocument && !await confirmReplaceDirtyDocument()) return;
      replaceDocument(createFolderDocumentState(info, path));
      setSelectedPath(info.entrypoint);
      setMode("split");
      setDrawingDoc(null);
      setDrawingPath(null);
      setPlantUmlPath(null);
      setMermaidPath(null);
      setMathJaxPath(null);
      setStatus(`${path} を作成しました`);
    } catch (e) {
      reportError(uiText("Create folder"), e);
    }
  };

  const runFileTask = async (
    operation: string,
    label: string,
    task: (snapshot: DocumentState, isCurrentSession: () => boolean) => Promise<void>,
  ) => {
    const snapshot = documentRef.current;
    if (!snapshot || fileTaskRef.current) return;
    const session = documentSessionRef.current;
    const isCurrentSession = () => session === documentSessionRef.current;
    fileTaskRef.current = true;
    setFileTask(label);
    try {
      await task(snapshot, isCurrentSession);
    } catch (e) {
      if (isCurrentSession()) {
        reportError(operation, e);
      }
    } finally {
      fileTaskRef.current = false;
      setFileTask(null);
    }
  };

  const finishSave = (snapshot: DocumentState, saved: DocumentState, historyWarning?: string) => {
    const current = documentRef.current;
    if (!current) return;
    const next = current === snapshot ? saved : applySavedBaseline(current, saved);
    savedDocumentRef.current = saved;
    applyDocumentState(withDocumentDirty(next));
    clearError(uiText("Save"));
    setStatus(`${saved.path} を保存しました`);
    if (historyWarning) {
      showNotification(uiText("The document was saved, but its edit history could not be saved."), "warning", { detail: historyWarning });
    }
  };

  const performSaveAs = () => runFileTask(uiText("Save"), uiText("Saving…"), async (snapshot, isCurrentSession) => {
    typingRef.current = null;
    const history = captureEditCheckpoint(snapshot, editHistoryRef.current);
    const result = await saveDialog({
      filters: [{ name: "Markdown パッケージ", extensions: ["mdpkg"] }],
      defaultPath: "document.mdpkg",
    });
    if (typeof result !== "string" || !isCurrentSession()) return;
    let historyWarning;
    const saved = await saveDocument({
      ...snapshot, path: result, origin: { kind: "package", path: result }, folderSnapshot: undefined,
    }, persistenceCommands, history, (warning) => { historyWarning = warning; });
    if (isCurrentSession()) {
      finishSave(snapshot, saved, historyWarning);
    }
  });

  const performSave = async () => {
    const current = documentRef.current;
    if (!current || folderConflictRef.current || fileTaskRef.current) return;
    if (current.origin.kind === "untitled") {
      await performSaveAs();
      return;
    }
    await runFileTask(uiText("Save"), uiText("Saving…"), async (snapshot, isCurrentSession) => {
      typingRef.current = null;
      try {
        const history = captureEditCheckpoint(snapshot, editHistoryRef.current);
        let historyWarning;
        const saved = await saveDocument(snapshot, persistenceCommands, history, (warning) => { historyWarning = warning; });
        if (isCurrentSession()) finishSave(snapshot, saved, historyWarning);
      } catch (reason) {
        if (snapshot.origin.kind === "folder" && isCurrentSession() && blocksFolderSave(reason)) setFolderConflict(true);
        throw reason;
      }
    });
  };

  const handleClearSavedEditHistory = () => runFileTask(uiText("Clear edit history…"), uiText("Clearing edit history…"), async (snapshot, isCurrentSession) => {
    if (snapshot.origin.kind === "untitled") return;
    const confirmed = await ask({
      title: uiText("Clear edit history…"),
      message: uiText("Delete this document’s saved and current edit history?"),
      confirmLabel: uiText("Delete"),
    });
    if (confirmed === null || !isCurrentSession()) return;
    const outcome = await clearSavedEditHistory(snapshot.origin.path, snapshot.origin.kind);
    if (!isCurrentSession() || !documentRef.current) return;
    editHistoryRef.current = createEditHistory();
    typingRef.current = null;
    applyDocumentState({ ...documentRef.current });
    setStatus(uiText("Edit history cleared."));
    if (outcome.reclaim_warning) {
      showNotification(uiText("Edit history was cleared, but disk space could not be reclaimed."), "warning", {
        detail: outcome.reclaim_warning,
      });
    }
  });

  const handleSave = async () => {
    if (!doc || folderConflictRef.current || fileTaskRef.current) return;
    if (String(doc.manifest.version ?? "").startsWith("1.")) {
      setV1MigrationOpen(true);
      return;
    }
    await performSave();
  };

  const handleReloadFolder = () => runFileTask(uiText("Reload folder"), uiText("Reloading folder…"), async (snapshot, isCurrentSession) => {
    if (snapshot.origin.kind !== "folder") return;
    if (snapshot.dirty) {
      if (!await confirmReplaceDirtyDocument(uiText("Discard unsaved changes and reload this folder?"))) return;
    } else if (editHistoryRef.current.entries.length > 0) {
      const response = await ask({
        title: uiText("Reload Folder..."),
        message: uiText("Discard edit history and reload this folder?"),
        confirmLabel: uiText("Discard and continue"),
      });
      if (response === null || documentRef.current !== snapshot) return;
    }
    const path = snapshot.origin.path;
    const info = await openFolder(path);
    if (!isCurrentSession()) return;
    if (documentRef.current !== snapshot) {
      setStatus(uiText("Reload canceled because the document was edited. Retry to discard the latest edits."));
      return;
    }
    replaceDocument(createFolderDocumentState(info, path));
    setSelectedPath(info.entrypoint);
    setMode("preview");
    setDrawingDoc(null);
    setDrawingPath(null);
    setPlantUmlPath(null);
    setMermaidPath(null);
    setMathJaxPath(null);
    setTableEdit(null);
    setStatus(`${path} を再読込しました`);
  });

  const handlePrint = async () => {
    if (printDialogRef.current) return;
    printDialogRef.current = true;
    let dispose: (() => void) | undefined;
    const preview = document.querySelector<HTMLElement>(".document-area .markdown-preview");
    if (preview && !supportsPrintPageMargins()) {
      try {
        const snapshot = preview.cloneNode(true) as HTMLElement;
        const { preparePaginatedPrint } = await import("./lib/preparePaginatedPrint");
        dispose = await preparePaginatedPrint(snapshot, printTitle);
      } catch (reason) {
        printDialogRef.current = false;
        reportError(uiText("Print"), reason);
        return;
      }
    }
    let jobTitle: string | null = null;
    try {
      jobTitle = await watchPrint(({ kind, detail }) => {
        reportError(uiText(kind === "monitoringFailed" ? "Print monitoring" : "Print"), detail);
      });
    } catch (reason) {
      reportError(uiText("Print monitoring"), reason);
    }
    const title = document.title;
    const taggedTitle = jobTitle ? `${jobTitle} — ${title}` : title;
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      window.removeEventListener("afterprint", restoreTitle);
      if (document.title === taggedTitle) document.title = title;
      if (jobTitle) {
        void closePrintPreview(jobTitle).catch((reason) => console.error("close_print_preview", reason));
      }
      dispose?.();
      printDialogRef.current = false;
    };
    if (jobTitle) {
      document.title = taggedTitle;
    }
    const macPreparedPrint = dispose && usesMacPreparedPrint();
    const waitForPrintEvent = !macPreparedPrint && (jobTitle || dispose);
    if (waitForPrintEvent) window.addEventListener("afterprint", restoreTitle);
    try {
      if (macPreparedPrint) await printPreparedPages(title);
      else await window.print();
    } catch (reason) {
      restoreTitle();
      reportError(uiText("Print"), reason);
    } finally {
      if (!waitForPrintEvent) restoreTitle();
    }
  };

  const handleNew = async () => {
    if (!await confirmReplaceDirtyDocument()) return;
    const approvedDocument = documentRef.current;
    const result = await saveDialog({
      filters: [{ name: "Markdown パッケージ", extensions: ["mdpkg"] }],
      defaultPath: "untitled.mdpkg",
    });
    if (typeof result === "string") {
      try {
        await createNewPackage(result);
        const info = await openPackage(result);
        if (documentRef.current !== approvedDocument && !await confirmReplaceDirtyDocument()) return;
        replaceDocument(createDocumentState(info, result));
        setSelectedPath(info.entrypoint);
        setMode("preview");
        setDrawingDoc(null);
        setDrawingPath(null);
        setPlantUmlPath(null);
        setMermaidPath(null);
        setStatus(`${result} を作成しました`);
      } catch (e) {
        reportError(uiText("Create package"), e);
      }
    }
  };

  const handleImport = async () => {
    if (!await confirmReplaceDirtyDocument()) return;
    const approvedDocument = documentRef.current;
    const folder = await openDialog({ directory: true });
    if (typeof folder === "string") {
      const dest = await saveDialog({
        filters: [{ name: "Markdown パッケージ", extensions: ["mdpkg"] }],
        defaultPath: "imported.mdpkg",
      });
      if (typeof dest === "string") {
        try {
          const sourceInfo = await openFolder(folder);
          if (documentRef.current !== approvedDocument && !await confirmReplaceDirtyDocument()) return;
          if (sourceInfo.manifest_generated) {
            setPendingInferredFolder({
              path: folder,
              info: sourceInfo,
              inference: inferManifest(sourceInfo.files),
              destination: dest,
            });
            clearError(uiText("Import folder"));
            setStatus(uiText("Review generated manifest"));
            return;
          }
          await importFolder(folder, dest);
          const info = await openPackage(dest);
          if (documentRef.current !== approvedDocument && !await confirmReplaceDirtyDocument()) return;
          replaceDocument(createDocumentState(info, dest));
          setSelectedPath(info.entrypoint);
          setMode("preview");
          setDrawingDoc(null);
          setDrawingPath(null);
          setPlantUmlPath(null);
          setMermaidPath(null);
          setStatus(`${folder} を取り込みました`);
        } catch (e) {
          reportError(uiText("Import folder"), e);
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
        setStatus(`${folder} に書き出しました`);
        clearError(uiText("Export folder"));
      } catch (e) {
        reportError(uiText("Export folder"), e);
      }
    }
  };

  const handleExportPackage = () => runFileTask(uiText("Export package"), uiText("Exporting package…"), async (snapshot, isCurrentSession) => {
    if (snapshot.origin.kind !== "folder") return;
    const result = await saveDialog({
      filters: [{ name: "Markdown パッケージ", extensions: ["mdpkg"] }],
      defaultPath: "document.mdpkg",
    });
    if (typeof result !== "string" || !isCurrentSession()) return;
    const path = result.toLowerCase().endsWith(".mdpkg") ? result : `${result}.mdpkg`;
    await exportFolderDocumentPackage(snapshot, path, persistenceCommands);
    if (isCurrentSession()) {
      setStatus(`${path} にパッケージを書き出しました`);
      clearError(uiText("Export package"));
    }
  });

  const handleEdit = () => {
    setMode("split");
  };

  const handleEditMarkdown = (path: string) => {
    setSelectedFolder(null);
    if (!/\.(md|markdown)$/i.test(path)) return;
    setAiDiagramEdit(null);
    setNavigationTarget(null);
    setSelectedPath(path);
    setMode("split");
  };

  const handleSelect = (path: string) => {
    setSelectedFolder(null);
    setAiDiagramEdit(null);
    setNavigationTarget(null);
    setTableEdit(null);
    setSelectedPath(path);
    if (path.endsWith(".draw.json")) {
      const file = doc?.files.find((f) => f.path === path);
      if (file?.content) {
        try {
          const parsed = parseDrawingFile(file.content);
          setDrawingDoc(parsed);
          clearError(uiText("Open drawing"));
          setDrawingPath(path);
          setPlantUmlPath(null);
          setMermaidPath(null);
          setMode("drawing");
          return;
        } catch (e) {
          reportError(uiText("Open drawing"), e);
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

  const recordTextEdit = (path: string, session: number, content: string, group?: TextEditGroup, label = path) => {
    const current = documentRef.current;
    if (!current || session !== documentSessionRef.current) return;
    const file = current.files.find((candidate) => candidate.path === path);
    if (!file?.is_text || file.content === content) return;
    const next = updateFileContent(current, path, content);
    if (file.content != null) {
      const history = editHistoryRef.current;
      const typing = typingRef.current;
      if (typing && typing.group === group && typing.path === path) {
        history.entries[history.cursor - 1] = textHistoryEntry(path, typing.before, content, typing.stale, next.staleResources);
      } else {
        typingRef.current = group ? { group, path, before: file.content, stale: current.staleResources } : null;
        recordEdit(history, textHistoryEntry(path, file.content, content, current.staleResources, next.staleResources, label));
      }
      applyDocumentState(withDocumentDirty(next));
    } else {
      setDoc(next);
    }
  };

  const handleSelectionChange = (selection: { from: number; to: number; text: string } | null) => {
    editorSelectionRef.current = selection;
    setEditorSelection(selection);
  };

  const handleAiSelection = (task: AiTaskKind) => {
    const selection = editorSelectionRef.current;
    if (!isSelectionValid(selection)) {
      reportError(uiText("AI action"), uiText("Select some text."));
      return;
    }
    const sel = selection as AiSelectionSnapshot;
    if (isEntirelyInsideCodeBlock(displayContent, sel.from, sel.to)) {
      reportError(uiText("AI action"), uiText("Select text outside a code block to use AI actions."));
      return;
    }
    clearError(uiText("AI action"));
    if (displayFile) setAiSelection({ task, snapshot: sel, path: displayFile.path, session: documentSessionRef.current });
  };

  const handleAiApply = (mode: "replace" | "insert", result: string, snapshot: AiSelectionSnapshot) => {
    const current = documentRef.current;
    if (!current || !aiSelection || aiSelection.session !== documentSessionRef.current) return;
    const file = current.files.find((f) => f.path === aiSelection.path);
    const applied = applyAiResult(file?.is_text ? file.content ?? "" : "", snapshot, result, mode);
    if (!applied.ok) {
      reportError(uiText("Apply AI result"), uiText("The document has changed since this AI request started. Please select the text again."));
      return;
    }
    recordTextEdit(aiSelection.path, aiSelection.session, applied.result.content, undefined, uiText("Apply AI result"));
    setAiSelection(null);
    setAiSelectionRunning(false);
    setStatus(`AI の結果を${mode === "replace" ? "置換" : "挿入"}しました`);
    clearError(uiText("Apply AI result"));
  };

  const insertionCursor = (file: FileInfo | undefined) =>
    file && file.path === selectedPath ? editorCursorsRef.current.get(file.path) ?? null : null;

  const handleInsertDrawing = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = insertionCursor(markdownFile);
    const baseDir = resourceDirectoryForMarkdown(markdownFile?.path ?? doc.entrypoint, DEFAULT_DRAWING_DIR);
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
    editorCursorsRef.current.set(markdownFile?.path ?? doc.entrypoint, insertedCursor);
    recordDocumentOperation(state, uiText("Insert Diagram"), { path: drawPath, mode: "drawing" });
    setDrawingDoc(empty);
    setDrawingPath(drawPath);
    setPlantUmlPath(null);
    setMermaidPath(null);
    setMode("drawing");
    setStatus(uiText("Inserted Drawing"));
  };

  const handleInsertPlantUml = async () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = insertionCursor(markdownFile);
    setStatus(uiText("Rendering PlantUML…"));
    try {
      const svg = await renderPlantUml(DEFAULT_PLANTUML_SOURCE);
      const added = addPlantUmlToDocument(doc, DEFAULT_PLANTUML_SOURCE, svg, "PlantUML", {
        baseDir: resourceDirectoryForMarkdown(markdownFile?.path ?? doc.entrypoint, "diagrams"),
        markdownPath: markdownFile?.path,
        cursor,
      });
      editorCursorsRef.current.set(markdownFile?.path ?? doc.entrypoint, added.cursor);
      setDoc(added.state);
      setSelectedPath(added.sourcePath);
      setPlantUmlPath(added.sourcePath);
      setMermaidPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("plantuml");
      setStatus(uiText("Inserted PlantUML"));
      clearError(uiText("Render PlantUML"));
    } catch (reason) {
      reportError(uiText("Render PlantUML"), reason);
    }
  };

  const editorSession = documentSessionRef.current;

  const handlePlantUmlSourceChange = useCallback((source: string) => {
    setDoc((current) => current && plantUmlPath
      ? updateFileContent(current, plantUmlPath, source)
      : current);
  }, [plantUmlPath]);

  const saveRenderedDiagram = useCallback((format: "plantuml" | "mermaid", path: string | null, source: string, svg: string) => {
    const current = documentRef.current;
    if (!current || !path || editorSession !== documentSessionRef.current ||
        current.files.find((file) => file.path === path)?.content !== source) return;
    const isPlantUml = format === "plantuml";
    const resource = (isPlantUml ? findPlantUmlResourceBySource : findMermaidResourceBySource)(current.manifest, path);
    if (!needsDiagramRender(current, resource?.rendered)) return;
    const operation = uiText(isPlantUml ? "Render PlantUML" : "Render Mermaid");
    try {
      setDoc((isPlantUml ? savePlantUmlToDocument : saveMermaidToDocument)(current, path, source, svg));
      setStatus(uiText(isPlantUml ? "PlantUML preview updated" : "Mermaid preview updated"));
    } catch (reason) {
      reportError(operation, reason);
    }
  }, [editorSession]);

  const handlePlantUmlRendered = useCallback((source: string, svg: string) => {
    saveRenderedDiagram("plantuml", plantUmlPath, source, svg);
  }, [plantUmlPath, saveRenderedDiagram]);

  const handleInsertMermaid = async () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = insertionCursor(markdownFile);
    setStatus(uiText("Rendering Mermaid…"));
    try {
      const svg = await renderMermaid(DEFAULT_MERMAID_SOURCE);
      const added = addMermaidToDocument(doc, DEFAULT_MERMAID_SOURCE, svg, "Mermaid", {
        baseDir: resourceDirectoryForMarkdown(markdownFile?.path ?? doc.entrypoint, "diagrams"),
        markdownPath: markdownFile?.path,
        cursor,
      });
      editorCursorsRef.current.set(markdownFile?.path ?? doc.entrypoint, added.cursor);
      setDoc(added.state);
      setSelectedPath(added.sourcePath);
      setMermaidPath(added.sourcePath);
      setPlantUmlPath(null);
      setDrawingDoc(null);
      setDrawingPath(null);
      setMode("mermaid");
      setStatus(uiText("Inserted Mermaid"));
      clearError(uiText("Render Mermaid"));
    } catch (reason) {
      reportError(uiText("Render Mermaid"), reason);
    }
  };

  const handleMermaidSourceChange = useCallback((source: string) => {
    setDoc((current) => current && mermaidPath
      ? updateFileContent(current, mermaidPath, source)
      : current);
  }, [mermaidPath]);

  const handleMermaidRendered = useCallback((source: string, svg: string) => {
    saveRenderedDiagram("mermaid", mermaidPath, source, svg);
  }, [mermaidPath, saveRenderedDiagram]);

  const handleAiDiagramEditApply = (updatedSource: string, svg: string, snapshot: { path: string; source: string }) => {
    const current = documentRef.current;
    if (!current || !aiDiagramEdit || aiDiagramEdit.session !== documentSessionRef.current) return;
    const currentPath = aiDiagramEdit.format === "plantuml" ? plantUmlPath : mermaidPath;
    const currentSource = current.files.find((file) => file.path === currentPath)?.content ?? "";
    const applied = applyDiagramEdit(currentPath ?? "", currentSource, snapshot, updatedSource);
    if (!applied.ok) {
      reportError(uiText("Apply AI diagram"), uiText("The diagram changed while AI generation was running. Run AI Generate again using the latest source."));
      return;
    }
    try {
      const saveDiagram = aiDiagramEdit.format === "plantuml" ? savePlantUmlToDocument : saveMermaidToDocument;
      recordDocumentOperation(saveDiagram(current, snapshot.path, applied.source, svg), uiText("Apply AI diagram"), {
        path: snapshot.path, mode: aiDiagramEdit.format,
      });
      setAiDiagramEdit(null);
      setStatus(uiText("AI-generated diagram applied"));
      clearError(uiText("Apply AI diagram"));
    } catch (reason) {
      reportError(uiText("Apply AI diagram"), reason);
    }
  };

  const handleInsertMathJax = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = insertionCursor(markdownFile);
    const placeholderSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"></svg>';
    const added = addMathJaxToDocument(doc, DEFAULT_MATHJAX_SOURCE, placeholderSvg, "MathJax", {
      baseDir: resourceDirectoryForMarkdown(markdownFile?.path ?? doc.entrypoint, "diagrams"),
      markdownPath: markdownFile?.path,
      cursor,
    });
    editorCursorsRef.current.set(markdownFile?.path ?? doc.entrypoint, added.cursor);
    setDoc(added.state);
    setSelectedPath(added.sourcePath);
    setMathJaxPath(added.sourcePath);
    setMermaidPath(null);
    setPlantUmlPath(null);
    setDrawingDoc(null);
    setDrawingPath(null);
    setMode("mathjax");
    setStatus(uiText("Inserted MathJax"));
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
    setStatus(uiText("MathJax preview updated"));
  }, [mathJaxPath]);

  const addImportedImages = (images: ImportedImage[]) => {
    if (!doc || images.length === 0) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    const cursor = insertionCursor(markdownFile);
    let next = doc;
    const addedPaths: string[] = [];
    for (const image of images) {
      const added = addImage(next, image.file_name, image.base64, markdownFile?.path ?? doc.entrypoint);
      next = added.state;
      addedPaths.push(added.path);
    }
    if (markdownFile?.content !== null && markdownFile?.content !== undefined) {
      const inserted = insertMarkdownImages(markdownFile.content, cursor, markdownFile.path, addedPaths);
      next = updateFileContent(next, markdownFile.path, inserted.content);
      editorCursorsRef.current.set(markdownFile.path, inserted.cursor);
    }
    setDoc(next);
    setSelectedPath(markdownFile?.path ?? addedPaths[addedPaths.length - 1] ?? null);
    setStatus(`画像を ${images.length} 件追加しました`);
    clearError(uiText("Add images"));
  };

  const handleAddImage = async () => {
    if (!doc) return;
    const result = await openDialog({
      multiple: true,
      filters: [
        { name: "画像", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      ],
    });
    const paths = Array.isArray(result) ? result : typeof result === "string" ? [result] : [];
    if (paths.length === 0) return;
    try {
      addImportedImages(await Promise.all(paths.map(readImage)));
    } catch (e) {
      reportError(uiText("Add images"), e);
    }
  };

  const addImportedAttachments = (attachments: ImportedFile[], markdownPath: string, useCursor: boolean) => {
    const current = documentRef.current;
    if (!current || attachments.length === 0) return;
    const markdownFile = current.files.find((file) => file.path === markdownPath && file.is_text);
    if (markdownFile?.content == null) {
      reportError(uiText("Add attachments"), uiText("The attachment target is no longer available."));
      return;
    }
    const cursor = useCursor ? editorCursorsRef.current.get(markdownPath) ?? null : null;
    let next = current;
    const addedPaths: string[] = [];
    for (const attachment of attachments) {
      const payload = reuseAttachmentPayload(editHistoryRef.current, attachment.base64);
      const added = addAttachment(next, attachment.file_name, payload, markdownPath);
      next = added.state;
      addedPaths.push(added.path);
    }
    const inserted = insertMarkdownLinks(markdownFile.content, cursor, markdownPath, addedPaths);
    next = updateFileContent(next, markdownPath, inserted.content);
    editorCursorsRef.current.set(markdownPath, inserted.cursor);
    recordDocumentOperation(next, uiText("Add attachments"));
    setSelectedPath(markdownPath);
    setStatus(`添付ファイルを ${attachments.length} 件追加しました`);
    clearError(uiText("Add attachments"));
  };

  const handleAddAttachment = async () => {
    if (!doc) return;
    const session = documentSessionRef.current;
    const target = selectedFile?.is_text && isMarkdownPath(selectedFile.path) ? selectedFile.path : doc.entrypoint;
    const useCursor = target === selectedPath;
    try {
      const result = await openDialog({ multiple: true });
      const paths = Array.isArray(result) ? result : typeof result === "string" ? [result] : [];
      if (paths.length === 0 || session !== documentSessionRef.current) return;
      const attachments = await Promise.all(paths.map(readAttachment));
      if (session === documentSessionRef.current) addImportedAttachments(attachments, target, useCursor);
    } catch (e) {
      if (session === documentSessionRef.current) reportError(uiText("Add attachments"), e);
    }
  };

  const handleDownloadAttachment = async (file: FileInfo) => {
    const notify = (event: AttachmentDownloadEvent, fileName: string) => {
      if (event === "started") {
        showNotification(`${fileName} のダウンロードを開始しました`, "info");
      } else if (event === "completed") {
        showNotification(`${fileName} のダウンロードが完了しました`, "success");
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
      if (saved) {
        setStatus(`${file.path} を保存しました`);
        clearError(uiText("Download attachment"));
      }
    } catch (e) {
      reportError(uiText("Download attachment"), e);
    }
  };

  const handleInsertTable = () => {
    if (!doc) return;
    const markdownFile = selectedFile?.is_text && selectedFile.path.match(/\.(md|markdown)$/i)
      ? selectedFile
      : entrypointFile;
    if (!markdownFile || markdownFile.content === null) return;
    const cursor = insertionCursor(markdownFile);
    const inserted = insertMarkdownBlock(markdownFile.content, cursor, EMPTY_2X2_MARKDOWN_TABLE);
    editorCursorsRef.current.set(markdownFile.path, inserted.cursor);
    recordTextEdit(markdownFile.path, documentSessionRef.current, inserted.content, undefined, uiText("Insert Table"));
    setSelectedPath(markdownFile.path);
    setTableEdit(null);
    setMode("split");
    setStatus(uiText("Inserted 2 × 2 table"));
  };

  const importDroppedImages = async <T,>(items: T[], name: (item: T) => string, read: (item: T) => Promise<ImportedImage>) => {
    if (!doc) return;
    const session = documentSessionRef.current;
    const supported = items.filter((item) => isSupportedImageName(name(item)));
    const excluded = items.filter((item) => !isSupportedImageName(name(item))).map(name);
    const results = await Promise.allSettled(supported.map(read));
    if (documentSessionRef.current !== session) return;
    const images: ImportedImage[] = [];
    const failed: Array<{ fileName: string; detail: string }> = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") images.push(result.value);
      else failed.push({ fileName: name(supported[index]), detail: errorDetail(result.reason) });
    });
    if (images.length) nativeImportImagesRef.current(images);
    const message = [
      `取り込み ${images.length} 件${images.length ? ": " + images.map((image) => image.file_name).join("、") : ""}`,
      excluded.length ? `除外 ${excluded.length} 件（非対応形式）: ${excluded.join("、")}` : "",
      failed.length ? `失敗 ${failed.length} 件: ${failed.map(({ fileName }) => fileName).join("、")}。ファイルを読み直してください` : "",
    ].filter(Boolean).join("。");
    const detail = failed.map(({ fileName, detail }) => `${fileName}\n${detail}`).join("\n\n");
    showNotification(message, excluded.length || failed.length ? "warning" : "success", { detail });
  };
  const handleDropImages = (files: File[]) => importDroppedImages(files, (file) => file.name, droppedFileToImage);

  nativeImportImagesRef.current = addImportedImages;
  nativeDropRef.current = (paths, action) => {
    if (paths.length === 0) return;
    if (action === "folder" || action === "package") {
      void openDocument(paths[0], action);
      return;
    }
    if (action === "images" || (doc && (paths.some(isSupportedImageName) || paths.every((path) => /\.(svg|heic|heif|tiff?|avif|ico|pdf)$/i.test(path))))) {
      void importDroppedImages(paths, (path) => path.split(/[\\/]/).pop() ?? path, readImage);
    } else if (paths.length === 1) {
      void openDocument(paths[0], /\.mdpkg$/i.test(paths[0]) ? "package" : "folder");
    } else {
      showNotification(`パッケージまたはフォルダは1件ずつ開いてください。除外: ${paths.map((path) => path.split(/[\\/]/).pop()).join("、")}`, "warning");
    }
  };

  const isRenameablePath = (path: string | null) => path !== null && (
    doc?.files.some((file) => file.path === path) === true ||
    doc?.directories?.includes(path) === true
  );
  const handleRename = async (path: string | null = selectedPath) => {
    if (!doc || !path || !isRenameablePath(path)) return;
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const snapshot = doc;
    const extension = doc.files.some((file) => file.path === path) && fileName.lastIndexOf(".") > 0
      ? fileName.match(/(\.draw\.json|\.[^.]+)$/i)?.[0] ?? "" : "";
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const requested = await ask({
      title: `${fileName} の名前を変更`, initialValue: extension ? fileName.slice(0, -extension.length) : fileName,
      label: uiText("Name"), suffix: extension, confirmLabel: uiText("Rename"),
      validate: (value) => nameError(value) ?? newPathError(parentPath + value + extension, path),
    });
    if (documentRef.current !== snapshot) return;
    const renamedName = requested === null ? null : requested + extension;
    if (renamedName === null || renamedName === fileName) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const destination = parent ? `${parent}/${renamedName}` : renamedName;
    try {
      const renamed = movePath(doc, path, destination);
      recordDocumentOperation(renamed, `${path} の名前変更`);
      setSelectedFolder((current) => current === path ? destination : current?.startsWith(path + "/") ? destination + current.slice(path.length) : current);
      setSelectedPath(destination);
      setMode("preview");
      setStatus(`${destination} に名前を変更し、Markdown のリンクを更新しました`);
      clearError(uiText("Rename"));
    } catch (e) {
      reportError(uiText("Rename"), e);
    }
  };

  const applyMove = (path: string, destination: string) => {
    if (!doc) return;
    if (destination === path) return;
    try {
      const move = planPathMove(doc, path, destination);
      const moved = applyPathMove(doc, move);
      const mapPath = (current: string | null) => current === path
        ? destination
        : current?.startsWith(`${path}/`) ? `${destination}${current.slice(path.length)}` : current;
      const entry = recordDocumentOperation(moved, `${path} の移動`);
      setSelectedFolder((current) => mapPath(current));
      setSelectedPath((current) => mapPath(current));
      setDrawingPath((current) => mapPath(current));
      setPlantUmlPath((current) => mapPath(current));
      setMermaidPath((current) => mapPath(current));
      setMathJaxPath((current) => mapPath(current));
      setStatus(`${destination} に移動し、Markdown のリンクを更新しました`); clearError(uiText("Move"));
      showNotification(`${path} を ${destination} に移動しました。Markdown のリンクも更新しました。`, "success", {
        action: {
          label: "元に戻す",
          onClick: () => {
            if (entry) applyEditHistory("undo", entry);
          },
        },
      });
    } catch (reason) { reportError(uiText("Move"), reason); }
  };

  const handleDropMove = async (path: string, destination: string) => {
    if (!doc || path === destination) return;
    const snapshot = doc;
    const count = doc.files.filter((file) => file.path === path || file.path.startsWith(path + "/")).length;
    if (!destination.includes("/") || count > 1) {
      const answer = await ask({ title: "移動を確認", confirmLabel: "移動",
        message: `${path} を ${destination} に移動します（${count} ファイル）。Markdown のリンクも更新します。` });
      if (answer === null || documentRef.current !== snapshot) return;
    }
    applyMove(path, destination);
  };

  const handleMove = async (path: string) => {
    if (!doc) return;
    const snapshot = doc;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const folders = [...new Set(["", "images", "attachments", ...doc.directories ?? []])]
      .filter((folder) => folder !== path && !folder.startsWith(path + "/"));
    const targetPath = (folder: string) => folder ? `${folder}/${name}` : name;
    const folder = await ask({
      title: `${name} を移動`, label: uiText("Destination folder"), initialValue: parent,
      message: "移動先を選んで確定してください。フォルダ内のファイルと Markdown のリンクも更新します。",
      folderPaths: folders,
      confirmLabel: uiText("Move"),
      validate: (folder) => targetPath(folder) === path ? uiText("Choose another folder.") : newPathError(targetPath(folder), path),
    });
    if (folder !== null && documentRef.current === snapshot) applyMove(path, targetPath(folder));
  };

  const contextDirectory = (contextPath?: string): string => {
    if (!doc || !contextPath) return "";
    const isDirectory = ["images", "attachments"].includes(contextPath) || doc.directories?.includes(contextPath) === true ||
      (!doc.files.some((file) => file.path === contextPath) &&
        doc.files.some((file) => file.path.startsWith(`${contextPath}/`)));
    if (isDirectory) return contextPath;
    return contextPath.includes("/") ? contextPath.slice(0, contextPath.lastIndexOf("/")) : "";
  };

  const addTreeItem = (kind: TreeAddKind, requested: string): string | null => {
    const current = documentRef.current;
    if (!current) return null;
    const operation = uiText(kind === "markdown" ? "Add Markdown" : "Add folder");
    try {
      const path = validateNewPackagePath(requested);
      if (kind === "markdown") {
        const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
        setDoc(addMarkdown(current, path, `# ${name}\n`));
        setSelectedFolder(null);
        setSelectedPath(path);
        setMode("split");
        setStatus(`${path} を追加しました`);
      } else {
        setDoc(addDirectory(current, path));
        setStatus(`${path} を追加しました。空のフォルダは保存されません`);
      }
      clearError(operation);
      return path;
    } catch (reason) {
      reportError(operation, reason);
      return null;
    }
  };

  const validateTreeItem = (kind: TreeAddKind, path: string): string | null =>
    newPathError(path) ?? (kind === "markdown" && !/\.(md|markdown)$/i.test(path) ? uiText("Use .md or .markdown.") : null);

  const handleInlineAdd = (kind: TreeAddKind, directory: string, name: string): string | null => {
    const requested = directory ? `${directory}/${name}` : name;
    const error = nameError(name) ?? validateTreeItem(kind, requested);
    if (error) return error;
    const path = addTreeItem(kind, requested);
    if (!path) return uiText("The item could not be added.");
    if (kind === "folder") setSelectedFolder(path);
    return null;
  };

  const handleAdd = async (kind: TreeAddKind) => {
    if (!doc) return;
    const directory = contextDirectory(selectedFolder ?? selectedPath ?? undefined);
    const snapshot = doc;
    const folder = kind === "folder";
    const title = uiText(folder ? "Add folder" : "Add Markdown");
    const requested = await ask({
      title, label: uiText("Package path"),
      initialValue: `${directory ? `${directory}/` : ""}${folder ? "folder" : "untitled.md"}`,
      message: folder ? uiText("Empty folders are not saved. Add a file inside the folder to keep it when reopening the document.") : undefined,
      confirmLabel: folder ? title : uiText("Add"), validate: (path) => validateTreeItem(kind, path),
    });
    if (requested && documentRef.current === snapshot) addTreeItem(kind, requested);
  };

  const handleDelete = async (path: string | null = selectedPath) => {
    if (!doc || !path) return;
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const references = pathReferenceCount(doc, path);
    const snapshot = doc;
    const answer = await ask({
      title: `${fileName} を削除しますか？`, confirmLabel: uiText("Delete"),
      message: `Markdown 内の参照が ${references} 件残ります。ファイルメニューの「ファイル操作を元に戻す」で取り消せます。`,
    });
    if (answer === null || documentRef.current !== snapshot) return;
    try {
      const next = deletePath(doc, path);
      recordDocumentOperation(next, `${path} の削除`);
      setSelectedFolder(null);
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
      setStatus(`${fileName} を削除しました。Markdown のリンクは残っています`);
      clearError(uiText("Delete"));
    } catch (e) {
      reportError(uiText("Delete"), e);
    }
  };

  const handleDrawingChange = (next: DrawingDocument) => {
    if (editorSession === documentSessionRef.current) setDrawingDoc(next);
  };

  const handleDrawingDirty = (next: DrawingDocument) => {
    const current = documentRef.current;
    if (!current || !drawingPath || editorSession !== documentSessionRef.current) return;
    const source = current.files.find((file) => file.path === drawingPath)?.content;
    if (!source) return;
    try {
      recordDocumentOperation(saveDrawingToDocument(current, drawingPath, next), uiText("Edit drawing"), {
        path: drawingPath, mode: "drawing",
      });
      clearError(uiText("Edit drawing"));
    } catch (reason) {
      setDrawingDoc(parseDrawingFile(source));
      reportError(uiText("Edit drawing"), reason);
    }
  };

  const handleDrawingImageRequest = async (): Promise<string | null> => {
    const result = await openDialog({
      filters: [
        { name: "画像", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      ],
    });
    if (typeof result !== "string") return null;
    try {
      const image = await readImage(result);
      setStatus(`${image.file_name} を図に追加しました`);
      clearError(uiText("Add image to drawing"));
      return importedImageDataUrl(image);
    } catch (e) {
      reportError(uiText("Add image to drawing"), e);
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
      clearError(uiText("Open drawing"));
      setDrawingPath(drawPath);
      setMode("drawing");
      setSelectedPath(drawPath);
    } catch (e) {
      reportError(uiText("Open drawing"), e);
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
    const content = documentRef.current?.files.find((file) => file.path === path)?.content;
    if (content == null || start >= end || end > content.length) return;
    setSelectedPath(path);
    setTableEdit({ path, start, end, content });
    setMode("table");
  };

  const closeTableEditor = () => {
    clearError(uiText("Edit table"));
    setTableEdit(null);
    setMode("split");
  };

  const handleTableDone = (markdown: string) => {
    const current = documentRef.current;
    if (!current || !tableEdit) return;
    const { path, start, end, content } = tableEdit;
    const file = current.files.find((candidate) => candidate.path === path);
    if (file?.content !== content) {
      reportError(uiText("Edit table"), uiText("The source file changed. Cancel this draft and reopen the table to edit the latest version."));
      return;
    }
    const next = content.slice(0, start) + markdown + content.slice(end);
    recordTextEdit(path, documentSessionRef.current, next, undefined, uiText("Edit table"));
    closeTableEditor();
  };

  const navigateToSearchResult = (path: string, offset: number, length = 0) => {
    setSelectedFolder(null);
    const editable = doc?.files.find((file) => file.path === path)?.is_text;
    setNavigationTarget(editable ? { path, offset, length } : null);
    setSelectedPath(path);
    setMode(editable ? "split" : "preview");
  };

  const handleValidatePackage = () => {
    const current = documentRef.current;
    if (current) { setPackageSearchOpen(false); setPackageDiagnostics(diagnosePackage(current)); }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const direction = historyShortcut(event);
      const target = event.target instanceof Element ? event.target : null;
      if (direction && doc && mode !== "table" &&
          !target?.closest("input, textarea, select, [contenteditable], [role=dialog]") &&
          !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        event.preventDefault();
        applyEditHistory(direction);
        return;
      }
      if (isPackageSearchShortcut(event) && doc) {
        event.preventDefault();
        setPackageDiagnostics(null);
        setPackageSearchOpen(true);
      } else if (isSaveShortcut(event)) {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc, mode]);

  const displayFile = selectedFile ?? entrypointFile;
  const printTitle = doc ? `${documentName} — ${displayFile?.path ?? ""}` : "MaCa Editor";
  useEffect(() => {
    document.documentElement.style.setProperty("--print-title", JSON.stringify(printTitle.replace(/[\r\n\f]/g, " ")));
    return () => { document.documentElement.style.removeProperty("--print-title"); };
  }, [printTitle]);
  const displayContent = displayFile?.is_text ? displayFile.content ?? "" : "";
  const displayIsMarkdown = displayFile ? isMarkdownPath(displayFile.path) : false;
  const displayPreviewUnavailable = /\.(pdf|zip)$/i.test(displayFile?.path ?? "");
  const navigation = navigationTarget?.path === displayFile?.path ? navigationTarget ?? undefined : undefined;
  const editorScrollTop = displayFile ? editorScrollTopsRef.current.get(displayFile.path) : undefined;
  const liveDiagnosticPath = mode === "split" && displayIsMarkdown ? displayFile?.path : undefined;
  const diagnosticsOpen = packageDiagnostics !== null;
  useEffect(() => {
    if (!doc) return;
    const diagnose = diagnosticsOpen ? () => diagnosePackage(doc)
      : liveDiagnosticPath ? () => diagnoseRelatedMarkdown(doc, liveDiagnosticPath) : null;
    if (!diagnose) return;
    const timer = window.setTimeout(() => setLiveDiagnostics({
      document: doc,
      wholePackage: diagnosticsOpen,
      diagnostics: diagnose(),
    }), 300);
    return () => window.clearTimeout(timer);
  }, [doc, diagnosticsOpen, liveDiagnosticPath]);
  useEffect(() => {
    if (diagnosticsOpen && liveDiagnostics?.wholePackage && liveDiagnostics.document === doc) {
      setPackageDiagnostics(liveDiagnostics.diagnostics);
    }
  }, [doc, liveDiagnostics, diagnosticsOpen]);

  const currentDiagnostics = liveDiagnostics?.document === doc ? liveDiagnostics?.diagnostics : undefined;
  const diagnosticRanges = useMemo(() => (currentDiagnostics ?? [])
    .filter((item) => item.path === displayFile?.path && item.offset !== undefined &&
      ["missing-link", "outside-package-link", "link-case-mismatch"].includes(item.code))
    .map((item) => ({ from: item.offset!, to: item.offset! + (item.target?.length ?? 1) })),
  [currentDiagnostics, displayFile?.path]);
  const displayBaseDir = selectedFile
    ? selectedFile.path.includes("/")
      ? selectedFile.path.slice(0, selectedFile.path.lastIndexOf("/"))
      : ""
    : entrypointDir();

  const handlePackagePathDrop = (path: string, position: number) => {
    if (!doc || !displayFile || !displayIsMarkdown || displayFile.content === null) return;
    try {
      const link = packageFileMarkdownLink(displayFile.path, path, doc.files, doc.manifest);
      const inserted = insertMarkdownBlock(displayFile.content, position, link);
      recordTextEdit(displayFile.path, editorSession, inserted.content, undefined, uiText("Insert link"));
      editorCursorsRef.current.set(displayFile.path, inserted.cursor);
      setStatus(`${path} へのリンクを挿入しました`);
      clearError(uiText("Insert link"));
    } catch (reason) {
      reportError(uiText("Insert link"), reason);
    }
  };

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

  const aiDisabledReason = !displayIsMarkdown ? uiText("Open a Markdown file to use selection actions.")
    : mode !== "split" ? uiText("Open the split editor to use selection actions.")
    : aiSelectionRunning ? uiText("Wait for the current AI request to finish.")
    : !isSelectionValid(editorSelection) ? uiText("Select text in the editor to use selection actions.")
    : isEntirelyInsideCodeBlock(displayContent, editorSelection!.from, editorSelection!.to)
      ? uiText("Select text outside a code block to use AI actions.") : undefined;

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
        onSaveAs={performSaveAs}
        fileTaskInProgress={fileTask !== null}
        folderConflict={folderConflict}
        onPrint={handlePrint}
        onNew={handleNew}
        onImport={handleImport}
        onExport={handleExport}
        onExportPackage={handleExportPackage}
        onValidatePackage={handleValidatePackage}
        onUndoFileOperation={() => applyEditHistory("undo")}
        onRedoFileOperation={() => applyEditHistory("redo")}
        onClearEditHistory={handleClearSavedEditHistory}
        onShowSavedEditHistories={() => setSavedEditHistoriesOpen(true)}
        canUndoFileOperation={mode !== "table" && editHistoryRef.current.cursor > 0}
        canRedoFileOperation={mode !== "table" && editHistoryRef.current.cursor < editHistoryRef.current.entries.length}
        onEditManifest={() => setManifestEditorOpen(true)}
        onSearchPackage={() => { setPackageDiagnostics(null); setPackageSearchOpen(true); }}
        onAddMarkdown={() => void handleAdd("markdown")}
        onAddFolder={() => void handleAdd("folder")}
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
        aiSelectionEnabled={!aiDisabledReason}
        aiDisabledReason={aiDisabledReason}
        onShortcuts={() => setShortcutsOpen(true)}
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
      {folderConflict && (
        <div className="folder-conflict">
          <span role="alert">{uiText("The folder changed on disk or needs recovery. Saving to this folder is blocked.")}</span>
          <button type="button" disabled={fileTask !== null} onClick={handleExportPackage}>{uiText("Export Package...")}</button>
          <button type="button" disabled={fileTask !== null} onClick={handleReloadFolder}>{uiText("Reload Folder...")}</button>
        </div>
      )}
      <div className="main-layout">
        {(fileListOpen || mode === "drawing") && (
          <aside style={{ width: `min(${sidebarWidth}px, 45vw)`, flexShrink: 0 }} className={`sidebar ${mode === "drawing" ? "sidebar-with-properties" : ""}`}>
            {fileListOpen && (
              <div className="sidebar-tree">
                <FileTree
                  key={editorSession}
                  files={doc?.files ?? []}
                  manifest={doc?.manifest}
                  directories={doc?.directories}
                  selectedPath={selectedFolder ?? selectedPath}
                  onSelect={handleSelect}
                  onSelectFolder={setSelectedFolder}
                  collapsedPaths={treeCollapsed}
                  onCollapsedPathsChange={setTreeCollapsed}
                  onEditMarkdown={handleEditMarkdown}
                  onDropImages={handleDropImages}
                  imageDropDirectory={resourceDirectoryForMarkdown(
                    selectedFile && /\.(md|markdown)$/i.test(selectedFile.path) ? selectedFile.path : doc?.entrypoint ?? "index.md",
                    "images",
                  )}
                  canRename={isRenameablePath}
                  onRename={handleRename}
                  canDelete={(path) => doc !== null && !(doc.entrypoint === path || doc.entrypoint.startsWith(`${path}/`))}
                  onDelete={handleDelete}
                  canMove={isRenameablePath}
                  onMove={handleMove}
                  canSetEntrypoint={(path) => path !== doc?.entrypoint && /\.(md|markdown)$/i.test(path)}
                  onSetEntrypoint={(path) => {
                    if (!doc) return;
                    try { recordDocumentOperation(setEntrypoint(doc, path), `${path} の開始ファイルへの設定`); setStatus(`開始ファイルを ${path} に設定しました`); clearError(uiText("Set entrypoint")); }
                    catch (reason) { reportError(uiText("Set entrypoint"), reason); }
                  }}
                  onAdd={doc ? handleInlineAdd : undefined}
                  onDropPath={handleDropMove}
                  onShowReferences={setBacklinksTarget}
                />
              </div>
            )}
            {mode === "drawing" && (
              <div id="drawing-properties-panel" className="sidebar-properties" />
            )}
          </aside>
        )}
        {(fileListOpen || mode === "drawing") && <ResizeHandle label="サイドバーの幅" value={sidebarWidth} min={120} max={480} initial={240} onChange={setSidebarWidth} />}
        <main
          ref={documentAreaRef}
          className={`document-area ${mode === "split" ? "document-area-editor" : ""}`}
          onScroll={handleDocumentAreaScroll}
        >
          <Suspense fallback={<div className="empty-state">{uiText("Loading…")}</div>}>
          {!doc && (
            <div className="empty-state">
              <h2>MaCa Editor</h2>
              <p>{uiText("Create a document, open a package, or open a folder to start editing.")}</p>
              <div className="empty-state-actions">
                <button type="button" onClick={handleNew}>{uiText("New")}</button>
                <button type="button" onClick={() => handleOpen(true)}>{uiText("Open")}</button>
                <button type="button" onClick={handleOpenFolder}>{uiText("Open Folder...")}</button>
              </div>
              <p>{uiText("Drop one .mdpkg file or folder anywhere in the window to open it.")}</p>
              {recentDocuments.length > 0 && <section className="recent-documents">
                <h3>{uiText("Recent documents")}</h3>
                <ul>{recentDocuments.map((recent) => <li key={recent.kind + recent.path}>
                  <button type="button" onClick={() => openDocument(recent.path, recent.kind)} title={recent.path}>
                    {recent.path}
                  </button>
                </li>)}</ul>
              </section>}
            </div>
          )}
          {doc && mode === "drawing" && drawingDoc && drawingPath && preferencesLoaded && (
            <DrawingEditor
              key={`${editorSession}:${drawingPath}`}
              translate={uiText}
              doc={drawingDoc}
              onChange={handleDrawingChange}
              onDirty={handleDrawingDirty}
              onHistory={applyEditHistory}
              onRequestImage={handleDrawingImageRequest}
              propertiesPanelId="drawing-properties-panel"
              preferences={drawingPreferences}
              onPreferencesChange={setDrawingPreferences}
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
                renderPending={needsDiagramRender(doc, resource?.rendered)}
                onSourceChange={handlePlantUmlSourceChange}
                onRendered={handlePlantUmlRendered}
                vimMode={vimMode}
                onSave={handleSave}
                onAiEdit={() => setAiDiagramEdit({ format: "plantuml", path: plantUmlPath, session: editorSession })}
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
                renderPending={needsDiagramRender(doc, resource?.rendered)}
                onSourceChange={handleMermaidSourceChange}
                onRendered={handleMermaidRendered}
                vimMode={vimMode}
                onSave={handleSave}
                onAiEdit={() => setAiDiagramEdit({ format: "mermaid", path: mermaidPath, session: editorSession })}
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
          {doc && mode === "table" && tableEdit && (
            <MarkdownTableEditor
              key={`${tableEdit.path}:${tableEdit.start}`}
              source={tableEdit.content.slice(tableEdit.start, tableEdit.end)}
              onDone={handleTableDone}
              onCancel={closeTableEditor}
            />
          )}
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
                    onNavigateMarkdown={(path) => { setSelectedPath(path); setMode("preview"); }}
                  />
                  <button className="edit-btn" onClick={handleEdit}>
                    {uiText("Edit")}</button>
                </div>
              )}
              {mode === "split" && (
                <SynchronizedScrollView ratio={splitRatio} onRatioChange={setSplitRatio}>
                  <MarkdownEditor
                    key={`${editorSession}:${displayFile.path}`}
                    value={displayContent}
                    onChange={(content, group) => recordTextEdit(displayFile.path, editorSession, content, group)}
                    onHistory={applyEditHistory}
                    onCursorChange={(position) => {
                      if (editorSession === documentSessionRef.current) editorCursorsRef.current.set(displayFile.path, position);
                    }}
                    initialCursorPosition={editorCursorsRef.current.get(displayFile.path)}
                    initialScrollTop={editorScrollTop}
                    onScrollTopChange={(top) => {
                      if (editorSession === documentSessionRef.current) editorScrollTopsRef.current.set(displayFile.path, top);
                    }}
                    navigation={navigation}
                    onNavigationComplete={() => setNavigationTarget(null)}
                    diagnosticRanges={diagnosticRanges}
                    onSelectionChange={handleSelectionChange}
                    onAiSelection={handleAiSelection}
                    vimMode={vimMode}
                    onSave={handleSave}
                    onPackagePathDrop={handlePackagePathDrop}
                    onMarkdownLinkOpen={(destination) => {
                      const target = resolveMarkdownLink(displayFile.path, destination, doc.files);
                      if (target && isMarkdownPath(target)) {
                        setSelectedPath(target);
                        setMode("split");
                      }
                    }}
                  />
                  <MarkdownPreview
                    markdown={displayContent}
                    scrollRestoreKey={`${editorSession}:${displayFile.path}`}
                    restoreScroll={editorScrollTop === undefined && !navigation}
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
                    onNavigateMarkdown={(path) => { setSelectedPath(path); setMode("preview"); }}
                  />
                </SynchronizedScrollView>
              )}
            </>
          )}
          {doc && mode !== "drawing" && mode !== "plantuml" && mode !== "mermaid" && mode !== "mathjax" && mode !== "table" && displayFile && !displayFile.is_text && (
            <div className="binary-view">
              {displayPreviewUnavailable ? (
                <p>{uiText("This file cannot be previewed.")}</p>
              ) : displayFile.base64 && (
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
      {packageDiagnostics && doc && (
        <PackageDiagnosticsDialog
          diagnostics={packageDiagnostics}
          onNavigate={(path, line, offset) => {
            const file = doc.files.find((item) => item.path === path);
            if (file) {
              const position = offset ?? (file.content ?? "").split("\n").slice(0, Math.max(0, (line ?? 1) - 1)).reduce((sum, text) => sum + text.length + 1, 0);
              navigateToSearchResult(path, position, 1);
            } else if (path === "manifest.json") setManifestEditorOpen(true);
          }}
          onClose={() => setPackageDiagnostics(null)}
        />
      )}
      {backlinksTarget && doc && (
        <BacklinksDialog
          target={backlinksTarget}
          backlinks={findBacklinks(backlinksTarget, doc.files)}
          onNavigate={(path, offset) => {
            navigateToSearchResult(path, offset);
            setBacklinksTarget(null);
          }}
          onClose={() => setBacklinksTarget(null)}
        />
      )}
      {manifestEditorOpen && doc && (
        <ManifestEditorDialog manifest={doc.manifest} files={doc.files.map((file) => file.path)}
          onSave={(values) => {
            try {
              recordDocumentOperation(updateManifestMetadata(doc, values), "edit manifest");
              setManifestEditorOpen(false); setStatus(uiText("Manifest updated")); clearError(uiText("Edit manifest"));
            } catch (reason) { reportError(uiText("Edit manifest"), reason); }
          }}
          onClose={() => setManifestEditorOpen(false)} />
      )}
      {pendingInferredFolder && (
        <InferredManifestDialog
          files={pendingInferredFolder.info.files.map((file) => file.path)}
          manifest={pendingInferredFolder.inference.manifest}
          warnings={pendingInferredFolder.inference.warnings}
          confirmLabel={pendingInferredFolder.destination ? uiText("Create Package") : uiText("Open Folder")}
          onConfirm={(manifest) => {
            const pending = pendingInferredFolder;
            void (async () => {
              try {
                if (pending.destination) {
                  await savePackage({ path: pending.destination, manifest, files: pending.info.files });
                  const imported = await openPackage(pending.destination);
                  replaceDocument(createDocumentState(imported, pending.destination));
                  setStatus(`${pending.path} を取り込みました`);
                } else {
                  const generatedInfo = { ...pending.info, manifest, entrypoint: manifest.entrypoint };
                  const next = createFolderDocumentState(generatedInfo, pending.path);
                  replaceDocument({ ...next, dirty: true, folderSnapshot: folderInfoFingerprint(pending.info) });
                  setStatus(`${pending.path} を開きました。保存時に manifest.json を作成します`);
                }
                setSelectedPath(manifest.entrypoint);
                setMode("preview");
                setDrawingDoc(null);
                setDrawingPath(null);
                setPlantUmlPath(null);
                setMermaidPath(null);
                setMathJaxPath(null);
                setPendingInferredFolder(null);
              } catch (reason) {
                reportError(pending.destination ? uiText("Import folder") : uiText("Open folder"), reason);
              }
            })();
          }}
          onCancel={() => {
            setPendingInferredFolder(null);
            setStatus(uiText("Open folder cancelled"));
          }}
        />
      )}
      {v1MigrationOpen && doc && (
        <V1MigrationDialog entrypoint={doc.entrypoint}
          onOverwrite={() => { setV1MigrationOpen(false); void performSave(); }}
          onSaveAs={() => { setV1MigrationOpen(false); void performSaveAs(); }}
          onCancel={() => setV1MigrationOpen(false)} />
      )}
      {packageSearchOpen && doc && (
        <PackageSearchDialog files={doc.files}
          onNavigate={(path, offset, length) => navigateToSearchResult(path, offset, length)}
          onClose={() => setPackageSearchOpen(false)} />
      )}
      <StatusBar
        message={fileTask ?? status}
        mode={doc?.origin.kind === "package" ? "Package" : doc?.origin.kind === "folder" ? "Folder" : undefined}
        location={doc?.origin.kind === "folder" ? doc.origin.path : undefined}
        onShowNotificationHistory={() => setNotificationHistoryOpen(true)}
        onShowErrorDetails={error && error.presentation !== "banner" ? () => {
          showErrorDetails();
        } : undefined}
      />
      {notificationHistoryOpen && (
        <NotificationHistoryDialog entries={notificationHistory} onClose={() => setNotificationHistoryOpen(false)} />
      )}
      {savedEditHistoriesOpen && <SavedEditHistoriesDialog onClose={() => setSavedEditHistoriesOpen(false)} />}
      {error?.presentation === "details" && (
        <Dialog title={uiText("Error details")} onClose={dismissError}>
          <p>{error.summary}</p>
          <div className="error-detail operation-error-detail" tabIndex={0}>{error.detail}</div>
          <div className="about-dialog-actions">
            <button type="button" onClick={dismissError}>{uiText("Close")}</button>
          </div>
        </Dialog>
      )}
      {shortcutsOpen && <Dialog title={uiText("Keyboard shortcuts")} onClose={() => setShortcutsOpen(false)}>
        <dl className="shortcut-list">
          <dt>{uiText("Save")}</dt><dd><kbd>Ctrl/Cmd+S</kbd></dd>
          <dt>{uiText("Find in current document")}</dt><dd><kbd>Ctrl/Cmd+F</kbd></dd>
          <dt>{uiText("Search package")}</dt><dd><kbd>Ctrl/Cmd+Shift+F</kbd></dd>
          <dt>{uiText("Undo")}</dt><dd><kbd>Ctrl/Cmd+Z</kbd></dd>
          <dt>{uiText("Redo")}</dt><dd><kbd>Ctrl+Y / Cmd+Shift+Z</kbd></dd>
          <dt>{uiText("Tree and menu navigation")}</dt><dd>{uiText("Arrow keys, Home, End")}</dd>
          <dt>{uiText("Open selected file")}</dt><dd>Enter</dd>
          <dt>{uiText("Context menu")}</dt><dd>Shift+F10 / コンテキストメニューキー</dd>
          <dt>{uiText("Close menu or dialog")}</dt><dd>Esc</dd>
          <dt>{uiText("Save in Vim")}</dt><dd><kbd>:w</kbd></dd>
        </dl>
        <button type="button" onClick={() => setShortcutsOpen(false)}>{uiText("Close")}</button>
      </Dialog>}
      {actionDialog}
      <NotificationBanners notices={notifications} onDismiss={dismissNotification}>
        {error?.presentation === "banner" && (
          <div key={`${error.operation}:${error.detail}`} className="notification-banner notification-banner-error operation-error">
            <div role="alert">{error.summary}</div>
            <ErrorDetails detail={error.detail} />
            <button type="button" onClick={dismissError}>{uiText("Close error")}</button>
          </div>
        )}
      </NotificationBanners>
    </div>
  );
}
