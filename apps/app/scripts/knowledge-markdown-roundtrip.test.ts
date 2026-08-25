import { describe, expect, test } from "bun:test";

import {
  blocksToMarkdown,
  markdownToBlocks,
  type MarkdownBlock,
} from "../src/react-app/domains/knowledge/knowledge-markdown-roundtrip";

const DOC = `# H1

## H2

### H3

#### H4

##### H5

###### H6

A paragraph with **bold**, *italic*, and \`inline code\`, plus a [link](https://example.com).

- bullet one
- bullet two

1. first
2. second

- [ ] open todo
- [x] done todo

> A blockquote
> spanning two lines

\`\`\`ts
const x: number = 1;
console.log(x);
\`\`\`

| Name | Value |
| --- | --- |
| alpha | 1 |
| beta | 2 |
`;

function find<T extends MarkdownBlock["type"]>(
  blocks: MarkdownBlock[],
  type: T,
): Extract<MarkdownBlock, { type: T }> {
  const found = blocks.find((b) => b.type === type) as Extract<MarkdownBlock, { type: T }> | undefined;
  if (!found) throw new Error(`missing block ${type}`);
  return found;
}

describe("markdown roundtrip", () => {
  test("parses representative document into blocks", () => {
    const blocks = markdownToBlocks(DOC);
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const heading = blocks.find(
        (b): b is Extract<MarkdownBlock, { type: "heading" }> =>
          b.type === "heading" && b.level === level,
      );
      expect(heading, `h${level}`).toBeDefined();
    }

    const bullets = find(blocks, "bulletList");
    expect(bullets.items).toHaveLength(2);

    const ordered = find(blocks, "orderedList");
    expect(ordered.items).toHaveLength(2);

    const todos = blocks.filter((b): b is Extract<MarkdownBlock, { type: "todo" }> => b.type === "todo");
    expect(todos).toHaveLength(2);
    expect(todos[0]?.checked).toBe(false);
    expect(todos[1]?.checked).toBe(true);

    const code = find(blocks, "code");
    expect(code.lang).toBe("ts");
    expect(code.code).toContain("const x: number = 1;");

    const quote = find(blocks, "blockquote");
    expect(quote.children.map((s) => s.text).join("")).toContain("A blockquote");
    expect(quote.children.map((s) => s.text).join("")).toContain("spanning two lines");

    const table = find(blocks, "table");
    expect(table.headers).toHaveLength(2);
    expect(table.headers[0]?.map((s) => s.text).join("")).toBe("Name");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.[0]?.map((s) => s.text).join("")).toBe("beta");

    const paragraph = find(blocks, "paragraph");
    expect(paragraph.children.some((s) => s.bold && s.text.includes("bold"))).toBe(true);
    expect(paragraph.children.some((s) => s.italic && s.text.includes("italic"))).toBe(true);
    expect(paragraph.children.some((s) => s.code && s.text === "inline code")).toBe(true);
    expect(paragraph.children.some((s) => s.text.includes("[link](https://example.com)"))).toBe(true);
  });

  test("blocksToMarkdown round-trips back to equivalent structure", () => {
    const blocks = markdownToBlocks(DOC);
    const md = blocksToMarkdown(blocks);
    const reparsed = markdownToBlocks(md);

    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      expect(
        reparsed.some((b) => b.type === "heading" && b.level === level),
        `h${level} roundtrips`,
      ).toBe(true);
    }

    expect(find(reparsed, "bulletList").items).toHaveLength(2);
    expect(find(reparsed, "orderedList").items).toHaveLength(2);

    const todos = reparsed.filter((b) => b.type === "todo");
    expect(todos).toHaveLength(2);
    expect(todos[0]?.checked).toBe(false);
    expect(todos[1]?.checked).toBe(true);

    const code = find(reparsed, "code");
    expect(code.lang).toBe("ts");
    expect(code.code).toBe("const x: number = 1;\nconsole.log(x);");

    const table = find(reparsed, "table");
    expect(table.headers).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.[1]?.map((s) => s.text).join("")).toBe("2");

    const paragraph = find(reparsed, "paragraph");
    expect(paragraph.children.some((s) => s.bold)).toBe(true);
    expect(paragraph.children.some((s) => s.italic)).toBe(true);
    expect(paragraph.children.some((s) => s.code)).toBe(true);
    // Link text survives as a parseable markdown link.
    expect(paragraph.children.some((s) => /\[link\]\(https?:/.test(s.text))).toBe(true);
  });

  test("empty and whitespace input do not throw and produce no blocks", () => {
    expect(markdownToBlocks("")).toEqual([]);
    expect(markdownToBlocks("   \n  \n")).toEqual([]);
    expect(blocksToMarkdown([])).toBe("");
  });
});
