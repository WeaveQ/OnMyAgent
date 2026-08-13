import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";

import {
  TASK_SUPERVISOR_PROTOCOL_VERSION,
  createSupervisorDescriptor,
  createSupervisorFrameDecoder,
  encodeSupervisorFrame,
  parseSupervisorFrame,
  supervisorDescriptorPaths,
  supervisorEndpointForUserData,
} from "./protocol.mjs";
import {
  createTaskSupervisorServer,
  readSupervisorSecret,
} from "./server.mjs";

function createFrameClient(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const queued = [];
    const waiting = [];
    let failure = null;
    const fail = (error) => {
      failure = error;
      while (waiting.length > 0) waiting.shift().reject(error);
    };
    const decoder = createSupervisorFrameDecoder({
      onFrame(frame) {
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(frame);
        else queued.push(frame);
      },
      onError: fail,
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", fail);
    socket.once("connect", () => {
      resolve({
        send(frame) {
          socket.write(encodeSupervisorFrame(frame));
        },
        receive() {
          if (queued.length > 0) return Promise.resolve(queued.shift());
          if (failure) return Promise.reject(failure);
          return new Promise((receiveResolve, receiveReject) => {
            waiting.push({ resolve: receiveResolve, reject: receiveReject });
          });
        },
        async close() {
          decoder.stop();
          if (socket.closed) return;
          await new Promise((closeResolve) => {
            socket.once("close", closeResolve);
            socket.destroy();
          });
        },
      });
    });
  });
}

function assertEndpointClosed(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for the stopped Windows named pipe to reject a connection"));
    }, 2_000);
    const finish = (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.once("connect", () => finish(new Error("Stopped Windows named pipe still accepted a connection")));
    socket.once("error", () => finish());
  });
}

test("Windows Supervisor endpoint, descriptor, and frame contracts are deterministic", () => {
  const userDataDir = path.resolve(os.tmpdir(), "onmyagent-windows-supervisor-contract");
  const endpoint = supervisorEndpointForUserData(userDataDir, { platform: "win32" });
  assert.equal(endpoint, supervisorEndpointForUserData(userDataDir, { platform: "win32" }));
  assert.match(endpoint, /^\\\\\.\\pipe\\onmyagent-task-supervisor-[a-f0-9]{32}$/);
  assert.notEqual(
    endpoint,
    supervisorEndpointForUserData(`${userDataDir}-other`, { platform: "win32" }),
  );

  const paths = supervisorDescriptorPaths(userDataDir);
  const descriptor = createSupervisorDescriptor({
    userDataDir,
    endpoint,
    pid: 42,
    supervisorEpoch: "windows-contract-epoch",
    startToken: "windows-contract-start",
    secretPath: paths.secretPath,
    createdAt: 123,
  });
  assert.equal(descriptor.protocolVersion, TASK_SUPERVISOR_PROTOCOL_VERSION);
  assert.equal(descriptor.endpoint, endpoint);
  assert.equal(descriptor.secretPath, paths.secretPath);

  const frames = [];
  const decoder = createSupervisorFrameDecoder({ onFrame: (frame) => frames.push(frame) });
  const encoded = encodeSupervisorFrame({
    type: "hello",
    id: "windows-contract-frame",
    token: "a".repeat(64),
    supervisorEpoch: descriptor.supervisorEpoch,
    startToken: descriptor.startToken,
  });
  const midpoint = Math.floor(encoded.length / 2);
  decoder.push(Buffer.from(encoded.slice(0, midpoint)));
  assert.equal(frames.length, 0);
  decoder.push(Buffer.from(encoded.slice(midpoint)));
  assert.equal(frames.length, 1);
  assert.deepEqual(parseSupervisorFrame(encoded), frames[0]);
});

test(
  "Windows named pipe accepts authenticated Supervisor RPC and is removed on stop",
  { skip: process.platform !== "win32", timeout: 10_000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-windows-supervisor-live-"));
    let listCalls = 0;
    const secret = "b".repeat(64);
    const server = createTaskSupervisorServer({
      userDataDir: root,
      platform: "win32",
      secret,
      supervisorEpoch: "windows-live-epoch",
      startToken: "windows-live-start",
      service: {
        async listTasks() {
          listCalls += 1;
          return { tasks: [{ id: "windows-live-task" }], issues: [] };
        },
      },
    });

    try {
      const descriptor = await server.listen();
      assert.match(descriptor.endpoint, /^\\\\\.\\pipe\\onmyagent-task-supervisor-[a-f0-9]{32}$/);
      assert.equal(await readSupervisorSecret(descriptor.secretPath), secret);

      const rejected = await createFrameClient(descriptor.endpoint);
      rejected.send({
        type: "hello",
        id: "wrong-token",
        token: "c".repeat(64),
        supervisorEpoch: descriptor.supervisorEpoch,
        startToken: descriptor.startToken,
      });
      const rejection = await rejected.receive();
      assert.equal(rejection.ok, false);
      assert.equal(rejection.error.code, "SUPERVISOR_AUTH_FAILED");
      await rejected.close();

      const client = await createFrameClient(descriptor.endpoint);
      client.send({
        type: "hello",
        id: "authenticated",
        token: secret,
        supervisorEpoch: descriptor.supervisorEpoch,
        startToken: descriptor.startToken,
      });
      assert.equal((await client.receive()).ok, true);
      client.send({
        type: "request",
        id: "list-tasks",
        idempotencyKey: "windows-live-list",
        method: "taskOrchestratorTasksList",
        params: {},
        supervisorEpoch: descriptor.supervisorEpoch,
        startToken: descriptor.startToken,
      });
      const response = await client.receive();
      assert.equal(response.ok, true);
      assert.equal(response.result.tasks[0].id, "windows-live-task");
      assert.equal(listCalls, 1);
      await client.close();

      await server.stop();
      await assert.rejects(stat(server.descriptorPath));
      await assert.rejects(stat(server.secretPath));
      await assertEndpointClosed(descriptor.endpoint);
    } finally {
      await server.stop().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  },
);
