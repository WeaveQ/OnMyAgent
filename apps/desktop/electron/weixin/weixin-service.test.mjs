import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createIlinkClient, ilinkHeaders, __test__ as ilinkTest } from "./ilink-client.mjs";
import { createQrSvgDataUrl, getChannelRunSnapshotState, __test__ as localQrTest } from "./local-qr.mjs";
import { aes128EcbDecrypt, assertWeixinMediaUrl, cdnDownloadUrl, downloadAndDecryptMedia, parseAesKey } from "./media.mjs";
import { createWeixinService, __test__ as serviceTest } from "./service.mjs";
import { createWeixinStore } from "./store.mjs";
import { ChannelPairingService } from "../channels/ChannelPairingService.mjs";
import { ChannelSessionStore } from "../channels/ChannelSessionStore.mjs";

async function tempRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "onmyagent-weixin-"));
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

describe("weixin iLink client", () => {
  it("adds Hermes-compatible base_info and headers", () => {
    const body = ilinkTest.jsonBody({ get_updates_buf: "abc" });
    assert.deepEqual(JSON.parse(body), { get_updates_buf: "abc", base_info: { channel_version: "2.2.0" } });
    const headers = ilinkHeaders("token-1", body);
    assert.equal(headers.Authorization, "Bearer token-1");
    assert.equal(headers.AuthorizationType, "ilink_bot_token");
    assert.equal(headers["iLink-App-Id"], "bot");
    assert.equal(headers["Content-Length"], String(Buffer.byteLength(body, "utf8")));
  });

  it("posts sendmessage payloads with context_token", async () => {
    const calls = [];
    const client = createIlinkClient({
      fetchFn: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ ret: 0, ok: true }), { status: 200 });
      },
    });

    const result = await client.sendMessage({
      baseUrl: "https://weixin.example.com/",
      token: "tok",
      to: "user-1",
      text: "hello",
      contextToken: "ctx-1",
      clientId: "client-1",
    });

    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "https://weixin.example.com/ilink/bot/sendmessage");
    assert.equal(calls[0].body.msg.to_user_id, "user-1");
    assert.equal(calls[0].body.msg.context_token, "ctx-1");
    assert.equal(calls[0].body.msg.item_list[0].text_item.text, "hello");
  });
});

describe("weixin store", () => {
  it("persists accounts and returns sanitized account metadata", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      const saved = await store.saveAccount({ accountId: "acct@im.bot", token: "token-secret", baseUrl: "https://base/", userId: "user-1" });
      assert.equal(saved.accountId, "acct@im.bot");
      assert.equal(saved.hasToken, true);
      assert.equal(saved.tokenPreview, "token-...cret");
      assert.equal(saved.token, undefined);
      const loaded = await store.loadAccount("acct@im.bot");
      assert.equal(loaded.token, "token-secret");
      await store.writeContextToken("acct@im.bot", "user-1", "ctx-1");
      assert.equal(await store.readContextToken("acct@im.bot", "user-1"), "ctx-1");
      await store.writeChatSetting("acct@im.bot", "user-1", { promptMode: "debug" });
      await store.appendChatHistory("acct@im.bot", "user-1", [{ role: "user", text: "hello" }]);
      await store.writeActiveRun("acct@im.bot", "user-1::agent:opencode/opencode", { runId: "run-1", chatId: "user-1" });
      assert.equal((await store.listActiveRuns("acct@im.bot")).length, 1);
      assert.deepEqual((await store.listAccounts()).map((account) => account.accountId), ["acct@im.bot"]);
      assert.equal((await store.loadDefaultAccount()).accountId, "acct@im.bot");
      assert.equal(await store.deleteActiveRun("acct@im.bot", "user-1::agent:opencode/opencode"), true);
    } finally {
      await cleanup(root);
    }
  });
});

describe("weixin service", () => {
  it("extracts text and gates access policies", () => {
    assert.equal(serviceTest.extractText([{ type: 1, text_item: { text: "hello" } }]), "hello");
    assert.equal(serviceTest.extractText([{ type: 3, voice_item: { text: "voice text" } }]), "voice text");
    assert.deepEqual(serviceTest.guessChatType({ from_user_id: "u1", to_user_id: "acct" }, "acct"), { chatType: "dm", chatId: "u1" });
      assert.equal(serviceTest.isAllowed({ dmPolicy: "allowlist", allowedUsers: ["u1"] }, { chatType: "dm", chatId: "u1" }, "u1"), true);
      assert.equal(serviceTest.isAllowed({ dmPolicy: "allowlist", allowedUsers: [] }, { chatType: "dm", chatId: "u1" }, "u1"), false);
      assert.equal(serviceTest.normalizeRuntimeOptions({ dmPolicy: "allowlist", allowedUsers: [] }).dmPolicy, "open");
      assert.equal(serviceTest.isAllowed({ groupPolicy: "disabled", allowedGroups: [] }, { chatType: "group", chatId: "g1" }, "u1"), false);
    });

  it("returns a renderer-safe QR image and follows QR redirect hosts", async () => {
    const root = await tempRoot();
    try {
      const calls = [];
      const client = {
        getBotQr: async () => ({
          qrcode: "qr-token",
          qrcode_img_content: "https://liteapp.weixin.qq.com/q/test?qrcode=qr-token&bot_type=3",
        }),
        getQrStatus: async (payload) => {
          calls.push(payload);
          return { status: "scaned_but_redirect", redirect_host: "redirect.weixin.example.com" };
        },
      };
      const service = createWeixinService({
        userDataDir: root,
        client,
      });

      const login = await service.loginStart();
      assert.equal(login.qrcode, "qr-token");
      assert.equal(login.qrcodeUrl.includes("liteapp.weixin.qq.com"), true);
      assert.equal(login.qrcodeImageDataUrl.startsWith("data:image/svg+xml;base64,"), true);

      const poll = await service.loginPoll({ qrcode: "qr-token", baseUrl: "https://ilinkai.weixin.qq.com" });
      assert.equal(calls[0].baseUrl, "https://ilinkai.weixin.qq.com");
      assert.equal(poll.status, "scaned_but_redirect");
      assert.equal(poll.baseUrl, "https://redirect.weixin.example.com");
      assert.equal(poll.pollBaseUrl, "https://ilinkai.weixin.qq.com");
      assert.equal(poll.redirectHost, "redirect.weixin.example.com");
    } finally {
      await cleanup(root);
    }
  });

  it("auto-starts after QR confirmation and restores the saved service config", async () => {
    const root = await tempRoot();
    try {
      let updateCalls = 0;
      const client = {
        getQrStatus: async () => ({
          status: "confirmed",
          ilink_bot_id: "acct@im.bot",
          bot_token: "tok",
          baseurl: "https://weixin.example.com",
          ilink_user_id: "owner",
        }),
        getUpdates: async () => {
          updateCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { ret: 0, get_updates_buf: "", msgs: [] };
        },
      };
      const service = createWeixinService({ userDataDir: root, client, personalAgentRuntime: {} });
      const poll = await service.loginPoll({
        qrcode: "qr-token",
        workspaceRoot: root,
        accessibleWorkspaceRoots: [path.join(root, "docs"), root, path.join(root, "docs")],
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        availableAgents: [
          { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
          { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        ],
        approvalMode: "read-only-auto",
        dmPolicy: "open",
      });
      assert.equal(poll.status, "confirmed");
      assert.equal(poll.autoStart.ok, true);
      assert.equal(service.status().status, "running");
      assert.equal(service.status().accountId, "acct@im.bot");
      assert.equal(service.status().activeAgentId, "codex");
      assert.equal(service.status().workspaceRoot, root);
      assert.deepEqual(service.status().accessibleWorkspaceRoots, [path.join(root, "docs")]);
      const accountStatus = await service.accountStatus();
      assert.equal(accountStatus.config.workspaceRoot, root);
      assert.deepEqual(accountStatus.config.accessibleWorkspaceRoots, [path.join(root, "docs")]);
      assert.equal(accountStatus.config.approvalMode, "read-only-auto");
      assert.equal(accountStatus.status.workspaceRoot, root);
      assert.deepEqual(accountStatus.status.accessibleWorkspaceRoots, [path.join(root, "docs")]);
      assert.equal(accountStatus.status.approvalMode, "read-only-auto");
      await waitFor(() => updateCalls >= 1, () => JSON.stringify(service.status()));

      await service.stop({ persist: false });
      const restored = createWeixinService({ userDataDir: root, client, personalAgentRuntime: {} });
      const started = await restored.autoStart();
      assert.equal(started.ok, true);
      assert.equal(restored.status().status, "running");
      assert.equal(restored.status().accountId, "acct@im.bot");
      assert.equal(restored.status().activeAgentId, "codex");
      assert.equal(restored.status().workspaceRoot, root);
      assert.deepEqual(restored.status().accessibleWorkspaceRoots, [path.join(root, "docs")]);
      assert.equal(restored.status().approvalMode, "read-only-auto");
      await restored.stop({ persist: false });
    } finally {
      await cleanup(root);
    }
  });

  it("runs an inbound text through the local agent runtime and replies via iLink", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      await store.writeContextToken("acct", "user-1", "ctx-1");
      const sent = [];
      const client = {
        sendMessage: async (payload) => {
          sent.push(payload);
          return { ret: 0 };
        },
        getConfig: async () => ({ typing_ticket: "" }),
      };
      const prompts = [];
      const runtimeInputs = [];
      const runtime = {
        startMessage: async (input) => {
          prompts.push(input.prompt);
          runtimeInputs.push(input);
          return { runId: "run-1", status: "running" };
        },
        getRun: () => ({ runId: "run-1", status: "completed", output: "agent reply" }),
      };
      const service = createWeixinService({ store, client, personalAgentRuntime: runtime });
      const saved = await service.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com" });
      assert.equal(saved.ok, true);
      const simulated = await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "ping",
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        workspaceRoot: root,
        accessibleWorkspaceRoots: [path.join(root, "reference")],
        agent: { provider: "opencode" },
      });
      assert.equal(simulated.ok, true);
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(prompts.length, 1, JSON.stringify(service.status()));
      assert.deepEqual(runtimeInputs[0].accessibleWorkspaceRoots, [path.join(root, "reference")]);
      assert.equal(prompts[0], "ping");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, "user-1");
      assert.equal(sent[0].text, "agent reply");
      assert.equal(sent[0].contextToken, "ctx-1");
    } finally {
      await cleanup(root);
    }
  });

  it("updates approval mode while the Weixin channel is running", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const runtimeInputs = [];
      let updateCalls = 0;
      const service = createWeixinService({
        store,
        client: {
          getUpdates: async () => {
            updateCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { ret: 0, get_updates_buf: "", msgs: [] };
          },
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: `run-${runtimeInputs.length}`, status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: `reply-${runtimeInputs.length}` }),
        },
      });

      const started = await service.start({
        accountId: "acct",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        approvalMode: "ask",
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      });
      assert.equal(started.ok, true);
      assert.equal(service.status().approvalMode, "ask");
      await waitFor(() => updateCalls >= 1, () => JSON.stringify(service.status()));

      const updated = await service.start({
        accountId: "acct",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        approvalMode: "auto",
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.updated, true);
      assert.equal(service.status().status, "running");
      assert.equal(service.status().approvalMode, "auto");
      const accountStatus = await service.accountStatus();
      assert.equal(accountStatus.config.approvalMode, "auto");

      await service.simulateInbound({ accountId: "acct", fromUserId: "user-1", text: "use new mode", messageId: "approval-mode-live" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs.length, 1);
      assert.equal(runtimeInputs[0].approvalMode, "auto");
      await service.stop({ persist: false });
    } finally {
      await cleanup(root);
    }
  });

  it("supports raw/debug prompt modes and persists per-chat mode switches", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const runtimeInputs = [];
      const makeService = () => createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: `run-${runtimeInputs.length}`, status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: `reply-${runtimeInputs.length}` }),
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      };

      const first = makeService();
      await first.simulateInbound({ ...common, text: "hello raw", messageId: "raw-1" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(first.status()));
      assert.equal(runtimeInputs[0].prompt, "hello raw");

      await first.simulateInbound({ ...common, text: "#mode debug", messageId: "mode-debug" });
      await waitFor(() => sent.length === 2, () => JSON.stringify(first.status()));
      assert.match(sent[1].text, /已切换当前微信会话的转发模式：debug/);
      assert.equal(runtimeInputs.length, 1);

      const restored = makeService();
      await restored.simulateInbound({ ...common, text: "hello debug", messageId: "debug-1" });
      await waitFor(() => sent.length === 3, () => JSON.stringify(restored.status()));
      assert.equal(runtimeInputs.length, 2);
      assert.match(runtimeInputs[1].prompt, /来源: Weixin\/iLink/);
      assert.match(runtimeInputs[1].prompt, /prompt_mode: debug/);
      assert.match(runtimeInputs[1].prompt, /最近对话:/);
      assert.match(runtimeInputs[1].prompt, /- user: hello raw/);
      assert.match(runtimeInputs[1].prompt, /- assistant\/opencode: reply-1/);
      assert.match(runtimeInputs[1].prompt, /用户消息:\nhello debug/);

      await restored.simulateInbound({ ...common, text: "#mode raw", messageId: "mode-raw" });
      await waitFor(() => sent.length === 4, () => JSON.stringify(restored.status()));
      await restored.simulateInbound({ ...common, text: "back raw", messageId: "raw-2" });
      await waitFor(() => sent.length === 5, () => JSON.stringify(restored.status()));
      assert.equal(runtimeInputs.at(-1).prompt, "back raw");
    } finally {
      await cleanup(root);
    }
  });

  it("keeps Weixin chat history isolated per reply agent", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const runtimeInputs = [];
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: `run-${runtimeInputs.length}`, status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: `reply-${runtimeInputs.length}` }),
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        promptMode: "debug",
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
        availableAgents: [
          { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
          { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        ],
      };

      await service.simulateInbound({ ...common, text: "opencode first", messageId: "agent-history-opencode-1" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(runtimeInputs[0].prompt, /用户消息:\nopencode first/);
      assert.doesNotMatch(runtimeInputs[0].prompt, /最近对话:/);
      assert.match(runtimeInputs[0].agent.id, /^opencode-weixin-/);

      await service.simulateInbound({ ...common, text: "#agent codex", messageId: "agent-history-switch-codex" });
      await waitFor(() => sent.length === 2, () => JSON.stringify(service.status()));
      await service.simulateInbound({ ...common, text: "codex first", messageId: "agent-history-codex-1" });
      await waitFor(() => sent.length === 3, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs[1].agent.provider, "codex");
      assert.match(runtimeInputs[1].agent.id, /^codex-weixin-/);
      assert.match(runtimeInputs[1].prompt, /用户消息:\ncodex first/);
      assert.doesNotMatch(runtimeInputs[1].prompt, /opencode first/);
      assert.doesNotMatch(runtimeInputs[1].prompt, /reply-1/);

      await service.simulateInbound({ ...common, text: "#agent opencode", messageId: "agent-history-switch-opencode" });
      await waitFor(() => sent.length === 4, () => JSON.stringify(service.status()));
      await service.simulateInbound({ ...common, text: "opencode second", messageId: "agent-history-opencode-2" });
      await waitFor(() => sent.length === 5, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs[2].agent.provider, "opencode");
      assert.match(runtimeInputs[2].prompt, /最近对话:/);
      assert.match(runtimeInputs[2].prompt, /opencode first/);
      assert.match(runtimeInputs[2].prompt, /reply-1/);
      assert.doesNotMatch(runtimeInputs[2].prompt, /codex first/);
      assert.doesNotMatch(runtimeInputs[2].prompt, /reply-2/);
    } finally {
      await cleanup(root);
    }
  });

  it("tracks active runs in the background and persists completion to chat history", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      let completed = false;
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => ({ runId: "run-bg", status: "running" }),
          getRun: async ({ runId }) => completed
            ? { runId, status: "completed", output: "background reply" }
            : { runId, status: "running" },
        },
      });

      await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "long task",
        messageId: "bg-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      });
      await waitFor(() => store.listActiveRuns("acct").then((runs) => runs.length === 1), () => JSON.stringify(service.status()));
      assert.equal(sent.length, 0);

      completed = true;
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(sent[0].text, "background reply");
      await waitFor(() => store.listActiveRuns("acct").then((runs) => runs.length === 0), () => JSON.stringify(service.status()));
      assert.equal((await store.listActiveRuns("acct")).length, 0);
      const history = await store.readChatHistory("acct", "user-1::agent:opencode/opencode", 4);
      assert.deepEqual(history.map((entry) => entry.text), ["long task", "background reply"]);
    } finally {
      await cleanup(root);
    }
  });

  it("keeps pending approval runs tracked and sends the final result after approval", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      let approved = false;
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => ({ runId: "run-approval-bg", status: "running" }),
          getRun: async ({ runId }) => approved
            ? { runId, status: "completed", output: "approved reply" }
            : { runId, status: "running", pendingApprovals: [{ id: "approval-1" }] },
        },
      });

      await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "needs approval",
        messageId: "approval-bg-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      });

      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /本地 Agent 请求权限审批/);
      assert.match(sent[0].text, /#approve/);
      assert.match(sent[0].text, /#deny/);
      assert.equal((await store.listActiveRuns("acct"))[0].status, "pending_approval");
      approved = true;
      await waitFor(() => sent.length === 2, () => JSON.stringify(service.status()));
      assert.equal(sent[1].text, "approved reply");
      await waitFor(() => store.listActiveRuns("acct").then((runs) => runs.length === 0), () => JSON.stringify(service.status()));
      assert.equal((await store.listActiveRuns("acct")).length, 0);
    } finally {
      await cleanup(root);
    }
  });

  it("clears failed active runs even when runtime returns stale pending approvals", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => ({ runId: "run-failed-stale-approval", status: "running" }),
          getRun: async ({ runId }) => ({
            runId,
            status: "failed",
            error: "Codex app-server turn timed out",
            pendingApprovals: [{ id: "approval-stale", command: "pnpm task build app" }],
          }),
        },
      });

      await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "will timeout",
        messageId: "failed-stale-approval-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
      });

      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /本次处理失败/);
      assert.match(sent[0].text, /Codex app-server turn timed out/);
      assert.doesNotMatch(sent[0].text, /#approve/);
      await waitFor(() => store.listActiveRuns("acct").then((runs) => runs.length === 0), () => JSON.stringify(service.status()));
      assert.equal((await store.listActiveRuns("acct")).length, 0);
    } finally {
      await cleanup(root);
    }
  });

  it("resolves pending approvals from Weixin approve commands", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const resolved = [];
      let approved = false;
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => ({ runId: "run-weixin-approval", status: "running" }),
          getRun: ({ runId }) => approved
            ? { runId, status: "completed", output: "approved from weixin" }
            : { runId, status: "running", pendingApprovals: [{ id: "approval-weixin-1", title: "需要权限", summary: "测试审批" }] },
          resolveApproval: async (input) => {
            resolved.push(input);
            approved = true;
            return { ok: true };
          },
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      };

      await service.simulateInbound({ ...common, text: "needs approval", messageId: "weixin-approval-start" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /#approve/);

      await service.simulateInbound({ ...common, text: "#approve", messageId: "weixin-approval-approve" });
      await waitFor(() => resolved.length === 1, () => JSON.stringify(service.status()));
      assert.deepEqual(resolved[0], {
        runId: "run-weixin-approval",
        approvalId: "approval-weixin-1",
        decision: "accept",
      });
      await waitFor(() => sent.some((item) => item.text === "approved from weixin"), () => JSON.stringify({ sent, status: service.status() }));
      assert.equal((await store.listActiveRuns("acct")).length, 0);
    } finally {
      await cleanup(root);
    }
  });

  it("supports Weixin run status and cancel commands", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const cancelled = [];
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => ({ runId: "run-cancel", status: "running" }),
          getRun: ({ runId }) => ({ runId, status: "running" }),
          cancelRun: async (runId, options) => {
            cancelled.push({ runId, options });
            return { ok: true };
          },
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
      };

      await service.simulateInbound({ ...common, text: "start long", messageId: "cancel-start" });
      await waitFor(() => store.listActiveRuns("acct").then((runs) => runs.length === 1), () => JSON.stringify(service.status()));
      await service.simulateInbound({ ...common, text: "#status", messageId: "cancel-status" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /当前任务：running/);
      assert.match(sent[0].text, /run-cancel/);
      await service.simulateInbound({ ...common, text: "#cancel", messageId: "cancel-command" });
      await waitFor(() => sent.length === 2, () => JSON.stringify(service.status()));
      assert.equal(cancelled[0].runId, "run-cancel");
      assert.equal((await store.listActiveRuns("acct")).length, 0);
      assert.match(sent[1].text, /已取消/);
    } finally {
      await cleanup(root);
    }
  });

  it("resumes persisted active runs after service restart and sends completed output", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      await store.writeConfig({
        autoStart: true,
        defaultAccountId: "acct",
        lastStartOptions: {
          workspaceRoot: root,
          dmPolicy: "open",
          textBatchDelayMs: 0,
          agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
        },
      });
      await store.writeActiveRun("acct", "user-1::agent:opencode/opencode", {
        status: "running",
        chatId: "user-1",
        senderId: "user-1",
        runId: "run-restored",
        workspaceRoot: root,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
        historyKey: "user-1::agent:opencode/opencode",
        userText: "before restart",
        historyStoreLimit: 24,
        startedAt: Date.now(),
      });
      const sent = [];
      const client = {
        getUpdates: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { ret: 0, get_updates_buf: "", msgs: [] };
        },
        sendMessage: async (payload) => {
          sent.push(payload);
          return { ret: 0 };
        },
        getConfig: async () => ({ typing_ticket: "" }),
      };
      const service = createWeixinService({
        store,
        client,
        personalAgentRuntime: {
          getRun: ({ runId }) => ({ runId, status: "completed", output: "restored reply" }),
        },
      });

      const started = await service.autoStart();
      assert.equal(started.ok, true);
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(sent[0].text, "restored reply");
      assert.equal((await store.listActiveRuns("acct")).length, 0);
      await service.stop({ persist: false });
    } finally {
      await cleanup(root);
    }
  });

  it("switches the reply agent from Weixin chat commands", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const runtimeInputs = [];
      const makeService = () => createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: `run-${runtimeInputs.length}`, status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: `reply from ${runtimeInputs.at(-1)?.agent?.provider}` }),
        },
      });
      const service = makeService();

      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
        availableAgents: [
          { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
          { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        ],
      };

      await service.simulateInbound({ ...common, text: "#agent", messageId: "cmd-help" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs.length, 0);
      assert.match(sent[0].text, /当前回复 Agent/);
      assert.match(sent[0].text, /codex/);

      await service.simulateInbound({ ...common, text: "#agent codex", messageId: "cmd-switch" });
      await waitFor(() => sent.length === 2, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs.length, 0);
      assert.match(sent[1].text, /已切换/);
      assert.equal(service.status().activeAgentId, "codex");

      const restored = makeService();
      await restored.simulateInbound({ ...common, text: "ping", messageId: "after-switch" });
      await waitFor(() => sent.length === 3, () => JSON.stringify(restored.status()));
      assert.equal(runtimeInputs.length, 1);
      assert.equal(runtimeInputs[0].agent.provider, "codex");
      assert.equal(sent[2].text, "reply from codex");
    } finally {
      await cleanup(root);
    }
  });

  it("keeps batched text bound to the agent selected when it was received", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const runtimeInputs = [];
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: `run-${runtimeInputs.length}`, status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: `reply from ${runtimeInputs.at(-1)?.agent?.provider}` }),
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 30,
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        availableAgents: [
          { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
          { id: "claude", name: "Claude Code", provider: "claude", executablePath: "claude" },
        ],
      };

      await service.simulateInbound({ ...common, text: "codex queued message", messageId: "queued-codex" });
      await service.simulateInbound({ ...common, text: "#agent claude", messageId: "switch-before-batch-dispatch" });

      await waitFor(() => runtimeInputs.length === 1 && sent.length === 2, () => JSON.stringify({ sent, runtimeInputs, status: service.status() }));
      assert.equal(runtimeInputs[0].agent.provider, "codex");
      assert.match(runtimeInputs[0].agent.id, /^codex-weixin-/);
      assert.match(sent[0].text, /已切换.*Agent：Claude Code \(claude\)/);
      assert.equal(sent[1].text, "reply from codex");
      const codexHistory = await store.readChatHistory("acct", "user-1::agent:codex/codex", 4);
      const claudeHistory = await store.readChatHistory("acct", "user-1::agent:claude/claude", 4);
      assert.deepEqual(codexHistory.map((entry) => entry.text), ["codex queued message", "reply from codex"]);
      assert.deepEqual(claudeHistory, []);
    } finally {
      await cleanup(root);
    }
  });

  it("starts a new Weixin conversation for the current agent", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      await store.appendChatHistory("acct", "user-1::agent:codex/codex", [
        { role: "user", text: "old codex question" },
        { role: "assistant", text: "old codex answer", agentId: "codex", agentProvider: "codex" },
      ]);
      await store.appendChatHistory("acct", "user-1::agent:claude/claude", [
        { role: "user", text: "old claude question" },
      ]);
      const sent = [];
      const resetInputs = [];
      const runtimeInputs = [];
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          resetConversation: async (input) => {
            resetInputs.push(input);
            return { ok: true };
          },
          startMessage: async (input) => {
            runtimeInputs.push(input);
            return { runId: "run-after-new", status: "running" };
          },
          getRun: ({ runId }) => ({ runId, status: "completed", output: "fresh reply" }),
        },
      });
      const common = {
        accountId: "acct",
        fromUserId: "user-1",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        availableAgents: [
          { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
          { id: "claude", name: "Claude Code", provider: "claude", executablePath: "claude" },
        ],
      };

      await service.simulateInbound({ ...common, text: "#new", messageId: "new-session" });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /已为当前微信会话开启新的 Codex CLI/);
      assert.equal(resetInputs.length, 1);
      assert.equal(resetInputs[0].workspaceRoot, root);
      assert.equal(resetInputs[0].agent.provider, "codex");
      assert.match(resetInputs[0].agent.id, /^codex-weixin-/);
      assert.deepEqual(await store.readChatHistory("acct", "user-1::agent:codex/codex", 4), []);
      assert.equal((await store.readChatHistory("acct", "user-1::agent:claude/claude", 4))[0].text, "old claude question");

      await service.simulateInbound({ ...common, text: "fresh question", messageId: "after-new" });
      await waitFor(() => sent.length === 2, () => JSON.stringify(service.status()));
      assert.equal(runtimeInputs.length, 1);
      assert.doesNotMatch(runtimeInputs[0].prompt, /old codex question/);
      assert.equal(sent[1].text, "fresh reply");
    } finally {
      await cleanup(root);
    }
  });

  it("does not start a new Weixin conversation while the current agent is running", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      await store.appendChatHistory("acct", "user-1::agent:codex/codex", [{ role: "user", text: "keep me" }]);
      await store.writeActiveRun("acct", "user-1::agent:codex/codex", {
        status: "running",
        chatId: "user-1",
        senderId: "user-1",
        runId: "run-active",
        workspaceRoot: root,
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
        historyKey: "user-1::agent:codex/codex",
        startedAt: Date.now(),
      });
      const sent = [];
      let resets = 0;
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          resetConversation: async () => {
            resets += 1;
            return { ok: true };
          },
          getRun: ({ runId }) => ({ runId, status: "running" }),
        },
      });

      await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "#new session",
        messageId: "new-session-blocked",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "codex", name: "Codex CLI", provider: "codex", executablePath: "codex" },
      });

      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /还有运行中的任务/);
      assert.equal(resets, 0);
      assert.equal((await store.readChatHistory("acct", "user-1::agent:codex/codex", 4))[0].text, "keep me");
    } finally {
      await cleanup(root);
    }
  });

  it("reports unknown Weixin agent switch commands without running the agent", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      let runs = 0;
      const service = createWeixinService({
        store,
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async () => {
            runs += 1;
            return { runId: "run-unexpected", status: "running" };
          },
          getRun: () => ({ runId: "run-unexpected", status: "completed", output: "unexpected" }),
        },
      });

      await service.simulateInbound({
        accountId: "acct",
        fromUserId: "user-1",
        text: "#agent missing",
        messageId: "cmd-unknown",
        workspaceRoot: root,
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        agent: { id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" },
        availableAgents: [{ id: "opencode", name: "OpenCode", provider: "opencode", executablePath: "opencode" }],
      });

      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.equal(runs, 0);
      assert.match(sent[0].text, /未找到可切换的本地 Agent：missing/);
    } finally {
      await cleanup(root);
    }
  });

  it("downloads inbound image media and includes local paths in the agent prompt", async () => {
    const root = await tempRoot();
    try {
      const store = createWeixinStore(root);
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const cipher = createCipheriv("aes-128-ecb", key, null);
      cipher.setAutoPadding(true);
      const encrypted = Buffer.concat([cipher.update(Buffer.from("image-body", "utf8")), cipher.final()]);
      const sent = [];
      const prompts = [];
      const service = createWeixinService({
        store,
        mediaCacheDir: path.join(root, "media"),
        mediaFetchFn: async () => new Response(encrypted, { status: 200 }),
        client: {
          sendMessage: async (payload) => {
            sent.push(payload);
            return { ret: 0 };
          },
          getConfig: async () => ({ typing_ticket: "" }),
        },
        personalAgentRuntime: {
          startMessage: async (input) => {
            prompts.push(input.prompt);
            return { runId: "run-media", status: "running" };
          },
          getRun: () => ({ runId: "run-media", status: "completed", output: "saw image" }),
        },
      });
      const event = await service.processMessage({
        from_user_id: "user-1",
        to_user_id: "acct",
        message_id: "media-1",
        item_list: [
          { type: 1, text_item: { text: "look" } },
          {
            type: 2,
            image_item: {
              aeskey: key.toString("hex"),
              media: { full_url: "https://novac2c.cdn.weixin.qq.com/c2c/download?x=1" },
            },
          },
        ],
      }, {
        account: await store.loadAccount("acct"),
        dmPolicy: "allowlist",
        allowedUsers: ["user-1"],
        textBatchDelayMs: 0,
        workspaceRoot: root,
      });
      assert.equal(event.mediaFiles.length, 1);
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(prompts[0], /本地媒体附件:/);
      assert.match(prompts[0], /image\/jpeg/);
      assert.equal(await readFile(event.mediaFiles[0].path, "utf8"), "image-body");
    } finally {
      await cleanup(root);
    }
  });

  it("returns early when a local agent run needs approval", async () => {
    const runtime = {
      startMessage: async () => ({ runId: "run-approval", status: "running" }),
      getRun: () => ({ runId: "run-approval", status: "running", pendingApprovals: [{ id: "approval-1" }] }),
    };
    const result = await serviceTest.runAgentTurn(runtime, { workspaceRoot: "/tmp/work", prompt: "x", agent: { provider: "opencode" } });
    assert.equal(result.runId, "run-approval");
    assert.equal(result.pendingApprovals.length, 1);
  });
});

describe("weixin channel infrastructure", () => {
  it("requires local pairing approval before dispatching messages and stores channel sessions", async () => {
    const root = await tempRoot();
    let pairingService;
    let sessionStore;
    try {
      const store = createWeixinStore(root);
      pairingService = new ChannelPairingService({ userDataDir: root });
      sessionStore = new ChannelSessionStore({ userDataDir: root });
      await pairingService.initialize();
      await sessionStore.initialize();
      await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
      const sent = [];
      const client = {
        sendMessage: async (payload) => {
          sent.push(payload);
          return { ret: 0 };
        },
        getConfig: async () => ({ typing_ticket: "" }),
      };
      const runtimeCalls = [];
      const runtime = {
        runMessage: async (input) => {
          runtimeCalls.push(input);
          return { status: "completed", output: "authorized reply" };
        },
      };
      const service = createWeixinService({ store, client, personalAgentRuntime: runtime, channelPairingService: pairingService, channelSessionStore: sessionStore });
      await service.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com" });
      await service.simulateInbound({ accountId: "acct", fromUserId: "user-1", messageId: "pairing-msg", text: "ping", dmPolicy: "open", textBatchDelayMs: 0, workspaceRoot: root, agent: { provider: "opencode" } });
      await waitFor(() => sent.length === 1, () => JSON.stringify(service.status()));
      assert.match(sent[0].text, /配对码/);
      assert.equal(runtimeCalls.length, 0);
      const pending = pairingService.getPendingRequests();
      assert.equal(pending.length, 1);
      await pairingService.approvePairing(pending[0].code);
      await service.simulateInbound({ accountId: "acct", fromUserId: "user-1", messageId: "authorized-msg", text: "ping after approve", dmPolicy: "open", textBatchDelayMs: 0, workspaceRoot: root, agent: { provider: "opencode" } });
      await waitFor(() => runtimeCalls.length === 1, () => JSON.stringify(service.status()));
      await waitFor(() => sent.length === 2, () => JSON.stringify(sent));
      await waitFor(() => sessionStore.getSessionsByUser("wechat", "user-1").some((session) => session.messages.length === 2));
      const sessions = sessionStore.getSessionsByUser("wechat", "user-1");
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].agentType, "opencode/opencode");
      assert.equal(sessions[0].messages[0].content, "ping after approve");
      await service.stop({ persist: false });
    } finally {
      // Disposing services here keeps failed assertions from leaving timers alive.
      await pairingService?.dispose();
      await sessionStore?.dispose();
      await cleanup(root);
    }
  });
});

describe("weixin local QR renderer", () => {
  it("renders iLink scan URLs without network access", () => {
    const scanUrl = "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=035d7e4d4235d0be0bd39b0ef3e9233b&bot_type=3";
    const dataUrl = createQrSvgDataUrl(scanUrl);
    assert.equal(dataUrl.startsWith("data:image/svg+xml;base64,"), true);
    const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
    assert.match(svg, /<svg /);
    assert.match(svg, /<path/);
    assert.equal(localQrTest.vendor, "qrcode@1.5.4");
  });

  it("classifies channel run snapshots for shared polling", () => {
    assert.deepEqual(getChannelRunSnapshotState({ status: "running", pendingApprovals: [{ id: "approval" }] }), {
      status: "running",
      pendingApprovals: [{ id: "approval" }],
      hasPendingApprovals: true,
      isCompletedWithOutput: false,
      isRunning: true,
      isTerminal: false,
    });
    assert.equal(getChannelRunSnapshotState({ status: "completed", output: "done" }).isCompletedWithOutput, true);
    assert.equal(getChannelRunSnapshotState({ status: "failed" }).isTerminal, true);
    assert.equal(getChannelRunSnapshotState({}).isRunning, true);
  });
});

describe("weixin media primitives", () => {
  it("parses AES keys and decrypts AES-128-ECB payloads", () => {
    const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(Buffer.from("hello weixin", "utf8")), cipher.final()]);
    assert.equal(parseAesKey(key.toString("base64")).toString("hex"), key.toString("hex"));
    assert.equal(aes128EcbDecrypt(encrypted, key).toString("utf8"), "hello weixin");
  });

  it("rejects non-Weixin media URLs and builds CDN download URLs", () => {
    assert.equal(assertWeixinMediaUrl("https://novac2c.cdn.weixin.qq.com/c2c/download?x=1").includes("novac2c"), true);
    assert.throws(() => assertWeixinMediaUrl("http://novac2c.cdn.weixin.qq.com/c2c/download"), /https/);
    assert.throws(() => assertWeixinMediaUrl("https://example.com/media"), /not allowed/);
    assert.equal(cdnDownloadUrl("https://novac2c.cdn.weixin.qq.com/c2c", "a b").includes("a%20b"), true);
  });

  it("downloads, decrypts, and caches media", async () => {
    const root = await tempRoot();
    try {
      const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const cipher = createCipheriv("aes-128-ecb", key, null);
      cipher.setAutoPadding(true);
      const encrypted = Buffer.concat([cipher.update(Buffer.from("media-body", "utf8")), cipher.final()]);
      const outputPath = await downloadAndDecryptMedia({
        fetchFn: async () => new Response(encrypted, { status: 200 }),
        url: "https://novac2c.cdn.weixin.qq.com/c2c/download?x=1",
        aesKey: key.toString("base64"),
        outputDir: root,
        filename: "image.jpg",
      });
      assert.equal(await readFile(outputPath, "utf8"), "media-body");
    } finally {
      await cleanup(root);
    }
  });
});

async function waitFor(predicate, describeFailure = () => "condition was not met", timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(describeFailure());
}
