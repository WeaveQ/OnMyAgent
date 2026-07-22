/**
 * Orchestration gate for frontend P0/P1 perf acceptance criteria.
 * Spawns existing real suites (does not reimplement helpers).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");

const AC_SUITES: Array<{
  ac: string;
  label: string;
  files: string[];
}> = [
  {
    ac: "AC1",
    label: "transcript pure helpers + contracts",
    files: [
      "scripts/session-transcript-layout-contract.test.ts",
      "scripts/session-transcript-render-items.test.ts",
      "scripts/session-transcript-turn-model.test.ts",
      "scripts/session-transcript-scroll-intent.test.ts",
      "scripts/session-transcript-virtual-window.test.ts",
      "scripts/session-transcript-block-model.test.ts",
      "scripts/session-transcript-estimate-size.test.ts",
    ],
  },
  {
    ac: "AC2",
    label: "stable transcript boundary (scroll/layout/memo path)",
    files: [
      "scripts/session-transcript-scroll-intent.test.ts",
      "scripts/session-transcript-layout-contract.test.ts",
      "scripts/session-transcript-block-model.test.ts",
    ],
  },
  {
    ac: "AC3",
    label: "tool fold default + layout contracts",
    files: [
      "scripts/session-process-fold-default.test.ts",
      "scripts/session-transcript-layout-contract.test.ts",
    ],
  },
  {
    ac: "AC4",
    label: "sidebar status/trailing + history soft refresh",
    files: [
      "scripts/session-sidebar-status-utils.test.ts",
      "scripts/task-row-trailing-status.test.ts",
      "scripts/session-lazy-side-panels-contract.test.ts",
    ],
  },
  {
    ac: "AC5",
    label: "lazy right-rail + browser rAF + query/history",
    files: [
      "scripts/session-lazy-side-panels-contract.test.ts",
      "scripts/session-browser-bounds-raf.test.ts",
    ],
  },
  {
    ac: "AC6",
    label: "focused-session full-stream policy",
    files: ["scripts/session-stream-policy.test.ts"],
  },
];

function runSuite(files: string[]) {
  const result = spawnSync(
    "bun",
    ["test", ...files],
    {
      cwd: appRoot,
      encoding: "utf8",
      env: process.env,
    },
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("session P0/P1 perf gate (orchestration)", () => {
  test("AC1–AC6 suite matrix all exit 0", () => {
    const matrix: Array<{ ac: string; label: string; exit: number }> = [];
    let failed = false;
    for (const row of AC_SUITES) {
      const run = runSuite(row.files);
      matrix.push({ ac: row.ac, label: row.label, exit: run.status });
      // Surface bun output for harness logs when debugging.
      if (run.status !== 0) {
        failed = true;
        console.error(`\n--- ${row.ac} FAILED ---\n${run.stdout}\n${run.stderr}`);
      } else {
        console.log(`${row.ac} PASS exit=0 (${row.label})`);
      }
    }
    console.log("\n=== AC MATRIX ===");
    for (const row of matrix) {
      console.log(
        `${row.ac}\t${row.exit === 0 ? "PASS" : "FAIL"}\texit=${row.exit}\t${row.label}`,
      );
    }
    expect(failed).toBe(false);
    expect(matrix.every((row) => row.exit === 0)).toBe(true);
  }, 120_000);
});
