import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWeixinService } from "../../weixin/service.mjs";
import { createWeixinStore } from "../../weixin/store.mjs";
import { ChannelPairingService } from "../ChannelPairingService.mjs";
import { ChannelSessionStore } from "../ChannelSessionStore.mjs";

async function waitFor(predicate, describeFailure, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(describeFailure());
}

test("Weixin pairing preserves first-message routing context and does not poison replay dedupe", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-weixin-pairing-readiness-"));
  const pairingService = new ChannelPairingService({ userDataDir: root });
  const sessionStore = new ChannelSessionStore({ userDataDir: root });
  const store = createWeixinStore(root);
  const sent = [];
  const runtimeCalls = [];
  let service;

  try {
    await pairingService.initialize();
    await sessionStore.initialize();
    await store.saveAccount({
      accountId: "acct",
      token: "tok",
      baseUrl: "https://weixin.example.com",
      userId: "owner",
    });

    service = createWeixinService({
      store,
      channelPairingService: pairingService,
      channelSessionStore: sessionStore,
      client: {
        async getUpdates({ signal }) {
          return await new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => resolve({ ret: 0, msgs: [], get_updates_buf: "" }),
              { once: true },
            );
          });
        },
        async sendMessage(payload) {
          sent.push(payload);
          return { ret: 0 };
        },
        async getConfig() {
          return { typing_ticket: "" };
        },
      },
      personalAgentRuntime: {
        async runMessage(input) {
          runtimeCalls.push(input);
          return { status: "completed", output: `reply ${runtimeCalls.length}` };
        },
      },
    });

    await service.start({
      accountId: "acct",
      workspaceRoot: root,
      dmPolicy: "open",
      textBatchDelayMs: 0,
      agent: { provider: "opencode" },
    });

    await service.simulateInbound({
      accountId: "acct",
      fromUserId: "user-1",
      messageId: "pairing-msg",
      contextToken: "ctx-user-1",
      text: "same text",
    });
    await waitFor(() => sent.length === 1, () => `sent: ${JSON.stringify(sent)}`);
    assert.match(sent[0].text, /配对码/);
    assert.equal(runtimeCalls.length, 0, "pre-approval inbound must not run the Agent");
    assert.equal(await store.readContextToken("acct", "user-1"), "ctx-user-1");

    const firstPairing = pairingService.getPendingRequests()[0];
    assert.equal(firstPairing?.platformUserId, "user-1");
    await pairingService.approvePairing(firstPairing.code);

    const delivery = await service.sendTaskDelivery({
      accountId: "acct",
      chatId: "user-1",
      text: "immediate after approval",
    });
    assert.equal(delivery.ok, true);
    assert.equal(sent[1].contextToken, "ctx-user-1");

    const authorizedMessage = {
      accountId: "acct",
      fromUserId: "user-1",
      messageId: "pairing-msg",
      contextToken: "ctx-user-1",
      text: "same text",
    };
    await service.simulateInbound(authorizedMessage);
    await service.simulateInbound(authorizedMessage);
    await waitFor(() => runtimeCalls.length === 1, () => `runtime calls: ${runtimeCalls.length}`);
    await waitFor(() => sent.length === 3, () => `sent: ${JSON.stringify(sent)}`);
    assert.equal(
      runtimeCalls.length,
      1,
      "the pre-approval provider ID must remain eligible once, then dedupe its replay",
    );

    await service.simulateInbound({
      accountId: "acct",
      fromUserId: "user-2",
      messageId: "",
      text: "no-id text",
    });
    assert.equal(runtimeCalls.length, 1, "a second user's pre-approval inbound must not run the Agent");

    const secondPairing = pairingService.getPendingRequests()[0];
    assert.equal(secondPairing?.platformUserId, "user-2");
    await pairingService.approvePairing(secondPairing.code);

    const idlessMessage = {
      accountId: "acct",
      fromUserId: "user-2",
      messageId: "",
      text: "no-id text",
    };
    await service.simulateInbound(idlessMessage);
    await service.simulateInbound(idlessMessage);
    await waitFor(() => runtimeCalls.length === 2, () => `runtime calls: ${runtimeCalls.length}`);
    assert.equal(runtimeCalls.length, 2, "authorized ID-less content fallback must run only once");
  } finally {
    await service?.stop({ persist: false }).catch(() => undefined);
    await pairingService.dispose();
    await sessionStore.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});
