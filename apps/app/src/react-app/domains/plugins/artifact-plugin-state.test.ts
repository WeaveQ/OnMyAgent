import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ArtifactPluginCatalogItem } from "@onmyagent/types/server";

import { createArtifactPluginState } from "./artifact-plugin-state";

const documentsEnabled = {
  id: "documents",
  manifest: {
    name: "documents",
    version: "1.0.0",
    description: "Document workflows",
    author: { name: "OnMyAgent" },
    keywords: [],
    interface: {
      displayName: "Documents",
      shortDescription: "Create and edit documents",
      longDescription: "Create and edit documents",
      developerName: "OnMyAgent",
      category: "Productivity",
      capabilities: ["documents"],
      defaultPrompt: ["Create a report", "Edit this document", "Review changes"],
      screenshots: [],
    },
  },
  runtime: {
    skills: [{ id: "documents", defaultEnabled: true }],
    routing: { extensions: [".docx"], mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  },
  enabled: true,
  skills: [{ id: "documents", enabled: true, defaultEnabled: true }],
} satisfies ArtifactPluginCatalogItem;

function deferred() {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("artifact plugin optimistic state", () => {
  test("optimistic plugin toggle rolls back on request failure", async () => {
    const state = createArtifactPluginState([documentsEnabled]);
    const pending = state.setPluginEnabled("documents", false, async () => {
      throw new Error("offline");
    });

    assert.equal(state.get("documents")?.enabled, false);
    await assert.rejects(pending, /offline/);
    assert.equal(state.get("documents")?.enabled, true);
  });

  test("an older failed plugin toggle cannot roll back a newer success", async () => {
    const state = createArtifactPluginState([documentsEnabled]);
    const older = deferred();
    const newer = deferred();

    const first = state.setPluginEnabled("documents", false, () => older.promise);
    const second = state.setPluginEnabled("documents", true, () => newer.promise);
    newer.resolve();
    await second;
    older.reject(new Error("late failure"));
    await assert.rejects(first, /late failure/);

    assert.equal(state.get("documents")?.enabled, true);
  });

  test("optimistic skill toggle rolls back on request failure", async () => {
    const state = createArtifactPluginState([documentsEnabled]);
    const pending = state.setSkillEnabled("documents", "documents", false, async () => {
      throw new Error("offline");
    });

    assert.equal(state.get("documents")?.skills[0]?.enabled, false);
    await assert.rejects(pending, /offline/);
    assert.equal(state.get("documents")?.skills[0]?.enabled, true);
  });

  test("an older failed skill toggle cannot roll back a newer success", async () => {
    const state = createArtifactPluginState([documentsEnabled]);
    const older = deferred();
    const newer = deferred();

    const first = state.setSkillEnabled("documents", "documents", false, () => older.promise);
    const second = state.setSkillEnabled("documents", "documents", true, () => newer.promise);
    newer.resolve();
    await second;
    older.reject(new Error("late failure"));
    await assert.rejects(first, /late failure/);

    assert.equal(state.get("documents")?.skills[0]?.enabled, true);
  });
});
