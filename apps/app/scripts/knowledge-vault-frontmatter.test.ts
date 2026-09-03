import { describe, expect, test } from "bun:test";

import {
  applyKnowledgeNoteProps,
  headingTitleFromBody,
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

  test("headingTitleFromBody only reads a leading h1", () => {
    expect(headingTitleFromBody("# Hello\n")).toBe("Hello");
    expect(headingTitleFromBody("\n\n# Hello\n")).toBe("Hello");
    expect(headingTitleFromBody("Intro\n\n# Later\n")).toBe("");
    expect(headingTitleFromBody("## Not h1\n")).toBe("");
  });

  test("empty frontmatter fences do not leak into the editor body", () => {
    expect(splitMarkdownFrontmatter("---\n---\n").body).toBe("");
    expect(splitMarkdownFrontmatter("---\n---\n# Hello\n").body).toBe("# Hello\n");
    expect(applyKnowledgeNoteProps("---\n---\n# Hello\n", parseKnowledgeNoteProps("---\n---\n# Hello\n"))).toBe(
      "# Hello\n",
    );
  });

  test("unknown top-level keys and their block lists survive a save roundtrip", () => {
    const source = `---
title: My Note
created: 2026/06/10
tags:
  - alpha
author: Jane
custom: value with spaces
labels:
  - a
  - b
nested:
  key: kept
---

# Body
`;
    const props = parseKnowledgeNoteProps(source);
    expect(props.title).toBe("My Note");
    expect(props.tags).toEqual(["alpha"]);

    const next = applyKnowledgeNoteProps(source, { ...props, tags: [...props.tags, "beta"] });

    // Unknown keys remain verbatim, including their indented block bodies.
    expect(next).toContain("author: Jane");
    expect(next).toContain("custom: value with spaces");
    expect(next).toContain("labels:\n  - a\n  - b");
    expect(next).toContain("nested:\n  key: kept");

    // Known field edit took effect.
    expect(parseKnowledgeNoteProps(next).tags).toEqual(["alpha", "beta"]);

    // Body untouched.
    expect(next).toContain("# Body");
  });

  test("editing title preserves unknown keys", () => {
    const source = `---
title: Old
author: Jane
---
body`;
    const props = parseKnowledgeNoteProps(source);
    const next = applyKnowledgeNoteProps(source, { ...props, title: "New" });
    expect(parseKnowledgeNoteProps(next).title).toBe("New");
    expect(next).toContain("author: Jane");
    expect(next).toContain("body");
  });

  test("unknown keys with no known props still produce a preserving fence", () => {
    const source = `---
author: Jane
---

# Body
`;
    const props = parseKnowledgeNoteProps(source);
    const next = applyKnowledgeNoteProps(source, props);
    expect(next).toContain("author: Jane");
    expect(next).toContain("# Body");
  });
});
