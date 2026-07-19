import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ConnectorsPage, SkillsPage } from "../src/react-app/domains/plugins/plugins-page";
import { StatusToastsProvider } from "../src/react-app/domains/shell-feedback";
import { StorePage } from "../src/react-app/domains/session/components/side-panel-pages";

describe("shared plugins page contract", () => {
  test("exports reusable skills and connectors pages for session side panels", () => {
    expect(typeof SkillsPage).toBe("function");
    expect(typeof ConnectorsPage).toBe("function");
  });

  test("mounts artifact plugins from the shared production Store page", () => {
    const html = renderToString(createElement(
      StatusToastsProvider,
      null,
      createElement(StorePage, { workspaceId: "workspace", activeTab: "plugins" }),
    ));

    expect(html).toContain("Artifact plugins");
    expect(html).toContain("aria-pressed=\"true\"");
    // Section copy + preview affordance (not installable +)
    expect(html).toContain("Create, edit, and analyze documents");
    expect(html).toContain("Connector preview");
    expect(html).toContain("not installable yet");
    expect(html).toContain("Coming soon");
    expect(html).not.toContain('aria-label="Add WordPress"');
  });
});
