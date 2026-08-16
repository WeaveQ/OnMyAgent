export type KnowledgeVaultScope = "user" | "project" | "expert";

export type KnowledgeVaultFile = {
  relPath: string;
  name: string;
  size: number;
  mtimeMs: number;
  indexable: boolean;
};

export type KnowledgeVaultScopeList = {
  scope: KnowledgeVaultScope;
  path: string;
  files: KnowledgeVaultFile[];
};

export type KnowledgeNoteRef = {
  scope: KnowledgeVaultScope;
  relPath: string;
};

export const GETTING_STARTED_REL_PATH = "getting-started.md";

export function noteKey(note: KnowledgeNoteRef): string {
  return `${note.scope}:${note.relPath}`;
}

export function parseNoteKey(key: string | null | undefined): KnowledgeNoteRef | null {
  const raw = String(key ?? "");
  const split = raw.indexOf(":");
  if (split <= 0) return null;
  const scope = raw.slice(0, split);
  const relPath = raw.slice(split + 1).trim();
  if (
    (scope !== "user" && scope !== "project" && scope !== "expert") ||
    !relPath
  ) {
    return null;
  }
  return { scope, relPath };
}

export function defaultKnowledgeNote(
  scopes: readonly KnowledgeVaultScopeList[],
): KnowledgeNoteRef | null {
  const user = scopes.find((item) => item.scope === "user");
  if (user?.files.some((file) => file.relPath === GETTING_STARTED_REL_PATH)) {
    return { scope: "user", relPath: GETTING_STARTED_REL_PATH };
  }
  const first = scopes.find((item) => item.files.length > 0);
  const file = first?.files[0];
  return first && file ? { scope: first.scope, relPath: file.relPath } : null;
}

export function filesForScope(
  scopes: readonly KnowledgeVaultScopeList[],
  scope: KnowledgeVaultScope,
): KnowledgeVaultFile[] {
  return scopes.find((item) => item.scope === scope)?.files ?? [];
}

export function knowledgeHitKey(scope: KnowledgeVaultScope, relPath: string): string {
  return noteKey({ scope, relPath });
}

export function filterKnowledgeFiles(
  files: readonly KnowledgeVaultFile[],
  query: string,
  hitKeys?: ReadonlySet<string>,
  scope?: KnowledgeVaultScope,
): KnowledgeVaultFile[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...files];
  return files.filter((file) => {
    if (scope && hitKeys?.has(knowledgeHitKey(scope, file.relPath))) return true;
    return (
      file.relPath.toLowerCase().includes(needle) ||
      file.name.toLowerCase().includes(needle)
    );
  });
}

export function resolveKnowledgeExpertFolderId(input: {
  draftAgentId?: string | null;
  routeAgentId?: string | null;
}): string | null {
  const draft = String(input.draftAgentId ?? "").trim();
  if (draft) return draft;
  const route = String(input.routeAgentId ?? "").trim();
  return route || null;
}

export function suggestKnowledgeNoteName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `note-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

export function normalizeNewNoteRelPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("/") || trimmed.includes("..")) return null;
  return normalizeNoteFileName(trimmed);
}

export function normalizeNoteFileName(raw: string): string | null {
  let name = raw.trim().replace(/\\/g, "/");
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) {
    return null;
  }
  if (!/\.(md|txt|csv)$/i.test(name)) name = `${name}.md`;
  if (name.length > 120) return null;
  return name;
}

export function parentDirOfRelPath(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(0, -1).join("/");
}

export function joinKnowledgeRelPath(folder: string, name: string): string {
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return dir ? `${dir}/${name}` : name;
}

export function nextDuplicateRelPath(
  relPath: string,
  existing: ReadonlySet<string>,
): string {
  const slash = relPath.lastIndexOf("/");
  const dir = slash >= 0 ? relPath.slice(0, slash) : "";
  const base = slash >= 0 ? relPath.slice(slash + 1) : relPath;
  const extMatch = base.match(/(\.(md|txt|csv))$/i);
  const ext = extMatch?.[1] ?? "";
  const stem = ext ? base.slice(0, -ext.length) : base;
  let index = 2;
  let candidate = joinKnowledgeRelPath(dir, `${stem}-${index}${ext}`);
  while (existing.has(candidate)) {
    index += 1;
    candidate = joinKnowledgeRelPath(dir, `${stem}-${index}${ext}`);
  }
  return candidate;
}

export function canDropKnowledgeItem(
  source: { kind: "file" | "dir"; path: string },
  destFolder: string,
): boolean {
  const dest = destFolder.replace(/^\/+|\/+$/g, "");
  if (source.kind === "file") {
    if (source.path === GETTING_STARTED_REL_PATH) return false;
    return parentDirOfRelPath(source.path) !== dest;
  }
  if (dest === source.path || dest.startsWith(`${source.path}/`)) return false;
  return parentDirOfRelPath(source.path) !== dest;
}

export function rewriteFolderPrefix(
  relPath: string,
  fromFolder: string,
  toFolder: string,
): string | null {
  const from = fromFolder.replace(/^\/+|\/+$/g, "");
  const to = toFolder.replace(/^\/+|\/+$/g, "");
  if (!from || relPath !== from && !relPath.startsWith(`${from}/`)) return null;
  const rest = relPath === from ? "" : relPath.slice(from.length + 1);
  return rest ? joinKnowledgeRelPath(to, rest) : to;
}

export type KnowledgeFolderNode = {
  kind: "dir";
  name: string;
  path: string;
  children: KnowledgeTreeNode[];
};

export type KnowledgeFileNode = {
  kind: "file";
  name: string;
  file: KnowledgeVaultFile;
};

export type KnowledgeTreeNode = KnowledgeFolderNode | KnowledgeFileNode;

export function buildKnowledgeFolderTree(
  files: readonly KnowledgeVaultFile[],
): KnowledgeTreeNode[] {
  type MutableDir = KnowledgeFolderNode & { childMap: Map<string, MutableDir> };
  const root: MutableDir = {
    kind: "dir",
    name: "",
    path: "",
    children: [],
    childMap: new Map(),
  };

  const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const file of sorted) {
    const parts = file.relPath.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      let next = cursor.childMap.get(name);
      if (!next) {
        next = {
          kind: "dir",
          name,
          path,
          children: [],
          childMap: new Map(),
        };
        cursor.childMap.set(name, next);
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({
      kind: "file",
      name: parts[parts.length - 1] ?? file.name,
      file,
    });
  }

  const strip = (nodes: KnowledgeTreeNode[]): KnowledgeTreeNode[] =>
    nodes.map((node) =>
      node.kind === "dir" ? { kind: "dir", name: node.name, path: node.path, children: strip(node.children) } : node,
    );
  return strip(root.children);
}

export function allKnowledgeFolderPaths(
  files: readonly KnowledgeVaultFile[],
): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    for (const folder of folderPathsContaining(file.relPath)) {
      paths.add(folder);
    }
  }
  return [...paths];
}

export function folderPathsContaining(
  relPath: string,
): string[] {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length < 2) return [];
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function normalizeKnowledgeFolderName(raw: string): string | null {
  const name = raw.trim().replace(/\\/g, "/");
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) {
    return null;
  }
  if (name.length > 80) return null;
  return name;
}

export function displayNoteTitle(file: KnowledgeVaultFile): string {
  if (file.relPath === GETTING_STARTED_REL_PATH) return file.name;
  return file.name.replace(/\.(md|txt|csv)$/i, "");
}

export function knowledgeFileLanguage(relPath: string): "markdown" | "text" {
  return String(relPath).toLowerCase().endsWith(".md") ? "markdown" : "text";
}
