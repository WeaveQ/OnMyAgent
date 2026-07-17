import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("assistant code icons", () => {
  test("the two confirmed entry points use their dedicated SVG artwork", () => {
    const sidebarControls = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
    );
    const avatars = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/chrome/avatars.tsx",
    );

    expect(sidebarControls).toContain("function AssistantCodeTabIcon");
    expect(sidebarControls).toContain(
      'd="M6.67 13.33 9.33 2.67M12 5.33l1.32 1.18c.9.79.9 2.19 0 2.98L12 10.67M4 10.67 2.68 9.49c-.9-.79-.9-2.19 0-2.98L4 5.33"',
    );
    expect(sidebarControls).toContain('id: "code"');
    expect(sidebarControls).toContain("icon: AssistantCodeTabIcon");
    expect(sidebarControls).toContain('stroke="currentColor"');
    expect(sidebarControls).toContain('aria-hidden="true"');

    expect(avatars).toContain("function AssistantCodeDraftHomeIcon");
    expect(avatars).toContain(
      'd="M19.649 5.39976C19.8701 4.51583 20.766 3.97857 21.65 4.19957C22.5339 4.42066 23.0712 5.31654 22.8502 6.20054L16.3502 32.2005C16.1291 33.0845 15.2332 33.6217 14.3492 33.4007C13.4653 33.1796 12.928 32.2837 13.149 31.3998L19.649 5.39976ZM7.15389 11.0668C7.83499 10.4617 8.87769 10.5235 9.48299 11.2044C10.0881 11.8855 10.0271 12.9282 9.34627 13.5336L6.13241 16.39C4.68932 17.6729 4.68937 19.9274 6.13241 21.2103L9.34627 24.0668C10.0271 24.6721 10.088 25.7148 9.48299 26.3959C8.87768 27.0769 7.835 27.1387 7.15389 26.5336L3.94002 23.6771C1.02 21.0815 1.01999 16.5188 3.94002 13.9232L7.15389 11.0668ZM26.5162 11.2044C27.1216 10.5234 28.1652 10.4613 28.8463 11.0668L32.0592 13.9232C34.8878 16.4376 34.9765 20.7982 32.3248 23.4281L32.0592 23.6771L28.8463 26.5336C28.1652 27.139 27.1216 27.077 26.5162 26.3959C25.9111 25.7147 25.9729 24.672 26.6539 24.0668L29.8668 21.2103C31.3098 19.9274 31.3099 17.6729 29.8668 16.39L26.6539 13.5336C25.9729 12.9282 25.9111 11.8855 26.5162 11.2044Z"',
    );
    expect(avatars).toContain("? AssistantCodeDraftHomeIcon");
    expect(avatars).toContain('fill="currentColor"');
    expect(avatars).toContain('aria-hidden="true"');
  });
});
