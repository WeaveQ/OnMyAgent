import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/shell/update-available-notice-monitor.tsx",
  ),
  "utf8",
);

describe("update available notice monitor", () => {
  test("dismisses the available toast when a download starts", () => {
    expect(source).toContain("dismissAvailableToast");
    expect(source).toMatch(
      /onAction:\s*\(\)\s*=>\s*\{[\s\S]*dismissAvailableToast\(\);[\s\S]*bridge\.download/,
    );
    expect(source).toMatch(
      /const showDownloadProgressToast[\s\S]*dismissAvailableToast\(\);/,
    );
  });

  test("locks restart-and-install after the first click", () => {
    expect(source).toContain("installingRef");
    expect(source).toContain("showInstallingToast");
    expect(source).toContain("settings.update_installing_notice_title");
    expect(source).toMatch(
      /if \(installingRef\.current\) return;[\s\S]*installingRef\.current = true/,
    );
  });
});
