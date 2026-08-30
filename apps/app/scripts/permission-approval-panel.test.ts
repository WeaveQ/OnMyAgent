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
    expect(panelSource).not.toContain("<IconTile");
    expect(panelSource).not.toContain('size="icon-xs"');
    expect(source).toContain("rounded-none border-r-0 border-t-0");
    expect(source).not.toContain("rounded-2xl border border-dls-border bg-dls-surface");
    expect(panelSource).not.toContain("permission_decision_hint");
    expect(source).toContain("flex flex-wrap items-center gap-x-3");
  });

  test("keeps the safest temporary approval as the trailing primary action", () => {
    const denyIndex = panelSource.indexOf('denyLabel={t("session.deny")}');
    const sessionIndex = panelSource.indexOf(
      'allowAlwaysLabel={t("session.allow_for_session")}',
    );
    const onceIndex = panelSource.indexOf('allowOnceLabel={t("session.allow_once")}');

    expect(denyIndex).toBeGreaterThan(-1);
    expect(sessionIndex).toBeGreaterThan(denyIndex);
    expect(onceIndex).toBeGreaterThan(sessionIndex);

    const footer = readFileSync(
      new URL("../src/components/ui/tool-approval-card.tsx", import.meta.url),
      "utf8",
    );
    const alwaysClick = footer.indexOf("onClick={onAllowAlways}");
    expect(alwaysClick).toBeGreaterThan(-1);
    expect(footer.slice(alwaysClick - 180, alwaysClick)).toContain('variant="outline"');
    expect(footer.indexOf("onClick={onAllowOnce}")).toBeGreaterThan(alwaysClick);
  });
});
