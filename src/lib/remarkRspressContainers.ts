type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const containerKinds = [
  "note", "tip", "important", "info", "warning", "danger", "caution", "details",
] as const;

type ContainerKind = typeof containerKinds[number];

interface Opening {
  kind: ContainerKind;
  title: string;
  markerLength: number;
}

const openingPattern = new RegExp(
  `^:::(${containerKinds.join("|")})(?:\\{title="([^"]*)"\\}|[ \\t]+([^\\n]+))?[ \\t]*(?:\\n|$)`,
);

function firstText(node: MarkdownNode): MarkdownNode | undefined {
  return node.children?.find((child) => child.type === "text");
}

function lastText(node: MarkdownNode): MarkdownNode | undefined {
  const children = node.children ?? [];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (children[index].type === "text") return children[index];
  }
  return undefined;
}

function openingOf(node: MarkdownNode): Opening | undefined {
  if (node.type !== "paragraph") return undefined;
  const text = firstText(node)?.value;
  const match = text?.match(openingPattern);
  if (!match) return undefined;
  const kind = match[1] as ContainerKind;
  return {
    kind,
    title: match[2] ?? match[3]?.trim() ?? `${kind[0].toUpperCase()}${kind.slice(1)}`,
    markerLength: match[0].length,
  };
}

function isClosingParagraph(node: MarkdownNode): boolean {
  return node.type === "paragraph"
    && node.children?.length === 1
    && node.children[0].type === "text"
    && node.children[0].value?.trim() === ":::";
}

function removeOpening(node: MarkdownNode, opening: Opening): void {
  const text = firstText(node);
  if (text?.value !== undefined) text.value = text.value.slice(opening.markerLength);
}

function removeInlineClosing(node: MarkdownNode): boolean {
  const text = lastText(node);
  if (!text?.value || !/\n:::[ \t]*$/.test(text.value)) return false;
  text.value = text.value.replace(/\n:::[ \t]*$/, "");
  return true;
}

function hasContent(node: MarkdownNode): boolean {
  return node.children?.some((child) => child.type !== "text" || Boolean(child.value)) === true;
}

function containerNode(opening: Opening, children: MarkdownNode[]): MarkdownNode {
  const title: MarkdownNode = {
    type: "paragraph",
    data: {
      hName: opening.kind === "details" ? "summary" : undefined,
      hProperties: { className: ["rspress-container-title"] },
    },
    children: [{ type: "text", value: opening.title }],
  };
  return {
    type: "blockquote",
    data: {
      hName: opening.kind === "details" ? "details" : "div",
      hProperties: {
        className: ["rspress-container", `rspress-container-${opening.kind}`],
      },
    },
    children: [title, ...children],
  };
}

function transformChildren(parent: MarkdownNode): void {
  const children = parent.children;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const opening = openingOf(children[index]);
    if (!opening) {
      transformChildren(children[index]);
      continue;
    }

    const openingParagraph = children[index];
    const hasInlineClosing = /\n:::[ \t]*$/.test(lastText(openingParagraph)?.value ?? "");
    if (hasInlineClosing) {
      removeOpening(openingParagraph, opening);
      removeInlineClosing(openingParagraph);
      children.splice(index, 1, containerNode(opening, hasContent(openingParagraph) ? [openingParagraph] : []));
      continue;
    }

    const closingIndex = children.findIndex((child, candidate) =>
      candidate > index && isClosingParagraph(child));
    if (closingIndex < 0) continue;

    removeOpening(openingParagraph, opening);
    const content = children.slice(index, closingIndex);
    if (!hasContent(openingParagraph)) content.shift();
    content.forEach(transformChildren);
    children.splice(index, closingIndex - index + 1, containerNode(opening, content));
  }
}

export function remarkRspressContainers() {
  return (tree: MarkdownNode) => transformChildren(tree);
}
