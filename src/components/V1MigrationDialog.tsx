interface Props {
  entrypoint: string;
  onOverwrite: () => void;
  onSaveAs: () => void;
  onCancel: () => void;
}

export function V1MigrationDialog({ entrypoint, onOverwrite, onSaveAs, onCancel }: Props) {
  return <div className="about-dialog-backdrop" onPointerDown={onCancel}>
    <section className="about-dialog" role="dialog" aria-modal="true" aria-label="MDPKG v2 migration"
      onPointerDown={(event) => event.stopPropagation()}>
      <h2>Upgrade MDPKG v1</h2>
      <p>This document will be saved as MDPKG version 2.0.</p>
      <p>The existing entrypoint <code>{entrypoint}</code> will be preserved. Unknown manifest fields are also preserved.</p>
      <div className="about-dialog-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={onSaveAs}>Save Copy...</button>
        <button type="button" onClick={onOverwrite}>Upgrade Original</button>
      </div>
    </section>
  </div>;
}
