import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  foldKnowledgeNeedle,
  knowledgeTextMatchesQuery,
} from "./knowledge-search-match.mjs";

describe("knowledge search match", () => {
  test("folds hyphen underscore and slash to spaces", () => {
    assert.equal(foldKnowledgeNeedle("Getting-started.md"), "getting started md");
    assert.equal(foldKnowledgeNeedle("Getting started"), "getting started");
  });

  test("spaced query hits hyphenated filename", () => {
    assert.equal(knowledgeTextMatchesQuery("getting-started.md", "Getting started"), true);
    assert.equal(knowledgeTextMatchesQuery("Knowledge vault / 知识库", "Getting started"), false);
    assert.equal(knowledgeTextMatchesQuery("getting-started.md", "getting-started"), true);
  });
});
