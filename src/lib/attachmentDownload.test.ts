import { describe, expect, test, vi } from "vitest";
import { downloadAttachment } from "./attachmentDownload";
import type { FileInfo } from "../types";

const attachment: FileInfo = {
  path: "attachments/report.txt",
  is_text: true,
  content: "hello",
  base64: null,
};

describe("downloadAttachment", () => {
  test("notifies start before saving and completion after saving", async () => {
    let finishSave!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const notify = vi.fn();
    const pending = downloadAttachment(
      attachment,
      async () => "C:/Downloads/report.txt",
      save,
      notify,
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

    expect(notify.mock.calls.map(([event]) => event)).toEqual(["started"]);
    finishSave();
    await pending;

    expect(notify.mock.calls.map(([event]) => event)).toEqual(["started", "completed"]);
    expect(save).toHaveBeenCalledWith("C:/Downloads/report.txt", "aGVsbG8=");
  });

  test("does not notify or save when destination selection is cancelled", async () => {
    const save = vi.fn();
    const notify = vi.fn();

    await downloadAttachment(attachment, async () => null, save, notify);

    expect(save).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
