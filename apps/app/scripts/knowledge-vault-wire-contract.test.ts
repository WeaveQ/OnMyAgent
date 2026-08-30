import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("knowledge 0.7 surfaces are wired", () => {
  test("vault page hosts groups and the bookmark form", () => {
    const page = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-vault-page.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-vault-sidebar.tsx"),
      "utf8",
    );
    const menu = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-new-menu.tsx"),
      "utf8",
    );
    expect(sidebar).toContain("KnowledgeVaultGroups");
    expect(sidebar.indexOf("<KnowledgeVaultTree")).toBeLessThan(
      sidebar.indexOf("<KnowledgeVaultGroups"),
    );
    expect(page).toContain("KnowledgeVaultSidebar");
    expect(page).toContain("KnowledgeBookmarkForm");
    expect(page).toContain("setRevealNonce");
    expect(
      readFileSync(
        join(root, "src/react-app/domains/knowledge/knowledge-vault-tree.tsx"),
        "utf8",
      ),
    ).toContain("data-knowledge-note");
    expect(
      readFileSync(
        join(root, "src/react-app/domains/knowledge/knowledge-vault-sidebar.tsx"),
        "utf8",
      ),
    ).toContain("props.error");
    expect(menu).toContain("onNewLink");
    expect(menu).toContain('t("knowledge.add_link")');
  });

  test("session surface hosts save-to-knowledge via the knowledge barrel", () => {
    const view = readFileSync(
      join(
        root,
        "src/react-app/domains/session/surface/session-surface-view.tsx",
      ),
      "utf8",
    );
    const barrel = readFileSync(
      join(root, "src/react-app/domains/knowledge/index.ts"),
      "utf8",
    );
    expect(barrel).toContain("useKnowledgeArchiveSession");
    expect(barrel).toContain("KnowledgeArchiveSessionIconButton");
    expect(view).toContain('from "../../knowledge"');
    expect(view).toContain("useKnowledgeArchiveSession");
    expect(view).toContain("KnowledgeArchiveSessionIconButton");
  });

  test("vault tree uses a follow-cursor drag layer instead of native title tooltips", () => {
    const tree = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-vault-tree.tsx"),
      "utf8",
    );
    expect(tree).toContain("KnowledgeVaultDragLayer");
    expect(tree).toContain("resolveKnowledgeDropFolder");
    expect(tree).toContain("hideKnowledgeDragGhost");
    expect(tree).not.toContain("title={dropping");
    expect(
      readFileSync(
        join(root, "src/react-app/domains/knowledge/knowledge-vault-drag-layer.tsx"),
        "utf8",
      ),
    ).toContain("--dls-z-overlay-max");
  });

  test("vault toolbar reuses one expand icon and hosts the sort menu", () => {
    const toolbar = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-vault-toolbar.tsx"),
      "utf8",
    );
    expect(toolbar).toContain("ListTree");
    expect(toolbar).toContain("DropdownMenuRadioGroup");
    expect(toolbar).toContain("whitespace-nowrap");
    expect(toolbar).toContain("w-max");
    expect(toolbar).toContain("onToggleExpand");
    expect(toolbar).not.toContain("ChevronsDown");
    expect(toolbar).not.toContain("ChevronsUp");
    expect(
      readFileSync(
        join(root, "src/react-app/domains/knowledge/use-knowledge-vault-index.ts"),
        "utf8",
      ),
    ).toContain("knowledge.index_done");
  });

  test("vault groups use list-selected and nest extra folders", () => {
    const groups = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-vault-groups.tsx"),
      "utf8",
    );
    expect(groups).toContain("bg-dls-list-selected");
    expect(groups).not.toContain("bg-dls-rail-pill-hover");
    expect(groups).toContain("nested");
    expect(groups).toContain('size="lg"');
    expect(groups).toContain("FieldLabel");
    expect(groups).toContain("knowledge.add_vault_failed");
    expect(groups).toContain("initialFocus");
    expect(groups).toContain('event.key !== "Enter"');
    expect(groups).toContain("aria-current");
  });

  test("archive dialog does not echo the .md file name under the input", () => {
    const dialog = readFileSync(
      join(root, "src/react-app/domains/knowledge/knowledge-archive-session.tsx"),
      "utf8",
    );
    expect(dialog).toContain("safeArchiveFileName");
    expect(dialog).not.toMatch(/<span[^>]*>\{\s*previewName\s*\}<\/span>/);
    expect(dialog).not.toContain("Inbox");
  });
});
