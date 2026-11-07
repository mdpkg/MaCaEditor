import { uiText } from "../lib/uiText";
import { Dialog } from "./Dialog";
interface Props {
  entrypoint: string;
  onOverwrite: () => void;
  onSaveAs: () => void;
  onCancel: () => void;
}

export function V1MigrationDialog({ entrypoint, onOverwrite, onSaveAs, onCancel }: Props) {
  return <Dialog onClose={onCancel} title={uiText("Upgrade MDPKG v1")}>
    <p>{uiText("This document will be saved as MDPKG version 2.0.")}</p>
    <p>{uiText("The existing entrypoint")}<code>{entrypoint}</code> {uiText("will be preserved. Unknown manifest fields are also preserved.")}</p>
    <div className="about-dialog-actions">
      <button type="button" onClick={onCancel}>{uiText("Cancel")}</button>
      <button type="button" onClick={onSaveAs}>{uiText("Save Copy...")}</button>
      <button type="button" onClick={onOverwrite}>{uiText("Upgrade Original")}</button>
    </div>
  </Dialog>;
}
