type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const alertTitles = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
} as const;

type AlertKind = keyof typeof alertTitles;

function removeAlertMarker(paragraph: MarkdownNode): AlertKind | undefined {
  const firstText = paragraph.children?.find((child) => child.type === "text");
  const match = firstText?.value?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\n)?/);
  if (!match || !firstText?.value) return undefined;

  firstText.value = firstText.value.slice(match[0].length);
  return match[1] as AlertKind;
}

function transformNode(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    const firstChild = node.children?.[0];
    if (firstChild?.type === "paragraph") {
      const kind = removeAlertMarker(firstChild);
      if (kind) {
        const className = `markdown-alert-${kind.toLowerCase()}`;
        node.data = {
          ...node.data,
          hName: "div",
          hProperties: {
            ...node.data?.hProperties,
            className: ["markdown-alert", className],
          },
        };
        node.children?.unshift({
          type: "paragraph",
          data: {
            hProperties: { className: ["markdown-alert-title"] },
          },
          children: [{ type: "text", value: alertTitles[kind] }],
        });
      }
    }
  }

  node.children?.forEach(transformNode);
}

export function remarkGitHubAlerts() {
  return (tree: MarkdownNode) => transformNode(tree);
}
