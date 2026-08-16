import { describe, expect, test } from "bun:test";

import {
  applyKnowledgeNoteProps,
  parseKnowledgeNoteProps,
  splitMarkdownFrontmatter,
} from "../src/react-app/domains/knowledge/knowledge-vault-frontmatter";

describe("knowledge note frontmatter", () => {
  test("reads title tags related and writes them back", () => {
    const source = `---
title: 公司与产品矩阵 v0.1
created: 2026/06/10
updated: 2026/06/10
tags:
  - 公司
  - WeaveQ
related:
  - "[[关于我]]"
---

# Body
`;
    const props = parseKnowledgeNoteProps(source);
    expect(props.title).toBe("公司与产品矩阵 v0.1");
    expect(props.created).toBe("2026/06/10");
    expect(props.tags).toEqual(["公司", "WeaveQ"]);
    expect(props.related).toEqual(["[[关于我]]"]);

    const next = applyKnowledgeNoteProps(source, {
      ...props,
      tags: [...props.tags, "OnMyAgent"],
    });
    expect(next.startsWith("---\n")).toBe(true);
    expect(parseKnowledgeNoteProps(next).tags).toEqual(["公司", "WeaveQ", "OnMyAgent"]);
    expect(next).toContain("# Body");
  });

  test("notes without frontmatter stay body-only until props exist", () => {
    expect(parseKnowledgeNoteProps("# Hello\n").title).toBe("");
    expect(applyKnowledgeNoteProps("# Hello\n", parseKnowledgeNoteProps("# Hello\n"))).toBe(
      "# Hello\n",
    );
  });

  test("empty frontmatter fences do not leak into the editor body", () => {
    expect(splitMarkdownFrontmatter("---\n---\n").body).toBe("");
    expect(splitMarkdownFrontmatter("---\n---\n# Hello\n").body).toBe("# Hello\n");
    expect(applyKnowledgeNoteProps("---\n---\n# Hello\n", parseKnowledgeNoteProps("---\n---\n# Hello\n"))).toBe(
      "# Hello\n",
    );
  });
});
