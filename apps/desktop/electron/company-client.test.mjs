/**
 * M5 company client unit tests (no live server).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  allowPersonalSkills,
  connectCompany,
  disconnectCompany,
  evaluateCompanyActionPolicy,
  hasCompanySession,
  listCompanyCatalog,
  listPersonalSkillPackages,
  mergeSkillPackageIds,
  normalizeCompanyBaseUrl,
  readCompanySettings,
  resolveActiveConfigRoot,
  resolveActiveSkillsRoot,
  resolveCompanySkillsInstalledRoot,
  resolvePersonalSkillsRoot,
  shouldCallCompany,
  writeCompanySettings,
} from "./company-client.mjs";
import { createCompanyDomainHandlers } from "./desktop-handlers/company.mjs";
import {
  resolveCompanyConfigRoot,
  resolveCompanySettingsPath,
} from "./config-profile-paths.mjs";

describe("company-client M5", () => {
  test("normalizeCompanyBaseUrl strips trailing slash", () => {
    assert.equal(normalizeCompanyBaseUrl("http://localhost:3000/"), "http://localhost:3000");
    assert.equal(normalizeCompanyBaseUrl("  "), undefined);
  });

  test("no BaseUrl → no company HTTP eligibility", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      const settings = readCompanySettings(home);
      assert.equal(shouldCallCompany(settings), false);
      assert.equal(hasCompanySession(settings), false);
      assert.equal(resolveActiveConfigRoot(home).profile, "local");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("settings persist companyBaseUrl without session", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      writeCompanySettings(home, { companyBaseUrl: "http://gw.example:3000" });
      const s = readCompanySettings(home);
      assert.equal(s.companyBaseUrl, "http://gw.example:3000");
      assert.equal(s.activeProfile, "local");
      assert.equal(shouldCallCompany(s), false);
      const settingsPath = resolveCompanySettingsPath(home);
      assert.ok((await readFile(settingsPath, "utf8")).includes("gw.example"));
      assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);
      assert.equal((await stat(path.dirname(settingsPath))).mode & 0o777, 0o700);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("connectCompany login + pull writes company profile", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      const fetchMock = createCompanyFetchMock();
      const result = await connectCompany(home, {
        companyBaseUrl: "http://company.test",
        email: "admin@acme.test",
        code: "000000",
        fetch: fetchMock,
      });
      assert.equal(result.settings.activeProfile, "company");
      assert.equal(result.settings.memberToken, "tok-abc");
      assert.equal(result.settings.memberId, "m-1");
      assert.equal(shouldCallCompany(result.settings), true);

      const companyRoot = resolveCompanyConfigRoot(home);
      const manifest = JSON.parse(await readFile(path.join(companyRoot, "manifest.json"), "utf8"));
      assert.equal(manifest.version, "cfg-1");
      const policy = JSON.parse(await readFile(path.join(companyRoot, "policy.json"), "utf8"));
      assert.deepEqual(policy.allowedActions, ["*"]);

      const active = resolveActiveConfigRoot(home);
      assert.equal(active.profile, "company");
      assert.equal(active.root, companyRoot);
      assert.equal(resolveActiveSkillsRoot(home), resolveCompanySkillsInstalledRoot(home));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("settings UI path: write session then disconnect clears token keeps BaseUrl", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      // Simulate Company settings connect write (same functions IPC handlers call)
      writeCompanySettings(home, {
        companyBaseUrl: "http://company.example:3000",
        memberToken: "omc_session_token",
        memberId: "member-xyz",
        email: "admin@acme.test",
        activeProfile: "company",
        lastSyncedVersion: "cfg-9",
      });
      const afterConnect = readCompanySettings(home);
      assert.equal(afterConnect.companyBaseUrl, "http://company.example:3000");
      assert.equal(afterConnect.memberToken, "omc_session_token");
      assert.equal(afterConnect.activeProfile, "company");
      assert.equal(hasCompanySession(afterConnect), true);

      const afterDisconnect = await disconnectCompany(home, {
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      });
      assert.equal(afterDisconnect.memberToken, undefined);
      assert.equal(afterDisconnect.activeProfile, "local");
      assert.equal(afterDisconnect.companyBaseUrl, "http://company.example:3000");
      // Re-read from disk (durable path company-settings.json)
      const disk = readCompanySettings(home);
      assert.equal(disk.memberToken, undefined);
      assert.equal(disk.companyBaseUrl, "http://company.example:3000");
      assert.equal(shouldCallCompany(disk), false);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("renderer-facing company handlers never return or accept memberToken", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      writeCompanySettings(home, {
        companyBaseUrl: "http://company.example:3000",
        memberToken: "main-only-token",
        memberId: "member-xyz",
        activeProfile: "company",
      });
      const handlers = createCompanyDomainHandlers({ getRealHomeDir: () => home });
      const read = await handlers.companySettingsRead({}, []);
      assert.equal("memberToken" in read, false);
      assert.equal(read.connected, true);

      const written = await handlers.companySettingsWrite({}, [{
        companyBaseUrl: "http://company.example:3000",
        memberToken: "renderer-injected-token",
      }]);
      assert.equal("memberToken" in written, false);
      assert.equal(readCompanySettings(home).memberToken, "main-only-token");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("connected company fails closed when mirrored policy is missing", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      writeCompanySettings(home, {
        companyBaseUrl: "http://company.example:3000",
        memberToken: "main-only-token",
        activeProfile: "company",
      });
      const decision = evaluateCompanyActionPolicy(home, "company.catalog.read");
      assert.equal(decision.allowed, false);
      assert.equal(decision.source, "org");
      assert.match(decision.reason, /策略不可用/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("S4 personal overlay respects allowPersonal policy", () => {
    assert.equal(allowPersonalSkills({ skills: { allowPersonal: false } }), false);
    assert.equal(allowPersonalSkills({}), true);
    const merged = mergeSkillPackageIds(["org@1"], ["mine@1", "org@1"], {
      skills: { allowPersonal: true },
    });
    assert.deepEqual(merged.packageIds, ["org@1", "mine@1"]);
    const blocked = mergeSkillPackageIds(["org@1"], ["mine@1"], {
      skills: { allowPersonal: false },
    });
    assert.deepEqual(blocked.packageIds, ["org@1"]);
    assert.equal(blocked.personalIncluded, false);
  });

  test("listPersonalSkillPackages reads mine folder", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      const mine = resolvePersonalSkillsRoot(home);
      await mkdir(path.join(mine, "personal-note@0.1.0"), { recursive: true });
      assert.deepEqual(listPersonalSkillPackages(home), ["personal-note@0.1.0"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("listCompanyCatalog empty when logged out; lists skills after connect", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      assert.equal(listCompanyCatalog(home).connected, false);
      assert.deepEqual(listCompanyCatalog(home).skills, []);

      await connectCompany(home, {
        companyBaseUrl: "http://company.test",
        email: "admin@acme.test",
        code: "000000",
        fetch: createCompanyFetchMock(),
      });
      const catalog = listCompanyCatalog(home);
      assert.equal(catalog.connected, true);
      assert.ok(catalog.skills.some((s) => s.id === "org-weekly-report"));
      assert.ok(catalog.experts.some((e) => e.id === "org-legal-expert"));
      // Live connections enrich 连接器 list (gateway.services).
      assert.ok(catalog.gatewayServices.some((s) => s.id === "hackernews"));
      assert.ok(catalog.gatewayServices.some((s) => s.id === "arxiv"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("disconnectCompany clears session and keeps BaseUrl", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "oma-co-"));
    try {
      await mkdir(resolveCompanyConfigRoot(home), { recursive: true });
      await writeFile(
        path.join(resolveCompanyConfigRoot(home), "manifest.json"),
        JSON.stringify({ version: "cfg-1" }),
      );
      writeCompanySettings(home, {
        companyBaseUrl: "http://company.test",
        memberToken: "tok",
        memberId: "m-1",
        activeProfile: "company",
      });
      const after = await disconnectCompany(home, {
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      });
      assert.equal(after.activeProfile, "local");
      assert.equal(after.memberToken, undefined);
      assert.equal(after.companyBaseUrl, "http://company.test");
      assert.equal(resolveActiveConfigRoot(home).profile, "local");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

function createCompanyFetchMock() {
  return async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/api/company/health")) {
      return json({ ok: true, companyModule: true });
    }
    if (u.endsWith("/api/company/auth/email/start")) {
      return json({ ok: true, devCode: "000000" });
    }
    if (u.endsWith("/api/company/auth/email/verify")) {
      return json({
        ok: true,
        token: "tok-abc",
        member: { id: "m-1", email: "admin@acme.test", roles: ["admin"] },
      });
    }
    if (u.endsWith("/api/org/config/manifest")) {
      return json({ version: "cfg-1", orgId: "default" });
    }
    if (u.endsWith("/api/org/config")) {
      return json({
        version: "cfg-1",
        config: {
          policy: { allowedActions: ["*"], blockedActions: ["admin.*"] },
          models: { models: [{ id: "org-model", name: "Org Model" }] },
          skills: {
            installed: ["org-weekly-report"],
            enabled: { enabled: ["org-weekly-report"] },
          },
          experts: {
            installed: ["org-legal-expert"],
            mine: [],
          },
          tools: {
            gateway: { services: [{ id: "mail", name: "Org Mail" }] },
            mcp: { servers: [] },
          },
        },
      });
    }
    if (u.includes("/api/catalog/skills?") || u.endsWith("/api/catalog/skills?scope=org")) {
      return json({
        items: [
          {
            packageId: "org-weekly-report",
            name: "Weekly Report",
            added: true,
          },
        ],
      });
    }
    if (u.includes("/api/catalog/skills/")) {
      const id = decodeURIComponent(u.split("/api/catalog/skills/")[1] || "");
      return json({
        meta: { packageId: id, name: id === "org-weekly-report" ? "Weekly Report" : id },
        skillMd: `# ${id}\n\nOrg skill body.\n`,
      });
    }
    if (u.endsWith("/api/connections")) {
      return json([
        {
          id: "hackernews:default",
          service: "hackernews",
          connectionName: "default",
          profile: { displayName: "Hacker News" },
        },
        {
          id: "arxiv:default",
          service: "arxiv",
          connectionName: "default",
          profile: { displayName: "arXiv Public" },
        },
      ]);
    }
    return new Response(`unexpected ${u} ${init.method || "GET"}`, { status: 404 });
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
