import { describe, expect, test } from "bun:test";

import {
  joinKnowledgePath,
  listKnowledgeChildren,
  removeKnowledgeNode,
  type ExpertKnowledgeEntry,
} from "../src/react-app/domains/agents/expert-creation-page";

const entries: ExpertKnowledgeEntry[] = [
  { kind: "directory", relativePath: "product-notes" },
  { kind: "directory", relativePath: "product-notes/research" },
  { kind: "file", relativePath: "product-notes/research/brief.txt" },
  { kind: "file", relativePath: "root.txt" },
];

describe("expert creation knowledge browser", () => {
  test("lists only direct children and synthesizes folders for nested files", () => {
    expect(listKnowledgeChildren(entries, "").map((node) => [node.kind, node.name])).toEqual([
      ["directory", "product-notes"],
      ["file", "root.txt"],
    ]);
    expect(listKnowledgeChildren(entries, "product-notes").map((node) => [node.kind, node.name])).toEqual([
      ["directory", "research"],
    ]);
  });

  test("joins uploads and created folders to the open directory", () => {
    expect(joinKnowledgePath("product-notes/research", "source.pdf")).toBe(
      "product-notes/research/source.pdf",
    );
    expect(joinKnowledgePath("", "source.pdf")).toBe("source.pdf");
  });

  test("removes a directory and all descendants without touching siblings", () => {
    expect(removeKnowledgeNode(entries, "product-notes")).toEqual([
      { kind: "file", relativePath: "root.txt" },
    ]);
  });
});
