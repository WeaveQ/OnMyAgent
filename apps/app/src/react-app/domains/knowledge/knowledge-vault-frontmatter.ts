export type KnowledgeNoteProps = {
  title: string;
  created: string;
  updated: string;
  tags: string[];
  related: string[];
  source: string;
};

const EMPTY: KnowledgeNoteProps = {
  title: "",
  created: "",
  updated: "",
  tags: [],
  related: [],
  source: "",
};

export function splitMarkdownFrontmatter(markdown: string): { raw: string; body: string } {
  const source = String(markdown ?? "");
  const withFields = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (withFields) {
    return { raw: withFields[1] ?? "", body: source.slice(withFields[0].length) };
  }
  const emptyFence = source.match(/^---[ \t]*\r?\n---[ \t]*(?:\r?\n|$)/);
  if (emptyFence) return { raw: "", body: source.slice(emptyFence[0].length) };
  return { raw: "", body: source };
}

function parseScalar(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseList(raw: string): string[] {
  const inline = raw.trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter(Boolean);
  }
  return inline
    ? inline
        .split(",")
        .map((item) => parseScalar(item))
        .filter(Boolean)
    : [];
}

export function parseKnowledgeNoteProps(markdown: string): KnowledgeNoteProps {
  const { raw } = splitMarkdownFrontmatter(markdown);
  if (!raw.trim()) return { ...EMPTY };
  const props: KnowledgeNoteProps = { ...EMPTY, tags: [], related: [] };
  let listKey: "tags" | "related" | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const item = line.match(/^\s*-\s+(.+)$/);
    if (item && listKey) {
      const value = parseScalar(item[1] ?? "");
      if (value) props[listKey].push(value);
      continue;
    }
    const pair = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!pair) {
      listKey = null;
      continue;
    }
    const key = pair[1].toLowerCase();
    const value = pair[2] ?? "";
    if (key === "title") {
      props.title = parseScalar(value);
      listKey = null;
    } else if (key === "created" || key === "date" || key === "created_at") {
      props.created = parseScalar(value);
      listKey = null;
    } else if (key === "updated" || key === "modified" || key === "updated_at") {
      props.updated = parseScalar(value);
      listKey = null;
    } else if (key === "tags" || key === "tag") {
      props.tags = parseList(value);
      listKey = "tags";
    } else if (key === "related" || key === "links") {
      props.related = parseList(value);
      listKey = "related";
    } else if (key === "source") {
      props.source = parseScalar(value);
      listKey = null;
    } else {
      listKey = null;
    }
  }
  return props;
}

function quoteIfNeeded(value: string): string {
  if (/[:#{}[\],&*?|<>=!%@`]/.test(value) || value.includes(" ")) {
    return JSON.stringify(value);
  }
  return value;
}

// Aliases accepted on parse must be dropped on serialize (the canonical key is
// emitted); every other top-level key is an unknown pass-through.
const KNOWN_KEYS = new Set([
  "title",
  "created",
  "date",
  "created_at",
  "updated",
  "modified",
  "updated_at",
  "tags",
  "tag",
  "related",
  "links",
  "source",
]);

const TOP_LEVEL_KEY = /^([A-Za-z][\w-]*):(?:\s*(.*))?$/;

function serializeKnownPropLines(props: KnowledgeNoteProps): string[] {
  const lines: string[] = [];
  if (props.title.trim()) lines.push(`title: ${quoteIfNeeded(props.title.trim())}`);
  if (props.created.trim()) lines.push(`created: ${quoteIfNeeded(props.created.trim())}`);
  if (props.updated.trim()) lines.push(`updated: ${quoteIfNeeded(props.updated.trim())}`);
  if (props.tags.length > 0) {
    lines.push("tags:");
    for (const tag of props.tags) lines.push(`  - ${quoteIfNeeded(tag)}`);
  }
  if (props.related.length > 0) {
    lines.push("related:");
    for (const link of props.related) lines.push(`  - ${quoteIfNeeded(link)}`);
  }
  if (props.source.trim()) lines.push(`source: ${quoteIfNeeded(props.source.trim())}`);
  return lines;
}

// Returns lines of the original fence that do not belong to a known key, in
// their original order and text. Known keys and their indented block-list
// continuations are omitted so the canonical known fields can be re-emitted.
function extractUnknownFrontmatterLines(raw: string): string[] {
  if (!raw.trim()) return [];
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const pair = line.match(TOP_LEVEL_KEY);
    if (pair) {
      const key = (pair[1] ?? "").toLowerCase();
      i += 1;
      if (KNOWN_KEYS.has(key)) {
        // Skip the known key plus its indented block-list continuations.
        while (i < lines.length && /^\s+\S/.test(lines[i] ?? "")) i += 1;
        continue;
      }
      kept.push(line);
      // Preserve the unknown key together with its indented block body
      // (block lists, block scalars, etc.).
      while (i < lines.length && /^\s+\S/.test(lines[i] ?? "")) {
        kept.push(lines[i] ?? "");
        i += 1;
      }
      continue;
    }
    // Comments, blank lines, and orphan lines are passed through verbatim.
    kept.push(line);
    i += 1;
  }
  return kept;
}

export function serializeKnowledgeNoteProps(props: KnowledgeNoteProps): string {
  const lines = ["---", ...serializeKnownPropLines(props), "---", ""];
  return lines.join("\n");
}

export function applyKnowledgeNoteProps(markdown: string, props: KnowledgeNoteProps): string {
  const { raw, body } = splitMarkdownFrontmatter(markdown);
  const knownLines = serializeKnownPropLines(props);
  const unknownLines = extractUnknownFrontmatterLines(raw);
  if (knownLines.length === 0 && unknownLines.length === 0) return body;
  const fence = ["---", ...knownLines, ...unknownLines, "---", ""].join("\n");
  return `${fence}${body.replace(/^\n/, "")}`;
}

export function headingTitleFromBody(body: string): string {
  // Leading h1 only. `/m` would treat a later "# Section" as the document title
  // and the reader would hide its synthetic h1.
  return body.match(/^\s*#\s+([^\n\r]+)/)?.[1]?.trim() ?? "";
}

export function countKnowledgeBody(body: string): { words: number; chars: number } {
  const text = String(body ?? "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9_]+/g) ?? []).length;
  return { words: cjk + latin, chars: text.replace(/\s/g, "").length };
}

export function countFilledKnowledgeProps(props: KnowledgeNoteProps): number {
  return [
    props.title.trim(),
    props.created.trim(),
    props.updated.trim(),
    props.tags.length > 0 ? "tags" : "",
    props.related.length > 0 ? "related" : "",
    props.source.trim(),
  ].filter(Boolean).length;
}
