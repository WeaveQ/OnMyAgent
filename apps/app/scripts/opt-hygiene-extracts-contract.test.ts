import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const repoRoot = join(appRoot, "../..");

describe("opt hygiene extracts", () => {
  test("extensions-store skill actions are extracted and wired", () => {
    const skillActions = join(
      appRoot,
      "src/react-app/domains/settings/state/extensions-store-skill-actions.ts",
    );
    const store = join(
      appRoot,
      "src/react-app/domains/settings/state/extensions-store.ts",
    );
    expect(existsSync(skillActions)).toBe(true);
    const storeSrc = readFileSync(store, "utf8");
    expect(storeSrc).toContain('from "./extensions-store-skill-actions"');
    expect(storeSrc).toContain("createExtensionsSkillActions");
    expect(storeSrc).not.toContain("async function importLocalSkill(");
    const actionsSrc = readFileSync(skillActions, "utf8");
    expect(actionsSrc).toContain("export function createExtensionsSkillActions");
    expect(actionsSrc).toContain("importLocalSkill");
  });

  test("TopRightNotifications is mounted from reload coordinator", () => {
    const reload = readFileSync(
      join(appRoot, "src/react-app/shell/reload-coordinator.tsx"),
      "utf8",
    );
    expect(reload).toContain("TopRightNotifications");
    expect(reload).toContain("<TopRightNotifications");
    expect(reload).not.toContain("StatusToastsViewport");
  });

  test("SessionPageProps has a single canonical definition", () => {
    const pages = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/session-page-types.ts"),
      "utf8",
    );
    const chat = readFileSync(
      join(appRoot, "src/react-app/domains/session/chat/session-page.tsx"),
      "utf8",
    );
    expect(pages).toContain("export type SessionPageProps = {");
    expect(chat).not.toContain("export type SessionPageProps = {");
    expect(chat).toContain('from "../pages/session-page-types"');
  });
});

describe("server archive search extract", () => {
  test("session-archive wires createSessionArchiveSearchApi", () => {
    const archive = readFileSync(
      join(repoRoot, "apps/server/src/services/session-archive.ts"),
      "utf8",
    );
    const searchApi = join(
      repoRoot,
      "apps/server/src/services/session-archive-search-api.ts",
    );
    expect(existsSync(searchApi)).toBe(true);
    expect(archive).toContain("createSessionArchiveSearchApi");
    expect(archive).not.toContain("function searchSession(");
    const apiSrc = readFileSync(searchApi, "utf8");
    expect(apiSrc).toContain("export function createSessionArchiveSearchApi");
    expect(apiSrc).toContain("function searchSession");
  });
});
