import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterManagedDesktopConnectors,
  managedDesktopConnectorMcpServerNames,
  type ManagedDesktopConnectorItem,
} from "./managed-desktop-connectors";

function item(
  partial: Partial<ManagedDesktopConnectorItem> &
    Pick<ManagedDesktopConnectorItem, "id" | "name">,
): ManagedDesktopConnectorItem {
  return {
    description: partial.description ?? "",
    iconSrc: partial.iconSrc ?? "/x.png",
    tryPrompts: partial.tryPrompts ?? [],
    mcpServerNames: partial.mcpServerNames ?? [],
    ...partial,
  };
}

describe("managedDesktopConnectorMcpServerNames", () => {
  it("includes product id and declared MCP server names", () => {
    const names = managedDesktopConnectorMcpServerNames([
      item({
        id: "baidu-drive",
        name: "Baidu",
        mcpServerNames: ["baidu-netdisk"],
      }),
      item({ id: "officecli", name: "OfficeCLI", mcpServerNames: [] }),
    ]);
    assert.equal(names.has("baidu-drive"), true);
    assert.equal(names.has("baidu-netdisk"), true);
    assert.equal(names.has("officecli"), true);
  });
});

describe("filterManagedDesktopConnectors", () => {
  const catalog = [
    item({
      id: "lark-cli",
      name: "飞书",
      description: "消息与日历",
    }),
    item({
      id: "officecli",
      name: "OfficeCLI",
      description: "Word Excel PPT",
    }),
  ];

  it("returns all when query empty", () => {
    assert.equal(filterManagedDesktopConnectors(catalog, "").length, 2);
    assert.equal(filterManagedDesktopConnectors(catalog, "  ").length, 2);
  });

  it("matches name description and id", () => {
    assert.equal(filterManagedDesktopConnectors(catalog, "飞书").length, 1);
    assert.equal(filterManagedDesktopConnectors(catalog, "excel").length, 1);
    assert.equal(filterManagedDesktopConnectors(catalog, "lark").length, 1);
    assert.equal(filterManagedDesktopConnectors(catalog, "zzz").length, 0);
  });
});
