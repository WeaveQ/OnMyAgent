#!/usr/bin/env node
import net from "node:net";

const endpoint = process.env.ONMYAGENT_BROWSER_RPC_ENDPOINT?.trim();
if (!endpoint) {
  process.stderr.write("ONMYAGENT_BROWSER_RPC_ENDPOINT is required\n");
  process.exit(2);
}

function createFrameDecoder(onMessage) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (length > 16 * 1024 * 1024) throw new Error("native message is too large");
      if (buffered.length < length + 4) return;
      const payload = buffered.subarray(4, length + 4);
      buffered = buffered.subarray(length + 4);
      onMessage(JSON.parse(payload.toString("utf8")));
    }
  };
}

function writeFrame(stream, message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  stream.write(Buffer.concat([header, payload]));
}

const socket = net.createConnection(endpoint);
const fromChrome = createFrameDecoder((message) => writeFrame(socket, message));
const fromApp = createFrameDecoder((message) => writeFrame(process.stdout, message));

process.stdin.on("data", fromChrome);
socket.on("data", fromApp);
socket.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
socket.on("close", () => process.exit());
process.stdin.on("end", () => socket.end());
