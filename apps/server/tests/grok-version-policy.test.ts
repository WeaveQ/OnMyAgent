import { describe, expect, test } from "bun:test";
import {
  assertGrokRuntimeVersion,
  grokVersionCompatibilityMode,
  isAuditedGrokVersion,
  parseGrokVersion,
} from "../src/services/grok-version-policy.js";

describe("Grok runtime version policy", () => {
  test("parses current CLI and ACP version strings", () => {
    expect(parseGrokVersion("grok 1.0.0 (3cd0d0c)")).toBe("1.0.0");
    expect(parseGrokVersion("1.0.1")).toBe("1.0.1");
    expect(parseGrokVersion("grok 1.0.3 (1a29d5b)")).toBe("1.0.3");
    expect(parseGrokVersion("future")).toBeNull();
    expect(isAuditedGrokVersion("1.0.0")).toBe(true);
    expect(isAuditedGrokVersion("1.0.3")).toBe(true);
    expect(isAuditedGrokVersion("2.0.0")).toBe(false);
  });

  test("allows unknown versions in base ACP compatibility mode and still rejects mismatches", () => {
    expect(assertGrokRuntimeVersion({
      initialized: { _meta: { agentVersion: "2.0.0" } },
    })).toBe("2.0.0");
    expect(grokVersionCompatibilityMode("2.0.0")).toBe("base-acp");
    expect(grokVersionCompatibilityMode("1.0.3")).toBe("audited");
    expect(() => assertGrokRuntimeVersion({
      initialized: { _meta: { agentVersion: "future" } },
    })).toThrow(expect.objectContaining({ code: "grok_runtime_version_unsupported" }));
    expect(() => assertGrokRuntimeVersion({
      expectedVersion: "1.0.1",
      initialized: { _meta: { agentVersion: "1.0.0" } },
    })).toThrow(expect.objectContaining({ code: "grok_runtime_version_mismatch" }));
    expect(assertGrokRuntimeVersion({
      expectedVersion: "1.0.0",
      initialized: { _meta: { agentVersion: "1.0.0" } },
    })).toBe("1.0.0");
  });
});
