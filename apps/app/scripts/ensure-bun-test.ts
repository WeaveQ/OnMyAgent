import { describe } from "bun:test";
import { spawnSync } from "node:child_process";

export function ensureBunTest(testFilePath: string): void {
  try {
    describe.skip("__ensure_bun_test__", () => undefined);
  } catch {
    const result = spawnSync(process.execPath, ["test", testFilePath], {
      stdio: "inherit",
    });
    process.exit(result.status ?? 1);
  }
}
