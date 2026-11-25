import { createRoot } from "react-dom/client";
import { AiSettingsDialog } from "../../src/components/AiSettingsDialog";

export function mount() {
  createRoot(document.getElementById("app")!).render(<AiSettingsDialog onClose={() => {}} />);
}
