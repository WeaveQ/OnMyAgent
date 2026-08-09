import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  LOCAL_SIMPLE_ICON_SLUGS,
  isLocalSimpleIconSlug,
  resolveSimpleIconUrl,
} from "../src/react-app/design-system/simple-icon";

const root = resolve(import.meta.dir, "../../..");
const appSrc = resolve(root, "apps/app/src");
const simpleIconsDir = resolve(root, "apps/app/public/simple-icons");

function collectSrcFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "dist") continue;
      collectSrcFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name.name)) out.push(full);
  }
  return out;
}

describe("simple-icon offline helper", () => {
  test("resolves known slugs to local public assets", () => {
    for (const slug of LOCAL_SIMPLE_ICON_SLUGS) {
      expect(isLocalSimpleIconSlug(slug)).toBe(true);
      const url = resolveSimpleIconUrl(slug);
      expect(url).toContain(`/simple-icons/${slug}.svg`);
      expect(existsSync(resolve(simpleIconsDir, `${slug}.svg`))).toBe(true);
    }
  });

  test("unknown slug uses offline fallback, never CDN", () => {
    const url = resolveSimpleIconUrl("not-a-real-icon-slug-xyz");
    expect(url).toContain("/simple-icons/_fallback.svg");
    expect(url).not.toContain("cdn.simpleicons.org");
    expect(existsSync(resolve(simpleIconsDir, "_fallback.svg"))).toBe(true);
  });

  test("apps/app/src has no runtime cdn.simpleicons.org strings", () => {
    const needle = ["cdn", "simpleicons", "org"].join(".");
    const hits: string[] = [];
    for (const file of collectSrcFiles(appSrc)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(needle)) {
        hits.push(file.replace(root + "/", ""));
      }
    }
    expect(hits).toEqual([]);
  });

  test("product call sites import resolveSimpleIconUrl", () => {
    const files = [
      "apps/app/src/react-app/domains/plugins/extension-icon.tsx",
      "apps/app/src/react-app/design-system/extension-card.tsx",
      "apps/app/src/react-app/design-system/extension-detail-modal.tsx",
      "apps/app/src/react-app/domains/plugins/connector-connect-dialog.tsx",
      "apps/app/src/react-app/domains/cloud/den-signin-surface.tsx",
      "apps/app/src/react-app/domains/session/chat/session-page.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).toContain("resolveSimpleIconUrl");
      expect(src, rel).not.toContain("cdn.simpleicons.org");
    }
  });
});
