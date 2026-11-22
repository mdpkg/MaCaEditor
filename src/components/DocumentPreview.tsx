import { useMemo, type ComponentProps } from "react";
import { detectMarp } from "../lib/marp/detect";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarpPreview, type MarpPosition } from "./MarpPreview";

type Props = ComponentProps<typeof MarkdownPreview> & {
  path: string;
  initialMarpPosition?: MarpPosition;
  onMarpPositionChange?: (position: MarpPosition) => void;
};

export function DocumentPreview({ path, initialMarpPosition, onMarpPositionChange, ...props }: Props) {
  const detected = useMemo(() => detectMarp(props.markdown, path), [props.markdown, path]);
  return <>
    {detected.warning && <div className="preview-warning preview-detection-warning" role="status">{detected.warning}</div>}
    {detected.marp ? <MarpPreview
      key={props.scrollRestoreKey ?? path}
      markdown={props.markdown} baseDir={props.baseDir} files={props.files}
      initialPosition={initialMarpPosition} onPositionChange={onMarpPositionChange}
      onNavigateMarkdown={props.onNavigateMarkdown} onDownloadAttachment={props.onDownloadAttachment}
    /> : <MarkdownPreview {...props} />}
  </>;
}
