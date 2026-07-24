import { describe, expect, test } from "bun:test";

import {
  COMPOSER_COLUMN_BOTTOM_PAD_CLASS,
  COMPOSER_SHELL_BOTTOM_PAD_CLASS,
  resolveComposerColumnShellClass,
  resolveComposerShellPadClass,
} from "../src/react-app/domains/session/surface/composer-shell-inset";

describe("composer shell bottom inset", () => {
  test("home and in-session sticky shells share the same bottom pad token", () => {
    // Flags that used to force pb-3 on home no longer branch the bottom pad.
    const home = resolveComposerShellPadClass({ compactTopSpacing: false });
    const chat = resolveComposerShellPadClass({ compactTopSpacing: false });
    expect(home).toBe(chat);
    expect(home).toContain(COMPOSER_SHELL_BOTTOM_PAD_CLASS);
    expect(home.includes("pb-3")).toBe(false);
    expect(home.includes("pb-0")).toBe(false);
  });

  test("compact top spacing only changes top pad, not bottom", () => {
    const compact = resolveComposerShellPadClass({ compactTopSpacing: true });
    const normal = resolveComposerShellPadClass({ compactTopSpacing: false });
    expect(compact).toContain("pt-0");
    expect(normal).toContain("pt-3");
    expect(compact).toContain(COMPOSER_SHELL_BOTTOM_PAD_CLASS);
    expect(normal).toContain(COMPOSER_SHELL_BOTTOM_PAD_CLASS);
  });

  test("draft-home column keeps bottom pad instead of pb-0", () => {
    const homeColumn = resolveComposerColumnShellClass({
      collapseTopSpacing: true,
    });
    const chatColumn = resolveComposerColumnShellClass({
      collapseTopSpacing: false,
    });
    expect(homeColumn).toContain(COMPOSER_COLUMN_BOTTOM_PAD_CLASS);
    expect(chatColumn).toContain(COMPOSER_COLUMN_BOTTOM_PAD_CLASS);
    expect(homeColumn.includes("pb-0")).toBe(false);
    expect(homeColumn).toContain("pt-0");
    expect(chatColumn).toContain("pt-2");
  });
});
