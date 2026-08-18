/**
 * No-model Electron window smoke for Grok attachments.
 * Starts a real BrowserWindow, clicks an enabled Add-file control, and
 * drives the shipped composer → staging prompt pipeline.
 */
import { app, BrowserWindow } from "electron";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const evidenceDir = process.env.GROK_ATTACH_SMOKE_EVIDENCE?.trim()
  || join(repoRoot, ".loop", "runs");

function resolveBunBinary() {
  const explicit = process.env.BUN_BIN?.trim();
  if (explicit) return explicit;
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(locator, ["bun"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const resolved = String(output).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (resolved) return resolved;
  } catch {
    // Fall through to a typed operator-facing error below.
  }
  throw new Error("Bun is required for this smoke; set BUN_BIN or install bun on PATH");
}

const bunBin = resolveBunBinary();

function log(message) {
  process.stdout.write(`[grok-attach-smoke] ${message}\n`);
}

const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Grok attach smoke</title></head>
  <body>
    <button id="add-file" type="button">Add file</button>
    <pre id="out"></pre>
    <script>
      document.getElementById("add-file").addEventListener("click", async () => {
        const file = new File(["hello from electron window"], "notes.md", { type: "text/markdown" });
        const response = await fetch("/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: file.name, mime: file.type, text: await file.text() }),
        });
        const json = await response.json();
        document.title = json.ok ? "GROK_ATTACH_OK" : "GROK_ATTACH_FAIL";
        document.getElementById("out").textContent = JSON.stringify(json);
        window.__grokAttachResult = json;
      });
    </script>
  </body>
</html>`;

function runProbe(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      bunBin,
      [join(__dirname, "grok-attach-pipeline-probe.mjs"), JSON.stringify(payload)],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`pipeline probe failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}"));
      } catch (error) {
        reject(new Error(`pipeline probe output invalid: ${stdout}\n${error}`));
      }
    });
  });
}

const server = createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/pipeline") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const result = await runProbe(payload);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: false, error: String(error) }));
    }
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("smoke server did not listen");

log(`starting evidenceDir=${evidenceDir} bun=${bunBin} ready=${app.isReady()}`);
await mkdir(evidenceDir, { recursive: true });
try {
  app.disableHardwareAcceleration();
} catch {
  // Already applied or unavailable in this Electron host.
}
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");
const ready = Promise.race([
  app.whenReady().then(() => "ready"),
  new Promise((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
]);
const readyState = await ready;
if (readyState !== "ready") {
  log("whenReady timeout — this agent process cannot join the macOS GUI session");
  app.quit();
  process.exit(2);
}
log("electron ready");
const window = new BrowserWindow({
  show: false,
  width: 900,
  height: 700,
  webPreferences: { contextIsolation: true, sandbox: false },
});

const outcomes = [];
try {
  for (const attempt of [1, 2]) {
    log(`attempt ${attempt} loading window`);
    await window.loadURL(`http://127.0.0.1:${address.port}/`);
    log(`attempt ${attempt} loaded`);
    const enabled = await window.webContents.executeJavaScript(
      `(() => { const button = document.getElementById("add-file"); return Boolean(button && !button.disabled); })()`,
    );
    if (!enabled) throw new Error(`attempt ${attempt}: Add file control was disabled`);
    await window.webContents.executeJavaScript(
      `document.getElementById("add-file").click()`,
    );
    const started = Date.now();
    let title = "";
    let result = null;
    while (Date.now() - started < 20_000) {
      title = await window.webContents.executeJavaScript("document.title");
      result = await window.webContents.executeJavaScript("window.__grokAttachResult || null");
      if (title === "GROK_ATTACH_OK" && result?.ok) break;
      if (title === "GROK_ATTACH_FAIL") {
        throw new Error(`attempt ${attempt}: pipeline failed ${JSON.stringify(result)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (title !== "GROK_ATTACH_OK" || !result?.ok) {
      throw new Error(`attempt ${attempt}: timed out title=${title} result=${JSON.stringify(result)}`);
    }
    const image = await window.webContents.capturePage();
    const shotPath = join(evidenceDir, `grok-attach-window-${attempt}.png`);
    await writeFile(shotPath, image.toPNG());
    outcomes.push({ attempt, ok: true, result, shotPath });
  }
  const summary = { ok: true, attempts: outcomes };
  await writeFile(join(evidenceDir, "electron-window-smoke.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
  const failed = { ok: false, error: String(error), attempts: outcomes };
  await writeFile(join(evidenceDir, "electron-window-smoke.json"), `${JSON.stringify(failed, null, 2)}\n`).catch(() => undefined);
  throw error;
} finally {
  window.destroy();
  await new Promise((resolve) => server.close(resolve));
  app.quit();
}
