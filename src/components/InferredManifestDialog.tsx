import { useState } from "react";
import type { ManifestInference } from "../lib/manifestInference";

type InferredManifest = ManifestInference["manifest"];
type Resource = InferredManifest["resources"][number];

interface Props {
  files: string[];
  manifest: InferredManifest;
  warnings: string[];
  confirmLabel?: string;
  onConfirm: (manifest: InferredManifest) => void;
  onCancel: () => void;
}

export function InferredManifestDialog({
  files, manifest, warnings, confirmLabel = "Open Folder", onConfirm, onCancel,
}: Props) {
  const markdownFiles = files.filter((path) => /\.(?:md|markdown)$/i.test(path));
  const [entrypoint, setEntrypoint] = useState(manifest.entrypoint);
  const [resources, setResources] = useState<Resource[]>(manifest.resources);
  const update = (index: number, field: keyof Resource, value: string) => {
    setResources((current) => current.map((resource, resourceIndex) =>
      resourceIndex === index ? { ...resource, [field]: value } : resource));
  };

  return <div className="about-dialog-backdrop" onPointerDown={onCancel}>
    <section className="about-dialog manifest-inference-dialog" role="dialog" aria-modal="true"
      aria-label="Review generated manifest" onPointerDown={(event) => event.stopPropagation()}>
      <h2>Create manifest.json</h2>
      <p>manifest.json was not found. Review the values inferred from the Markdown files and links.</p>
      <label className="manifest-description-field">
        <span>Entrypoint</span>
        <select aria-label="Entrypoint" value={entrypoint} onChange={(event) => setEntrypoint(event.target.value)}>
          {markdownFiles.map((path) => <option key={path} value={path}>{path}</option>)}
        </select>
      </label>
      {warnings.length > 0 && <div className="manifest-inference-warnings">
        <h3>Warnings</h3>
        <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </div>}
      <h3>Diagram resources</h3>
      <datalist id="inferred-manifest-file-paths">
        {files.map((path) => <option key={path} value={path} />)}
      </datalist>
      {resources.map((resource, index) => <div className="manifest-resource-row" key={index}>
        <input aria-label={`Resource ${index + 1} type`} placeholder="type" value={resource.type}
          onChange={(event) => update(index, "type", event.target.value)} />
        <input aria-label={`Resource ${index + 1} source`} placeholder="source"
          list="inferred-manifest-file-paths" value={resource.source}
          onChange={(event) => update(index, "source", event.target.value)} />
        <input aria-label={`Resource ${index + 1} rendered`} placeholder="rendered"
          list="inferred-manifest-file-paths" value={resource.rendered}
          onChange={(event) => update(index, "rendered", event.target.value)} />
        <button type="button" onClick={() => setResources((current) =>
          current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
      </div>)}
      <button type="button" onClick={() => setResources((current) => [
        ...current, { type: "", source: "", rendered: "" },
      ])}>Add Resource</button>
      <div className="about-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={() => onConfirm({ ...manifest, entrypoint, resources })}>{confirmLabel}</button>
      </div>
    </section>
  </div>;
}
