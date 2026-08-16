import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { permissionIdsForPlatform } from "../src/react-app/domains/settings/pages/system-authorizations-model";
import type { SystemPermissionType } from "../src/app/lib/desktop-types";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

const ALL: SystemPermissionType[] = [
  "full-disk-access",
  "screen-recording",
  "accessibility",
  "microphone",
  "automation",
  "notifications",
];

describe("linux system authorizations", () => {
  test("linux shows workspace/fs, notifications, mic, and accessibility", () => {
    expect(permissionIdsForPlatform("linux", ALL)).toEqual([
      "full-disk-access",
      "notifications",
      "microphone",
      "screen-recording",
      "accessibility",
    ]);
    expect(permissionIdsForPlatform("windows", ALL)).not.toContain(
      "full-disk-access",
    );
    expect(permissionIdsForPlatform("macos", ALL)).toContain("automation");
  });

  test("view uses platform helper and workspace copy", () => {
    const view = read(
      "apps/app/src/react-app/domains/settings/pages/system-authorizations-view.tsx",
    );
    expect(view).toContain("permissionIdsForPlatform");
    expect(view).toContain("settings.permission_workspace_label");
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const source = read(`apps/app/src/i18n/locales/${locale}/settings.ts`);
      expect(source).toContain('"settings.permission_workspace_label"');
      expect(source).toContain('"settings.permission_workspace_desc"');
    }
  });
});
