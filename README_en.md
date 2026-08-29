[日本語](README.md) | **英語**

# MaCa Editor

MaCa Editor is a desktop editor for viewing and editing `.mdpkg` files that conform to the [Markdown Package Specification (mdpkg specification)](https://github.com/mdpkg/mdpkg-spec).

The name **MaCa** comes from **Ma**rkdown and **Ca**nvas. It combines Markdown document editing and SVG-based drawing in a single application, allowing you to manage text, images, diagrams, and attachments together.

<img width="1204" height="1062" alt="MaCaEditor" src="https://github.com/user-attachments/assets/5ed57a0f-9519-4cfa-95a9-49b8930aaa46" />

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
- Support for image filenames containing Japanese characters or spaces
- GitHub-style preview
- Double-click Markdown files in the file tree to edit them
- Toggle the file list using the button at the left end of the toolbar
- Full-screen viewing, zooming, and panning for images and diagrams
- Print the Markdown preview and save it as PDF using the operating system's print functionality
- Restore TOC, Rspress, and Vim mode settings on the next launch
- Restore the previous window position and size on the next launch

### File and Image Management

- Create, open, save, and save `.mdpkg` files under a new name
- Import from a folder and export to a folder
- Browse files in the package using a tree view
- File-type icons for folders, Markdown, images, diagrams, and other files
- Add PNG, JPEG, GIF, WebP, and BMP images
- Add one or multiple attachment files of any type
- Drag and drop images into the `images` folder
- Rename and delete images, attachments, and diagrams
- Rename and delete files from the file tree context menu
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
- Reopen diagrams for editing using the **Edit** button shown in the Markdown preview or by double-clicking them

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

1. Open an `.mdpkg` file using **Open** from the **File** menu.
2. Select a Markdown file from the file tree on the left.
3. Double-click the Markdown file or click **Edit** in the preview.
4. Edit the Markdown and check the result in the preview.
5. Save it using **Save** from the **File** menu or `Ctrl+S`.

On the right side of the toolbar, you can toggle **TOC** to display a table of contents, **Rspress** to enable Rspress `:::` syntax, and **Vim mode** to enable Vim keybindings. These settings are preserved for the next launch.

The window position and size are also saved when the application exits and restored on the next launch.

Click **☰** at the left end of the toolbar to hide the file list and expand the editing area. Click it again to show the file list.

### Editing an Existing Folder (Folder Mode)

Choose **File** → **Open Folder...** to edit either an extracted mdpkg folder or an existing Markdown folder directly. If `manifest.json` is missing, MaCa Editor analyzes the Markdown files and their links and generates an MDPKG v2 manifest candidate. It chooses `index.md`, then `README.md`, then the first Markdown path as the entrypoint. Linked `.svg` and `.png` files are paired with same-name `.draw.json`, `.puml`, `.mmd`, `.tex`, or `.dot` diagram sources.

Review and edit the inferred entrypoint and resources before opening the folder. Broken links, links outside the folder, and ambiguous diagram sources are shown as warnings. In Folder mode, `manifest.json` is written on the first save. **File** → **Import Folder** uses the same review flow and embeds the generated manifest in the new `.mdpkg` file.

During manifest inference, `.git`, `.hg`, `.svn`, `.next`, `node_modules`, `target`, `dist`, `build`, and `coverage` are skipped so large dependency and generated-output directories are not imported accidentally.

### Creating a New `.mdpkg` File

1. Click **New** from the **File** menu.
2. Edit the Markdown and add images or diagrams as needed.
3. Choose a destination using **Save** or **Save As** from the **File** menu.

Use **File** → **Edit Manifest...** to change the entrypoint, description, and resource relationships. Only existing Markdown files can be selected as the entrypoint.

### Adding an Image

1. Place the cursor at the desired insertion position in the Markdown.
2. Click **Add Image** and select an image.
3. A link to the image is inserted at the cursor position. If there is no cursor position, it is inserted at the end of the Markdown document.

You can also add images by dragging and dropping them into the `images` folder in the file tree.

### Adding Attachments

1. Place the cursor at the desired insertion position in the Markdown.
2. Click **Add Attachment** and select the files to attach. You can select multiple files at once.
3. The selected files are added to `attachments` in the file tree, and links to each file are inserted at the cursor position. If there is no cursor position, the links are inserted at the end of the Markdown document.
4. Click an attachment link in the Markdown preview and choose a destination to download the file.
5. Download start, completion, and failure events are displayed as banners in the upper-right corner.

### Adding a Diagram

1. Place the cursor at the desired insertion position in the Markdown.
2. Select **SVG** from the **Insert Diagram** menu.
3. Create a diagram using the Drawing Editor.
4. A link to the diagram is inserted at the Markdown cursor position. If there is no cursor position, it is inserted at the end of the document.
5. Hover over the diagram in the Markdown preview and click **Edit**, or double-click the diagram, to reopen it in the Drawing Editor.

To create a PlantUML or Mermaid diagram, or a MathJax formula, select the corresponding format from the **Insert Diagram** menu. Enter the definition or TeX-formatted formula in the displayed text editor, and the SVG preview on the right will update automatically.

### Viewing Images and Diagrams in Full Screen

- In the Markdown view or split editor view, click an image or diagram to open it in full-screen view.
- In the PlantUML, Mermaid, and MathJax editors, click the SVG preview on the right to open it in full-screen view.
- Use the mouse wheel to zoom in and out, and drag with the left mouse button to pan.
- Press `Esc` or click **×** in the upper-right corner to return to the previous screen.
- Diagrams opened from Markdown can be double-clicked while in full-screen view to open their corresponding editor.

### Previewing Extended Markdown

GitHub Flavored Markdown Alerts are always supported.

```markdown
> [!WARNING]
> This operation cannot be undone.
```

To render Rspress-style containers, enable **Rspress** in the toolbar. The following container types are supported: `note`, `tip`, `important`, `info`, `warning`, `danger`, `caution`, and `details`. Custom titles can also be specified.

```markdown
:::
Write your description here.
:::
```

### Displaying a Table of Contents

Enable **TOC** in the toolbar to generate a table of contents from Markdown headings and display it at the beginning of the preview.

### Printing the Preview and Saving as PDF

Use **File** → **Print** to print the Markdown preview. To save it as PDF, select a PDF printer from the operating system's print dialog.

### Adding and Editing Tables

- Click a table in the Markdown preview to open the table editor.
- In the table editor, you can edit cells directly, add or remove rows and columns, set column alignment to left, center, or right, and paste TSV data.
- Click **Done** to apply the changes to the Markdown and return to the split editor.
- Use `Ctrl+Z` or `Cmd+Z` to undo table editing operations.

### Renaming and Deleting Files

1. Right-click an image or diagram in the file tree.
2. Select **Rename** or **Delete**.

### Importing from and Exporting to Folders

- **File** → **Import Folder**: Create an `.mdpkg` file from the contents of a folder.
- **File** → **Export Folder**: Export the contents of the currently opened `.mdpkg` file to a folder.

## Using the Drawing Editor

### Creating Objects

Select a shape, line, connector, text, or image tool from the toolbar, then click or drag in the drawing area. After creating one object, the editor automatically returns to Select mode.

### Selecting Objects

- Click an object to select it.
- Hold `Ctrl` while clicking to select multiple objects.
- Drag from an empty area to select all objects fully contained within the selection rectangle.
- Double-click a group to select individual objects inside the group.

### Editing Objects

- Drag an object to move it.
- Drag the handles on the selection frame to resize it.
- Drag the rotation handle above the selection frame to rotate it.
- Use Properties or the context menu to change colors, strokes, opacity, text alignment, and front/back ordering.
- Multiple selected objects can be moved, aligned, and grouped together.

### Editing Connectors

- Selecting a connector displays white attachment handles at its start and end.
- Drag an attachment handle to position it freely along the outline of its connected shape. The relative attachment position is preserved when the shape is moved, resized, or rotated.
- Drag an attachment handle onto another shape to reattach that end of the connector.
- Double-click an attachment handle to clear its custom position and return to automatic attachment.
- In Properties or the context menu, use **Start** and **End** to select an arrowhead or crow's foot, and use **Start size** and **End size** to select **Small**, **Medium**, or **Large** independently for each end.
- Attachment positions and endpoint settings work consistently with straight, curved, and elbow connectors.

## Keyboard Shortcuts

### Application

| Action | Key |
|---|---|
| Save | `Ctrl+S` |

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
