import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  AUTOMATION_EMPTY_STATE_ASSET,
  CONNECTORS_EMPTY_STATE_ASSET,
  CONVERSATION_HISTORY_EMPTY_STATE_ASSET,
  DEVICES_EMPTY_STATE_ASSET,
  EMPTY_STATE_ILLUSTRATION_CLASS,
  EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS,
  NO_EXPERT_CONVERSATIONS_ASSET,
  PROJECTS_PLACEHOLDER_ASSET,
  SCHEDULED_TASKS_PREVIEW_ASSET,
  SKILLS_EMPTY_STATE_ASSET,
} from "../src/react-app/domains/session/empty-state-assets";

const root = resolve(import.meta.dir, "../../..");

function publicPath(asset: string) {
  return resolve(root, "apps/app/public", asset.replace(/^\//, ""));
}

const WAVE1_ASSETS = [
  NO_EXPERT_CONVERSATIONS_ASSET,
  PROJECTS_PLACEHOLDER_ASSET,
  DEVICES_EMPTY_STATE_ASSET,
] as const;

const WAVE2_ASSETS = [
  AUTOMATION_EMPTY_STATE_ASSET,
  CONVERSATION_HISTORY_EMPTY_STATE_ASSET,
  SKILLS_EMPTY_STATE_ASSET,
  CONNECTORS_EMPTY_STATE_ASSET,
  SCHEDULED_TASKS_PREVIEW_ASSET,
] as const;

describe("empty-state Koboyo local illustrations", () => {
  test("all exported illustration paths exist as local monochrome SVGs", () => {
    const assets = [...WAVE1_ASSETS, ...WAVE2_ASSETS];
    expect(new Set(assets).size).toBe(assets.length);
    for (const asset of assets) {
      expect(asset.startsWith("/illustrations/koboyo/")).toBe(true);
      expect(asset.endsWith(".svg")).toBe(true);
      const full = publicPath(asset);
      expect(existsSync(full), full).toBe(true);
      expect(statSync(full).size).toBeLessThan(20_000);
      const svg = readFileSync(full, "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("currentColor");
      expect(svg).toContain("viewBox");
    }
  });

  test("layout classes are height-driven (not square-forced)", () => {
    for (const cls of [
      EMPTY_STATE_ILLUSTRATION_CLASS,
      EMPTY_STATE_ILLUSTRATION_COMPACT_CLASS,
    ]) {
      expect(cls).toContain("h-");
      expect(cls).toContain("w-auto");
      expect(cls).not.toContain("object-cover");
      expect(cls).not.toMatch(/\bsize-\[/);
    }
  });

  test("obsolete empty-states raster directory is gone or empty of product refs", () => {
    const emptyDir = resolve(root, "apps/app/public/empty-states");
    if (existsSync(emptyDir)) {
      const files = readdirSync(emptyDir);
      expect(files).toEqual([]);
    }
    const deadNames = [
      "no-expert-conversations.png",
      "projects-placeholder.jpg",
      "devices-placeholder.png",
      "cloud-drive-placeholder.png",
    ];
    for (const name of deadNames) {
      expect(existsSync(resolve(emptyDir, name))).toBe(false);
    }
  });

  test("apps/app/src has no references to superseded empty-states rasters", () => {
    const needleHits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (
          name.name === "node_modules" ||
          name.name === "dist" ||
          name.name === ".git"
        ) {
          continue;
        }
        const full = resolve(dir, name.name);
        if (name.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name.name)) continue;
        const text = readFileSync(full, "utf8");
        if (
          text.includes("empty-states/no-expert-conversations.png") ||
          text.includes("empty-states/projects-placeholder.jpg") ||
          text.includes("empty-states/devices-placeholder.png") ||
          text.includes("empty-states/cloud-drive-placeholder.png")
        ) {
          needleHits.push(full.replace(root + "/", ""));
        }
      }
    };
    walk(resolve(root, "apps/app/src"));
    expect(needleHits).toEqual([]);
  });

  test("wave-2 live empty consumers wire shared illustrations", () => {
    const automation = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/messaging/automation-page-lists.tsx",
      ),
      "utf8",
    );
    const history = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/conversation-history-panel.tsx",
      ),
      "utf8",
    );
    const plugins = readFileSync(
      resolve(root, "apps/app/src/react-app/domains/plugins/plugins-page.tsx"),
      "utf8",
    );
    const skills = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/plugins/skills-marketplace/skills-marketplace-page.tsx",
      ),
      "utf8",
    );
    const preview = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/components/feature-preview-placeholder.tsx",
      ),
      "utf8",
    );

    expect(automation).toContain("AUTOMATION_EMPTY_STATE_ASSET");
    expect(automation).toContain("EmptyStateIllustration");
    expect(history).toContain("CONVERSATION_HISTORY_EMPTY_STATE_ASSET");
    expect(history).toContain("EmptyStateIllustration");
    expect(plugins).toContain("SKILLS_EMPTY_STATE_ASSET");
    expect(plugins).toContain("CONNECTORS_EMPTY_STATE_ASSET");
    expect(plugins).toContain("EmptyStateIllustration");
    expect(skills).toContain("SKILLS_EMPTY_STATE_ASSET");
    expect(skills).toContain("EmptyStateIllustration");
    expect(preview).toContain("SCHEDULED_TASKS_PREVIEW_ASSET");
    expect(preview).toContain("DEVICES_EMPTY_STATE_ASSET");
  });
});
