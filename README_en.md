[日本語](README.md) | **English**

# MaCa Editor

MaCa Editor is a desktop editor for viewing and editing `.mdpkg` files that conform to the [Markdown Package Specification (mdpkg specification)](https://github.com/mdpkg/mdpkg-spec).

The name **MaCa** comes from **Ma**rkdown and **Ca**nvas. It combines Markdown document editing and SVG-based drawing in a single application, allowing you to manage text, images, diagrams, and attachments together.

<img width="1204" height="1062" alt="MaCaEditor" src="https://github.com/user-attachments/assets/5ed57a0f-9519-4cfa-95a9-49b8930aaa46" />

## Download

Installers are available for Windows x64 (`.exe` or `.msi`), macOS on Apple Silicon (`.dmg`), and Linux x86-64 (AppImage, `.deb`, or `.rpm`). [Download the latest MaCa Editor release](https://github.com/mdpkg/MaCaEditor/releases/latest)

Version 2.2.0 protects edits made during saves, improves recovery from external changes, and updates keyboard navigation, search, and Japanese error messages. It also speeds up previews of long Markdown documents and adds print headers and page numbers. The instructions below use the Japanese labels shown in the app. [Review results and verification scope (Japanese)](review/README.md)

## Features

### Markdown Editing and Preview

- Edit Markdown files with real-time preview
- Markdown editing powered by CodeMirror
- Switch between standard mode and Vim mode (`:w` saves the file in Vim mode)
- GitHub Flavored Markdown (GFM) support
- Tables, task lists, strikethrough, and automatic URL linking
- GitHub Flavored Markdown Alerts such as `> [!NOTE]`
- YAML front matter rendered as a key-value table
- `:::` container rendering in Rspress mode
- Toggleable table of contents (TOC)
- Click tables in the preview to edit them with a GUI
- Insert table rows and columns at any position and paste TSV or Markdown tables, including column alignment
- Support for image filenames containing Japanese characters or spaces
- GitHub-style preview
- Double-click Markdown files in the file tree to edit them
- Toggle the file list using the button at the left end of the toolbar
- Full-screen viewing, zooming, and panning for images and diagrams
- Print with headers and page numbers, or save to PDF using the system print dialog
- Restore TOC, Rspress, and Vim mode settings on the next launch
- Restore the previous window position and size on the next launch

### File and Image Management

- Create, open, save, and save `.mdpkg` files under a new name
- Open MDPKG v1 files and convert them to v2 when saving
- Import from a folder and export to a folder
- Filter the file tree, navigate it with the keyboard, and restore folder expansion for each document
- File-type icons for folders, Markdown, images, diagrams, and other files
- Add PNG, JPEG, GIF, WebP, and BMP images
- Add one or multiple attachment files of any type
- Drop an `.mdpkg` file or folder to open it, or drop images into an open document to import them
- Rename, move, or delete files and folders from the file tree
- Update Markdown links when files move, and undo or redo file operations
- Search and diagnose the entire package
- Insert links to images and diagrams at the Markdown cursor position or at the end of the document
- Insert attachment links into Markdown and download attachments from the preview by choosing a destination
- Display notifications in the upper-right corner when attachment downloads start, complete, or fail

### Drawing Editor

- Rectangles, rounded rectangles, ellipses, cylinders, cubes, callouts, files, users, text, and images
- Flowchart symbols, directional arrows, curved arrows, and left/right braces
- Lines, arrows, straight connectors, curved connectors, and elbow connectors
- Select, multi-select, move, resize, and rotate objects
- Grid display, snapping, zooming, and drawing area resizing
- Copy, paste, duplicate, delete, undo, and redo
- Move objects forward/backward and align them
- Group, ungroup, and create nested groups
- Double-click to select individual objects inside a group
- Fill color, stroke color, opacity, stroke width, and line style
- Configure arrowheads, crow's feet, and small/medium/large endpoint sizes independently at either end of connectors
- Freely position connector attachment points along shape outlines and reattach them to other shapes
- Adjust callout tails and curved-arrow angles/endpoints using GUI handles
- Multi-line text inside shapes with horizontal and vertical alignment
- Add images to SVG diagrams
- Reopen diagrams for editing using **編集** in the Markdown preview or by double-clicking them

### PlantUML, Mermaid, and MathJax

- Create PlantUML and Mermaid diagrams, as well as MathJax formulas
- Display text-based definitions and SVG previews side by side
- Automatically update previews as you type
- Display syntax errors
- Insert diagrams at the Markdown cursor position or at the end of the document
- Double-click diagrams in the Markdown preview to edit them again
- Click the SVG preview in the PlantUML, Mermaid, or MathJax editor to open it in full-screen view
- PlantUML uses `plantuml.js`, Mermaid uses `mermaid.js`, and formulas use MathJax to render SVG directly within the application

## Basic Usage

### Editing an `.mdpkg` File

1. Choose **開く** (Open) on the start screen and select an `.mdpkg` file. The entrypoint opens in the split editor with the cursor ready for input. You can also drop a package onto the window or select it from **最近使った文書** (Recent documents).
2. To edit another Markdown file, double-click it in the file tree or select it and click **編集** in its preview.
3. Save with **ファイル** → **保存**, or press `Ctrl+S` (`Cmd+S` on macOS). Edits made while a save is in progress remain unsaved and are written on the next save.

On the right side of the toolbar, you can toggle **目次** to display a table of contents, **Rspress** to enable Rspress `:::` syntax, and **Vim モード** to enable Vim keybindings. These settings are preserved for the next launch.

The window position and size are also saved when the application exits and restored on the next launch.

Click **☰** at the left end of the toolbar to hide the file list and expand the editing area. Click it again to show the file list. Drag the dividers to resize the sidebar and split editor. Their widths are restored on the next launch.

### Editing an Existing Folder (Folder Mode)

Choose **ファイル** → **フォルダを開く...** to edit either an extracted mdpkg folder or an existing Markdown folder directly. If `manifest.json` is missing, MaCa Editor analyzes the Markdown files and their links and generates an MDPKG v2 manifest candidate. It chooses `index.md`, then `README.md`, then the first Markdown path as the entrypoint. Linked `.svg` and `.png` files are paired with same-name `.draw.json`, `.puml`, `.mmd`, `.tex`, or `.dot` diagram sources.

Review and edit the inferred entrypoint and resources before opening the folder. Broken links, links outside the folder, and ambiguous diagram sources are shown as warnings. In Folder mode, `manifest.json` is written on the first save. **ファイル** → **フォルダから取り込み** uses the same review flow and embeds the generated manifest in the new `.mdpkg` file.

Use **保存** to write edits directly to the folder, or **ファイル** → **パッケージに書き出し...** to export an `.mdpkg`. The app reloads external changes automatically when there are no unsaved edits. When changes conflict, saving to the folder pauses and your edits are kept. Use **パッケージに書き出し...** on the conflict banner to save a copy, then confirm **フォルダを再読込...** to reload. Cancelling the reload keeps your edits.

During manifest inference, `.git`, `.hg`, `.svn`, `.next`, `node_modules`, `target`, `dist`, `build`, and `coverage` are skipped so large dependency and generated-output directories are not imported accidentally.

### Creating a New `.mdpkg` File

1. Choose **新規作成** on the start screen or from **ファイル**, then select a path for the new `.mdpkg` file.
2. Edit `index.md` and add images or diagrams as needed.
3. Use **ファイル** → **保存** to write your changes, or choose **名前を付けて保存** to save a separate package.

Use **ファイル** → **manifest を編集...** to change the entrypoint, description, and resource relationships. Only existing Markdown files can be selected as the entrypoint. Unknown resource types are flagged and their original values are preserved when saving.

### Adding an Image

1. Place the cursor at the desired insertion position in the Markdown.
2. Click **画像を追加** and select an image.
3. A link to the image is inserted at the cursor position. If there is no cursor position, it is inserted at the end of the Markdown document.

You can also drop images onto the document area or the relevant `images` folder in the file tree. After a mixed drop, the notification identifies imported images, skipped files, and files that could not be read.

### Adding Attachments

1. Place the cursor at the desired insertion position in the Markdown.
2. Click **添付ファイルを追加** and select the files to attach. You can select multiple files at once.
3. The selected files are added to `attachments` in the file tree, and links to each file are inserted at the cursor position. If there is no cursor position, the links are inserted at the end of the Markdown document.
4. Click an attachment link in the Markdown preview and choose a destination to download the file.
5. Download start, completion, and failure events are displayed as banners in the upper-right corner.

### Adding a Diagram

1. Place the cursor at the desired insertion position in the Markdown.
2. Select **SVG** from the **図を挿入** menu.
3. Create a diagram using the Drawing Editor.
4. A link to the diagram is inserted at the Markdown cursor position. If there is no cursor position, it is inserted at the end of the document.
5. Click **編集** on the diagram in the Markdown preview, or double-click the diagram, to reopen it in the Drawing Editor.

To create a PlantUML or Mermaid diagram, or a MathJax formula, select the corresponding format from the **図を挿入** menu. Enter the definition or TeX-formatted formula in the displayed text editor, and the SVG preview on the right will update automatically.

### Viewing Images and Diagrams in Full Screen

- In the Markdown view or split editor view, click an image or diagram to open it in full-screen view.
- In the PlantUML, Mermaid, and MathJax editors, click the SVG preview on the right to open it in full-screen view.
- Use the mouse wheel to zoom in and out, and drag with the left mouse button to pan.
- Press `Esc` or click **×** in the upper-right corner to return to the previous screen.
- For a diagram opened from Markdown, click **編集** or double-click the enlarged diagram to open its editor.

### Previewing Extended Markdown

GitHub Flavored Markdown Alerts are always supported.

```markdown
> [!WARNING]
> This operation cannot be undone.
```

To render Rspress-style containers, enable **Rspress** in the toolbar. The following container types are supported: `note`, `tip`, `important`, `info`, `warning`, `danger`, `caution`, and `details`. Custom titles can also be specified.

```markdown
:::tip Tip
Write your description here.
:::
```

### Displaying a Table of Contents

Enable **目次** in the toolbar to generate a table of contents at the beginning of the preview. Any table of contents you wrote in Markdown remains visible.

### Printing the Preview and Saving as PDF

Choose **ファイル** → **印刷** to print the Markdown preview with headers and page numbers in the form “current page / total pages.” To save a PDF, select a PDF printer such as **Microsoft Print to PDF** on Windows, use the PDF option in the macOS print dialog, or choose **Print to File** in the GTK print dialog on Linux.

When the app detects a failed Windows print job, it shows a Japanese summary in the error banner and status bar. Open **詳細** to see the original Windows error. After closing the banner, you can reopen it from **エラーの詳細** in the status bar.

### Adding and Editing Tables

- Click a table in the Markdown preview to open the table editor.
- In the table editor, you can edit cells directly, add or remove rows and columns, set column alignment to left, center, or right, and paste TSV data.
- Click **完了** to apply the changes to the Markdown and return to the split editor.
- Click **キャンセル** to discard the table draft and return to the split editor.
- Use `Ctrl+Z` or `Cmd+Z` to undo table editing operations.

### Organizing Files and Folders

Right-click a file or folder in the tree and choose **名前を変更**, **移動**, or **削除**. You can also drag files and folders to a destination in the tree. The app asks for confirmation when you drop an item at the package root. Package links update when files are renamed or moved. Use **ファイル** → **元に戻す** or **やり直し** to undo or redo document changes, including Markdown edits and file moves. Reopening a document restores its edit history from the last save.

### Searching and Diagnosing a Package

Choose **ファイル** → **パッケージを検索...** to search file names, text, headings, link destinations, or references to a specific path. Click a result to open it, or select it with the arrow keys and press `Enter`. Use `Ctrl+F` (`Cmd+F` on macOS) to search within the current Markdown file.

Choose **ファイル** → **パッケージを診断...** to find problems such as broken links, missing resources, and diagrams that need to be regenerated. Filter issues by severity or open a result to go to its location.

### Importing from and Exporting to Folders

- **ファイル** → **フォルダから取り込み**: Create an `.mdpkg` file from the contents of a folder.
- **ファイル** → **フォルダへ書き出し**: Export the contents of the currently opened `.mdpkg` file to a folder.

### Reviewing Notifications

Open **通知履歴** (Notification history) from the status bar to see recent notifications from the current session. The history includes banners that disappeared automatically and original error messages from dismissed banners.

### Setting Up AI

Under **AI**, choose **AI を設定する** (Set up AI) or **AI 設定** (AI Settings) to configure an OpenAI-compatible endpoint, model, and API key if required. Use **接続をテスト** to check the connection. Once configured, you can rewrite, summarize, or proofread selected text, ask questions in **AI チャット**, and generate diagrams in the PlantUML and Mermaid editors. Errors show a Japanese summary and the original message under **詳細**.

## Using the Drawing Editor

### Creating Objects

Select a shape, line, connector, text, or image tool from the toolbar, then click or drag in the drawing area. After creating one object, the editor automatically returns to selection mode.

### Selecting Objects

- Click an object to select it.
- Hold `Ctrl` while clicking to select multiple objects.
- Drag from an empty area to select all objects fully contained within the selection rectangle.
- Double-click a group to select individual objects inside the group.

### Editing Objects

- Drag an object to move it.
- Drag the handles on the selection frame to resize it.
- Drag the rotation handle above the selection frame to rotate it.
- Use **プロパティ** or the context menu to change colors, strokes, opacity, text alignment, and front/back ordering.
- Multiple selected objects can be moved, aligned, and grouped together.

### Editing Connectors

- Selecting a connector displays white attachment handles at its start and end.
- Drag an attachment handle to position it freely along the outline of its connected shape. The relative attachment position is preserved when the shape is moved, resized, or rotated.
- Drag an attachment handle onto another shape to reattach that end of the connector.
- Double-click an attachment handle to clear its custom position and return to automatic attachment.
- In **プロパティ** or the context menu, use **始点** and **終点** to select an arrowhead or crow's foot, and use **始点の大きさ** and **終点の大きさ** to select **小**, **中**, or **大** independently for each end.
- Attachment positions and endpoint settings work consistently with straight, curved, and elbow connectors.

## Keyboard Shortcuts

You can also find shortcuts in the app under **ヘルプ** → **キーボードショートカット**.

### Application

| Action | Key |
|---|---|
| Save | `Ctrl+S` / `Cmd+S` |
| Find in the current Markdown file | `Ctrl+F` / `Cmd+F` |
| Search the entire package | `Ctrl+Shift+F` / `Cmd+Shift+F` |
| Navigate the file tree or a menu | Arrow keys, `Home`, `End` |
| Open the selected file | `Enter` |
| Close a menu or dialog | `Esc` |

### Drawing Editor

| Action | Key |
|---|---|
| Delete | `Delete` / `Backspace` |
| Copy | `Ctrl+C` |
| Paste | `Ctrl+V` |
| Duplicate | `Ctrl+D` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` |
| Move | Arrow keys |
| Move by a larger amount | `Shift` + Arrow keys |
| Zoom | `Ctrl` + Mouse wheel |
| Multi-select | `Ctrl` + Click, or drag a selection rectangle |

When a text input field has focus, text-editing keys such as `Backspace` are not used for shape operations.

## Currently Unsupported Features

- Diagram formats other than SVG, PlantUML, Mermaid, and MathJax, such as Graphviz
- Import/export interoperability with draw.io, Excalidraw, or PowerPoint
- Dedicated HTML export or direct PDF export without using the operating system's print dialog
- Real-time collaborative editing or cloud synchronization

## License

MaCa Editor is available under the [MIT License](LICENSE).

Copyright (c) 2026 mikoto2000 &lt;mikoto2000@gmail.com&gt;
