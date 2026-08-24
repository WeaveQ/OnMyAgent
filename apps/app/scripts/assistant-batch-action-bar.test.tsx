import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AssistantBatchActionBar } from "../src/react-app/domains/session/sidebar/assistant-sidebar-controls";

function renderBar(selectedCount: number, totalCount = 4, canDelete = true) {
  return renderToStaticMarkup(
    createElement(AssistantBatchActionBar, {
      selectionState: {
        checked: selectedCount === totalCount && totalCount > 0,
        indeterminate: selectedCount > 0 && selectedCount < totalCount,
        selectedCount,
        totalCount,
      },
      busy: false,
      canDelete,
      onToggleAll: () => undefined,
      onCancel: () => undefined,
      onDelete: () => undefined,
      onArchive: () => undefined,
    }),
  );
}

function actionTag(html: string, action: "delete" | "archive"): string {
  return html.match(
    new RegExp(`<button[^>]*data-assistant-batch-${action}="true"[^>]*>`),
  )?.[0] ?? "";
}

describe("AssistantBatchActionBar", () => {
  test("extends the divider to both sidebar edges without moving its content", () => {
    const html = renderBar(2);

    expect(html).toContain(
      'class="-mx-2.5 shrink-0 border-t border-dls-border px-2.5 pt-2"',
    );
  });

  test("uses the compact batch checkbox radius", () => {
    const html = renderBar(2);

    expect(html).toContain("rounded-xs");
  });

  test("renders mixed selection and enables both batch actions", () => {
    const html = renderBar(2);

    expect(html).toContain('data-assistant-batch-selected-count="2"');
    expect(html).toContain("data-indeterminate");
    expect(actionTag(html, "delete")).not.toContain(' disabled=""');
    expect(actionTag(html, "archive")).not.toContain(' disabled=""');
    expect(html).toContain('data-assistant-batch-cancel="true"');
  });

  test("disables destructive actions when nothing is selected", () => {
    const html = renderBar(0);

    expect(actionTag(html, "delete")).toContain(' disabled=""');
    expect(actionTag(html, "archive")).toContain(' disabled=""');
  });

  test("disables delete when the host has no delete capability", () => {
    const html = renderBar(2, 4, false);

    expect(actionTag(html, "delete")).toContain(' disabled=""');
    expect(actionTag(html, "archive")).not.toContain(' disabled=""');
  });
});

describe("assistant batch action wiring", () => {
  const sidebarRoot = join(
    import.meta.dir,
    "../src/react-app/domains/session/sidebar",
  );

  test("wires the same batch entry into normal and space task rows", () => {
    const taskItem = readFileSync(
      join(sidebarRoot, "assistant-task-item.tsx"),
      "utf8",
    );
    const sections = readFileSync(
      join(sidebarRoot, "assistant-conversation-sections.tsx"),
      "utf8",
    );

    expect(taskItem).toContain('t("session.batch_actions")');
    expect(taskItem).toContain("props.onToggleBatchSelected?.(latestSession.id)");
    expect(sections).toContain("<SpaceFolderDragList");
    expect(sections).toContain("onEnterBatchMode={props.onEnterBatchMode}");
  });

  test("clears and locks search while batch selection owns the full list", () => {
    const panel = readFileSync(
      join(sidebarRoot, "agent-conversation-panel.tsx"),
      "utf8",
    );

    expect(panel).toContain('if (props.query) props.onQueryChange("")');
    expect(panel).toContain('queryDisabled={mode === "assistant" && assistantBatch.active}');
  });

  test("guards async completion from writing into a different scope", () => {
    const controls = readFileSync(
      join(sidebarRoot, "assistant-sidebar-controls.tsx"),
      "utf8",
    );

    expect(controls).toContain("scopeGenerationRef.current += 1");
    expect(controls).toContain("isAssistantBatchOperationCurrent(");
    expect(controls).toContain("setBusy(busyRef.current)");
  });
});
