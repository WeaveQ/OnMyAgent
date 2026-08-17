import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  collectWindowsWorkBuddyInstallDirs,
  dedupeCodebuddyWorkbuddyAgents,
  isWorkBuddyEmbeddedPath,
  KNOWN_DISCOVERABLE_AGENTS,
  discoverableAgentDrafts,
  resolveDiscoverableAcpArgs,
  windowsPathVariants,
  workbuddyCliCandidatesFromInstallDir,
} from "./detect-local-agents.mjs";

test("isWorkBuddyEmbeddedPath detects macOS app bundle paths", () => {
  assert.equal(
    isWorkBuddyEmbeddedPath(
      "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
    ),
    true,
  );
  assert.equal(isWorkBuddyEmbeddedPath("/usr/local/bin/codebuddy"), false);
  assert.equal(isWorkBuddyEmbeddedPath("/Users/me/.local/bin/codebuddy"), false);
  assert.equal(
    isWorkBuddyEmbeddedPath(
      "C:/Users/me/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/cli/bin/codebuddy.cmd",
    ),
    true,
  );
  assert.equal(
    isWorkBuddyEmbeddedPath(
      "D:/soft/workbuddy/resources/app.asar.unpacked/cli/bin/codebuddy",
    ),
    true,
  );
});

test("windowsPathVariants adds PATHEXT on win32 only", () => {
  const raw = "C:\\Users\\me\\.grok\\bin\\grok";
  const variants = windowsPathVariants(raw);
  assert.ok(variants.includes(raw));
  if (process.platform === "win32") {
    assert.ok(variants.some((item) => /\.exe$/i.test(item)));
  } else {
    assert.deepEqual(variants, [raw]);
  }
});

test("workbuddyCliCandidatesFromInstallDir covers custom Windows install roots", () => {
  const candidates = workbuddyCliCandidatesFromInstallDir("D:\\soft\\workbuddy");
  assert.ok(candidates.some((p) => p.replaceAll("\\", "/").endsWith("cli/bin/codebuddy.cmd")));
});

test("Windows custom WorkBuddy install is discoverable when present", () => {
  if (process.platform !== "win32") return;
  const custom = "D:\\soft\\workbuddy";
  if (!existsSync(custom)) return;
  const dirs = collectWindowsWorkBuddyInstallDirs();
  assert.ok(
    dirs.some((dir) => dir.replaceAll("/", "\\").toLowerCase() === custom.toLowerCase()),
    `expected ${custom} in ${JSON.stringify(dirs)}`,
  );
});

test("catalog includes WorkBuddy and CodeBuddy as separate entries", () => {
  const ids = KNOWN_DISCOVERABLE_AGENTS.map((item) => item.id);
  assert.ok(ids.includes("workbuddy"));
  assert.ok(ids.includes("codebuddy"));
  const workbuddy = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "workbuddy");
  assert.ok(Array.isArray(workbuddy.wellKnownPaths) && workbuddy.wellKnownPaths.length > 0);
  assert.equal(typeof workbuddy.resolveWellKnownPaths, "function");
  assert.deepEqual(workbuddy.acpArgs, ["--acp"]);
  const codebuddy = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "codebuddy");
  assert.equal(codebuddy.skipWorkBuddyEmbedded, true);
});

test("dedupeCodebuddyWorkbuddyAgents keeps WorkBuddy when both share one binary", () => {
  const shared =
    "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
  const out = dedupeCodebuddyWorkbuddyAgents(
    [
      { id: "workbuddy", command: shared },
      { id: "codebuddy", command: shared },
      { id: "grok", command: "/usr/local/bin/grok" },
    ],
    "command",
  );
  assert.deepEqual(
    out.map((item) => item.id),
    ["workbuddy", "grok"],
  );
});

test("dedupeCodebuddyWorkbuddyAgents keeps both when binaries differ", () => {
  const out = dedupeCodebuddyWorkbuddyAgents(
    [
      {
        id: "workbuddy",
        command:
          "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy",
      },
      { id: "codebuddy", command: "/Users/me/.local/bin/codebuddy" },
    ],
    "command",
  );
  assert.deepEqual(
    out.map((item) => item.id),
    ["workbuddy", "codebuddy"],
  );
});

test("discoverableAgentDrafts surfaces WorkBuddy draft", () => {
  const drafts = discoverableAgentDrafts();
  const workbuddy = drafts.find((item) => item.id === "workbuddy");
  assert.ok(workbuddy, "workbuddy draft present");
  assert.equal(workbuddy.name, "WorkBuddy");
  assert.deepEqual(workbuddy.acpArgs, ["--acp"]);
  assert.ok(
    Array.isArray(workbuddy.nativeSkillsDirs) &&
      workbuddy.nativeSkillsDirs.some((dir) => String(dir).includes(".codebuddy")),
  );
  assert.ok(
    workbuddy.nativeSkillsDirs.some((dir) => String(dir).includes(".workbuddy")),
    "WorkBuddy also declares ~/.workbuddy/skills",
  );
});

test("Grok catalog uses well-known paths and enriched PATH resolution", () => {
  const grok = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "grok");
  assert.ok(grok, "grok catalog entry present");
  assert.ok(Array.isArray(grok.wellKnownPaths) && grok.wellKnownPaths.length > 0);
  assert.ok(
    grok.wellKnownPaths.some((p) => String(p).includes(".local") && String(p).endsWith("grok")),
  );
  assert.ok(
    grok.wellKnownPaths.some((p) => String(p).replaceAll("\\", "/").includes(".grok/bin/grok")),
    "official Windows/mac install root ~/.grok/bin",
  );
  assert.ok(
    grok.wellKnownPaths.some((p) => String(p).replaceAll("\\", "/").endsWith(".grok/bin/grok.exe")),
    "official Windows grok.exe next to ~/.grok/bin/grok",
  );
  assert.deepEqual(grok.acpArgs, ["agent", "stdio"]);

  // Source contract: resolveOnPath must walk enrichedPath, not raw process.env.PATH only.
  const src = readFileSync(new URL("./detect-local-agents.mjs", import.meta.url), "utf8");
  assert.match(src, /enrichedPath/);
  assert.match(src, /wellKnownPaths/);
  assert.match(src, /from "\.\.\/runtime-path-env\.mjs"/);
});

test("Pi catalog prefers pi-acp then pi, with protocol-aware acpArgs", () => {
  const pi = KNOWN_DISCOVERABLE_AGENTS.find((item) => item.id === "pi");
  assert.ok(pi, "pi catalog entry present");
  assert.deepEqual(pi.commands, ["pi-acp", "pi"]);
  assert.deepEqual(pi.acpArgs, ["--mode", "rpc"]);
  assert.ok(Array.isArray(pi.wellKnownPaths) && pi.wellKnownPaths.some((p) => String(p).endsWith("pi")));
  assert.ok(
    Array.isArray(pi.wellKnownPaths) && pi.wellKnownPaths.some((p) => String(p).endsWith("pi-acp")),
  );
  assert.ok(
    Array.isArray(pi.skillsDirs) && pi.skillsDirs.some((dir) => String(dir).includes(".pi")),
  );

  assert.deepEqual(resolveDiscoverableAcpArgs(pi, "/opt/homebrew/bin/pi"), ["--mode", "rpc"]);
  assert.deepEqual(resolveDiscoverableAcpArgs(pi, "/usr/local/bin/pi-acp"), []);
  assert.deepEqual(resolveDiscoverableAcpArgs(pi, "/opt/homebrew/bin/pi-acp"), []);
  assert.deepEqual(resolveDiscoverableAcpArgs(pi, "C:\\Users\\me\\bin\\pi-acp.cmd"), []);

  const drafts = discoverableAgentDrafts();
  const draft = drafts.find((item) => item.id === "pi");
  assert.ok(draft, "pi draft present in discoverable catalog");
  assert.equal(draft.name, "Pi CLI");
  assert.equal(draft.provider, "custom");
  assert.equal(draft.supportsAcp, true);
});

test("preferPiAcpAgent upgrades native pi path when pi-acp is preferred", async () => {
  const { preferPiAcpAgent } = await import("./detect-local-agents.mjs");
  // Already on pi-acp: only clear stale acpArgs.
  const already = preferPiAcpAgent({
    id: "pi",
    executablePath: "/opt/homebrew/bin/pi-acp",
    acpArgs: ["--mode", "rpc"],
  });
  assert.equal(already.executablePath, "/opt/homebrew/bin/pi-acp");
  assert.deepEqual(already.acpArgs, []);

  // Non-pi agents unchanged.
  const other = preferPiAcpAgent({ id: "claude", executablePath: "/usr/bin/claude" });
  assert.equal(other.executablePath, "/usr/bin/claude");
});

test("pickPiDisplayVersion prefers native pi release over empty/adapter versions", async () => {
  const { pickPiDisplayVersion } = await import("./detect-local-agents.mjs");
  assert.equal(pickPiDisplayVersion("", "0.84.1"), "0.84.1");
  assert.equal(pickPiDisplayVersion("0.0.33", "0.84.1"), "0.84.1");
  assert.equal(pickPiDisplayVersion("0.0.33", ""), null);
  assert.equal(pickPiDisplayVersion("1.2.3", ""), "1.2.3");
});
