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
    expect(page).toContain("KnowledgeVaultSidebar");
    expect(page).toContain("KnowledgeBookmarkForm");
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
    expect(barrel).toContain("KnowledgeArchiveSessionButton");
    expect(view).toContain('from "../../knowledge"');
    expect(view).toContain("KnowledgeArchiveSessionButton");
  });
});
