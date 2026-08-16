/**
 * OfficeCLI / Lark / cloud-drive connector managers.
 * Extracted from main.mjs so the composition root only wires deps.
 */
import path from "node:path";

import { createOfficeCliManager } from "./managed-tools/officecli-manager.mjs";
import { createLarkCliManager } from "./managed-tools/lark-cli-manager.mjs";
import { createLarkCliAuthService } from "./managed-tools/lark-cli-auth.mjs";
import { createTencentDocsConnectorManager } from "./tencent-docs-connector/manager.mjs";
import { createBaiduDriveConnectorManager } from "./baidu-drive-connector/manager.mjs";
import { createKdocsConnectorManager } from "./kdocs-connector/manager.mjs";
import { createDingtalkConnectorManager } from "./dingtalk-connector/manager.mjs";
import { createWecomConnectorManager } from "./wecom-connector/manager.mjs";
import { createTencentMeetingConnectorManager } from "./tencent-meeting-connector/manager.mjs";

/**
 * @param {{
 *   getRealHomeDir: () => string,
 *   refreshSkillLinks: () => Promise<unknown>,
 *   getMainWindow: () => { isDestroyed?: () => boolean, webContents?: { send: (channel: string, payload: unknown) => void } } | null,
 *   shell: { openExternal: (url: string) => Promise<unknown> },
 *   runtimeManager: {
 *     getActiveOpencodeConfigDir?: () => string | null,
 *     resolveLocalOpencodeConfigDir?: () => string | null,
 *     onmyagentOpencodeConfigDir?: () => string | null,
 *   },
 *   globalOpencodeRoot: () => string,
 * }} deps
 */
export function createDesktopManagedConnectors({
  getRealHomeDir,
  refreshSkillLinks,
  getMainWindow,
  shell,
  runtimeManager,
  globalOpencodeRoot,
}) {
  const send = (channel, payload) => {
    const mainWindow = getMainWindow();
    if (mainWindow?.isDestroyed?.()) return;
    mainWindow?.webContents?.send(channel, payload);
  };

  const officeCliManager = createOfficeCliManager({
    homeDir: getRealHomeDir(),
    refreshSkillLinks,
    onProgress: (progress) => send("onmyagent:officecli:progress", progress),
    onStatus: (status) => send("onmyagent:officecli:status", status),
  });

  const larkCliManager = createLarkCliManager({
    homeDir: getRealHomeDir(),
    refreshSkillLinks,
    onProgress: (progress) => send("onmyagent:lark-cli:progress", progress),
    onStatus: (status) => send("onmyagent:lark-cli:status", status),
  });

  const larkCliAuth = createLarkCliAuthService({
    homeDir: getRealHomeDir(),
    onProgress: (progress) => send("onmyagent:lark-cli:auth-progress", progress),
  });

  const resolveOpencodeConfigDirsForConnectors = () => {
    /** @type {string[]} */
    const dirs = [];
    const push = (value) => {
      const trimmed = String(value ?? "").trim();
      if (trimmed && !dirs.includes(trimmed)) dirs.push(trimmed);
    };
    try {
      push(runtimeManager.getActiveOpencodeConfigDir?.());
    } catch {
      // runtime not ready
    }
    try {
      push(runtimeManager.resolveLocalOpencodeConfigDir?.());
    } catch {
      // ignore
    }
    try {
      push(runtimeManager.onmyagentOpencodeConfigDir?.());
    } catch {
      // ignore
    }
    push(globalOpencodeRoot());
    if (process.env.XDG_CONFIG_HOME?.trim()) {
      push(path.join(process.env.XDG_CONFIG_HOME.trim(), "opencode"));
    }
    return dirs;
  };

  const openExternal = async (url) => {
    await shell.openExternal(url);
  };

  const tencentDocsConnector = createTencentDocsConnectorManager({
    homeDir: getRealHomeDir(),
    globalOpencodeRoot: () => globalOpencodeRoot(),
    resolveOpencodeConfigDirs: resolveOpencodeConfigDirsForConnectors,
    openExternal,
    refreshSkillLinks,
    onProgress: (progress) => send("onmyagent:tencent-docs:auth-progress", progress),
    onStatus: (status) => send("onmyagent:tencent-docs:status", status),
  });

  const baiduDriveConnector = createBaiduDriveConnectorManager({
    homeDir: getRealHomeDir(),
    globalOpencodeRoot: () => globalOpencodeRoot(),
    resolveOpencodeConfigDirs: resolveOpencodeConfigDirsForConnectors,
    openExternal,
    onProgress: (progress) => send("onmyagent:baidu-drive:auth-progress", progress),
    onStatus: (status) => send("onmyagent:baidu-drive:status", status),
  });

  const kdocsConnector = createKdocsConnectorManager({
    homeDir: getRealHomeDir(),
    globalOpencodeRoot: () => globalOpencodeRoot(),
    resolveOpencodeConfigDirs: resolveOpencodeConfigDirsForConnectors,
    onProgress: (progress) => send("onmyagent:kdocs:auth-progress", progress),
    onStatus: (status) => send("onmyagent:kdocs:status", status),
  });

  const dingtalkConnector = createDingtalkConnectorManager({
    homeDir: getRealHomeDir(),
    globalOpencodeRoot: () => globalOpencodeRoot(),
    resolveOpencodeConfigDirs: resolveOpencodeConfigDirsForConnectors,
    onProgress: (progress) => send("onmyagent:dingtalk:auth-progress", progress),
    onStatus: (status) => send("onmyagent:dingtalk:status", status),
  });

  const wecomConnector = createWecomConnectorManager({
    homeDir: getRealHomeDir(),
    openExternal,
    refreshSkillLinks: async () => {
      await refreshSkillLinks();
    },
    onProgress: (progress) => send("onmyagent:wecom:auth-progress", progress),
    onStatus: (status) => send("onmyagent:wecom:status", status),
  });

  const tencentMeetingConnector = createTencentMeetingConnectorManager({
    homeDir: getRealHomeDir(),
    globalOpencodeRoot: () => globalOpencodeRoot(),
    resolveOpencodeConfigDirs: resolveOpencodeConfigDirsForConnectors,
    openExternal,
    onProgress: (progress) => send("onmyagent:tencent-meeting:auth-progress", progress),
    onStatus: (status) => send("onmyagent:tencent-meeting:status", status),
  });

  return {
    officeCliManager,
    larkCliManager,
    larkCliAuth,
    tencentDocsConnector,
    baiduDriveConnector,
    kdocsConnector,
    dingtalkConnector,
    wecomConnector,
    tencentMeetingConnector,
  };
}
