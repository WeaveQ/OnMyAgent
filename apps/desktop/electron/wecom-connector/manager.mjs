/**
 * WeCom (企业微信) connector via official wecom-cli.
 * Auth: QR (`wecom-cli init --noninteractive`) or Bot ID + Secret (TTY feed).
 * Skill materialize under local skills root; config under managed tools/wecom.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  resolveLocalManagedToolsRoot,
  resolveLocalSkillsRoot,
} from "../config-profile-paths.mjs";
import {
  AUTH_TIMEOUT_MS,
  BOT_ENC_FILE,
  CLI_BIN,
  CLI_PACKAGE,
  CREDENTIALS_FILE,
  PLUGIN_ID,
  SKILL_ID,
  STATE_FILE,
} from "./constants.mjs";

/**
 * @param {string | undefined} homeDir
 */
export function resolveWecomManagedRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), PLUGIN_ID);
}

/**
 * wecom-cli config dir (bot.enc lives here).
 * @param {string | undefined} homeDir
 */
export function resolveWecomCliConfigDir(homeDir) {
  return path.join(resolveWecomManagedRoot(homeDir), "cli-config");
}

export function buildWecomSkillMarkdown() {
  return `---
name: ${SKILL_ID}
description: 企业微信官方 wecom-cli。通讯录、消息、日程、待办、会议、文档/智能表格。用户任务涉及企微时使用。
metadata:
  requires:
    bins: ["${CLI_BIN}"]
  cliHelp: "${CLI_BIN} --help"
---

# 企业微信（wecom-cli）

通过官方 \`${CLI_BIN}\` 操作企业微信。凭证由 OnMyAgent 连接器托管（\`WECOM_CLI_CONFIG_DIR\`）。

## 常用命令

\`\`\`bash
${CLI_BIN} contact get_userlist '{}'
${CLI_BIN} schedule --help
${CLI_BIN} todo --help
${CLI_BIN} msg --help
${CLI_BIN} meeting --help
${CLI_BIN} doc --help
\`\`\`

通用格式：\`${CLI_BIN} <category> <method> [json_args]\`

品类：\`contact\` | \`doc\` | \`meeting\` | \`msg\` | \`schedule\` | \`todo\`

## 规则

- 不可逆操作前向用户确认
- 涉及成员时先 \`contact get_userlist\` 再按姓名本地筛选
- 凭证失效时提示用户在连接器中重新授权
`;
}

/**
 * Extract first work.weixin.qq.com URL from CLI output.
 * @param {string} text
 */
export function extractWecomAuthUrl(text) {
  const cleaned = String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
  const match = cleaned.match(/https:\/\/work\.weixin\.qq\.com\/[^\s]+/);
  return match ? match[0] : "";
}

/**
 * Resolve wecom-cli invocation: prefer PATH binary, else npx -y @wecom/cli.
 * @returns {{ command: string, argsPrefix: string[] }}
 */
export function resolveWecomCliInvocation() {
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    argsPrefix: ["-y", CLI_PACKAGE],
  };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, filePath);
  } catch {
    await writeFile(filePath, payload, { encoding: "utf8", mode: 0o600 });
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   homeDir?: string,
 *   openExternal?: (url: string) => Promise<void> | void,
 *   onProgress?: (progress: import('@onmyagent/types/wecom-connector').WecomAuthProgress) => void,
 *   onStatus?: (status: import('@onmyagent/types/wecom-connector').WecomConnectionStatus) => void,
 *   now?: () => number,
 *   refreshSkillLinks?: () => Promise<void> | void,
 * }} options
 */
export function createWecomConnectorManager(options = {}) {
  const homeDir = options.homeDir;
  const now = options.now ?? (() => Date.now());
  let busy = false;
  /** @type {Map<string, any>} */
  const sessions = new Map();

  function managedRoot() {
    return resolveWecomManagedRoot(homeDir);
  }

  function cliConfigDir() {
    return resolveWecomCliConfigDir(homeDir);
  }

  function skillPath() {
    return path.join(resolveLocalSkillsRoot(homeDir), SKILL_ID);
  }

  function emitProgress(progress) {
    try {
      options.onProgress?.(progress);
    } catch {
      // ignore
    }
  }

  function emitStatus(status) {
    try {
      options.onStatus?.(status);
    } catch {
      // ignore
    }
  }

  async function botAuthorized() {
    return pathExists(path.join(cliConfigDir(), BOT_ENC_FILE));
  }

  async function skillInstalled() {
    return pathExists(path.join(skillPath(), "SKILL.md"));
  }

  async function materializeSkill() {
    const dest = skillPath();
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "SKILL.md"), buildWecomSkillMarkdown(), "utf8");
    await writeJsonAtomic(path.join(dest, ".onmyagent-managed.json"), {
      owner: "onmyagent",
      pluginId: PLUGIN_ID,
      updatedAt: now(),
    });
    if (options.refreshSkillLinks) {
      await Promise.resolve(options.refreshSkillLinks()).catch(() => undefined);
    }
  }

  async function removeSkill() {
    const dest = skillPath();
    try {
      const marker = await readJson(path.join(dest, ".onmyagent-managed.json"));
      if (marker?.pluginId === PLUGIN_ID || marker?.owner === "onmyagent") {
        await rm(dest, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  function spawnWecomCli(args, spawnOpts = {}) {
    const inv = resolveWecomCliInvocation();
    const env = {
      ...process.env,
      WECOM_CLI_CONFIG_DIR: cliConfigDir(),
      ...(spawnOpts.env ?? {}),
    };
    return spawn(inv.command, [...inv.argsPrefix, ...args], {
      ...spawnOpts,
      env,
      windowsHide: true,
    });
  }

  async function getStatus() {
    const authorized = await botAuthorized();
    let skillOk = await skillInstalled();
    if (authorized && !skillOk) {
      try {
        await materializeSkill();
        skillOk = true;
      } catch (error) {
        console.warn("[wecom] heal materializeSkill failed:", error);
      }
    }

    /** @type {import('@onmyagent/types/wecom-connector').WecomConnectionPhase} */
    let phase = "disconnected";
    if (busy) phase = "busy";
    else if (authorized && skillOk) phase = "connected";
    else if (authorized && !skillOk) phase = "error";
    else phase = "disconnected";

    /** @type {import('@onmyagent/types/wecom-connector').WecomConnectionStatus} */
    const status = {
      phase,
      authorized,
      skillInstalled: skillOk,
      cliAvailable: true,
      serverNames: [CLI_BIN],
      message:
        authorized && !skillOk ? "Authorized but skill not installed" : null,
      errorCode: authorized && !skillOk ? "skill_missing" : null,
      errorMessage:
        authorized && !skillOk ? "Authorized but skill not installed" : null,
      lastCheckedAt: now(),
    };
    emitStatus(status);
    return status;
  }

  async function startConnect() {
    const current = await getStatus();
    if (current.phase === "connected" && current.authorized) {
      await materializeSkill();
      return {
        sessionId: "already-connected",
        authorizationUrl: "",
        alreadyConnected: true,
      };
    }
    if (busy) {
      const err = new Error("Another WeCom connect is in progress");
      // @ts-expect-error coded
      err.code = "busy";
      throw err;
    }

    busy = true;
    const sessionId = randomUUID();
    await mkdir(cliConfigDir(), { recursive: true });

    try {
      emitProgress({
        operation: "connect",
        phase: "starting",
        message: "Starting WeCom authorization",
      });

      /** @type {any} */
      const sessionEntry = {
        resolve: () => undefined,
        reject: () => undefined,
        authUrl: "",
      };

      const completion = new Promise((resolve, reject) => {
        sessionEntry.resolve = resolve;
        sessionEntry.reject = reject;

        let settled = false;
        const finish = async (ok, error) => {
          if (settled) return;
          settled = true;
          clearTimeout(sessionEntry.timer);
          clearInterval(sessionEntry.poll);
          sessions.delete(sessionId);
          busy = false;
          if (!ok) {
            reject(error ?? new Error("WeCom authorization failed"));
            return;
          }
          try {
            await materializeSkill();
            await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), {
              pluginId: PLUGIN_ID,
              connectedAt: now(),
              updatedAt: now(),
              mode: "qr",
            });
            emitProgress({ operation: "connect", phase: "complete" });
            resolve(await getStatus());
          } catch (e) {
            reject(e);
          }
        };

        sessionEntry.timer = setTimeout(() => {
          try {
            sessionEntry.child?.kill("SIGTERM");
          } catch {
            // ignore
          }
          const err = new Error("Authorization timed out");
          // @ts-expect-error coded
          err.code = "oauth_timeout";
          void finish(false, err);
        }, AUTH_TIMEOUT_MS);

        let buffer = "";
        const child = spawnWecomCli(["init", "--noninteractive", "--no-open"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        sessionEntry.child = child;

        const onChunk = (chunk) => {
          buffer += chunk.toString();
          if (!sessionEntry.authUrl) {
            const url = extractWecomAuthUrl(buffer);
            if (url) {
              sessionEntry.authUrl = url;
              emitProgress({
                operation: "connect",
                phase: "waiting_user",
                authorizationUrl: url,
                message: "Waiting for WeCom QR scan",
              });
              if (options.openExternal) {
                void Promise.resolve(options.openExternal(url)).catch(
                  () => undefined,
                );
              }
            }
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);

        child.on("error", (error) => {
          void finish(false, error);
        });

        child.on("close", async (code) => {
          const authorized = await botAuthorized();
          if (authorized) {
            void finish(true);
            return;
          }
          const err = new Error(
            code === 0
              ? "Authorization cancelled or incomplete"
              : `wecom-cli init exited with code ${code}`,
          );
          // @ts-expect-error coded
          err.code = "oauth_callback_invalid";
          void finish(false, err);
        });

        sessionEntry.poll = setInterval(() => {
          void botAuthorized().then((ok) => {
            if (ok) {
              try {
                child.kill("SIGTERM");
              } catch {
                // ignore
              }
              void finish(true);
            }
          });
        }, 1500);
      });

      sessionEntry.promise = completion;
      sessions.set(sessionId, sessionEntry);

      await new Promise((r) => setTimeout(r, 2500));

      return {
        sessionId,
        authorizationUrl: sessionEntry.authUrl || "",
      };
    } catch (error) {
      sessions.delete(sessionId);
      busy = false;
      throw error;
    }
  }

  async function completeConnect(sessionId) {
    if (sessionId === "already-connected") {
      return getStatus();
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      const status = await getStatus();
      if (status.authorized) return status;
      const err = new Error("Connect session not found");
      // @ts-expect-error coded
      err.code = "session_missing";
      throw err;
    }
    if (!entry.promise) {
      const err = new Error("Connect session incomplete");
      // @ts-expect-error coded
      err.code = "session_incomplete";
      throw err;
    }
    return entry.promise;
  }

  async function cancelConnect() {
    for (const [id, entry] of sessions) {
      try {
        clearTimeout(entry.timer);
        clearInterval(entry.poll);
        entry.child?.kill("SIGTERM");
        entry.reject(
          Object.assign(new Error("Authorization cancelled"), {
            code: "oauth_cancelled",
          }),
        );
      } catch {
        // ignore
      }
      sessions.delete(id);
    }
    busy = false;
    return { ok: true };
  }

  /**
   * @param {import('@onmyagent/types/wecom-connector').WecomConnectCredentialsInput} input
   */
  async function connectWithCredentials(input) {
    const botId = String(input?.botId ?? "").trim();
    const secret = String(input?.secret ?? "").trim();
    if (!botId || !secret) {
      const err = new Error("Bot ID and Secret are required");
      // @ts-expect-error coded
      err.code = "missing_credentials";
      throw err;
    }

    busy = true;
    try {
      emitProgress({
        operation: "connect",
        phase: "materializing",
        message: "Configuring WeCom credentials",
      });
      await mkdir(cliConfigDir(), { recursive: true });
      await writeJsonAtomic(path.join(managedRoot(), CREDENTIALS_FILE), {
        bot_id: botId,
        secret,
        obtained_at: now(),
      });

      const initOk = await runCredentialInit(botId, secret);
      if (!initOk && !(await botAuthorized())) {
        const err = new Error(
          "Could not complete wecom-cli init automatically. Prefer QR scan, or run wecom-cli init in a terminal.",
        );
        // @ts-expect-error coded
        err.code = "init_failed";
        throw err;
      }

      await materializeSkill();
      await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), {
        pluginId: PLUGIN_ID,
        connectedAt: now(),
        updatedAt: now(),
        mode: "credentials",
      });
      emitProgress({ operation: "connect", phase: "complete" });
      return getStatus();
    } finally {
      busy = false;
    }
  }

  /**
   * @param {string} botId
   * @param {string} secret
   * @returns {Promise<boolean>}
   */
  async function runCredentialInit(botId, secret) {
    return new Promise((resolve) => {
      const inv = resolveWecomCliInvocation();
      const env = {
        ...process.env,
        WECOM_CLI_CONFIG_DIR: cliConfigDir(),
      };
      const useScript = process.platform !== "win32";
      const command = useScript ? "script" : inv.command;
      const args = useScript
        ? ["-q", "/dev/null", inv.command, ...inv.argsPrefix, "init"]
        : [...inv.argsPrefix, "init"];

      const child = spawn(command, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let buffer = "";
      let sentMenu = false;
      let sentBot = false;
      let sentSecret = false;

      const feed = (text) => {
        try {
          child.stdin?.write(text);
        } catch {
          // ignore
        }
      };

      const onData = (chunk) => {
        buffer += chunk.toString();
        if (
          !sentMenu &&
          /1[\s.).].*扫码|扫码/.test(buffer) &&
          /2[\s.).]/.test(buffer)
        ) {
          feed("2\n");
          sentMenu = true;
        }
        if (!sentBot && /bot\s*id|Bot ID|机器人.?ID/i.test(buffer)) {
          feed(`${botId}\n`);
          sentBot = true;
        }
        if (
          sentBot &&
          !sentSecret &&
          /secret|Secret|密钥/i.test(buffer.slice(-240))
        ) {
          feed(`${secret}\n`);
          sentSecret = true;
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        void botAuthorized().then(resolve);
      }, 45_000);

      child.on("close", () => {
        clearTimeout(timer);
        void botAuthorized().then(resolve);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  async function disconnect() {
    emitProgress({ operation: "disconnect", phase: "starting" });
    try {
      await cancelConnect().catch(() => undefined);
      await rm(cliConfigDir(), { recursive: true, force: true });
      await rm(path.join(managedRoot(), CREDENTIALS_FILE), {
        force: true,
      }).catch(() => undefined);
      await removeSkill();
      await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), {
        pluginId: PLUGIN_ID,
        disconnectedAt: now(),
        updatedAt: now(),
      });
      emitProgress({ operation: "disconnect", phase: "complete" });
      return getStatus();
    } catch (error) {
      emitProgress({
        operation: "disconnect",
        phase: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return {
    getStatus,
    startConnect,
    completeConnect,
    cancelConnect,
    connectWithCredentials,
    disconnect,
  };
}
