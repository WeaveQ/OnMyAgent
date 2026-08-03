/**
 * M5 company client unit tests (no live server).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  allowPersonalSkills,
  connectCompany,
  disconnectCompany,
  hasCompanySession,
  listPersonalSkillPackages,
  mergeSkillPackageIds,
  normalizeCompanyBaseUrl,
  readCompanySettings,
  resolveActiveConfigRoot,
  resolvePersonalSkillsRoot,
  shouldCallCompany,
  writeCompanySettings,
} from "./company-client.mjs";
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
      assert.ok((await readFile(resolveCompanySettingsPath(home), "utf8")).includes("gw.example"));
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
          policy: { allowedActions: ["*"] },
          models: { items: [] },
        },
      });
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
