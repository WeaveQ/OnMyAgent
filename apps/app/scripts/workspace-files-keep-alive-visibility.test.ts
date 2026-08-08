import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("workspace Files keep-alive visibility", () => {
  test("the files rail passes KeepAlive visibility into its page", () => {
    const keepAlive = read(
      "src/react-app/domains/session/sidebar/keep-alive-pane.tsx",
    );
    const shell = read(
      "src/react-app/domains/session/pages/session-page-shell.tsx",
    );
    const assistant = read("src/react-app/domains/session/pages/assistant.tsx");
    const expert = read("src/react-app/domains/session/pages/expert.tsx");

    expect(keepAlive).toContain("(active: boolean) => ReactNode");
    expect(keepAlive).toContain("props.children(props.active)");
    expect(shell).toContain("files?: ReactNode | ((active: boolean) => ReactNode)");
    expect(assistant).toContain("files: (active) => (");
    expect(assistant).toContain("active={active}");
    expect(expert).toContain("files: (active) => (");
    expect(expert).toContain("active={active}");
  });

  test("hidden Files panels do not start catalog, migration, or preview work", () => {
    const page = read("src/react-app/domains/workspace/workspace-files-page.tsx");
    const uploads = read(
      "src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );
    const browser = read(
      "src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
    );

    expect(page).toContain("active={props.active}");
    expect(uploads).toContain("if (props.active === false) return;");
    expect(uploads).toContain("const inboxList = await client.listInbox(workspaceId);");
    expect(uploads).toContain("migratedWorkspaceIdRef.current !== workspaceId");
    expect(uploads).toContain("migratedWorkspaceIdRef.current = workspaceId");
    expect(browser).toContain("if (props.active === false) return;");
    expect(browser).toContain("recursive: true");
    expect(browser).toContain("props.active, props.client");
  });
});
