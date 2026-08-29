#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/local-agent-composer-ui-only-parity");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const viteLog = [];
const chromeLog = [];

function spawnProcess(cmd, args, opts, log) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  return child;
}

async function killProcess(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch {}
  await wait(200);
  try { child.kill("SIGKILL"); } catch {}
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 302) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`waitForHttp timeout ${url}`);
}

async function connectChrome(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  const tabs = await response.json();
  const tab = tabs.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, "Chrome CDP tab should expose WebSocket URL");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve: resolveSend, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const screenshot = async (name) => {
    const captured = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidenceRoot, name), Buffer.from(captured.data, "base64"));
  };
  return { send, evaluate, screenshot, close: () => ws.close() };
}

function fixtureHtml() {
  const result = spawnSync("bun", ["scripts/local-agent-composer-ui-only-visual-render.ts"], { cwd: appRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "failed to render composer visual fixture");
  return String(result.stdout || "");
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const html = fixtureHtml();
  assert.ok(html.includes("local-agent-model-selector"), "fixture should include the ACP model selector");
  assert.ok(html.includes("local-agent-composer-stop"), "fixture should include the running stop control");
  assert.ok(html.includes("local-agent-slash-menu"), "fixture should include the slash menu");
  assert.ok(html.includes("local-agent-draft-workspace"), "fixture should include the draft workspace control");
  assert.ok(html.includes("local-agent-composer-approval"), "fixture should include the approval control");
  const tempRoot = await mkdtemp(join(tmpdir(), "local-agent-composer-ui-only-visual-"));
  const chromeProfile = join(tempRoot, "chrome-profile");
  await mkdir(chromeProfile, { recursive: true });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: appBaseUrl });
    await wait(1000);
    const layout = await page.evaluate(`(() => {
      const html = ${JSON.stringify(html)};
      const host = document.createElement("div");
      host.id = "local-agent-composer-ui-only-visual-fixture";
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--dls-background,#fff);overflow:auto;padding:24px;";
      const column = document.createElement("div");
      column.style.cssText = "width:360px;max-width:360px;min-width:0;margin:0 auto;";
      column.innerHTML = html;
      host.appendChild(column);
      document.body.appendChild(host);
      const overflowOf = (node) => {
        const rect = node.getBoundingClientRect();
        return Array.from(node.querySelectorAll("*"))
          .filter((child) => child.getBoundingClientRect().width > 0)
          .some((child) => {
            const box = child.getBoundingClientRect();
            return box.right > rect.right + 1.5 || box.left < rect.left - 1.5;
          });
      };
      const toolbarOverlaps = (section) => {
        const tools = section?.querySelector('[data-local-agent-composer-tools="true"]');
        const trailing = section?.querySelector('[data-local-agent-composer-trailing="true"]');
        if (!tools || !trailing) return true;
        return tools.getBoundingClientRect().right > trailing.getBoundingClientRect().left + 0.5;
      };
      const draft = column.querySelector('[data-testid="draft"]');
      const formal = column.querySelector('[data-testid="formal"]');
      const running = column.querySelector('[data-testid="running"]');
      const disabled = column.querySelector('[data-testid="disabled"]');
      const loadingModel = column.querySelector('[data-testid="loading-model"]');
      const slash = column.querySelector('[data-testid="slash"]');
      const trigger = draft?.querySelector('[data-testid="local-agent-model-selector"] button');
      trigger?.click();
      return {
        width: column.getBoundingClientRect().width,
        scrollWidth: column.scrollWidth,
        overflow: overflowOf(column),
        draftOverflow: draft ? overflowOf(draft) : true,
        formalOverflow: formal ? overflowOf(formal) : true,
        runningOverflow: running ? overflowOf(running) : true,
        disabledOverflow: disabled ? overflowOf(disabled) : true,
        loadingModelOverflow: loadingModel ? overflowOf(loadingModel) : true,
        draftToolbarOverlap: toolbarOverlaps(draft),
        formalToolbarOverlap: toolbarOverlaps(formal),
        runningToolbarOverlap: toolbarOverlaps(running),
        disabledToolbarOverlap: toolbarOverlaps(disabled),
        loadingModelToolbarOverlap: toolbarOverlaps(loadingModel),
        slashOverflow: slash ? overflowOf(slash) : true,
        modelSelector: Boolean(column.querySelector('[data-testid="local-agent-model-selector"]')),
        stop: Boolean(column.querySelector('[data-testid="local-agent-composer-stop"]')),
        slashMenu: Boolean(column.querySelector('[data-testid="local-agent-slash-menu"]')),
        draftWorkspace: Boolean(draft?.querySelector('[data-testid="local-agent-draft-workspace"]')),
        formalWorkspace: Boolean(formal?.querySelector('[data-testid="local-agent-draft-workspace"]')),
        approval: Boolean(column.querySelector('[data-testid="local-agent-composer-approval"]')),
        disabledApproval: Boolean(disabled?.querySelector('[data-testid="local-agent-composer-approval"] button:disabled')),
        disabledModel: Boolean(disabled?.querySelector('[data-testid="local-agent-model-selector"] button:disabled')),
        loadingModel: Boolean(loadingModel?.querySelector('[data-testid="local-agent-model-selector"]')),
        narrowWorkspaceLabelDisplay: getComputedStyle(draft.querySelector('[data-testid="local-agent-workspace-label"]')).display,
        narrowApprovalLabelDisplay: getComputedStyle(draft.querySelector('[data-testid="local-agent-approval-label"]')).display,
        footer: Boolean(column.querySelector('[data-local-agent-composer-footer="true"]')),
        modelOpen: Boolean(document.querySelector('[role="listbox"]')),
      };
    })()`);
    assert.equal(layout.width, 360);
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.equal(layout.draftOverflow, false, JSON.stringify(layout));
    assert.equal(layout.formalOverflow, false, JSON.stringify(layout));
    assert.equal(layout.runningOverflow, false, JSON.stringify(layout));
    assert.equal(layout.disabledOverflow, false, JSON.stringify(layout));
    assert.equal(layout.loadingModelOverflow, false, JSON.stringify(layout));
    assert.equal(layout.draftToolbarOverlap, false, JSON.stringify(layout));
    assert.equal(layout.formalToolbarOverlap, false, JSON.stringify(layout));
    assert.equal(layout.runningToolbarOverlap, false, JSON.stringify(layout));
    assert.equal(layout.disabledToolbarOverlap, false, JSON.stringify(layout));
    assert.equal(layout.loadingModelToolbarOverlap, false, JSON.stringify(layout));
    assert.equal(layout.modelSelector, true);
    assert.equal(layout.stop, true);
    assert.equal(layout.slashMenu, true);
    assert.equal(layout.draftWorkspace, true);
    assert.equal(layout.formalWorkspace, false);
    assert.equal(layout.approval, true);
    assert.equal(layout.disabledApproval, true);
    assert.equal(layout.disabledModel, true);
    assert.equal(layout.loadingModel, true);
    assert.equal(layout.narrowWorkspaceLabelDisplay, "none");
    assert.equal(layout.narrowApprovalLabelDisplay, "none");
    assert.equal(layout.footer, false);
    await page.screenshot("composer-ui-only-light-360.png");
    await page.evaluate("document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark';");
    await wait(100);
    await page.screenshot("composer-ui-only-dark-360.png");
    await page.evaluate("document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme='light'; document.querySelector('#local-agent-composer-ui-only-visual-fixture > div').style.width='720px'; document.querySelector('#local-agent-composer-ui-only-visual-fixture > div').style.maxWidth='720px';");
    await wait(100);
    const wideLayout = await page.evaluate(`(() => {
      const draft = document.querySelector('[data-testid="draft"]');
      return {
        workspaceLabelDisplay: getComputedStyle(draft.querySelector('[data-testid="local-agent-workspace-label"]')).display,
        approvalLabelDisplay: getComputedStyle(draft.querySelector('[data-testid="local-agent-approval-label"]')).display,
      };
    })()`);
    assert.notEqual(wideLayout.workspaceLabelDisplay, "none");
    assert.notEqual(wideLayout.approvalLabelDisplay, "none");
    await page.screenshot("composer-ui-only-light-wide.png");
    await page.evaluate(`(async () => {
      document.body.innerHTML = '<div id="root"></div>';
      await import('/scripts/local-agent-composer-approval-interactive-fixture.tsx');
    })()`);
    await wait(250);
    await page.evaluate(`document.querySelector('[data-testid="local-agent-composer-approval"] button')?.click()`);
    await wait(150);
    const approvalOpen = await page.evaluate(`(() => {
      const popup = document.querySelector('[data-slot="dropdown-menu-content"]');
      const items = Array.from(document.querySelectorAll('[data-slot="dropdown-menu-radio-item"]'));
      return {
        open: Boolean(popup),
        itemCount: items.length,
        roles: items.map((item) => item.getAttribute('role')),
        checkedCount: items.filter((item) => item.getAttribute('aria-checked') === 'true').length,
        selectedFocused: document.activeElement?.getAttribute('aria-checked') === 'true',
      };
    })()`);
    assert.equal(approvalOpen.open, true, JSON.stringify(approvalOpen));
    assert.equal(approvalOpen.itemCount, 3, JSON.stringify(approvalOpen));
    assert.deepEqual(approvalOpen.roles, ["menuitemradio", "menuitemradio", "menuitemradio"]);
    assert.equal(approvalOpen.checkedCount, 1, JSON.stringify(approvalOpen));
    assert.equal(approvalOpen.selectedFocused, true, JSON.stringify(approvalOpen));
    await page.screenshot("composer-approval-menu.png");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
    await wait(100);
    const approvalCurrentSelected = await page.evaluate(`(() => ({
      value: document.querySelector('[data-testid="local-agent-approval-interactive-fixture"]')?.getAttribute('data-approval-value'),
      open: Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')),
    }))()`);
    assert.equal(approvalCurrentSelected.value, "ask", JSON.stringify(approvalCurrentSelected));
    assert.equal(approvalCurrentSelected.open, false, JSON.stringify(approvalCurrentSelected));
    await page.evaluate(`document.querySelector('[data-testid="local-agent-composer-approval"] button')?.click()`);
    await wait(100);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "End", code: "End" });
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter" });
    await wait(150);
    const approvalSelected = await page.evaluate(`(() => ({
      value: document.querySelector('[data-testid="local-agent-approval-interactive-fixture"]')?.getAttribute('data-approval-value'),
      open: Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')),
    }))()`);
    assert.equal(approvalSelected.value, "read-only-auto", JSON.stringify(approvalSelected));
    assert.equal(approvalSelected.open, false, JSON.stringify(approvalSelected));
    await page.evaluate(`document.querySelector('[data-testid="local-agent-composer-approval"] button')?.click()`);
    await wait(100);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await wait(100);
    const approvalEscaped = await page.evaluate(`(() => {
      const trigger = document.querySelector('[data-testid="local-agent-composer-approval"] button');
      return {
        open: Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')),
        focusReturned: document.activeElement === trigger,
      };
    })()`);
    assert.equal(approvalEscaped.open, false, JSON.stringify(approvalEscaped));
    assert.equal(approvalEscaped.focusReturned, true, JSON.stringify(approvalEscaped));
    await writeFile(join(evidenceRoot, "visual-layout.json"), JSON.stringify({
      narrow: layout,
      wide: wideLayout,
      approvalOpen,
      approvalCurrentSelected,
      approvalSelected,
      approvalEscaped,
    }, null, 2));
    await writeFile(join(evidenceRoot, "visual-command-output.txt"), [
      "pnpm exec bun scripts/local-agent-composer-ui-only-visual-smoke.mjs",
      "status: PASS",
      `360px overflow: ${layout.overflow}`,
      `draft workspace: ${layout.draftWorkspace}`,
      `formal workspace: ${layout.formalWorkspace}`,
      `approval: ${layout.approval}`,
      `disabled controls: approval=${layout.disabledApproval}, model=${layout.disabledModel}`,
      `loading model: ${layout.loadingModel}`,
      `separate footer: ${layout.footer}`,
      `toolbar overlap: draft=${layout.draftToolbarOverlap}, formal=${layout.formalToolbarOverlap}, running=${layout.runningToolbarOverlap}`,
      `narrow labels: workspace=${layout.narrowWorkspaceLabelDisplay}, approval=${layout.narrowApprovalLabelDisplay}`,
      `wide labels: workspace=${wideLayout.workspaceLabelDisplay}, approval=${wideLayout.approvalLabelDisplay}`,
      `model open: ${layout.modelOpen}`,
      `approval menu: items=${approvalOpen.itemCount}, checked=${approvalOpen.checkedCount}, selected=${approvalSelected.value}, escape-focus-return=${approvalEscaped.focusReturned}`,
      "screenshots: composer-ui-only-light-360.png, composer-ui-only-dark-360.png, composer-ui-only-light-wide.png, composer-approval-menu.png",
      "fixture: production LocalAgentDraftComposer + PersonalLocalAgentModelSelector",
      "",
      "vite log tail:",
      viteLog.slice(-20).join(""),
    ].join("\n"));
  } catch (error) {
    await writeFile(join(evidenceRoot, "visual-command-output.txt"), [
      "pnpm exec bun scripts/local-agent-composer-ui-only-visual-smoke.mjs",
      "status: FAIL",
      error instanceof Error ? error.stack ?? error.message : String(error),
      "",
      "vite log tail:",
      viteLog.slice(-40).join(""),
      "",
      "chrome log tail:",
      chromeLog.slice(-20).join(""),
    ].join("\n"));
    throw error;
  } finally {
    page?.close?.();
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
