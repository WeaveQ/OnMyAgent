import { describe, expect, test } from "bun:test";

import {
  bookmarkDomain,
  buildBookmarkMarkdown,
  buildSessionArchiveMarkdown,
  isBookmarkProps,
  isHttpUrl,
  isSessionSource,
  parseBookmarkHref,
  safeArchiveFileName,
  safeBookmarkFileName,
  sessionSource,
} from "../src/react-app/domains/knowledge/knowledge-bookmark";
import { parseKnowledgeNoteProps } from "../src/react-app/domains/knowledge/knowledge-vault-frontmatter";

describe("knowledge link bookmarks", () => {
  test("isHttpUrl accepts only http/https", () => {
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("http://example.com/path?q=1")).toBe(true);
    expect(isHttpUrl("mailto:jane@example.com")).toBe(false);
    expect(isHttpUrl("session:abc")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  test("buildBookmarkMarkdown round-trips title and source URL", () => {
    const md = buildBookmarkMarkdown({ title: "Docs", url: "https://onmyagent.com/docs" });
    const props = parseKnowledgeNoteProps(md);
    expect(props.title).toBe("Docs");
    expect(props.source).toBe("https://onmyagent.com/docs");
    expect(isBookmarkProps(props)).toBe(true);
    expect(parseBookmarkHref(md)).toBe("https://onmyagent.com/docs");
    // The URL remains clickable in the body.
    expect(md).toContain("[https://onmyagent.com/docs](https://onmyagent.com/docs)");
  });

  test("bookmarkDomain strips www", () => {
    expect(bookmarkDomain("https://www.example.com/x")).toBe("example.com");
  });

  test("safeBookmarkFileName rejects path separators and traversal, ends in .md", () => {
    const name = safeBookmarkFileName("My / Docs", "https://example.com");
    expect(name).toMatch(/\.md$/);
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
    // Falls back to a slug from the URL when title is empty.
    const fallback = safeBookmarkFileName("   ", "https://example.com/guide");
    expect(fallback).toMatch(/\.md$/);
    expect(fallback.length).toBeGreaterThan(3);
  });
});

describe("knowledge session archive", () => {
  test("sessionSource / isSessionSource use the session: prefix", () => {
    expect(sessionSource("ses_123")).toBe("session:ses_123");
    expect(isSessionSource("session:ses_123")).toBe(true);
    expect(isSessionSource("https://example.com")).toBe(false);
  });

  test("buildSessionArchiveMarkdown records source=session:<id> and title", () => {
    const md = buildSessionArchiveMarkdown({
      sessionId: "ses_42",
      title: "Weather query",
      body: "# Weather query\n\nIt is sunny.",
    });
    const props = parseKnowledgeNoteProps(md);
    expect(props.title).toBe("Weather query");
    expect(props.source).toBe("session:ses_42");
    expect(isSessionSource(props.source)).toBe(true);
    // Body content survives.
    expect(md).toContain("It is sunny.");
  });

  test("safeArchiveFileName normalizes to a .md note name", () => {
    expect(safeArchiveFileName("Hello / World")).toBe("Hello - World.md");
    expect(safeArchiveFileName("already.md")).toBe("already.md");
    expect(safeArchiveFileName("   ")).toBe("session.md");
    expect(safeArchiveFileName("a/b/../c")).not.toContain("..");
  });
});
