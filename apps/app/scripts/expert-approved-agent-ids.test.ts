import { describe, expect, test } from "bun:test";

import { BUILTIN_MARKETPLACE_EXPERTS } from "../src/react-app/domains/plugins/expert-marketplace/data";

describe("expert approved agent ids", () => {
  test("marketplace lead agent is allowed even when plugin.json omits approvedAgentIds", () => {
    const kol = BUILTIN_MARKETPLACE_EXPERTS.find(
      (expert) => expert.packageName === "kol-content-ops-specialist",
    );
    expect(kol).toBeDefined();
    expect(kol?.approvedAgentIds).toContain("kol-content-ops-specialist");
    expect(kol?.approvedAgentIds).not.toContain("sisyphus");
  });
});
