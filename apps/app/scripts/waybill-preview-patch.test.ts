import { describe, expect, test } from "bun:test";

import {
  applyWaybillDataPatch,
  toWorkspaceRelativePath,
  waybillDataPathCandidates,
} from "../src/react-app/domains/session/artifacts/waybill-preview-patch";

describe("applyWaybillDataPatch", () => {
  test("sets nested dotted fields and clears confirmation", () => {
    const next = applyWaybillDataPatch(
      {
        carrier: { phone: "" },
        userConfirmed: true,
      },
      { "carrier.phone": "13800000000" },
    );
    expect(next.userConfirmed).toBe(false);
    expect((next.carrier as { phone: string }).phone).toBe("13800000000");
  });

  test("keeps partial placeholder text instead of treating it as empty", () => {
    const next = applyWaybillDataPatch({}, { "carrier.phone": "待补" });
    expect((next.carrier as { phone: string }).phone).toBe("待补");
  });

  test("writes cargo weight/volume from weightOrVolume", () => {
    const next = applyWaybillDataPatch(
      { cargo: [{ name: "注塑机" }] },
      { "cargo.weightOrVolume": "1.2t / 3m³" },
    );
    const row = (next.cargo as Array<Record<string, string>>)[0];
    expect(row?.weight).toBe("1.2t");
    expect(row?.volume).toBe("3m³");
  });
});

describe("waybillDataPathCandidates", () => {
  test("prefers isolated session directory under the catalog root", () => {
    const paths = waybillDataPathCandidates({
      catalogRoot: "/Users/me/ws",
      sessionRoot: "/Users/me/ws/order-entry-clerk/abc123",
    });
    expect(paths[0]).toBe("order-entry-clerk/abc123/waybill-data.json");
    expect(paths).toContain("waybill-data.json");
    expect(paths).toContain("output/waybill-data.json");
  });

  test("toWorkspaceRelativePath handles absolute session roots", () => {
    expect(
      toWorkspaceRelativePath("/Users/me/ws", "/Users/me/ws/agent/sid/file.json"),
    ).toBe("agent/sid/file.json");
  });
});
