import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const checkScript = join(here, "check-dual-runtime-boundary.mjs");
const repoRoot = join(here, "..", "..");

function run(cwd) {
  try {
    const stdout = execFileSync(process.execPath, [checkScript], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DUAL_RUNTIME_ROOT: cwd },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

test("dual-runtime gate passes on real repo tip", () => {
  const result = run(repoRoot);
  assert.equal(
    result.status,
    0,
    `expected pass on real tree:\n${result.stderr}\n${result.stdout}`,
  );
  assert.match(result.stdout, /Dual-runtime boundary check passed/);
});

test("dual-runtime gate fails when renderer imports personal-agent-runtime", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "dual-runtime-"));
  try {
    const appSrc = join(sandbox, "apps/app/src");
    mkdirSync(appSrc, { recursive: true });
    writeFileSync(
      join(appSrc, "bad-import.ts"),
      `import { createPersonalAgentRuntime } from "../../desktop/electron/personal-agent-runtime/index.mjs";\nexport const x = createPersonalAgentRuntime;\n`,
    );
    // Empty personal runtime so rule 2 does not fire
    mkdirSync(join(sandbox, "apps/desktop/electron/personal-agent-runtime"), {
      recursive: true,
    });
    writeFileSync(
      join(sandbox, "apps/desktop/electron/personal-agent-runtime/ok.mjs"),
      `export const ok = 1;\n`,
    );

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /renderer-no-personal-runtime|personal-agent-runtime/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("dual-runtime gate fails when personal runtime imports session-archive", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "dual-runtime-archive-"));
  try {
    mkdirSync(join(sandbox, "apps/app/src"), { recursive: true });
    writeFileSync(join(sandbox, "apps/app/src/ok.ts"), `export const ok = 1;\n`);
    const runtime = join(sandbox, "apps/desktop/electron/personal-agent-runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(
      join(runtime, "leak.mjs"),
      `import { createSessionArchiveStore } from "../../../server/src/services/session-archive.js";\nexport { createSessionArchiveStore };\n`,
    );

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /personal-no-server-archive|session-archive/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("dual-runtime gate fails when one file imports archive and personal store", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "dual-runtime-mixed-"));
  try {
    mkdirSync(join(sandbox, "apps/app/src"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/app/src/mixed.ts"),
      `import { withSessionArchiveStore } from "../../server/src/services/session-archive.js";\nimport { createConversation } from "../../desktop/electron/personal-agent-runtime/conversation-store.mjs";\nexport { withSessionArchiveStore, createConversation };\n`,
    );
    mkdirSync(join(sandbox, "apps/desktop/electron/personal-agent-runtime"), {
      recursive: true,
    });
    writeFileSync(
      join(sandbox, "apps/desktop/electron/personal-agent-runtime/ok.mjs"),
      `export const ok = 1;\n`,
    );

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no-mixed-write-imports/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("dual-runtime gate fails when production code uses openwork:desktop", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "dual-runtime-openwork-"));
  try {
    mkdirSync(join(sandbox, "apps/app/src"), { recursive: true });
    writeFileSync(
      join(sandbox, "apps/app/src/legacy.ts"),
      `export const channel = "openwork:desktop";\n`,
    );
    mkdirSync(join(sandbox, "apps/desktop/electron/personal-agent-runtime"), {
      recursive: true,
    });
    writeFileSync(
      join(sandbox, "apps/desktop/electron/personal-agent-runtime/ok.mjs"),
      `export const ok = 1;\n`,
    );

    const result = run(sandbox);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no-legacy-openwork-desktop-channel|openwork:desktop/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("check script is present and executable entry", () => {
  assert.ok(existsSync(checkScript));
});
