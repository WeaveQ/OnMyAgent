import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.platform === "darwin" && process.arch === "arm64"
  ? "aarch64-apple-darwin"
  : process.platform === "darwin"
    ? "x86_64-apple-darwin"
    : process.platform === "linux" && process.arch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
const bundledPython = path.join(
  desktopRoot,
  "resources",
  "runtimes",
  target,
  "python",
  process.platform === "win32" ? "python.exe" : "bin/python3",
);
const python = process.env.ONMYAGENT_BROWSER_USE_TEST_PYTHON?.trim() || bundledPython;
const runtimeTest = existsSync(python) ? test : test.skip;
const resources = path.join(desktopRoot, "resources", "browser-use-agent");

function runPython(args, options) {
  return new Promise((resolve) => {
    const child = spawn(python, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

runtimeTest("OnMyAgentChatModel serializes images and validates structured output", async () => {
  let received = null;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const body = JSON.stringify({
        value: { next_goal: "inspect", confidence: 0.9 },
        usage: { inputTokens: 12, outputTokens: 4 },
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const code = [
      "import asyncio, json",
      "from pydantic import BaseModel",
      "from browser_use.llm.messages import UserMessage, ContentPartTextParam, ContentPartImageParam, ImageURL",
      "from onmyagent_chat_model import OnMyAgentChatModel",
      "class Output(BaseModel):",
      "    next_goal: str",
      "    confidence: float",
      "async def main():",
      "    llm = OnMyAgentChatModel()",
      "    assert llm.model_name == 'onmyagent-selected-model'",
      "    message = UserMessage(content=[ContentPartTextParam(text='inspect'), ContentPartImageParam(image_url=ImageURL(url='data:image/png;base64,AA=='))])",
      "    result = await llm.ainvoke([message], Output)",
      "    print(json.dumps({'completion': result.completion.model_dump(), 'usage': result.usage.model_dump()}))",
      "asyncio.run(main())",
    ].join("\n");
    const result = await runPython(["-c", code], {
      cwd: resources,
      env: {
        ...process.env,
        PYTHONPATH: resources,
        ONMYAGENT_MODEL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        ONMYAGENT_MODEL_GATEWAY_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output.completion, { next_goal: "inspect", confidence: 0.9 });
    assert.equal(output.usage.prompt_tokens, 12);
    const receivedJson = JSON.stringify(received);
    assert.match(receivedJson, /"title":"Output"/);
    assert.match(receivedJson, /"type":"image_url"/);
    assert.match(receivedJson, /data:image\/png;base64,AA==/);
    assert.doesNotMatch(receivedJson, /test-token/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

runtimeTest("runner describes an upstream browser_use.Agent entrypoint", () => {
  const result = spawnSync(python, [path.join(resources, "runner.py"), "--describe"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    agentClass: "browser_use.Agent",
    browserClass: "browser_use.BrowserSession",
    modelClass: "OnMyAgentChatModel",
    protocol: "jsonl-v1",
  });
});

runtimeTest("runner approval policy detects explicit writes and risky DOM clicks", () => {
  const code = [
    "import json",
    "from runner import approval_reason",
    "cases = [",
    "  approval_reason('upload_file', {'path': '/tmp/a'}, ''),",
    "  approval_reason('click', {'index': 7}, '发布笔记'),",
    "  approval_reason('click', {'index': 8}, '展开详情'),",
    "]",
    "print(json.dumps(cases, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const reasons = JSON.parse(result.stdout);
  assert.match(reasons[0], /upload_file/);
  assert.match(reasons[1], /发布/);
  assert.equal(reasons[2], null);
});

runtimeTest("runner strips sentence punctuation from URL tokens without rewriting prose", () => {
  const code = [
    "import json",
    "from runner import sanitize_task_urls",
    "cases = [",
    "  sanitize_task_urls('访问 https://www.xiaohongshu.com/explore。然后查看内容'),",
    "  sanitize_task_urls('Open https://example.com/path?x=1, then inspect it'),",
    "  sanitize_task_urls('保留普通句子。不要改写'),",
    "]",
    "print(json.dumps(cases, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    "访问 https://www.xiaohongshu.com/explore 。然后查看内容",
    "Open https://example.com/path?x=1 , then inspect it",
    "保留普通句子。不要改写",
  ]);
});

runtimeTest("runner places the selected interface language in the user task", () => {
  const code = [
    "import json",
    "from runner import task_with_language_instruction",
    "print(json.dumps({",
    "  'zh': task_with_language_instruction('访问页面', 'zh-CN'),",
    "  'tw': task_with_language_instruction('瀏覽頁面', 'zh-TW'),",
    "  'en': task_with_language_instruction('Open the page', 'en'),",
    "}, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const tasks = JSON.parse(result.stdout);
  assert.match(tasks.zh, /^必须全程使用简体中文/);
  assert.match(tasks.tw, /^必須全程使用繁體中文/);
  assert.match(tasks.en, /^Use English/);
  assert.match(tasks.zh, /访问页面$/);
});

runtimeTest("runner recognizes rich editors that require a real activation click", () => {
  const code = [
    "import json",
    "from runner import requires_click_activation",
    "cases = [",
    "  requires_click_activation('p', {'contenteditable': 'true'}),",
    "  requires_click_activation('div', {'role': 'textbox'}),",
    "  requires_click_activation('textarea', {}),",
    "  requires_click_activation('input', {'type': 'text'}),",
    "]",
    "print(json.dumps(cases))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [true, true, false, false]);
});

runtimeTest("runner treats unchanged browser state as an unverified side effect", () => {
  const code = [
    "import json",
    "from runner import observable_state_changed",
    "before = {'url': 'https://example.com', 'editors': ['draft'], 'visibleText': '1 comment'}",
    "print(json.dumps({",
    "  'unchanged': observable_state_changed(before, dict(before)),",
    "  'editorCleared': observable_state_changed(before, {'url': before['url'], 'editors': [''], 'visibleText': '2 comments'}),",
    "  'navigated': observable_state_changed(before, {'url': 'https://example.com/done', 'editors': ['draft'], 'visibleText': '1 comment'}),",
    "}))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    unchanged: false,
    editorCleared: true,
    navigated: true,
  });
});

runtimeTest("runner ignores unrelated page churn while submitted editor text remains", () => {
  const code = [
    "import json",
    "from runner import observable_state_changed",
    "before = {'url': 'https://example.com/post', 'editors': [{'value': 'draft'}], 'actions': [], 'visibleText': '1 comment'}",
    "after = {'url': 'https://example.com/post', 'editors': [{'value': 'draft'}], 'actions': [], 'visibleText': '1 comment\\nOnly friends may comment'}",
    "print(json.dumps(observable_state_changed(before, after)))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout), false);
});

runtimeTest("ApprovalTools activates a rich editor before delegating input", () => {
  const code = [
    "import asyncio, json",
    "from browser_use.agent.views import ActionResult",
    "from runner import ApprovalTools",
    "class Tracker:",
    "    operation_id = 'operation-input'",
    "    def progress(self, action): pass",
    "class Node:",
    "    tag_name = 'p'",
    "    attributes = {'contenteditable': 'true'}",
    "    def get_meaningful_text_for_llm(self): return '评论'",
    "class Browser:",
    "    async def get_selector_map(self): return {7: Node()}",
    "class Action:",
    "    def model_dump(self, exclude_unset=True): return {'input': {'index': 7, 'text': 'hello'}}",
    "class HarnessTools(ApprovalTools):",
    "    def __init__(self):",
    "        super().__init__(operation_tracker=Tracker())",
    "        self.calls = []",
    "    async def _activate_rich_editor(self, node, browser_session): self.calls.append('activate')",
    "    async def _input_active_rich_editor(self, browser_session, text, clear):",
    "        self.calls.append('input-active')",
    "        return ActionResult(extracted_content='typed active editor')",
    "    async def _execute_action(self, action, browser_session, **kwargs):",
    "        self.calls.append('execute')",
    "        return ActionResult(extracted_content='typed')",
    "async def main():",
    "    tools = HarnessTools()",
    "    result = await tools.act(Action(), Browser())",
    "    print(json.dumps({'calls': tools.calls, 'error': result.error}))",
    "asyncio.run(main())",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), {
    calls: ["activate", "input-active"],
    error: null,
  });
});

runtimeTest("ApprovalTools activates an occluded rich editor with trusted coordinate mouse events", () => {
  const code = [
    "import asyncio, json",
    "from types import SimpleNamespace",
    "from runner import ApprovalTools",
    "class Tracker:",
    "    operation_id = 'operation-coordinate-activation'",
    "    def progress(self, action): pass",
    "class InputCommands:",
    "    def __init__(self, client): self.client = client",
    "    async def dispatchMouseEvent(self, params, session_id):",
    "        self.client.calls.append({'method': 'Input.dispatchMouseEvent', 'params': params, 'sessionId': session_id})",
    "class Client:",
    "    def __init__(self):",
    "        self.calls = []",
    "        self.send = SimpleNamespace(Input=InputCommands(self))",
    "class Browser:",
    "    def __init__(self):",
    "        self.client = Client()",
    "        self.session = SimpleNamespace(cdp_client=self.client, session_id='session-editor')",
    "    async def cdp_client_for_node(self, node): return self.session",
    "    async def get_element_coordinates(self, backend_node_id, session):",
    "        return SimpleNamespace(x=20, y=30, width=200, height=40)",
    "class Node:",
    "    backend_node_id = 42",
    "async def main():",
    "    browser = Browser()",
    "    await ApprovalTools(operation_tracker=Tracker())._activate_rich_editor(Node(), browser)",
    "    print(json.dumps(browser.client.calls))",
    "asyncio.run(main())",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(calls.map((call) => call.method), [
    "Input.dispatchMouseEvent",
    "Input.dispatchMouseEvent",
  ]);
  assert.deepEqual(calls.map((call) => call.params.type), [
    "mousePressed",
    "mouseReleased",
  ]);
  assert.deepEqual(calls.map((call) => call.params.buttons), [1, 0]);
  assert.deepEqual(calls.map((call) => [call.params.x, call.params.y]), [
    [120, 50],
    [120, 50],
  ]);
});

runtimeTest("ApprovalTools rejects a risky click when observable page state stays unchanged", () => {
  const code = [
    "import asyncio, io, json",
    "from browser_use.agent.views import ActionResult",
    "import runner",
    "from runner import ApprovalTools",
    "runner.uuid.uuid4 = lambda: 'approval-fixed'",
    "runner.sys.stdin = io.StringIO(json.dumps({'type': 'approval_response', 'approvalId': 'approval-fixed', 'decision': 'accept'}) + '\\n')",
    "runner.emit = lambda *args, **kwargs: None",
    "class Tracker:",
    "    operation_id = 'operation-send'",
    "    def progress(self, action): pass",
    "class Node:",
    "    tag_name = 'button'",
    "    attributes = {}",
    "    def get_meaningful_text_for_llm(self): return '发送'",
    "class Browser:",
    "    async def get_selector_map(self): return {9: Node()}",
    "class Action:",
    "    def model_dump(self, exclude_unset=True): return {'click': {'index': 9}}",
    "class HarnessTools(ApprovalTools):",
    "    def __init__(self): super().__init__(operation_tracker=Tracker())",
    "    async def _snapshot_browser_state(self, browser_session):",
    "        return {'url': 'https://example.com', 'editors': ['draft'], 'visibleText': '1 comment'}",
    "    async def _execute_action(self, action, browser_session, **kwargs):",
    "        return ActionResult(extracted_content='Clicked button \\\"发送\\\"')",
    "    async def _click_node_at_coordinates(self, node, browser_session):",
    "        return ActionResult(extracted_content='Clicked button \\\"发送\\\"')",
    "async def main():",
    "    result = await HarnessTools().act(Action(), Browser())",
    "    print(json.dumps({'error': result.error, 'content': result.extracted_content}))",
    "asyncio.run(main())",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.match(output.error, /not confirmed/i);
  assert.equal(output.content, null);
});

runtimeTest("ApprovalTools uses trusted coordinates for an approved risky click", () => {
  const code = [
    "import asyncio, io, json",
    "from browser_use.agent.views import ActionResult",
    "import runner",
    "from runner import ApprovalTools",
    "runner.uuid.uuid4 = lambda: 'approval-coordinate'",
    "runner.sys.stdin = io.StringIO(json.dumps({'type': 'approval_response', 'approvalId': 'approval-coordinate', 'decision': 'accept'}) + '\\n')",
    "runner.emit = lambda *args, **kwargs: None",
    "class Tracker:",
    "    operation_id = 'operation-send'",
    "    def progress(self, action): pass",
    "class Node:",
    "    tag_name = 'button'",
    "    attributes = {}",
    "    backend_node_id = 42",
    "    def get_meaningful_text_for_llm(self): return '发送'",
    "class Browser:",
    "    async def get_selector_map(self): return {9: Node()}",
    "class Action:",
    "    def model_dump(self, exclude_unset=True): return {'click': {'index': 9}}",
    "class HarnessTools(ApprovalTools):",
    "    def __init__(self):",
    "        super().__init__(operation_tracker=Tracker())",
    "        self.calls = []",
    "        self.states = iter([{'url': 'a', 'editors': [], 'actions': []}, {'url': 'b', 'editors': [], 'actions': []}])",
    "    async def _snapshot_browser_state(self, browser_session): return next(self.states)",
    "    async def _click_node_at_coordinates(self, node, browser_session):",
    "        self.calls.append('coordinate-click')",
    "        return ActionResult(extracted_content='clicked with coordinates')",
    "    async def _execute_action(self, action, browser_session, **kwargs):",
    "        self.calls.append('upstream-click')",
    "        return ActionResult(extracted_content='clicked')",
    "    async def _verify_side_effect(self, browser_session, before): return True, None",
    "async def main():",
    "    tools = HarnessTools()",
    "    result = await tools.act(Action(), Browser())",
    "    print(json.dumps({'calls': tools.calls, 'error': result.error}))",
    "asyncio.run(main())",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)), {
    calls: ["coordinate-click"],
    error: null,
  });
});

runtimeTest("runner uses an owner-scoped upstream BrowserSession", () => {
  const code = [
    "import json",
    "from runner import OwnerScopedBrowserSession",
    "from browser_use import BrowserSession",
    "session = OwnerScopedBrowserSession(cdp_url='http://127.0.0.1:9823', keep_alive=True, owner_tab_id='tab-owner-test')",
    "print(json.dumps({",
    "  'subclass': issubclass(OwnerScopedBrowserSession, BrowserSession),",
    "  'ownerTabId': session.owner_tab_id,",
    "  'overridesTabs': OwnerScopedBrowserSession.get_tabs is not BrowserSession.get_tabs,",
    "  'overridesPageCreation': OwnerScopedBrowserSession._cdp_create_new_page is not BrowserSession._cdp_create_new_page,",
    "}))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    subclass: true,
    ownerTabId: "tab-owner-test",
    overridesTabs: true,
    overridesPageCreation: true,
  });
});

runtimeTest("runner discovers broker-created tabs through the preload marker", async () => {
  let received = null;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = {
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        path: request.url,
      };
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ tabId: "tab_owner_1" }));
    });
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const code = [
      "import inspect",
      "from runner import OwnerScopedBrowserSession, create_owner_tab",
      "print(create_owner_tab())",
      "print(inspect.getsource(OwnerScopedBrowserSession._target_marker))",
      "print(inspect.getsource(OwnerScopedBrowserSession._wait_for_owner_target))",
    ].join("\n");
    const result = await runPython(["-c", code], {
      cwd: resources,
      env: {
        ...process.env,
        PYTHONPATH: resources,
        ONMYAGENT_BROWSER_BROKER_URL: `http://127.0.0.1:${address.port}`,
        ONMYAGENT_BROWSER_BROKER_TOKEN: "owner-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^tab_owner_1\n/);
    assert.match(result.stdout, /window\.name/);
    assert.doesNotMatch(result.stdout, /get_target_id_from_url|owner-marker/);
    assert.deepEqual(received, {
      authorization: "Bearer owner-token",
      body: { url: "about:blank" },
      path: "/v1/tabs",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

runtimeTest("runner exposes narration and operation events without private thinking", () => {
  const code = [
    "import json",
    "from runner import build_step_events",
    "output = {",
    "  'thinking': 'private chain of thought',",
    "  'memory': 'private working memory',",
    "  'evaluation_previous_goal': 'The previous navigation succeeded',",
    "  'next_goal': 'Open the target page and verify its title',",
    "  'action': [",
    "    {'go_to_url': {'url': 'https://example.com'}},",
    "    {'wait': {'seconds': 2}},",
    "  ],",
    "}",
    "events = build_step_events(",
    "  output,",
    "  step=3,",
    "  operation_id='operation-3',",
    "  url='about:blank',",
    "  title='New Tab',",
    ")",
    "print(json.dumps(events, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const events = JSON.parse(result.stdout);
  assert.deepEqual(events, [
    {
      type: "model_update",
      step: 3,
      evaluation: "The previous navigation succeeded",
      nextGoal: "Open the target page and verify its title",
      actions: [
        { name: "go_to_url", params: { url: "https://example.com" } },
        { name: "wait", params: { seconds: 2 } },
      ],
      raw: {
        evaluationPreviousGoal: "The previous navigation succeeded",
        nextGoal: "Open the target page and verify its title",
        actions: [
          { name: "go_to_url", params: { url: "https://example.com" } },
          { name: "wait", params: { seconds: 2 } },
        ],
      },
    },
    {
      type: "narration",
      step: 3,
      text: "Open the target page and verify its title",
      nextGoal: "Open the target page and verify its title",
    },
    {
      type: "operation_started",
      operationId: "operation-3",
      step: 3,
      actions: [
        { name: "go_to_url", params: { url: "https://example.com" } },
        { name: "wait", params: { seconds: 2 } },
      ],
      actionCount: 2,
      url: "about:blank",
      title: "New Tab",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private chain of thought|private working memory|thinking|memory/);
});

runtimeTest("runner constrains public progress to the selected interface language", () => {
  const code = [
    "import json",
    "from runner import public_progress_instruction",
    "print(json.dumps({",
    "  'zh': public_progress_instruction('zh'),",
    "  'tw': public_progress_instruction('zh-TW'),",
    "  'en': public_progress_instruction('en'),",
    "}, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const instructions = JSON.parse(result.stdout);
  assert.match(instructions.zh, /简体中文/);
  assert.match(instructions.tw, /繁體中文/);
  assert.match(instructions.en, /English/);
  assert.match(instructions.zh, /next_goal/);
  assert.match(instructions.zh, /evaluation_previous_goal/);
  assert.match(instructions.zh, /private reasoning/i);
  assert.match(instructions.zh, /collapsed comment boxes/i);
  assert.match(instructions.zh, /verify an observable page-state change/i);
});

runtimeTest("runner emits a public diagnostic when a model call fails", () => {
  const source = spawnSync(python, ["-c", [
    "import inspect",
    "from runner import EventingChatModel",
    "print(inspect.getsource(EventingChatModel.ainvoke))",
  ].join("\n")], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(source.status, 0, source.stderr);
  assert.match(source.stdout, /emit\("model_error"/);
  assert.match(source.stdout, /raise/);
});

runtimeTest("runner skips the redundant upstream judge after the agent reports done", () => {
  const source = spawnSync(python, ["-c", [
    "import inspect",
    "from runner import run_agent",
    "print(inspect.getsource(run_agent))",
  ].join("\n")], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(source.status, 0, source.stderr);
  assert.match(source.stdout, /use_judge=False/);
});

runtimeTest("runner tracks one complete operation batch with progress and result", () => {
  const code = [
    "import json",
    "from runner import OperationEventTracker",
    "events = []",
    "tracker = OperationEventTracker(events.append, operation_id_factory=lambda step: f'operation-{step}')",
    "tracker.start(",
    "  {'next_goal': 'Navigate and inspect', 'action': [{'go_to_url': {'url': 'https://example.com'}}]},",
    "  step=4,",
    "  url='about:blank',",
    "  title='New Tab',",
    "  observation_source='hybrid',",
    ")",
    "tracker.progress({'go_to_url': {'url': 'https://example.com'}})",
    "tracker.complete(",
    "  [{'extracted_content': 'Opened Example Domain', 'error': None, 'is_done': False}],",
    "  url='https://example.com',",
    "  title='Example Domain',",
    ")",
    "print(json.dumps(events, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const events = JSON.parse(result.stdout);
  assert.deepEqual(events.map((event) => event.type), [
    "model_update",
    "narration",
    "operation_started",
    "operation_progress",
    "operation_completed",
  ]);
  assert.deepEqual(events.slice(2).map((event) => event.operationId), [
    "operation-4",
    "operation-4",
    "operation-4",
  ]);
  assert.equal(events[3].observationSource, "hybrid");
  assert.deepEqual(events[3].action, {
    name: "go_to_url",
    params: { url: "https://example.com" },
  });
  assert.equal(events[4].success, true);
  assert.equal(events[4].url, "https://example.com");
  assert.equal(events[4].title, "Example Domain");
  assert.deepEqual(events[4].results, [{
    extractedContent: "Opened Example Domain",
    error: null,
    isDone: false,
    success: null,
  }]);
});
