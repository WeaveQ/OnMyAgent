import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("knowledge vault switcher", () => {
  test("exposes one folder picker and does not label it as manage/new vault", () => {
    const source = readFileSync(
      join(root, "src/react-app/domains/session/knowledge/knowledge-vault-switcher.tsx"),
      "utf8",
    );

    expect(source).toContain('t("knowledge.add_space")');
    expect(source).toContain('t("knowledge.reveal")');
    expect(source).toContain('t("knowledge.reset_folder")');
    expect(source).toContain("w-56 min-w-56");
    expect(source).toContain("FolderPlus");
    expect(source).toContain("pickAndActivate");
    expect(source.split("pickAndActivate()").length - 1).toBe(1);
    expect(source).not.toContain("knowledge.manage_vaults");
    expect(source).not.toContain("knowledge.new_vault");
  });
});
