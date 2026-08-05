import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ConnectorsPage, SkillsPage } from "../src/react-app/domains/plugins/plugins-page";
import { LocalProvider } from "../src/react-app/kernel/local-provider";
import { StatusToastsProvider } from "../src/react-app/domains/shell-feedback";
import { ReloadCoordinatorProvider } from "../src/react-app/shell/reload-coordinator";
import { StorePage } from "../src/react-app/domains/session/components/side-panel-pages";

describe("shared plugins page contract", () => {
  test("exports reusable skills and connectors pages for session side panels", () => {
    expect(typeof SkillsPage).toBe("function");
    expect(typeof ConnectorsPage).toBe("function");
  });

  test("mounts artifact plugins from the shared production Store page", () => {
    const html = renderToString(createElement(
      LocalProvider,
      null,
      createElement(
        StatusToastsProvider,
        null,
        createElement(
          ReloadCoordinatorProvider,
          null,
          createElement(StorePage, { workspaceId: "workspace", activeTab: "plugins" }),
        ),
      ),
    ));

    expect(html).toContain("Built-in");
    expect(html).toContain("Recommended");
    expect(html).toContain("OfficeCLI");
    expect(html).not.toContain("Optional enhancements");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).not.toContain('aria-label="Add WordPress"');
  });
});
