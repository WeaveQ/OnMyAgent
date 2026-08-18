import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evaluateCloseoutRawEvidence,
  evaluateElectronRawEvidence,
} from "./grok-closeout-raw-evidence.mjs";

const repoRoot = join(tmpdir(), `grok-raw-evidence-${process.pid}`);
mkdirSync(repoRoot, { recursive: true });

function writeJson(rel, value) {
  const path = join(repoRoot, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
  return rel;
}

describe("grok closeout raw-evidence predicates", () => {
  test("rejects summary ok:true when raw attempt text has Runtime command failed", () => {
    const smoke = {
      ok: true,
      attempts: [
        { ok: true, screenshot: "a.png", log: "a.log" },
        { ok: true, screenshot: "b.png", log: "b.log" },
      ],
      assertions: { deleteSemantics: true },
      details: {
        deleteClicked: true,
        restore2: { text: "Runtime command failed\n可稍后重新发送" },
      },
    };
    const result = evaluateElectronRawEvidence(smoke, repoRoot);
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => /Runtime command failed/.test(reason))).toBe(true);
  });

  test("rejects deleteSemantics when delete was not clicked", () => {
    const smoke = {
      ok: true,
      assertions: { deleteSemantics: true },
      details: { deleteClicked: false, restore2: { text: "PONG2" } },
    };
    const result = evaluateElectronRawEvidence(smoke, repoRoot);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/deleteClicked is false|independent delete sidecar is missing/);
  });

  test("rejects Expert ok:true when no reply was recorded", () => {
    const result = evaluateCloseoutRawEvidence({
      electron: {
        ok: true,
        assertions: { deleteSemantics: true },
        details: { deleteClicked: true, restore2: { text: "PONG2" } },
      },
      grok: {
        ok: true,
        expert: { ok: true, screenshot: "c9-expert-summoned.png" },
        assistant: { ok: true, reply: "PONG" },
      },
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/no Expert reply|missing|independent/);
  });

  test("rejects Expert ok:true when sidecar DOM is empty Expert state", () => {
    const sidecar = writeJson("c9-expert-done.json", {
      href: "/expert",
      text: "召唤专家\n暂无专家会话\n先选择一位专家开始对话",
    });
    const result = evaluateCloseoutRawEvidence({
      electron: {
        ok: true,
        assertions: { deleteSemantics: true },
        details: { deleteClicked: true, restore2: { text: "PONG2" } },
      },
      grok: {
        ok: true,
        expert: { ok: true, screenshot: sidecar },
        assistant: { ok: true, reply: "PONG" },
      },
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/empty Expert|no Expert reply|missing/);
  });

  test("accepts matching success observables", () => {
    writeJson("ok.log", { text: "ok" });
    writeJson("a1.json", { text: "PONG2 attached notes.md" });
    writeFileSync(join(repoRoot, "a1.png"), "png");
    writeJson("delete.json", { deleteClicked: true });
    writeJson("compact.json", {
      newUpdates: [
        { params: { update: { sessionUpdate: "compaction_checkpoint" } } },
        { params: { update: { sessionUpdate: "auto_compact_completed" } } },
        { params: { update: { sessionUpdate: "turn_completed" } } },
      ],
    });
    writeJson("inventory-after.json", { binding: false, nativeDir: null });
    const expertDom = writeJson("c9-expert-ok.json", {
      text: "爆款选题策划专家\n好的，这是选题建议。",
    });
    writeFileSync(join(repoRoot, "c9-expert-ok.png"), "png");
    const result = evaluateCloseoutRawEvidence({
      electron: {
        ok: true,
        attempts: [{
          ok: true,
          screenshot: "a1.png",
          log: "ok.log",
          sidecar: "a1.json",
          reply: "PONG2 attached notes.md",
        }],
        assertions: { deleteSemantics: true },
        details: {
          compact: { ok: true, sidecar: "compact.json" },
          deleteSidecar: "delete.json",
          deleteClicked: true,
          afterDelete: { inventoryAfter: "inventory-after.json" },
          restore2: { text: "PONG2 attached notes.md" },
        },
      },
      grok: {
        ok: true,
        assistant: {
          ok: true,
          reply: "PONG2 attached notes.md",
          screenshot: "a1.png",
          sidecar: "a1.json",
        },
        expert: {
          ok: true,
          reply: "好的，这是选题建议。",
          screenshot: "c9-expert-ok.png",
          sidecar: expertDom,
        },
      },
      repoRoot,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("rejects missing sidecars and self-authored summary fields", () => {
    const result = evaluateCloseoutRawEvidence({
      electron: {
        ok: true,
        attempts: [{
          ok: true,
          screenshot: "missing-shot.png",
          log: "missing.log",
          reply: "SELF_AUTHORED",
        }],
        assertions: { deleteSemantics: true },
        details: { deleteClicked: true },
      },
      grok: {
        ok: true,
        assistant: { ok: true, reply: "SELF_AUTHORED", screenshot: "missing-shot.png" },
        expert: { ok: true, reply: "SELF_AUTHORED", screenshot: "missing-expert.png" },
      },
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/missing|independent/i);
  });

  test("rejects the frozen contradictory Electron smoke fixture", async () => {
    const { readFileSync } = await import("node:fs");
    const { join: joinPath } = await import("node:path");
    const fixture = joinPath(
      import.meta.dir,
      "fixtures/grok-closeout-contradictory-electron-smoke.json",
    );
    const smoke = JSON.parse(readFileSync(fixture, "utf8"));
    const result = evaluateElectronRawEvidence(smoke, import.meta.dir);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/Runtime command failed|deleteClicked is false/);
  });

  test("rejects claimed compact when the sidecar is missing or has no native completion events", () => {
    writeJson("delete-ok.json", { deleteClicked: true });
    writeJson("inventory-ok.json", { binding: false, nativeDir: null });
    writeJson("compact-summary-only.json", {
      completedEvent: "compaction_checkpoint+auto_compact_completed+turn_completed",
    });
    const missing = evaluateElectronRawEvidence({
      assertions: { deleteSemantics: true },
      details: {
        compact: { ok: true, sidecar: "missing-compact.json" },
        deleteSidecar: "delete-ok.json",
        afterDelete: { inventoryAfter: "inventory-ok.json" },
        deleteClicked: true,
      },
    }, repoRoot);
    expect(missing.ok).toBe(false);
    expect(missing.reasons.join(" ")).toMatch(/independent compact sidecar is missing/);

    const summaryOnly = evaluateElectronRawEvidence({
      assertions: { deleteSemantics: true },
      details: {
        compact: { ok: true, sidecar: "compact-summary-only.json" },
        deleteSidecar: "delete-ok.json",
        afterDelete: { inventoryAfter: "inventory-ok.json" },
        deleteClicked: true,
      },
    }, repoRoot);
    expect(summaryOnly.ok).toBe(false);
    expect(summaryOnly.reasons.join(" ")).toMatch(/missing native compaction_checkpoint|missing native auto_compact_completed|missing native turn_completed/);
  });

  test("rejects deleteSemantics when inventory-after is missing or still has a native dir", () => {
    writeJson("delete-click.json", { deleteClicked: true });
    const missingInventory = evaluateElectronRawEvidence({
      assertions: { deleteSemantics: true },
      details: {
        deleteSidecar: "delete-click.json",
        deleteClicked: true,
      },
    }, repoRoot);
    expect(missingInventory.ok).toBe(false);
    expect(missingInventory.reasons.join(" ")).toMatch(/independent inventory-after sidecar is missing/);

    writeJson("inventory-still-there.json", {
      binding: true,
      nativeDir: "/tmp/native-session",
    });
    const stillThere = evaluateElectronRawEvidence({
      assertions: { deleteSemantics: true },
      details: {
        deleteSidecar: "delete-click.json",
        afterDelete: { inventoryAfter: "inventory-still-there.json" },
        deleteClicked: true,
      },
    }, repoRoot);
    expect(stillThere.ok).toBe(false);
    expect(stillThere.reasons.join(" ")).toMatch(/binding:false|nativeDir/);
  });
});
