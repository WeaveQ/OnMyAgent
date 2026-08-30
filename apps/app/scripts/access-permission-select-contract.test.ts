/**
 * Composer full-access control is a binary Switch popover, not a 3-mode menu.
 * Home draft (accessory) and expert empty (composer toolbar) share one component.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("access permission select contract", () => {
  test("uses portal Popover and a binary Switch, not a 3-mode menu", () => {
    const src = read("src/react-app/design-system/access-permission-select.tsx");
    expect(src).toContain('from "@/components/ui/popover"');
    expect(src).toContain('side="top"');
    expect(src).toContain("<Switch");
    expect(src).toContain('props.onChange(next ? "full" : "default")');
    expect(src).toContain("composer.access_full_allow");
    expect(src).toContain("composer.access_full_warning");
    expect(src).not.toContain("ACCESS_PERMISSION_OPTIONS");
    expect(src).not.toContain("composer.access_delegate");
    expect(src).not.toContain("absolute bottom-full");
    expect(src).not.toContain("mousedown");
    expect(src).toContain("w-44");
    expect(src).not.toContain("18rem");
  });

  test("draft workspace picker popover matches the access chip width", () => {
    const accessory = read(
      "src/react-app/domains/session/surface/chrome/session-draft-workspace-accessory.tsx",
    );
    expect(accessory).toContain('className="w-44 gap-0 overflow-hidden p-0"');
    expect(accessory).not.toContain("w-72");
  });

  test("draft workspace search uses InputGroup so focus ring is not doubled", () => {
    const accessory = read(
      "src/react-app/domains/session/surface/chrome/session-draft-workspace-accessory.tsx",
    );
    expect(accessory).toContain("<InputGroup");
    expect(accessory).toContain("<InputGroupInput");
    expect(accessory).not.toContain("focus-within:ring-1");
  });

  test("treats only full as on; delegate displays as off until the user toggles", () => {
    const src = read("src/react-app/design-system/access-permission-select.tsx");
    expect(src).toContain('return mode === "full"');
    expect(src).not.toContain('mode === "delegate"');
  });

  test("home draft accessory and expert composer both mount the shared select", () => {
    const accessory = read(
      "src/react-app/domains/session/surface/chrome/session-draft-workspace-accessory.tsx",
    );
    const composer = read("src/react-app/domains/session/surface/composer/composer.tsx");
    const view = read("src/react-app/domains/session/surface/session-surface-view.tsx");
    const mode = read("src/react-app/domains/session/surface/session-surface-layout-mode.ts");
    expect(accessory).toContain("<AccessPermissionSelect");
    expect(composer).toContain("<AccessPermissionSelect");
    expect(view).toContain("hideAccessPermissionSelect=");
    expect(view).toContain("draftWorkspaceAccessoryActive || props.chrome === \"embedded\"");
    // Expert empty keeps the composer chip (workspace foot row is assistant-only).
    expect(mode).toContain("draftWorkspaceAccessoryActive");
    expect(mode).toContain("Boolean(input.personalAssistantHome)");
  });

  test("local-agent composer still does not mount session access mode", () => {
    const composer = read(
      "src/react-app/domains/local-agents/local-agent-draft-composer.tsx",
    );
    expect(composer).not.toContain("AccessPermissionSelect");
  });
});
