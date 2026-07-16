import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/react-app/domains/session/components/permission-modal/index.tsx",
    import.meta.url,
  ),
  "utf8",
);

const panelSource = source.slice(
  source.indexOf("export function PermissionApprovalPanel"),
);

describe("permission approval panel", () => {
  test("separates context, scope, and decisions into a calm hierarchy", () => {
    expect(panelSource).toContain("permissionLayoutClass.panelHeader");
    expect(panelSource).toContain("permissionLayoutClass.panelBody");
    expect(panelSource).toContain("permissionLayoutClass.panelDecision");
    expect(panelSource).toContain("<StatusBadge");
  });

  test("keeps the safest temporary approval as the trailing primary action", () => {
    const denyIndex = panelSource.indexOf('t("session.deny")');
    const sessionIndex = panelSource.indexOf('t("session.allow_for_session")');
    const onceIndex = panelSource.indexOf('t("session.allow_once")');

    expect(denyIndex).toBeGreaterThan(-1);
    expect(sessionIndex).toBeGreaterThan(denyIndex);
    expect(onceIndex).toBeGreaterThan(sessionIndex);
    expect(panelSource.slice(sessionIndex - 400, sessionIndex)).toContain(
      'variant="outline"',
    );
  });
});
