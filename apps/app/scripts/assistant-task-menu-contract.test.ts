import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("assistant task context menu contract", () => {
  test("menu items are pin, open-folder (conditional), rename, archive, delete — no share/export", () => {
    const item = read(
      "src/react-app/domains/session/sidebar/assistant-task-item.tsx",
    );
    const tabs = read(
      "src/react-app/domains/session/sidebar/agent-session-tabs.tsx",
    );
    const settings = read(
      "src/react-app/domains/settings/pages/archived-tasks-view.tsx",
    );
    const panel = read(
      "src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
    );

    // Present actions
    expect(item).toContain('t("session.pin")');
    expect(item).toContain('t("session.open_folder")');
    expect(item).toContain('t("session.rename_action")');
    expect(item).toContain('t("session.archive_task")');
    expect(item).toContain('t("session.delete_task")');
    expect(item).toContain("resolveOpenFolderPath");
    expect(item).toContain("openFolderPath && props.onOpenFolder");
    expect(item).toContain("TASK_CONTEXT_MENU_CLASS");
    expect(item).toContain("TASK_CONTEXT_MENU_SEPARATOR_CLASS");
    expect(item).toContain('data-task-context-menu="true"');
    expect(item).toContain("align=\"start\"");

    // Forbidden product actions for this goal (menu labels / i18n keys only)
    expect(item).not.toMatch(/session\.share/i);
    expect(item).not.toMatch(/session\.export/i);
    expect(item).not.toMatch(/t\(["']session\.(share|export)/);
    expect(item).not.toContain("分享");
    expect(item).not.toContain("导出");

    // Expert strip shares chrome
    expect(tabs).toContain("TASK_CONTEXT_MENU_CLASS");
    expect(tabs).toContain("TASK_CONTEXT_MENU_SEPARATOR_CLASS");
    expect(tabs).toContain('t("session.delete_task")');

    // Panel wires archive + open folder + filters archived from main list
    expect(panel).toContain("handleArchiveAssistantSession");
    expect(panel).toContain("handleOpenFolder");
    expect(panel).toContain("filterGroupsExcludingArchived");
    expect(panel).toContain("revealDesktopItemInDir");

    // Settings restore / permanent delete for assistant archives
    expect(settings).toContain("restoreAssistantArchivedTask");
    expect(settings).toContain("permanentlyRemoveAssistantArchivedTask");
    expect(settings).toContain("data-assistant-archived-list");
    expect(settings).toContain("deleteSession");
  });
});
