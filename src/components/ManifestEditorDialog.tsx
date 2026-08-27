import { useState } from "react";
import type { EditableManifestResource } from "../lib/document";

interface Props {
  manifest: Record<string, unknown>;
  files: string[];
  onSave: (values: { description: string; resources: EditableManifestResource[] }) => void;
  onClose: () => void;
}

export function ManifestEditorDialog({ manifest, files, onSave, onClose }: Props) {
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
  return <div className="about-dialog-backdrop" onPointerDown={onClose}>
    <section className="about-dialog manifest-editor-dialog" role="dialog" aria-modal="true"
      aria-label="Manifest editor" onPointerDown={(event) => event.stopPropagation()}>
      <h2>Manifest</h2>
      <label>Description<textarea aria-label="Description" value={description}
        onChange={(event) => setDescription(event.target.value)} /></label>
      <h3>Resources</h3>
      <datalist id="manifest-file-paths">{files.map((path) => <option key={path} value={path} />)}</datalist>
      {resources.map((resource, index) => <div className="manifest-resource-row" key={index}>
        <input aria-label={`Resource ${index + 1} type`} placeholder="type" value={resource.type}
          onChange={(event) => update(index, "type", event.target.value)} />
        <input aria-label={`Resource ${index + 1} source`} placeholder="source" list="manifest-file-paths"
          value={resource.source} onChange={(event) => update(index, "source", event.target.value)} />
        <input aria-label={`Resource ${index + 1} rendered`} placeholder="rendered" list="manifest-file-paths"
          value={resource.rendered} onChange={(event) => update(index, "rendered", event.target.value)} />
        <button type="button" onClick={() => setResources((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
      </div>)}
      <button type="button" data-action="add-resource"
        onClick={() => setResources((current) => [...current, { type: "", source: "", rendered: "" }])}>Add Resource</button>
      <div className="about-dialog-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" data-action="save" onClick={() => onSave({ description, resources })}>Save</button>
      </div>
    </section>
  </div>;
}
