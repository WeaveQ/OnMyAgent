import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "check-unused-composition.mjs");

test("unused composition gate rejects an unreferenced kernel provider", () => {
  const root = mkdtempSync(join(tmpdir(), "unused-composition-"));
  try {
    mkdirSync(join(root, "apps/app/src/react-app/kernel"), { recursive: true });
    mkdirSync(join(root, "apps/app/src"), { recursive: true });
    mkdirSync(join(root, "apps/app/src/react-app/shell"), { recursive: true });
    writeFileSync(join(root, "apps/app/src/index.react.tsx"), "import './react-app/shell/providers';\n");
    writeFileSync(join(root, "apps/app/src/react-app/shell/providers.tsx"), "export const providers = true;\n");
    writeFileSync(join(root, "apps/app/src/react-app/kernel/orphan-provider.tsx"), "export function OrphanProvider() { return null; }\n");
    mkdirSync(join(root, "scripts/checks/baselines"), { recursive: true });
    writeFileSync(join(root, "scripts/checks/baselines/unused-composition.json"), '{"allow":[]}\n');
    assert.throws(
      () => execFileSync(process.execPath, [script], { env: { ...process.env, UNUSED_COMPOSITION_ROOT: root }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      /unused composition modules/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
