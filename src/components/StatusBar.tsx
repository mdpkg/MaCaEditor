interface Props {
  message: string;
  mode?: "Package" | "Folder";
  location?: string;
}

export function StatusBar({ message, mode, location }: Props) {
  return <div className="status-bar">
    <span>{message}</span>
    {mode && <span className="document-origin" title={location}>{mode}{location ? ` — ${location}` : ""}</span>}
  </div>;
}
