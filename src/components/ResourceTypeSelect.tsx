import { uiText } from "../lib/uiText";
interface Props {
  value: string;
  label: string;
  onChange: (value: string) => void;
}

const resourceTypes = ["drawing", "plantuml", "mermaid", "mathjax"];

export function ResourceTypeSelect({ value, label, onChange }: Props) {
  const unknown = value !== "" && !resourceTypes.includes(value);
  return <div>
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{uiText("Choose a type")}</option>
      {unknown && <option value={value}>{value}</option>}
      {resourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
    </select>
    {unknown && <small role="status">{uiText("Unknown resource type. Its value will be preserved.")}</small>}
  </div>;
}
