#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/expert-module-refactor/p10-ui");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const states = ["empty", "real-session", "directory-error", "missing-skill", "delete-partial"];
const themes = ["light", "dark"];

const viteLog = [];
const chromeLog = [];

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-fixture-"));
  const profileRoot = join(tempRoot, "chrome-profile");
  await mkdir(profileRoot, { recursive: true });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const fixtureUrl = `${appBaseUrl}/scripts/expert-refactor-visual-fixture.html`;

  const vite = spawnProcess("pnpm", [
    "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort",
  ], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileRoot}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    "--headless=new",
    "about:blank",
  ], { cwd: repoRoot, env: process.env }, chromeLog);

  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    if (process.env.KEEP_EXPERT_FIXTURE_TEMP !== "1") {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };

  let page;
  const screenshots = [];
  const focusChecks = [];
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");

    for (const theme of themes) {
      for (const state of states) {
        await page.send("Page.navigate", { url: `${fixtureUrl}?state=${state}&theme=${theme}&lang=en` });
        await page.waitFor(() => Boolean(document.querySelector("[data-expert-fixture=\"true\"]")), 20_000);
        await page.waitFor(`document.querySelector('[data-fixture-state]')?.getAttribute('data-fixture-state') === ${JSON.stringify(state)}`, 20_000);

        const metrics = await page.evaluate(`(() => {
          const root = document.querySelector('[data-expert-fixture="true"]');
          const controls = Array.from(document.querySelectorAll('button,[role="button"],a,[contenteditable="true"]'));
          const unnamed = controls.filter((node) => !(node.getAttribute('aria-label') || node.getAttribute('aria-placeholder') || node.getAttribute('title') || node.textContent || '').trim());
          return {
            state: root?.getAttribute('data-fixture-state'),
            theme: root?.getAttribute('data-fixture-theme'),
            controls: controls.length,
            unnamedControls: unnamed.length,
            unnamedLabels: unnamed.map((node) => ({ tag: node.tagName, testid: node.getAttribute('data-testid'), className: node.className })).slice(0, 8),
            hasSourceNote: Boolean(document.querySelector('[data-testid="fixture-source-note"]')),
          };
        })()`);
        assert.equal(metrics.state, state, `fixture state should be ${state}`);
        assert.equal(metrics.theme, theme, `fixture theme should be ${theme}`);
        assert.equal(metrics.unnamedControls, 0, `${state}/${theme} controls should have an accessible name: ${JSON.stringify(metrics.unnamedLabels)}`);
        assert.ok(metrics.controls >= 6, `${state}/${theme} should expose keyboard-reachable controls`);
        assert.equal(metrics.hasSourceNote, true, "fixture should disclose its production-component boundary");

        const filename = `${state}-${theme}.png`;
        await screenshot(page, filename);
        screenshots.push(filename);

        if (theme === "light" && state === "empty") {
          await page.evaluate(`document.querySelector('[data-state-choice="real-session"]')?.focus()`);
          const before = await page.evaluate(`document.activeElement?.getAttribute('data-state-choice')`);
          assert.equal(before, "real-session", "state rail button should accept programmatic focus");
          await page.keyPress("Tab", "Tab");
          const after = await page.evaluate(`({ tag: document.activeElement?.tagName, text: (document.activeElement?.textContent || '').trim(), aria: document.activeElement?.getAttribute('aria-label') })`);
          assert.notEqual(after.tag, "BODY", "Tab should move focus off the focused rail button");
          focusChecks.push({ before, after });
        }

        if (theme === "light" && state === "real-session") {
          const editor = await page.evaluate(`document.querySelector('[data-state-surface="real-session"] [contenteditable="true"]')?.getAttribute('contenteditable')`);
          assert.equal(editor, "true", "production Lexical editor should be keyboard focusable");
          await page.evaluate(`document.querySelector('[data-testid="create-expert-session"]')?.focus()`);
          const focused = await page.evaluate(`document.activeElement?.getAttribute('data-testid')`);
          assert.equal(focused, "create-expert-session", "directory create action should accept keyboard focus");
          focusChecks.push({ editor, focused });
        }

        if (theme === "light" && state === "directory-error") {
          await page.clickSelector('[data-testid="directory-retry"]');
          await page.waitFor(() => document.querySelector('[data-fixture-state]')?.getAttribute('data-fixture-state') === "real-session", 5_000);
        }
        if (theme === "light" && state === "missing-skill") {
          await page.clickSelector('[data-testid="repair-skills"]');
          await page.waitFor(() => document.querySelector('[data-fixture-state]')?.getAttribute('data-fixture-state') === "real-session", 5_000);
        }
        if (theme === "light" && state === "delete-partial") {
          await page.clickSelector('[data-testid="retry-delete"]');
          await page.waitFor(() => document.querySelector('[data-fixture-state]')?.getAttribute('data-fixture-state') === "real-session", 5_000);
        }
      }
    }

    const report = {
      status: "PASS",
      appBaseUrl,
      fixtureUrl,
      screenshots,
      focusChecks,
      states,
      themes,
    };
    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm --dir apps/app exec node scripts/expert-refactor-visual-fixture-smoke.mjs",
      "status: PASS",
      `screenshots: ${screenshots.length} (${screenshots.join(", ")})`,
      `focus checks: ${focusChecks.length}`,
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
  } catch (error) {
    if (page) {
      await writeFile(join(evidenceRoot, "failure-dom.txt"), String(await page.evaluate("document.body?.innerText || ''"))).catch(() => undefined);
      await screenshot(page, "failure.png").catch(() => undefined);
    }
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm --dir apps/app exec node scripts/expert-refactor-visual-fixture-smoke.mjs",
      "status: FAIL",
      error instanceof Error ? error.stack ?? error.message : String(error),
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
    throw error;
  } finally {
    page?.close?.();
    await cleanup();
  }
}

async function connectChrome(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((item) => item.type === "page" && typeof item.webSocketDebuggerUrl === "string") ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, "Chrome CDP tab should expose a WebSocket URL");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callbacks.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const waitFor = async (fn, timeoutMs = 10_000) => {
    const source = typeof fn === "string" ? `(() => Boolean(${fn}))()` : `(${fn.toString()})()`;
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try {
        last = await evaluate(source);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await wait(200);
    }
    throw new Error(`Timed out waiting for ${fn.toString()} (last=${String(last)})`);
  };
  const clickSelector = async (selector) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `selector not found: ${selector}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(250);
  };
  const keyPress = async (key, code) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    await wait(200);
  };
  return { send, evaluate, waitFor, clickSelector, keyPress, close: () => ws.close() };
}

async function screenshot(page, filename) {
  const result = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(evidenceRoot, filename), Buffer.from(result.data, "base64"));
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function spawnProcess(command, args, options, log) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const append = (prefix, chunk) => {
    log.push(`${prefix}${chunk.toString()}`);
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  child.stdout.on("data", (chunk) => append("", chunk));
  child.stderr.on("data", (chunk) => append("", chunk));
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") log.push(`\n[exit code=${code} signal=${signal}]\n`);
  });
  return child;
}

async function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2500).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }),
  ]);
}

function tail(log) {
  return log.join("").split(/\r?\n/).slice(-40).join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
