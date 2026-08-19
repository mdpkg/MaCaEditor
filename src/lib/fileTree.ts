export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/**
 * フラットなファイルパス一覧からツリー構造を構築する。
 */
export function buildFileTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  for (const path of paths) {
    const segments = path.split("/");
    let currentPath = "";
    let parentList = root;

    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      currentPath = currentPath === "" ? segment : `${currentPath}/${segment}`;

      if (isLast) {
        parentList.push({
          name: segment,
          path: currentPath,
          isDir: false,
          children: [],
        });
      } else {
        let dir = dirMap.get(currentPath);
        if (!dir) {
          dir = {
            name: segment,
            path: currentPath,
            isDir: true,
            children: [],
          };
          dirMap.set(currentPath, dir);
          parentList.push(dir);
        }
        parentList = dir.children;
      }
    });
  }

  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return sorted.map((n) =>
    n.isDir ? { ...n, children: sortTree(n.children) } : n,
  );
}
