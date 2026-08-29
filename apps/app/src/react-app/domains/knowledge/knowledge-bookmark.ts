import {
  applyKnowledgeNoteProps,
  parseKnowledgeNoteProps,
  type KnowledgeNoteProps,
} from "./knowledge-vault-frontmatter";

/**
 * Link bookmarks are normal Markdown notes whose frontmatter `source` is an
 * http(s) URL. Activating one opens the URL in the system browser.
 */

export function isHttpUrl(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A note is a bookmark when its frontmatter source is a valid http(s) URL. */
export function isBookmarkProps(
  props: Pick<KnowledgeNoteProps, "source"> | KnowledgeNoteProps,
): boolean {
  return isHttpUrl(props.source ?? "");
}

/** Extract the bookmark URL from frontmatter `source`, or null if absent. */
export function parseBookmarkHref(markdown: string): string | null {
  const source = parseKnowledgeNoteProps(markdown).source.trim();
  return isHttpUrl(source) ? source : null;
}

/** Human-readable host for the list/reader row, e.g. `example.com`. */
export function bookmarkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const MAX_BOOKMARK_STEM_LEN = 80;

/**
 * Produce a filesystem-safe basename (ending in `.md`) from a title/url.
 * Rejects path separators and `..`; never returns an empty stem.
 */
export function safeBookmarkFileName(title: string, url: string): string {
  const candidate = String(title ?? "").trim() || slugFromUrl(url);
  const sanitized = candidate
    .replace(/[\\/]/g, "-")
    .replace(/\.\./g, ".")
    .replace(/[:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.]+/, "")
    .replace(/[.]+$/, "");
  const stem = (sanitized || slugFromUrl(url) || "bookmark").slice(0, MAX_BOOKMARK_STEM_LEN).trim();
  return `${stem}.md`;
}

function slugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, "") ?? "";
    return `${parsed.hostname.replace(/^www\./, "")}${path ? `-${path}` : ""}`;
  } catch {
    return "bookmark";
  }
}

export type BuildBookmarkMarkdownInput = {
  title: string;
  url: string;
  /** Optional created date; defaults to empty (caller may stamp later). */
  created?: string;
};

/**
 * Build bookmark Markdown: frontmatter title + source, with a readable link
 * line in the body. Round-trips through `parseKnowledgeNoteProps`.
 */
export function buildBookmarkMarkdown(input: BuildBookmarkMarkdownInput): string {
  const url = String(input.url ?? "").trim();
  const title = String(input.title ?? "").trim() || bookmarkDomain(url) || url;
  const props: KnowledgeNoteProps = {
    title,
    created: input.created?.trim() ?? "",
    updated: "",
    tags: [],
    related: [],
    source: url,
  };
  const body = `[${url}](${url})\n`;
  return applyKnowledgeNoteProps(body, props);
}

export type BuildSessionArchiveInput = {
  sessionId: string;
  title: string;
  body: string;
  created?: string;
};

const SESSION_SOURCE_PREFIX = "session:";

/** Source marker for a note archived from a conversation: `session:<id>`. */
export function sessionSource(sessionId: string): string {
  return `${SESSION_SOURCE_PREFIX}${String(sessionId ?? "").trim()}`;
}

export function isSessionSource(source: string): boolean {
  return String(source ?? "").trim().startsWith(SESSION_SOURCE_PREFIX);
}

/** Normalize a session title into a safe .md file name for the archive. */
export function safeArchiveFileName(title: string): string {
  const base = String(title ?? "")
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/\.\./g, ".")
    .replace(/[:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.]+/, "")
    .replace(/[.]+$/, "")
    .slice(0, 80)
    .trim();
  const stem = base || "session";
  return /\.(md|txt|csv)$/i.test(stem) ? stem : `${stem}.md`;
}

/**
 * Build the vault note for an archived session. Frontmatter records the source
 * as `session:<id>`; the transcript body is stored verbatim after the fence.
 */
export function sessionArchiveDefaultTitle(
  session: { title?: unknown } | null | undefined,
  fallback: string,
): string {
  const title = session && typeof session === "object" ? session.title : null;
  return typeof title === "string" && title.trim() ? title.trim() : fallback;
}

export function buildSessionArchiveMarkdown(input: BuildSessionArchiveInput): string {
  const title = String(input.title ?? "").trim() || "Session";
  const props: KnowledgeNoteProps = {
    title,
    created: input.created?.trim() ?? "",
    updated: "",
    tags: [],
    related: [],
    source: sessionSource(input.sessionId),
  };
  const body = String(input.body ?? "").replace(/^\s+/, "");
  return applyKnowledgeNoteProps(body, props);
}
