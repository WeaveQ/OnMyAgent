import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const pluginsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "logistics-efficiency-"));
  temporaryRoots.push(root);
  return root;
}

function runPython(script: string, args: string[]): void {
  const result = Bun.spawnSync(["python3", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
}

function readCsv(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("logistics efficiency helper scripts", () => {
  test("normalizes shipment fields and records source rows", () => {
    const root = temporaryRoot();
    const input = join(root, "shipments.csv");
    const output = join(root, "normalized.csv");
    writeFileSync(
      input,
      "运单号,发货地址,收货地址,品名,重量kg\nS-1,上海,苏州,配件,1200\n",
    );
    runPython(
      join(
        pluginsRoot,
        "order-dispatch-specialist/skills/shipment-data-structuring/scripts/normalize_shipments.py",
      ),
      [input, output],
    );
    const csv = readCsv(output);
    expect(csv).toContain("shipment_id");
    expect(csv).toContain("S-1");
    expect(csv).toContain("上海");
    expect(csv).toContain(",1,");
  });

  test("merges fleet sources and preserves conflicting values", () => {
    const root = temporaryRoot();
    const first = join(root, "fleet-a.csv");
    const second = join(root, "fleet-b.csv");
    const output = join(root, "fleet.csv");
    writeFileSync(first, "车牌号,司机姓名,车型\n沪A1,张师傅,厢式\n");
    writeFileSync(second, "plate_number,driver_name,车型\n沪A1,李师傅,厢式\n");
    runPython(
      join(
        pluginsRoot,
        "fleet-management-specialist/skills/fleet-data-consolidation/scripts/consolidate_fleet.py",
      ),
      [first, second, "--output", output],
    );
    const csv = readCsv(output);
    expect(csv).toContain("沪A1");
    expect(csv).toContain("fleet-a.csv|fleet-b.csv");
    expect(csv).toContain("张师傅");
    expect(csv).toContain("李师傅");
  });

  test("deduplicates transit events and identifies the latest event", () => {
    const root = temporaryRoot();
    const input = join(root, "transit.csv");
    const output = join(root, "timeline.csv");
    writeFileSync(
      input,
      [
        "运单号,发生时间,节点,位置",
        "S-1,2026-07-30 08:00,已发车,上海",
        "S-1,2026-07-30 08:00,已发车,上海",
        "S-1,2026-07-30 10:00,运输中,昆山",
        "",
      ].join("\n"),
    );
    runPython(
      join(
        pluginsRoot,
        "fulfillment-specialist/skills/transit-update-structuring/scripts/build_transit_timeline.py",
      ),
      [input, output],
    );
    const lines = readCsv(output).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("已发车");
    expect(lines[1]).toContain(",no");
    expect(lines[2]).toContain("运输中");
    expect(lines[2]).toContain(",yes");
  });

  test("matches settlement sources and calculates quote and cost differences", () => {
    const root = temporaryRoot();
    const first = join(root, "billing-a.csv");
    const second = join(root, "billing-b.csv");
    const output = join(root, "settlement.csv");
    writeFileSync(
      first,
      "运单号,报价金额,客户账单金额\nS-1,1000,1050\n",
    );
    writeFileSync(second, "shipment_id,carrier_amount\nS-1,700\n");
    runPython(
      join(
        pluginsRoot,
        "logistics-finance-specialist/skills/settlement-data-consolidation/scripts/reconcile_settlement.py",
      ),
      [first, second, "--output", output],
    );
    const csv = readCsv(output);
    expect(csv).toContain("shipment:S-1");
    expect(csv).toContain(",50,350,");
    expect(csv).toContain("billing-a.csv|billing-b.csv");
  });
});
