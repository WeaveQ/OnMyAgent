import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDesktopConnectorError,
  formatDesktopConnectorErrorShort,
  isDesktopIpcUnavailableError,
} from "./connector-desktop-error";

describe("connector-desktop-error", () => {
  it("detects IPC unavailable shapes", () => {
    assert.equal(
      isDesktopIpcUnavailableError(
        "Error invoking remote method 'onmyagent:desktop': Error: Electron desktop bridge method is not implemented yet: baiduDriveGetStatus",
      ),
      true,
    );
    assert.equal(isDesktopIpcUnavailableError("missing_token"), false);
  });

  it("maps IPC failures to full restart copy", () => {
    const msg = formatDesktopConnectorError(
      "Error invoking remote method 'onmyagent:desktop': Error: not implemented yet: x",
      "请检查 access_token",
    );
    assert.match(msg, /完全退出|Fully quit|主程序|main process/i);
    assert.equal(msg.includes("access_token"), false);
  });

  it("maps IPC failures to short card copy", () => {
    const short = formatDesktopConnectorErrorShort(
      "Error invoking remote method 'onmyagent:desktop': Error: not implemented yet: x",
      "请检查 access_token",
    );
    assert.match(short, /重启|Restart/i);
    assert.ok(short.length < 20);
  });

  it("collapses long product errors on the card", () => {
    const short = formatDesktopConnectorErrorShort(
      "这是一段很长的产品侧错误说明文字用来挤爆卡片布局",
      "fallback",
    );
    assert.match(short, /连接异常|Connection issue|連線異常/);
  });

  it("keeps product fallback for empty raw", () => {
    assert.equal(formatDesktopConnectorError("", "product"), "product");
    assert.equal(formatDesktopConnectorErrorShort("", "product"), "product");
  });
});
