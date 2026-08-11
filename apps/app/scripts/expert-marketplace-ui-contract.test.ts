import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const marketplaceRoot = join(
  repoRoot,
  "apps/app/src/react-app/domains/plugins/expert-marketplace",
);
const builtinPluginsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);
const retiredMinimaxDocxSkillRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/skills/skills/skill_2053082396193849344",
);

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

// ExpertPage is intentionally assembled from a hook, a thin layout container,
// and typed presentational/lifecycle seams. Structural contracts read the full
// owned surface so moving a behavior-neutral block does not erase coverage.
const EXPERT_PAGE_SEAM_FILES = [
  "apps/app/src/react-app/domains/session/pages/expert-page-main-surface.tsx",
  "apps/app/src/react-app/domains/session/pages/expert-page-modals.tsx",
  "apps/app/src/react-app/domains/session/pages/expert-page-rail.tsx",
  "apps/app/src/react-app/domains/session/pages/expert-page-side-panel.tsx",
  "apps/app/src/react-app/domains/session/pages/expert-page-view-types.ts",
  "apps/app/src/react-app/domains/session/pages/expert-page-artifacts-model.ts",
  "apps/app/src/react-app/domains/session/pages/expert-page-identity-model.ts",
  "apps/app/src/react-app/domains/session/pages/expert-page-navigation-model.ts",
  "apps/app/src/react-app/domains/session/pages/use-expert-archive-revision.ts",
  "apps/app/src/react-app/domains/session/pages/use-expert-composer-template-events.ts",
  "apps/app/src/react-app/domains/session/pages/use-expert-draft-cleanup.ts",
  "apps/app/src/react-app/domains/session/pages/use-expert-route-lifecycle.ts",
  "apps/app/src/react-app/domains/session/pages/use-expert-session-tab-order.ts",
].map(readWorkspaceFile);

function readExpertPageSource() {
  return EXPERT_PAGE_SEAM_FILES.join("\n");
}

function readMarketplaceFile(path: string): string {
  return readFileSync(join(marketplaceRoot, path), "utf8");
}

function directoryTreeContainsFiles(path: string): boolean {
  return readdirSync(path, { withFileTypes: true }).some((entry) =>
    entry.isFile() ||
    (entry.isDirectory() && directoryTreeContainsFiles(join(path, entry.name))),
  );
}

function builtInPackageNames(): string[] {
  return readdirSync(builtinPluginsRoot)
    .filter((name) => {
      const packageRoot = join(builtinPluginsRoot, name);
      return statSync(packageRoot).isDirectory() && directoryTreeContainsFiles(packageRoot);
    })
    .sort();
}

describe("expert marketplace UI contract", () => {
  test("does not ship the retired minimax-docx marketplace capability", () => {
    expect(existsSync(retiredMinimaxDocxSkillRoot)).toBe(false);

    for (const packageName of builtInPackageNames()) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      expect(existsSync(join(packageRoot, "skills/minimax-docx"))).toBe(false);
      expect(
        readFileSync(join(packageRoot, ".expert-plugin/plugin.json"), "utf8"),
      ).not.toContain("minimax-docx");
      for (const agentFile of readdirSync(join(packageRoot, "agents"))) {
        expect(readFileSync(join(packageRoot, "agents", agentFile), "utf8")).not.toContain(
          "minimax-docx",
        );
      }
    }
  });

  test("keeps OnMyAgent expert packages as complete package folders", () => {
    const packageNames = builtInPackageNames();

    expect(packageNames.length).toBeGreaterThanOrEqual(10);
    for (const packageName of packageNames) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      expect(existsSync(join(packageRoot, ".expert-plugin/plugin.json"))).toBe(true);
      expect(existsSync(join(packageRoot, "agents"))).toBe(true);
    }

    expect(packageNames).toEqual(
      expect.arrayContaining([
        "document-generation-expert",
        "viral-topic-master",
        "logistics-ops-navigator",
        "logistics-line-haul",
        "logistics-urban-delivery",
        "logistics-cold-chain",
      ]),
    );
    // Office-first: engineering / game-dev packages are not shipped in the built-in shelf.
    for (const removed of [
      "ai-engineer",
      "senior-developer",
      "frontend-developer",
      "software-architect",
      "game-designer",
    ]) {
      expect(packageNames).not.toContain(removed);
    }
  });

  test("ships the logistics verticals plus four consolidated operations experts", () => {
    const categories = readMarketplaceFile("categories.ts");
    expect(categories).toContain('id: "14-Logistics"');
    expect(categories).toContain("session.expert_marketplace_category_logistics");
    expect(categories).toMatch(/物流/);
    expect(categories).toMatch(/logistics/i);

    const localeRoots = [
      join(repoRoot, "apps/app/src/i18n/locales/en/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh-TW/session.ts"),
    ];
    for (const localePath of localeRoots) {
      const text = readFileSync(localePath, "utf8");
      expect(text).toContain("session.expert_marketplace_category_logistics");
    }

    const logisticsPackages = [
      "logistics-ops-navigator",
      "logistics-line-haul",
      "logistics-urban-delivery",
      "logistics-cold-chain",
      "order-dispatch-specialist",
      "fleet-management-specialist",
      "fulfillment-specialist",
      "logistics-finance-specialist",
    ] as const;
    const verticalSkillMarkers: Record<string, string> = {
      "logistics-line-haul": "throw-weight",
      "logistics-urban-delivery": "day-clear",
      "logistics-cold-chain": "break-chain",
    };

    for (const packageName of logisticsPackages) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      const pluginPath = join(packageRoot, ".expert-plugin/plugin.json");
      expect(existsSync(pluginPath)).toBe(true);
      expect(existsSync(join(packageRoot, "agents"))).toBe(true);
      const plugin = JSON.parse(readFileSync(pluginPath, "utf8")) as {
        categoryId?: string;
        categoryIds?: string[];
        skills?: string[];
      };
      const categoryIds = [
        ...(plugin.categoryId ? [plugin.categoryId] : []),
        ...(Array.isArray(plugin.categoryIds) ? plugin.categoryIds : []),
      ];
      expect(categoryIds).toContain("14-Logistics");
      if (packageName in verticalSkillMarkers) {
        const marker = verticalSkillMarkers[packageName];
        const skillTree = join(packageRoot, "skills");
        expect(existsSync(skillTree)).toBe(true);
        const skillBlob = readdirSync(skillTree, { recursive: true })
          .map((rel) => {
            const full = join(skillTree, String(rel));
            return statSync(full).isFile() ? readFileSync(full, "utf8") : "";
          })
          .join("\n");
        expect(skillBlob.toLowerCase()).toContain(marker);
      }
    }

    const expertManifest = JSON.parse(
      readMarketplaceFile("builtin-experts.manifest.json"),
    ) as {
      experts?: Array<{
        packageName?: string;
        manifest?: {
          categoryId?: string;
          categoryIds?: string[];
          profession?: { zh?: string };
          skills?: string[];
          quickPrompts?: Array<{ en?: string; zh?: string }>;
        };
      }>;
    };
    const manifestNames = (expertManifest.experts ?? []).map((entry) => entry.packageName);
    for (const packageName of logisticsPackages) {
      expect(manifestNames).toContain(packageName);
      const entry = (expertManifest.experts ?? []).find((item) => item.packageName === packageName);
      const cats = [
        ...(entry?.manifest?.categoryId ? [entry.manifest.categoryId] : []),
        ...(Array.isArray(entry?.manifest?.categoryIds) ? entry.manifest.categoryIds : []),
      ];
      expect(cats).toContain("14-Logistics");
    }

    const consolidatedSkills: Record<string, string[]> = {
      "order-dispatch-specialist": [
        "./skills/shipment-data-structuring",
        "./skills/shipment-information-audit",
        "./skills/freight-quote-analysis",
        "./skills/order-quote-consistency",
      ],
      "fleet-management-specialist": [
        "./skills/fleet-data-consolidation",
        "./skills/vehicle-candidate-ranking",
        "./skills/dispatch-readiness-audit",
        "./skills/dispatch-brief-drafting",
        "./skills/fleet-efficiency-analysis",
      ],
      "fulfillment-specialist": [
        "./skills/transit-update-structuring",
        "./skills/customer-update-drafting",
        "./skills/exception-evidence-review",
        "./skills/pod-document-audit",
        "./skills/fulfillment-performance-analysis",
      ],
      "logistics-finance-specialist": [
        "./skills/settlement-data-consolidation",
        "./skills/charge-variance-audit",
        "./skills/settlement-readiness-audit",
        "./skills/invoice-information-audit",
        "./skills/freight-profit-analysis",
      ],
    };
    const consolidatedProfessions: Record<string, string> = {
      "order-dispatch-specialist": "货运客服专家",
      "fleet-management-specialist": "车队管理专家",
      "fulfillment-specialist": "物流运输专家",
      "logistics-finance-specialist": "货运财务专家",
    };
    const alignedCardSubtitles: Record<string, string> = {
      "order-dispatch-specialist": "货运客服专家",
      "fleet-management-specialist": "车队管理专家",
      "fulfillment-specialist": "物流运输专家",
      "logistics-finance-specialist": "货运财务专家",
    };
    for (const [packageName, skills] of Object.entries(consolidatedSkills)) {
      const entry = (expertManifest.experts ?? []).find((item) => item.packageName === packageName);
      expect(entry?.manifest?.skills).toEqual(skills);
      expect(entry?.manifest?.quickPrompts?.length).toBeGreaterThanOrEqual(4);
      expect(entry?.manifest?.quickPrompts?.length).toBeLessThanOrEqual(5);
      expect(entry?.manifest?.profession?.zh).toBe(
        consolidatedProfessions[packageName],
      );
      if (packageName in alignedCardSubtitles) {
        expect(entry?.manifest?.displayName?.zh).toBe(
          alignedCardSubtitles[packageName],
        );
      }
    }

    const removedPackages = [
      "order-entry-clerk",
      "quote-specialist",
      "capacity-dispatcher",
      "fuel-auditor",
      "affiliate-vehicle-admin",
      "claims-specialist",
      "pod-reconciler",
      "invoice-assistant",
      "ar-collector",
      "warehouse-manager",
      "waybill-cargo-checker",
    ];
    for (const packageName of removedPackages) {
      expect(existsSync(join(builtinPluginsRoot, packageName))).toBe(false);
      expect(manifestNames).not.toContain(packageName);
    }

    const assetMap = readMarketplaceFile("builtin-expert-assets.ts");
    for (const packageName of logisticsPackages) {
      expect(assetMap).toContain(`"${packageName}"`);
    }
  });

  test("ships the creator-ops vertical with three KOL specialists", () => {
    const categories = readMarketplaceFile("categories.ts");
    expect(categories).toContain('id: "15-CreatorOps"');
    expect(categories).toContain("session.expert_marketplace_category_creator_ops");
    expect(categories).toMatch(/达人运营/);

    const localeRoots = [
      join(repoRoot, "apps/app/src/i18n/locales/en/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh/session.ts"),
      join(repoRoot, "apps/app/src/i18n/locales/zh-TW/session.ts"),
    ];
    for (const localePath of localeRoots) {
      const text = readFileSync(localePath, "utf8");
      expect(text).toContain("session.expert_marketplace_category_creator_ops");
    }

    const creatorPackages = [
      "kol-media-specialist",
      "kol-content-ops-specialist",
      "kol-project-review-specialist",
    ] as const;
    const creatorSkills: Record<string, string[]> = {
      "kol-media-specialist": [
        "./skills/kol-brief-structuring",
        "./skills/kol-talent-ranking",
        "./skills/kol-data-clean-merge",
        "./skills/kol-media-execution-board",
        "./skills/kol-pitch-readiness-check",
      ],
      "kol-content-ops-specialist": [
        "./skills/xhs-script-assistant",
        "./skills/kol-content-delivery-tracker",
        "./skills/rebate-contract-generator",
        "./skills/rebate-contract-checker",
        "./skills/kol-reputation-monitor",
      ],
      "kol-project-review-specialist": [
        "./skills/kol-data-clean-merge",
        "./skills/kol-margin-effect-analysis",
        "./skills/kol-content-performance-attribution",
        "./skills/kol-project-review-framework",
        "./skills/kol-review-report-audit",
      ],
    };
    const creatorProfessions: Record<string, string> = {
      "kol-media-specialist": "媒介专家",
      "kol-content-ops-specialist": "达人运营专家",
      "kol-project-review-specialist": "项目复盘专家",
    };

    const expertManifest = JSON.parse(
      readMarketplaceFile("builtin-experts.manifest.json"),
    ) as {
      experts?: Array<{
        packageName?: string;
        manifest?: {
          categoryId?: string;
          categoryIds?: string[];
          profession?: { zh?: string };
          displayName?: { zh?: string };
          skills?: string[];
          quickPrompts?: Array<{ en?: string; zh?: string }>;
        };
      }>;
    };
    const manifestNames = (expertManifest.experts ?? []).map((entry) => entry.packageName);
    const assetMap = readMarketplaceFile("builtin-expert-assets.ts");

    for (const packageName of creatorPackages) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      const pluginPath = join(packageRoot, ".expert-plugin/plugin.json");
      expect(existsSync(pluginPath)).toBe(true);
      expect(existsSync(join(packageRoot, "agents"))).toBe(true);
      const plugin = JSON.parse(readFileSync(pluginPath, "utf8")) as {
        categoryId?: string;
        categoryIds?: string[];
        skills?: string[];
      };
      const categoryIds = [
        ...(plugin.categoryId ? [plugin.categoryId] : []),
        ...(Array.isArray(plugin.categoryIds) ? plugin.categoryIds : []),
      ];
      expect(categoryIds).toContain("15-CreatorOps");
      expect(manifestNames).toContain(packageName);
      expect(assetMap).toContain(`"${packageName}"`);

      const entry = (expertManifest.experts ?? []).find((item) => item.packageName === packageName);
      expect(entry?.manifest?.skills).toEqual(creatorSkills[packageName]);
      expect(entry?.manifest?.quickPrompts?.length).toBeGreaterThanOrEqual(4);
      expect(entry?.manifest?.profession?.zh).toBe(creatorProfessions[packageName]);
      expect(entry?.manifest?.displayName?.zh).toBe(creatorProfessions[packageName]);

      if (packageName === "kol-content-ops-specialist") {
        const rebateCheckerRoot = join(packageRoot, "skills/rebate-contract-checker");
        expect(
          existsSync(join(rebateCheckerRoot, "scripts/check_rebate_contracts.py")),
        ).toBe(true);
        expect(existsSync(join(rebateCheckerRoot, "references/usage_guide.md"))).toBe(
          true,
        );
        expect(
          existsSync(join(packageRoot, "skills/kol-rebate-invoice-audit")),
        ).toBe(false);
        const xhsScriptRoot = join(packageRoot, "skills/xhs-script-assistant");
        expect(existsSync(join(xhsScriptRoot, "references/script-template.md"))).toBe(
          true,
        );
        expect(existsSync(join(xhsScriptRoot, "references/docx-template.py"))).toBe(
          true,
        );
        expect(existsSync(join(packageRoot, "skills/kol-script-risk-review"))).toBe(
          false,
        );
        const agentMarkdown = readFileSync(
          join(packageRoot, "agents/kol-content-ops-specialist.md"),
          "utf8",
        );
        expect(agentMarkdown).toContain("rebate-contract-checker");
        expect(agentMarkdown).toContain("xhs-script-assistant");
      }
      const cats = [
        ...(entry?.manifest?.categoryId ? [entry.manifest.categoryId] : []),
        ...(Array.isArray(entry?.manifest?.categoryIds) ? entry.manifest.categoryIds : []),
      ];
      expect(cats).toContain("15-CreatorOps");

      const skillTree = join(packageRoot, "skills");
      expect(existsSync(skillTree)).toBe(true);
      const skillBlob = readdirSync(skillTree, { recursive: true })
        .map((rel) => {
          const full = join(skillTree, String(rel));
          return statSync(full).isFile() ? readFileSync(full, "utf8") : "";
        })
        .join("\n");
      expect(skillBlob).toContain("模板优先");
      expect(skillBlob).toContain("用户提供的永远优先");
    }
  });

  test("keeps every practical logistics skill concise and preview-free", () => {
    const capabilitySkills: Array<[string, string]> = [
      ["order-dispatch-specialist", "shipment-data-structuring"],
      ["order-dispatch-specialist", "shipment-information-audit"],
      ["order-dispatch-specialist", "freight-quote-analysis"],
      ["order-dispatch-specialist", "order-quote-consistency"],
      ["fleet-management-specialist", "fleet-data-consolidation"],
      ["fleet-management-specialist", "vehicle-candidate-ranking"],
      ["fleet-management-specialist", "dispatch-readiness-audit"],
      ["fleet-management-specialist", "dispatch-brief-drafting"],
      ["fleet-management-specialist", "fleet-efficiency-analysis"],
      ["fulfillment-specialist", "transit-update-structuring"],
      ["fulfillment-specialist", "customer-update-drafting"],
      ["fulfillment-specialist", "exception-evidence-review"],
      ["fulfillment-specialist", "pod-document-audit"],
      ["fulfillment-specialist", "fulfillment-performance-analysis"],
      ["logistics-finance-specialist", "settlement-data-consolidation"],
      ["logistics-finance-specialist", "charge-variance-audit"],
      ["logistics-finance-specialist", "settlement-readiness-audit"],
      ["logistics-finance-specialist", "invoice-information-audit"],
      ["logistics-finance-specialist", "freight-profit-analysis"],
    ];

    for (const [packageName, skillName] of capabilitySkills) {
      const skill = readFileSync(
        join(builtinPluginsRoot, packageName, "skills", skillName, "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain(`name: ${skillName}`);
      expect(skill).not.toContain("inlineWidget");
      expect(skill).not.toContain(".process/");
      expect(skill).not.toContain("artifact:");
    }
  });

  test("parses details from package files with folder-name fallback and duplicate-safe ids", () => {
    const data = readMarketplaceFile("data.ts");

    expect(data).toContain("titleFromReadme(agentMarkdown, packageName)");
    expect(data).toContain("BUILTIN_EXPERT_AVATAR_URLS[packageName]");
    expect(data).toContain("id: `${manifest.name?.trim() || packageName}:${packageName}`");
    expect(data).toContain("packagePath: `builtin-experts/plugins/${packageName}`");
    expect(data).toContain("systemPrompt: agentMarkdown || readme");
  });

  test("renders marketplace, my experts, detail dialog, and summon CTA contracts", () => {
    const dialog = readMarketplaceFile("expert-marketplace-dialog.tsx");
    const storePage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );

    expect(dialog).toContain('export type ExpertMarketplaceView = "market" | "mine"');
    expect(dialog).toContain("BUILTIN_MARKETPLACE_EXPERTS.filter");
    expect(dialog).toContain("props.query ??");
    expect(dialog).toContain("myExperts: ExpertMarketplaceEntry[]");
    expect(dialog).toContain("onOpen={setSelectedExpert}");
    expect(dialog).toContain("onSummon={props.onSummonMarketplaceExpert}");
    // Create expert: store header + mine empty-state CTA (not the mine card grid).
    expect(dialog).toContain('t("session.create_expert")');
    expect(dialog).toContain("my_experts_empty");
    expect(storePage).toContain('t("session.create_expert")');
    expect(storePage).toContain("onCreateExpert");
    expect(dialog).toContain('t("session.summon")');
    expect(dialog).toContain('t("session.summon_expert"');
    // Mine shelf uses open-chat CTA (already summoned); market keeps summon.
    expect(dialog).toContain('t("session.open_chat")');
    expect(dialog).toContain('t("session.open_chat_with"');
    expect(dialog).toContain('shelf="mine"');
    expect(dialog).toContain('shelf="market"');
    expect(dialog).toContain("max-h-[calc(100vh-48px)]");
    expect(dialog).toContain("quickPrompts.slice(0, 2)");
    expect(dialog).toContain("MARKETPLACE_DIALOG_EXIT_DURATION_MS = 200");
    expect(dialog).toContain("}, MARKETPLACE_DIALOG_EXIT_DURATION_MS)");
    expect(dialog).toContain(
      "props.onSummonMarketplaceExpert(selectedExpert, prompt)",
    );
    expect(dialog).not.toContain("MyExpertCard");
    expect(dialog).not.toContain("AgentRecord");
    expect(dialog).not.toContain("onSummonMyExpert");
  });

  test("expert cards hide summon until hover and only show border on hover", () => {
    const dialog = readMarketplaceFile("expert-marketplace-dialog.tsx");
    expect(dialog).toContain("border border-transparent");
    expect(dialog).toContain("hover:border-dls-border");
    expect(dialog).toContain("opacity-0");
    expect(dialog).toContain("group-hover:opacity-100");
    expect(dialog).toContain("group-hover:pointer-events-auto");
    expect(dialog).toContain("pointer-events-none");
    expect(dialog).toContain("event.stopPropagation()");
    expect(dialog).toContain("props.onSummon(props.expert)");
  });

  test("store page hosts the expert marketplace and expert icon jumps there", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const summonHook = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-summon-marketplace-expert.ts",
    );
    const myExpertsHook = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-my-expert-packages.ts",
    );
    const storePage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
    );
    const installHelper = readMarketplaceFile("install.ts");
    const pendingAgent = readWorkspaceFile(
      "apps/app/src/react-app/domains/agents/marketplace-pending-agent.ts",
    );

    expect(storePage).toContain(
      'export type StorePrimaryTab = "experts" | "skills" | "plugins"',
    );
    expect(storePage).toContain("function StorePrimaryTabs");
    expect(storePage).toContain("<ExpertMarketplacePage");
    expect(storePage).toContain('t("store.experts_tab")');
    expect(storePage).toContain('t("store.skills_tab")');
    expect(storePage).toContain('t("plugins.artifact_tab")');
    expect(storePage).toContain('t("store.all_experts")');
    // Experts market: my-experts CTA; skills market: my-skills entry with count.
    expect(storePage).toContain('t("session.my_experts")');
    expect(storePage).toContain('t("store.my_skills")');
    expect(storePage).toContain('t("store.skills_marketplace")');
    expect(storePage).toContain("CustomConnectorEntryButton");
    expect(expertPage).toContain("const openExpertMarket = useCallback");
    expect(expertPage).toContain("onOpenAgents={openExpertMarket}");
    expect(expertPage).toContain("activeTab={storeActiveTab}");
    expect(expertPage).toContain("onSummonMarketplaceExpert={handleStartMarketplaceExpert}");
    // Install + my-experts list live in shared hooks (expert still installs on summon path).
    const sessionStarters = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-expert-session-starters.ts",
    );
    expect(sessionStarters).toContain("installSummonedMarketplaceExpert(expert)");
    expect(assistantPage).toContain("useSummonMarketplaceExpert");
    expect(summonHook).toContain("installSummonedMarketplaceExpert(expert)");
    expect(myExpertsHook).toContain('listExpertPackages("experts")');
    expect(myExpertsHook).toContain('listExpertPackages("my-experts")');
    expect(myExpertsHook).toContain("const entriesByPackageName = new Map(");
    expect(myExpertsHook).toContain("[...entriesByPackageName.values()]");
    expect(expertPage).toContain("useMyExpertPackages");
    // The expert page owns real summoned sessions; it must not synthesize
    // starter entries into the sidebar from local package metadata.
    expect(expertPage).not.toContain("additionalStarterItems=");
    expect(expertPage).not.toContain("localExpertStarterItems");
    expect(expertPage).toContain("onOpenAgentStarter={handleOpenExpertStarter}");
    // Cold-open defers while unbound agent-selection draft is active.
    expect(expertPage).toContain('pendingAgent.draftSource === "agent-selection"');
    // Do not re-activate draft on null route gaps (multi-switch blank).
    expect(expertPage).toContain(
      "Do NOT re-activate agent-selection draft when selectedSessionId is",
    );
    expect(installHelper).toContain('expert.source !== "builtin"');
    expect(installHelper).toContain('marketplace: "experts"');
    expect(expertPage).toContain("props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)");
    expect(expertPage).not.toContain("agentEditRequest");
    expect(expertPage).not.toContain("onOpenAgentSettings={");
    expect(expertPage).not.toContain("<ExpertMarketplaceDialog");
    expect(pendingAgent).toContain("source: expert.source");
    expect(pendingAgent).toContain('avatarOptionId: "marketplace-expert"');
    expect(pendingAgent).toContain("systemPrompt: expert.systemPrompt");
    expect(pendingAgent).toContain("teamWorkflow: expert.teamWorkflow ?? undefined");
    expect(pendingAgent).toContain("packagePath: expert.packagePath");
  });

  test("team expert empty state exposes an honest lead workflow playbook", () => {
    const emptyState = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/chrome/session-surface-expert-empty.tsx",
    );
    const surfaceView = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface-view.tsx",
    );
    const zhSession = readWorkspaceFile("apps/app/src/i18n/locales/zh/session.ts");
    const enSession = readWorkspaceFile("apps/app/src/i18n/locales/en/session.ts");
    const zhTwSession = readWorkspaceFile("apps/app/src/i18n/locales/zh-TW/session.ts");

    expect(emptyState).toContain("function TeamWorkflowSummary");
    expect(emptyState).toContain("<StatusBadge");
    expect(emptyState).toContain("<StepMarker");
    expect(emptyState).toContain('t("session.team_workflow_mode")');
    expect(emptyState).toContain('t("session.team_workflow_honesty_note")');
    expect(emptyState).not.toContain("shadow-");
    expect(surfaceView).toContain("teamWorkflow: props.effectiveAgent.teamWorkflow");
    expect(zhSession).toContain('"session.team_workflow_mode": "主理人工作流"');
    expect(enSession).toContain('"session.team_workflow_mode": "Lead workflow"');
    expect(zhTwSession).toContain('"session.team_workflow_mode": "主理人工作流"');
  });

  test("expert runtime allocation releases its creation lock and never heals into the project", () => {
    const pageView = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/page-view.tsx",
    );
    const surfaceProps = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts",
    );
    const lockStart = pageView.indexOf(
      "creatingSessionWorkspaceIdsRef.current.add(workspaceId)",
    );
    const lockEnd = pageView.indexOf(
      "creatingSessionWorkspaceIdsRef.current.delete(workspaceId)",
      lockStart,
    );
    const creationBlock = pageView.slice(lockStart, lockEnd);

    expect(lockStart).toBeGreaterThan(-1);
    expect(lockEnd).toBeGreaterThan(lockStart);
    expect(creationBlock.indexOf("try {")).toBeLessThan(
      creationBlock.indexOf("createIsolatedExpertSessionRuntimeDirectory"),
    );
    expect(surfaceProps).not.toContain("materializeExpertSessionDirectory");
    expect(surfaceProps).not.toContain("resolveExpertSessionDirectoryMarker");
  });

  test("expert store create expert opens a fresh assistant draft before prefill", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const expertSkillNav = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-expert-skill-navigation.ts",
    );
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const desktopMain = readWorkspaceFile("apps/desktop/electron/main.mjs");
    const zhSession = readWorkspaceFile("apps/app/src/i18n/locales/zh/session.ts");
    const enSession = readWorkspaceFile("apps/app/src/i18n/locales/en/session.ts");

    // Host wires the extracted skill-navigation hook (file-size split from expert.tsx).
    expect(expertPage).toContain("useExpertSkillNavigation");
    expect(expertPage).toContain("onCreateTaskInWorkspace: props.sidebar.onCreateTaskInWorkspace");
    expect(expertSkillNav).toContain('t("session.create_expert_prompt")');
    // Navigate first (goAssistantOfficeNewTaskWithDraft); do not await install before jump.
    expect(expertSkillNav).toContain("goAssistantOfficeNewTaskWithDraft");
    expect(expertSkillNav).toContain("setComposerDraftAfterNewTask(");
    expect(expertSkillNav).toContain("navigate(workspaceAssistantRoute(id))");
    expect(expertSkillNav).not.toContain("await installBuiltinSkillPackage");
    expect(expertSkillNav).toContain('packageName: CREATE_EXPERT_SKILL_NAME');
    expect(expertSkillNav).toContain('skillName: CREATE_EXPERT_SKILL_NAME');
    expect(assistantPage).toContain('t("session.create_expert_prompt")');
    expect(assistantPage).toContain("installBuiltinSkillPackage");
    // expert-manager is curated under bundled-skills, not marketplace hub package ids
    expect(desktopMain).toContain('path.join(bundledRoot, safePackage)');
    expect(desktopMain).toContain("apps/desktop/resources/bundled-skills");
    expect(zhSession).toContain("session.create_expert_prompt");
    expect(zhSession).toContain("/expert-manager 帮我创建一个");
    expect(enSession).toContain("session.create_expert_prompt");
    expect(enSession).toContain("/expert-manager Help me create");
  });

  test("marketplace summon binds pending agent around create-task then opens expert draft", () => {
    const assistantPage = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const summonHook = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-summon-marketplace-expert.ts",
    );
    const sessionStarters = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-expert-session-starters.ts",
    );

    // Assistant summon path: bind pending agent before create-task (which
    // clears pending), re-assert after, then switch to expert mode.
    expect(assistantPage).toContain("useSummonMarketplaceExpert");
    expect(summonHook).toContain("buildPendingAgentFromMarketplaceExpert(expert)");
    expect(summonHook).toContain("usePendingAgentStore.getState().setAgent(pending)");
    expect(summonHook).toContain("onCreateTaskInWorkspace(selectedWorkspaceId)");
    // Re-assert after create-task's synchronous setAgent(null).
    expect(summonHook).toContain("draftSource: \"agent-selection\"");
    expect(summonHook.indexOf("setAgent(pending)")).toBeLessThan(
      summonHook.indexOf("onCreateTaskInWorkspace(selectedWorkspaceId)"),
    );
    expect(summonHook.indexOf("onCreateTaskInWorkspace(selectedWorkspaceId)")).toBeLessThan(
      summonHook.indexOf("draftSource: \"agent-selection\""),
    );
    expect(summonHook).toContain(
      "setExpertComposerDraftAfterNewTask(",
    );
    expect(summonHook).toContain("resolveMarketplaceExpertStartPrompt(");
    expect(summonHook).toContain(
      "setExpertComposerTemplateAfterNewTask(",
    );
    expect(summonHook).toContain('onNavigateToMode("expert")');
    expect(expertPage).toContain("const openFreshExpertDraft = useCallback");
    expect(expertPage).toContain("useExpertSessionStarters");
    // Always fresh draft — never reopen latest history session for 「去聊天」/召唤.
    expect(sessionStarters).toContain("buildPendingAgentFromMarketplaceExpert(expert)");
    expect(sessionStarters).toContain("input.activateDraftAgent(pendingWithStart)");
    expect(sessionStarters).toContain("input.openFreshExpertDraft()");
    // Must leave 市场 immediately so UI does not stall on the store rail.
    expect(sessionStarters).toContain('input.openRailView("chat")');
    expect(sessionStarters).toContain("resolveMarketplaceExpertStartPrompt(");
    expect(sessionStarters).not.toContain("setComposerTemplateAfterNavigation(");
    expect(sessionStarters).not.toContain("existingConversationGroup");
    expect(sessionStarters).toContain("setExpertComposerDraftAfterNewTask(");
    expect(sessionStarters).toContain("setExpertComposerTemplateAfterNewTask(");
    // Prefill only explicit quick-prompt or logistics templates.
    expect(sessionStarters).toContain("initialPrompt?.trim()");
  });

  test("vite regenerates marketplace manifests from desktop resources", () => {
    const viteConfig = readWorkspaceFile("apps/app/vite.config.ts");

    expect(viteConfig).toContain("generate-marketplace-manifests.mjs");
    expect(viteConfig).toContain("apps/desktop/resources/marketplace");
    expect(viteConfig).toContain("buildStart()");
    expect(viteConfig).toContain("server.watcher.add(marketplaceResourcesRoot)");
  });

  test("marketplace manifests stay lightweight and reference generated Vite assets", () => {
    const generator = readWorkspaceFile("apps/app/scripts/generate-marketplace-manifests.mjs");
    const expertManifest = readMarketplaceFile("builtin-experts.manifest.json");
    const expertAssets = readMarketplaceFile("builtin-expert-assets.ts");
    const skillManifest = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/skills-marketplace/builtin-skills.manifest.json",
    );
    const skillAssets = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/skills-marketplace/builtin-skill-assets.ts",
    );
    const skillData = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/skills-marketplace/data.ts",
    );

    expect(generator).toContain("writeAssetMap");
    expect(generator).toContain("?url");
    expect(expertManifest).toContain("avatarAssetPath");
    expect(expertAssets).toContain("BUILTIN_EXPERT_AVATAR_URLS");
    expect(expertAssets).toContain("../../../../../../desktop/resources/marketplace");
    expect(skillManifest).toContain("iconAssetPath");
    expect(skillAssets).toContain("BUILTIN_SKILL_ICON_URLS");
    expect(skillAssets).toContain("../../../../../../desktop/resources/marketplace");
    expect(skillData).toContain("BUILTIN_SKILL_ICON_URLS[packageName]");
    expect(expertManifest).not.toContain("data:image");
    expect(skillManifest).not.toContain("data:image");
  });

  test("expert package metadata stays aligned across runtime and generated manifests", () => {
    const generated = JSON.parse(
      readMarketplaceFile("builtin-experts.manifest.json"),
    ) as {
      experts?: Array<{
        packageName?: string;
        manifest?: {
          skills?: unknown;
          introStyle?: unknown;
          approvedAgentIds?: unknown;
        };
      }>;
    };
    const generatedByPackage = new Map(
      (generated.experts ?? []).map((entry) => [entry.packageName, entry.manifest ?? {}]),
    );

    for (const packageName of builtInPackageNames()) {
      const packageRoot = join(builtinPluginsRoot, packageName);
      const source = JSON.parse(
        readFileSync(join(packageRoot, ".expert-plugin/plugin.json"), "utf8"),
      ) as {
        skills?: unknown;
        introStyle?: unknown;
        approvedAgentIds?: unknown;
      };
      const runtimePath = join(packageRoot, ".onmyagent-plugin/plugin.json");
      const runtime = existsSync(runtimePath)
        ? (JSON.parse(readFileSync(runtimePath, "utf8")) as typeof source)
        : null;
      const generatedEntry = generatedByPackage.get(packageName);
      expect(generatedEntry).toBeDefined();
      expect(generatedEntry?.skills ?? []).toEqual(source.skills ?? []);
      expect(generatedEntry?.introStyle ?? "default").toBe(source.introStyle ?? "default");
      expect(generatedEntry?.approvedAgentIds ?? []).toEqual(source.approvedAgentIds ?? []);
      if (runtime) {
        expect(runtime.skills ?? []).toEqual(source.skills ?? []);
        expect(runtime.introStyle ?? "default").toBe(source.introStyle ?? "default");
        expect(runtime.approvedAgentIds ?? []).toEqual(source.approvedAgentIds ?? []);
      }
    }
  });

  test("expert chat keeps selected marketplace expert identity across header and new sessions", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const conversationModel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/expert-conversation-model.ts",
    );
    const sessionStarters = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-expert-session-starters.ts",
    );
    const surface = readWorkspaceFile("apps/app/src/react-app/domains/session/surface/session-surface.tsx");
    const pendingAgent = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface-pending-agent.ts",
    );
    const surfaceTypes = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface-types.ts",
    );
    const surfaceSources = [surface, pendingAgent].join("\n");
    const expertHost = [expertPage, conversationModel, sessionStarters].join("\n");

    // Active agent identity resolves via pure conversation model (wired from ExpertPage).
    expect(expertPage).toContain("resolveActiveAgentContext");
    expect(expertPage).toContain("buildExpertPageNavigationModel");
    expect(expertPage).toContain("activeAgentContext,");
    expect(conversationModel).toContain("export function resolveActiveAgentContext");
    expect(conversationModel).toContain("findBuiltinMarketplaceExpertById(");
    expect(expertHost).toContain("activeAgentContext?.id");
    expect(sessionStarters).toContain("input.activeAgentContext?.id");
    expect(expertPage).toContain("agentContext={activeAgentContext}");
    expect(expertPage).toContain("assistantFeatureCategoryId={activeExpertFeatureCategoryId}");
    expect(expertPage).not.toContain("DEFAULT_AGENT_TEMPLATE_ID");
    // SessionSurfaceProps lives in session-surface-types (folder extract).
    expect(surfaceTypes).toContain("agentContext?: PendingAgentContext | null");
    expect(surface).toContain('export type { SessionSurfaceProps } from "./session-surface-types"');
    expect(surface).toContain("export function SessionSurface");
    expect(surfaceSources).toContain(": props.agentContext");
    expect(surfaceSources).toContain("assistantFeatureCategoryId");
  });

  test("expert draft tabs keep multiple unsent experts selectable", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const conversationModel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/expert-conversation-model.ts",
    );
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx");
    const expertHost = [expertPage, conversationModel].join("\n");

    expect(expertPage).toContain("draftAgentContexts");
    expect(conversationModel).toContain("export function buildDraftAgentGroups");
    expect(expertHost).toContain("`draft:${selectedWorkspaceId}:${agent.id}`");
    expect(expertPage).toContain("onOpenDraftSession={handleOpenDraftSession}");
    expect(expertPage).toContain("draftAgentGroups={draftAgentGroups}");
    expect(expertPage).toContain("selectedAgentId={activeConversationAgentId}");
    expect(expertPage).toContain("onOpenSession={handleOpenExpertSession}");
    expect(tabs).toContain("onOpenDraftSession?: (sessionId: string) => void");
    expect(tabs).toContain("if (isDraft) props.onOpenDraftSession?.(session.id)");
    expect(panel).toContain("draftAgentGroups?: AgentConversationGroup[]");
  });

  test("expert conversation list keeps the selected agent highlighted for draft tabs", () => {
    const list = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-list.tsx");
    const item = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-item.tsx");
    const panel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx");

    expect(panel).toContain("selectedAgentId?: string | null");
    expect(panel).toContain("selectedAgentId={props.selectedAgentId}");
    expect(list).toContain("selectedAgentId?: string | null");
    // Draft + multi-session: highlight by agentId or any session under the group.
    expect(list).toContain("group.agentId === props.selectedAgentId");
    expect(list).toContain("session.id === props.selectedSessionId");
    // Title matches local-agent list weight (always medium).
    expect(item).toContain(
      'itemTitle: "min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text"',
    );
    // Streaming / activity uses ExpertStatusDots (not raw accent pill).
    expect(item).toContain("ExpertStatusDots");
    expect(item).not.toContain(
      'props.taskStatusVariant === "available" && "bg-dls-accent"',
    );
    expect(list).not.toContain(
      'props.taskStatusVariant === "available" && "bg-dls-accent"',
    );
  });

  test("expert page feeds selected route expert sessions back into the left conversation panel", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const visibility = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-visibility.ts");
    const barrel = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/session-chrome.ts");

    expect(visibility).toContain("export function ensureSelectedAgentSessionVisible");
    expect(visibility).toContain("export function ensureSelectedAgentSessionGroupVisible");
    expect(visibility).toContain("selectedAgentId: string | null");
    expect(visibility).toContain("selectedSessionId: string | null");
    expect(barrel).toContain("ensureSelectedAgentSessionGroupVisible");
    expect(barrel).toContain("ensureSelectedAgentSessionVisible");
    expect(expertPage).toContain("const rawWorkspaceSessions = useMemo");
    expect(expertPage).toContain("const workspaceSessions = useMemo");
    expect(expertPage).toContain("const sidebarWorkspaceSessionGroups = useMemo");
    expect(expertPage).toContain("groups={sidebarWorkspaceSessionGroups}");
  });

  test("expert side panel reuses assistant office and code workspace panel", () => {
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const hostState = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-session-page-host-state.ts",
    );

    expect(expertPage).toContain("CodeWorkspaceSidePanel");
    // Side-panel open helpers live in shared host state after host extract.
    expect(hostState).toContain('setCurrentSidePanel("codeMenu")');
    expect(expertPage).toContain('activeSidePanel === "review"');
    expect(expertPage).toContain('activeSidePanel === "terminal"');
    expect(expertPage).toContain('activeSidePanel === "browser"');
    expect(expertPage).toContain('activeSidePanel === "artifacts"');
    expect(expertPage).toContain('activeExpertFeatureCategoryId === "office"');
    // Office keeps terminal + browser + files; only code review is code-scene only.
    expect(expertPage).toContain('? ["review"]');
    expect(expertPage).not.toContain('["review", "terminal"]');
    expect(expertPage).not.toContain("<BrowserPanel");
    expect(expertPage).not.toContain("<ArtifactPanel");
  });

  test("expert session tab menu auto-closes when pointer leaves the menu", () => {
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");

    expect(tabs).toContain("const menuRef = useRef<HTMLDivElement>(null)");
    expect(tabs).toContain('window.addEventListener("pointermove", handlePointerMove)');
    expect(tabs).toContain("triggerBottom: rect.bottom");
    expect(tabs).toContain("const safeBottom = Math.max(rect.bottom, menuState.triggerBottom) + padding");
    expect(tabs).toContain("onMouseLeave={() => setMenuState(null)}");
    expect(tabs).toContain("onPointerLeave={() => setMenuState(null)}");
  });

  test("expert session tabs keep pending selection visible while route catches up", () => {
    const tabs = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx");
    const expertPage = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/use-expert-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert-page-layout.tsx"),
      readExpertPageSource(),
    ].join("\n");
    const draftTransition = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/use-expert-bound-draft-transition.ts",
    );
    const surfaceProps = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts",
    );
    const actionRow = readWorkspaceFile("apps/app/src/components/ui/action-row.tsx");

    expect(expertPage).toContain("const [pendingTabSessionId, setPendingTabSessionId]");
    expect(expertPage).toContain("const [sessionTabOrderIdsByScope, setSessionTabOrderIdsByScope]");
    expect(expertPage).toContain("orderIds={sessionTabOrderIds}");
    // Pending tab highlight: local override or surface-mode creatingSessionId.
    expect(expertPage).toContain("pendingSessionId={");
    expect(expertPage).toContain("expertSurfaceMode.creatingSessionId");
    // Single surface mode owns draftOnly / sessionId / force-nav.
    expect(expertPage).toContain("resolveExpertSurfaceMode({");
    expect(expertPage).toContain("draftOnly={isDraftSession}");
    // Bound-draft navigation owns the transition after its extraction from
    // ExpertPage, while ExpertPage remains the state host and tab renderer.
    expect(expertPage).toContain("useExpertBoundDraftTransition({");
    expect(draftTransition).toContain("resolveExpertSurfaceMode({");
    expect(draftTransition).toContain("shouldDropDraftIntentForRoute({");
    expect(draftTransition).toContain("mode.mayForceNavToBound");
    expect(draftTransition).toContain("setPendingTabSessionId(mode.creatingSessionId ?? createdSessionId)");
    expect(expertPage).toContain("props.sidebar.onOpenSession(");
    expect(tabs).toContain("const activeSessionId = pendingSessionIsVisible");
    expect(tabs).toContain("scrollTabIntoViewIfNeeded(tabRefs.current[activeSessionId])");
    expect(tabs).toContain("window.setTimeout");
    expect(tabs).toContain("props.onPendingSessionIdChange(session.id)");
    expect(tabs).not.toContain("if (!pendingSessionIsVisible)");
    expect(tabs).toContain("const active = session.id === activeSessionId");
    // Bind the created expert before route activation so ExpertPage can lock
    // selection without flashing through its draft home.
    const earlyBindIndex = surfaceProps.indexOf(".upsertIdentity(");
    const routeActivationIndex = surfaceProps.indexOf(
      "activateCreatedSessionRoute({",
    );
    expect(earlyBindIndex).toBeGreaterThan(-1);
    expect(routeActivationIndex).toBeGreaterThan(earlyBindIndex);
    // Session tab active chrome: soft list-selected wash (not accent pill).
    expect(actionRow).toContain("bg-dls-list-selected font-medium text-dls-text shadow-none");
  });

  test("expert session tabs separate expanded chrome and embed the collapse handle", () => {
    const tabs = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/sidebar/agent-session-tabs.tsx",
    );

    // Expanded strip owns the bottom rule; collapsed is hang-tab host only.
    expect(tabs).toContain('"h-11 border-b border-dls-mist px-3"');
    expect(tabs).toContain('"h-0 overflow-visible shadow-none"');
    expect(tabs).toContain(
      'className="flex h-full min-w-0 items-center gap-1.5 overflow-x-auto"',
    );
    expect(tabs).toContain('variant="ghost"');
    expect(tabs).toContain("rounded-t-none rounded-b-md");
    expect(tabs).toContain(
      "border-x border-b border-t-0 border-dls-mist",
    );
    expect(tabs).toContain('expanded ? "-rotate-90" : "rotate-90"');
    expect(tabs).toContain("before:-top-px before:inset-x-0 before:h-px");
    expect(tabs).not.toContain("rounded-full border-dls-border bg-dls-surface");
  });

  test("assistant automation session rows support local pinning under scheduled groups", () => {
    const sections = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx");
    const taskItem = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/assistant-task-item.tsx");
    const automationNav = readWorkspaceFile(
      "apps/app/src/react-app/domains/messaging/automation-nav-sidebar.tsx",
    );

    expect(taskItem).toContain("pinnable?: boolean");
    expect(taskItem).toContain("const pinnable = props.pinnable ?? true");
    // Pin control only when pinnable and a toggle handler is provided.
    expect(taskItem).toContain("{pinnable && props.onTogglePinned ? (");
    // Home schedule section removed — local pins live on primary-rail Automation nav.
    expect(sections).toContain(
      "Schedules / automation groups live on the primary-rail Automation page.",
    );
    expect(automationNav).toContain("onToggleSessionPinned");
    expect(automationNav).toContain("onToggleGroupPinned");
    expect(automationNav).toContain("props.session.pinned");
  });

  test("session route does not maintain a renderer expert index after deletion", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/page-view.tsx",
    );

    expect(sessionRoute).toContain("removeAssistantSession(sessionId)");
    expect(sessionRoute).not.toContain("removeExpertSession(sessionId)");
    expect(sessionRoute).toContain("writeCustomAgentIdForSession(sessionId, null)");
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(sessionId, null)");
    expect(sessionRoute).toContain("removeAutomationSessionRecord(");
    expect(sessionRoute).toContain("removeAssistantSessionWorkspace(sessionId)");
  });

  test("keeps built-in package installation delayed until a real session exists", () => {
    const pageView = readWorkspaceFile("apps/app/src/react-app/shell/session-route/page-view.tsx");
    const sessionRoute = [
      pageView,
      // Assembly lives in impl; thin surface-props-hook.ts only re-exports.
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/surface-props-hook.ts"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts"),
      readWorkspaceFile("apps/app/src/react-app/shell/session-route/intent.ts"),
    ].join("\n");
    const agentContext = readWorkspaceFile("apps/app/src/react-app/shell/session-route/agent-context.ts");
    const installIntent = readWorkspaceFile("apps/app/src/react-app/shell/session-route/intent.ts");
    const installHelper = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/expert-marketplace/install.ts",
    );

    expect(sessionRoute).toContain("installMarketplaceExpertAfterSessionCreated");
    expect(sessionRoute).toContain("kickoffMarketplaceExpertInstall");
    expect(installIntent).toContain("await ensureMarketplaceExpertInstalled(marketplaceExpert)");
    expect(installHelper).toContain('expert.source !== "builtin"');
    expect(installHelper).toContain("coordinator.ensure({");
    expect(installHelper).toContain('marketplace: "experts"');
    expect(sessionRoute).toContain("bindPendingAgentToSession({");
    expect(sessionRoute).toContain("sessionId: newSession.id");
    const promptBindIndex = sessionRoute.indexOf(
      "if (pendingAgentSnapshot && sessionId)",
    );
    const promptBindSlice = sessionRoute.slice(promptBindIndex, promptBindIndex + 2_000);
    expect(promptBindIndex).toBeGreaterThan(-1);
    expect(promptBindSlice).toContain("useExpertDirectoryStore");
    expect(promptBindSlice).toContain(".upsertIdentity(");
    expect(promptBindSlice).toContain("pendingAgentSnapshot.id");
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(sessionId, pendingAgentSnapshot)");
    // First prompt joins install (started earlier) with env prep — not a serial
    // await after bind. Empty-shell create fire-and-forgets install.
    expect(sessionRoute).toContain("installMarketplaceExpertAfterSessionCreated");
    expect(sessionRoute).toContain("Promise.all([");
    const sessionCreatedGuardIndex = pageView.indexOf("if (!newSession) return;");
    const installAfterCreationIndex = pageView.indexOf(
      "void installMarketplaceExpertAfterSessionCreated(agentToBind)",
    );
    expect(sessionCreatedGuardIndex).toBeGreaterThan(-1);
    expect(installAfterCreationIndex).toBeGreaterThan(sessionCreatedGuardIndex);
    // Binding goes through helper; agent-context stamps boundSessionId from sessionId.
    expect(agentContext).toContain("boundSessionId: input.sessionId");
  });

  test("expert sessions persist agent metadata snapshots for restart restore", () => {
    const sessionRoute = readWorkspaceFile(
      "apps/app/src/react-app/shell/session-route/page-view.tsx",
    );
    const store = readWorkspaceFile("apps/app/src/react-app/domains/agents/agent-registry-store.ts");
    const model = readWorkspaceFile("apps/app/src/react-app/domains/session/sidebar/conversation-model.ts");

    // After create, resolvePendingAgentForPrompt may inherit; bind uses agentToBind.
    expect(sessionRoute).toContain("writeSessionAgentSnapshot(newSession.id, agentToBind)");
    expect(sessionRoute).toContain("resolvePendingAgentForPrompt");
    expect(store).toContain("onmyagent:customAgentSnapshotBySessionId");
    expect(store).toContain("export function readSessionAgentSnapshot");
    expect(store).toContain("export function writeSessionAgentSnapshot");
    expect(model).toContain("readSessionAgentSnapshot(session.id)");
    expect(model).toContain("sessionAgentSnapshot?.name");
  });

  test("exposes a lightweight expert registry separate from full card details", () => {
    const types = readMarketplaceFile("types.ts");
    const data = readMarketplaceFile("data.ts");
    const desktop = readWorkspaceFile("apps/app/src/app/lib/desktop.ts");
    const main = readWorkspaceFile("apps/desktop/electron/main.mjs");

    expect(types).toContain("export type ExpertRegistryRecord");
    expect(types).toContain("packageName: string");
    expect(types).toContain("packagePath: string");
    expect(data).toContain("export const BUILTIN_EXPERT_REGISTRY");
    // desktop.ts may export as function or const re-export after domain splits
    expect(desktop).toMatch(/export (?:async )?function listExpertRegistryRecords|export const listExpertRegistryRecords/);
    const skillsHandlers = readWorkspaceFile(
      "apps/desktop/electron/desktop-handlers/skills.mjs",
    );
    expect(skillsHandlers).toContain('"listExpertRegistryRecords"');
    expect(skillsHandlers).toContain("listExpertRegistryRecords:");
    expect(main).toContain("createAllDesktopDomainHandlers");
  });
});
