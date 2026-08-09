import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const viewPath = join(
  import.meta.dir,
  "../src/react-app/domains/settings/pages/archived-tasks-view.tsx",
);

describe("archived-tasks-view filter UX contract", () => {
  const source = readFileSync(viewPath, "utf8");

  test("uses RadioGroup/RadioItem with trailing check (not custom left-check MenuItem)", () => {
    expect(source).toContain("DropdownMenuRadioGroup");
    expect(source).toContain("DropdownMenuRadioItem");
    expect(source).toContain("function FilterRadioItem");
    expect(source).not.toContain("MenuCheckItem");
    expect(source).not.toContain("event.preventDefault");
  });

  test("DropdownMenuLabel is always wrapped in DropdownMenuGroup (Base UI requires context)", () => {
    // Opening the type chip without Group throws MenuGroupRootContext missing
    // and remounts the settings tab (looks like a full page refresh).
    expect(source).toContain("DropdownMenuGroup");
    expect(source).toMatch(
      /DropdownMenuGroup[\s\S]{0,240}archived_tasks_type_section/,
    );
    expect(source).toMatch(
      /DropdownMenuGroup[\s\S]{0,240}archived_tasks_sort_section/,
    );
  });

  test("type and sort are separate radio groups under 所有任务 chip", () => {
    expect(source).toContain("setSourceFilter");
    expect(source).toContain("setSortMode");
    // Two onValueChange blocks for the type chip groups.
    const groups = source.match(/DropdownMenuRadioGroup/g) ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(3);
  });

  test("所有任务 type menu shows all + local only (cloud hidden for now)", () => {
    // Type radio values: all + local; cloud option not listed in the menu.
    expect(source).toContain('value="all"');
    expect(source).toContain('value="local"');
    expect(source).toContain('label={t("settings.archived_tasks_type_all")}');
    expect(source).toContain('label={t("settings.archived_tasks_type_local")}');
    expect(source).not.toContain(
      'label={t("settings.archived_tasks_type_cloud")}',
    );
  });

  test("project and kind filters remain independent state", () => {
    expect(source).toContain("projectFilter");
    expect(source).toContain("kindFilter");
    expect(source).toContain('useState<ArchivedProjectFilter>("all")');
    expect(source).toContain('useState<ArchivedKindFilter>("all")');
    expect(source).not.toContain("scopeFilter");
  });

  test("kind:tasks does not exclude local assistant archives (only scheduled does)", () => {
    expect(source).toContain('if (kindFilter === "scheduled") continue');
    expect(source).toContain('if (kindFilter === "tasks" && automated) continue');
    expect(source).not.toContain('if (kindFilter === "tasks") continue');
  });

  test("RadioGroup does not nest Separator as a radio child", () => {
    // Separator must not sit inside a RadioGroup block (Base UI crash).
    expect(source).not.toMatch(
      /DropdownMenuRadioGroup[\s\S]{0,800}DropdownMenuSeparator[\s\S]{0,200}FilterRadioItem/,
    );
  });

  test("project menu does not list synthetic unknown project as a folder option", () => {
    // Unscoped archives stay under 所有项目; do not invent a fake project row.
    expect(source).toContain('if (!raw) continue');
    expect(source).toContain('if (key === "__unknown__") continue');
  });

  test("project view groups by folder; task view is flat list", () => {
    expect(source).toContain("useProjectGroups");
    expect(source).toContain("groupArchivedRowsByProject");
    expect(source).toContain("formatTaskArchiveMeta");
    expect(source).toContain('kindFilter === "all"');
    expect(source).toContain("function ArchivedTaskRow");
  });

  test("project groups: card header with count + bulk-delete menu", () => {
    expect(source).toContain("ARCHIVE_ROW_INSET");
    expect(source).toContain('data-archived-task-list="true"');
    // WorkBuddy layout: spaced groups; folder header shares inset with rows.
    expect(source).toContain('className="flex flex-col gap-5"');
    expect(source).toContain(
      "overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
    );
    // Header lives inside the card (muted strip + shared ARCHIVE_ROW_INSET).
    expect(source).toContain("border-b border-dls-border/70");
    expect(source).toContain("MoreHorizontal");
    expect(source).toContain(
      't("settings.archived_tasks_delete_project_all")',
    );
    // Bulk-delete menu: single line + red label (WorkBuddy ref).
    expect(source).toContain("whitespace-nowrap");
    expect(source).toContain("text-dls-danger");
    expect(source).toContain("w-auto min-w-max");
    expect(source).toContain("ConfirmModal");
    // Unarchive is text-only (reference has no leading undo icon).
    expect(source).not.toContain("Undo2");
    // Filter chips: rounded-full capsule on archive filters.
    expect(source).toContain(
      "h-9 shrink-0 gap-1.5 rounded-full border-dls-border bg-dls-surface px-3 font-normal text-dls-text",
    );
    expect(source).not.toContain("leadSlot");
    // C1: permanent delete removes session-owned workspace files.
    expect(source).toContain("deleteSessionOwnedWorkspaceFiles");
  });

  test("row primary action is restore; permanent delete is overflow + confirm", () => {
    // Restore is the only co-equal pill control on the row.
    expect(source).toContain('data-archive-row-restore="true"');
    expect(source).toContain('t("settings.archived_tasks_unarchive")');
    // Delete is not a sibling outline Button of restore.
    expect(source).toContain('data-archive-row-menu="true"');
    expect(source).toContain('data-archive-row-delete="true"');
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('t("settings.archived_tasks_delete")');
    // Delete still routes through ConfirmModal (setPendingDeleteRow).
    expect(source).toContain("setPendingDeleteRow");
    expect(source).toContain("ConfirmModal");
    // No second outline Button labeled permanent-delete next to restore.
    const rowFn = source.slice(source.indexOf("function ArchivedTaskRow"));
    const outlineButtons = rowFn.match(/variant="outline"/g) ?? [];
    expect(outlineButtons.length).toBe(1);
    expect(rowFn).toContain("DropdownMenuItem");
    expect(rowFn).toContain("text-dls-danger");
    expect(rowFn).toContain("onClick={props.onDelete}");
    expect(rowFn).toContain("onClick={props.onRestore}");
  });
});
