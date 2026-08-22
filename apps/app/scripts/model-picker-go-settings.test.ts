/**
 * Session model picker footer: 去设置 → Settings → AI / models.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");
const srcRoot = join(appRoot, "src");

describe("model picker go-to-settings", () => {
  test("footer uses 去设置 and opens settings models, not Done", () => {
    const modal = readFileSync(
      join(srcRoot, "react-app/capabilities/model-selection/model-picker-modal.tsx"),
      "utf8",
    );
    expect(modal).toContain("model_picker.go_to_settings");
    expect(modal).toContain("onGoToSettings ?? props.onOpenSettings");
    expect(modal).not.toContain('t("settings.done")');

    const sessionModals = readFileSync(
      join(srcRoot, "react-app/shell/session-route/modals.tsx"),
      "utf8",
    );
    expect(sessionModals).toContain('handleOpenSettings("/settings/ai")');

    const en = readFileSync(join(srcRoot, "i18n/locales/en/model_picker.ts"), "utf8");
    const zh = readFileSync(join(srcRoot, "i18n/locales/zh/model_picker.ts"), "utf8");
    const zhTw = readFileSync(join(srcRoot, "i18n/locales/zh-TW/model_picker.ts"), "utf8");
    expect(en).toContain('"model_picker.go_to_settings": "Go to settings"');
    expect(zh).toContain('"model_picker.go_to_settings": "去设置"');
    expect(zhTw).toContain('"model_picker.go_to_settings": "去設置"');
  });
});
