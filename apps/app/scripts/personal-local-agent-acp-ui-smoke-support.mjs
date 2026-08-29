import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";

export async function connectChrome(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, "Chrome CDP tab should expose WebSocket URL");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const waitForLoad = async () => wait(1000);
  const waitFor = async (fn, timeoutMs = 10000) => {
    const source = `(${fn.toString()})()`;
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
  const waitForText = async (text, timeoutMs = 10000) => {
    const list = Array.isArray(text) ? text : [text];
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      last = await evaluate(`(() => {
        const body = document.body.innerText || '';
        return ${JSON.stringify(list)}.some((item) => body.includes(item));
      })()`);
      if (last) return true;
      await wait(200);
    }
    throw new Error(`Timed out waiting for text ${list.join(",")}`);
  };
  const clickText = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const ok = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],[role="menuitem"],a,summary')).filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        });
        const el = nodes.find((node) => (node.innerText || node.getAttribute('aria-label') || '').includes(needle));
        if (!el) return false;
        el.scrollIntoView({block:'center', inline:'center'});
        el.click();
        return true;
      })()`);
      if (ok) {
        await wait(400);
        return;
      }
    }
    throw new Error(`text target not found: ${list.join(", ")}`);
  };
  const clickAria = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const rect = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
        const interactive = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],[role="menuitem"],a,summary')).filter(visible);
        const exact = interactive.find((node) => [node.getAttribute('aria-label'), node.getAttribute('title')].some((value) => String(value || '').trim() === needle));
        const direct = exact || interactive.find((node) => [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText].some((value) => String(value || '').includes(needle)));
        const labelled = Array.from(document.querySelectorAll('*[aria-label],*[title]')).filter(visible).find((node) => [node.getAttribute('aria-label'), node.getAttribute('title')].some((value) => String(value || '').includes(needle)));
        const el = direct || labelled?.closest('button,[role="button"],[role="combobox"],[role="menuitem"],a,summary') || labelled;
        if (!el) return null;
        el.scrollIntoView({block:'center', inline:'center'});
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (rect) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await wait(400);
        return;
      }
    }
    throw new Error(`aria target not found: ${list.join(", ")}`);
  };
  const clickTestId = async (testId) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `test id target should be clickable: ${testId}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(400);
  };
  const assertVisibleTestId = async (testId) => {
    const visible = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })()`);
    assert.equal(visible, true, `test id should be visible in rendered UI: ${testId}`);
  };
  const fillInputByTestId = async (testId, value) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `test id input should be fillable: ${testId}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.insertText", { text: value });
    await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(200);
  };
  const fillTextarea = async (value) => {
    const rect = await evaluate(`(() => {
      const areas = Array.from(document.querySelectorAll('textarea')).filter((item) => !item.disabled);
      const el = areas.find((item) => item.getAttribute('data-local-agent-composer') === 'true') || areas.find((item) => {
        const form = item.closest('form,section,div');
        return form && (form.innerText || '').includes('权限策略');
      }) || areas[0];
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, "enabled textarea should exist");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await send("Input.insertText", { text: value });
    await evaluate(`(() => {
      const el = document.querySelector('textarea[data-local-agent-composer="true"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(300);
  };
  const setFiles = async (...paths) => {
    await send("DOM.enable");
    const document = await send("DOM.getDocument", { depth: -1, pierce: true });
    const query = await send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: 'input[type="file"]',
    });
    assert.ok(query.nodeId, "Local Agent file input should exist");
    await send("DOM.setFileInputFiles", { nodeId: query.nodeId, files: paths });
    await wait(500);
  };
  const clickSend = async () => {
    const ok = await evaluate(`(() => {
      const composer = Array.from(document.querySelectorAll('textarea')).find((item) => !item.disabled && item.getAttribute('data-local-agent-composer') === 'true') || Array.from(document.querySelectorAll('textarea')).find((item) => !item.disabled && (item.closest('form,section,div')?.innerText || '').includes('权限策略'));
      const root = composer?.closest('form,section,div') || document;
      const buttons = Array.from(root.querySelectorAll('button')).filter((button) => !button.disabled);
      const el = buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'))
        || buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('Send'))
        || Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled).find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    assert.equal(ok, true, "send button should be clickable");
    await wait(500);
  };
  const close = () => ws.close();
  return { send, evaluate, waitForLoad, waitFor, waitForText, clickText, clickAria, clickTestId, assertVisibleTestId, fillInputByTestId, fillTextarea, setFiles, clickSend, close };
}

export async function screenshot(page, evidenceRoot, filename) {
  const result = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(evidenceRoot, filename), Buffer.from(result.data, "base64"));
}

async function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

export async function waitForHttp(url, timeoutMs = 30000) {
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
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== "string", "expected TCP address");
  return address.port;
}

export function spawnProcess(command, args, options, log) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const append = (chunk) => {
    log.push(chunk.toString());
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") log.push(`\n[exit code=${code} signal=${signal}]\n`);
  });
  return child;
}

export async function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(2500).then(() => child.kill("SIGKILL"))]);
}

export function tail(lines) {
  return lines.join("").split(/\r?\n/).slice(-60).join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
