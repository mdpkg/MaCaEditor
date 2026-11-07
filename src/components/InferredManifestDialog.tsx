import { uiText } from "../lib/uiText";
import { ResourceTypeSelect } from "./ResourceTypeSelect";
import { Dialog } from "./Dialog";
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
  files, manifest, warnings, confirmLabel = uiText("Open Folder"), onConfirm, onCancel,
}: Props) {
  const markdownFiles = files.filter((path) => /\.(?:md|markdown)$/i.test(path));
  const [entrypoint, setEntrypoint] = useState(manifest.entrypoint);
  const [resources, setResources] = useState<Resource[]>(manifest.resources);
  const update = (index: number, field: keyof Resource, value: string) => {
    setResources((current) => current.map((resource, resourceIndex) =>
      resourceIndex === index ? { ...resource, [field]: value } : resource));
  };

  return <Dialog className="about-dialog manifest-inference-dialog" onClose={onCancel} title={uiText("Create manifest.json")}>
    <p>{uiText("manifest.json was not found. Review the values inferred from the Markdown files and links.")}</p>
    <label className="manifest-description-field">
      <span>{uiText("Entrypoint")}</span>
      <select aria-label={uiText("Entrypoint")} value={entrypoint} onChange={(event) => setEntrypoint(event.target.value)}>
        {markdownFiles.map((path) => <option key={path} value={path}>{path}</option>)}
      </select>
    </label>
    {warnings.length > 0 && <div className="manifest-inference-warnings">
      <h3>{uiText("Warnings")}</h3>
      <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </div>}
    <h3>{uiText("Diagram resources")}</h3>
    <datalist id="inferred-manifest-file-paths">
      {files.map((path) => <option key={path} value={path} />)}
    </datalist>
    {resources.map((resource, index) => <div className="manifest-resource-row" key={index}>
      <ResourceTypeSelect label={`リソース ${index + 1} 種類`} value={resource.type}
        onChange={(value) => update(index, "type", value)} />
      <input aria-label={`リソース ${index + 1} ソース`} placeholder="ソースのパス"
        list="inferred-manifest-file-paths" value={resource.source}
        onChange={(event) => update(index, "source", event.target.value)} />
      <input aria-label={`リソース ${index + 1} 描画結果`} placeholder="描画結果のパス"
        list="inferred-manifest-file-paths" value={resource.rendered}
        onChange={(event) => update(index, "rendered", event.target.value)} />
      <button type="button" onClick={() => setResources((current) =>
        current.filter((_, itemIndex) => itemIndex !== index))}>{uiText("Remove")}</button>
    </div>)}
    <button type="button" onClick={() => setResources((current) => [
      ...current, { type: "", source: "", rendered: "" },
    ])}>{uiText("Add Resource")}</button>
    <div className="about-dialog-actions">
      <button type="button" onClick={onCancel}>{uiText("Cancel")}</button>
      <button type="button" onClick={() => onConfirm({ ...manifest, entrypoint, resources })}>{confirmLabel}</button>
    </div>
  </Dialog>;
}
