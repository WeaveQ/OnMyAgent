import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as saveModel from "./expert-creation-save-model";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type { AgentRecord, AgentRegistry } from "./agent-registry-types";

const PACKAGE_AVATAR = "data:image/png;base64,package-avatar";

function mineAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "movie-expert",
    name: "好剧推荐专家",
    description: "推荐好剧",
    quote: "推荐好剧",
    tone: "professional",
    avatarStyle: "pixel",
    avatarOptionId: "pixel-tech",
    customAvatarDataUrl: null,
    modelProvider: "auto",
    model: "Auto",
    enabledToolIds: [],
    defaultWorkspace: "",
    skillIds: [],
    preferredName: "",
    preferredLanguage: "中文",
    userNote: "",
    userBackground: "",
    sourceTemplateId: null,
    marketplaceSource: "mine",
    marketplacePath: "/experts/mine/movie-expert",
    marketplacePackageName: "movie-expert",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function registry(agent = mineAgent()): AgentRegistry {
  return {
    version: 1,
    updatedAt: "2026-08-21T00:00:00.000Z",
    avatars: [],
    templates: [],
    agents: [agent],
    skills: [],
  };
}

describe("imported expert package avatars", () => {
  test("maps the copied package avatar into the imported registry seed", () => {
    const buildSeed = Reflect.get(saveModel, "buildImportedMineExpertSeed");
    assert.equal(typeof buildSeed, "function");
    if (typeof buildSeed !== "function") return;

    const seed = buildSeed({
      path: "/experts/mine/movie-expert",
      packageName: "movie-expert",
      displayName: "好剧推荐专家",
      description: "推荐好剧",
      declaredSkills: ["movie-search"],
      rolePrompt: "推荐匹配的电影",
      memory: "偏好冷门佳作",
      avatarDataUrl: PACKAGE_AVATAR,
    });

    assert.equal(seed.customAvatarDataUrl, PACKAGE_AVATAR);
  });

  test("reconciles an existing imported expert from its package avatar", () => {
    const reconcile = Reflect.get(saveModel, "reconcileImportedMineExpertAvatars");
    assert.equal(typeof reconcile, "function");
    if (typeof reconcile !== "function") return;

    const current = registry();
    const next = reconcile(current, [
      { packageName: "movie-expert", source: "mine", avatarUrl: PACKAGE_AVATAR },
    ]);

    assert.notEqual(next, current);
    assert.equal(next.agents[0]?.customAvatarDataUrl, PACKAGE_AVATAR);
  });

  test("clears a stale imported avatar when the package has no avatar file", () => {
    const reconcile = Reflect.get(saveModel, "reconcileImportedMineExpertAvatars");
    assert.equal(typeof reconcile, "function");
    if (typeof reconcile !== "function") return;

    const next = reconcile(
      registry(mineAgent({ customAvatarDataUrl: PACKAGE_AVATAR })),
      [{ packageName: "movie-expert", source: "mine", avatarUrl: null }],
    );

    assert.equal(next.agents[0]?.customAvatarDataUrl, null);
  });

  test("uses the expert-name initial when a mine expert package has no avatar", () => {
    const current = registry();

    const pending = buildPendingAgentFromRecord(current.agents[0]!, current);

    assert.equal(pending?.avatar.avatarUrl, null);
  });
});
