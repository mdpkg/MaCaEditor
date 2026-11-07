import { uiText } from "../lib/uiText";
import { ResourceTypeSelect } from "./ResourceTypeSelect";
import { Dialog } from "./Dialog";
import { useState } from "react";
import type { EditableManifestResource } from "../lib/document";

interface Props {
  manifest: Record<string, unknown>;
  files: string[];
  onSave: (values: { entrypoint: string; description: string; resources: EditableManifestResource[] }) => void;
  onClose: () => void;
}

export function ManifestEditorDialog({ manifest, files, onSave, onClose }: Props) {
  const markdownFiles = files.filter((path) => /\.(?:md|markdown)$/i.test(path));
  const [entrypoint, setEntrypoint] = useState(
    typeof manifest.entrypoint === "string" ? manifest.entrypoint : markdownFiles[0] ?? "",
  );
  const [description, setDescription] = useState(typeof manifest.description === "string" ? manifest.description : "");
  const [resources, setResources] = useState<EditableManifestResource[]>(
    Array.isArray(manifest.resources) ? manifest.resources.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const value = item as Record<string, unknown>;
      return [{
        type: typeof value.type === "string" ? value.type : "",
        source: typeof value.source === "string" ? value.source : "",
        rendered: typeof value.rendered === "string" ? value.rendered : "",
      }];
    }) : [],
  );
  const update = (index: number, field: keyof EditableManifestResource, value: string) => {
    setResources((current) => current.map((resource, resourceIndex) =>
      resourceIndex === index ? { ...resource, [field]: value } : resource));
  };
  return <Dialog className="about-dialog manifest-editor-dialog" onClose={onClose} title={uiText("Manifest")}>
    <label className="manifest-description-field">
      <span>{uiText("Entrypoint")}</span>
      <select aria-label={uiText("Entrypoint")} value={entrypoint}
        onChange={(event) => setEntrypoint(event.target.value)}>
        {markdownFiles.map((path) => <option key={path} value={path}>{path}</option>)}
      </select>
    </label>
    <label className="manifest-description-field">
      <span>{uiText("Description")}</span>
      <textarea aria-label={uiText("Description")} value={description}
        onChange={(event) => setDescription(event.target.value)} />
    </label>
    <h3>{uiText("Resources")}</h3>
    <datalist id="manifest-file-paths">{files.map((path) => <option key={path} value={path} />)}</datalist>
    {resources.map((resource, index) => <div className="manifest-resource-row" key={index}>
      <ResourceTypeSelect label={`リソース ${index + 1} 種類`} value={resource.type}
        onChange={(value) => update(index, "type", value)} />
      <input aria-label={`リソース ${index + 1} ソース`} placeholder="ソースのパス" list="manifest-file-paths"
        value={resource.source} onChange={(event) => update(index, "source", event.target.value)} />
      <input aria-label={`リソース ${index + 1} 描画結果`} placeholder="描画結果のパス" list="manifest-file-paths"
        value={resource.rendered} onChange={(event) => update(index, "rendered", event.target.value)} />
      <button type="button" onClick={() => setResources((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{uiText("Remove")}</button>
    </div>)}
    <button type="button" data-action="add-resource"
      onClick={() => setResources((current) => [...current, { type: "", source: "", rendered: "" }])}>{uiText("Add Resource")}</button>
    <div className="about-dialog-actions">
      <button type="button" onClick={onClose}>{uiText("Cancel")}</button>
      <button type="button" data-action="save"
        onClick={() => onSave({ entrypoint, description, resources })}>{uiText("Save")}</button>
    </div>
  </Dialog>;
}
