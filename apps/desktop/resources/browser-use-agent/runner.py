#!/usr/bin/env python3
"""JSONL runner for the upstream Browser Use Agent."""

import argparse
import asyncio
import json
import os
import re
import sys
import uuid
import urllib.request

from browser_use import Agent, BrowserSession
from browser_use.agent.views import ActionResult
from browser_use.browser.events import ClickElementEvent
from browser_use.tools.service import Tools
from pydantic import PrivateAttr

from onmyagent_chat_model import OnMyAgentChatModel


WRITE_ACTIONS = {
    "upload_file",
    "download_file",
    "send_email",
    "delete_file",
}
RISK_WORDS = (
    "publish", "send", "submit", "purchase", "buy", "pay", "delete", "download",
    "发布", "发送", "提交", "购买", "支付", "删除", "下载",
)
URL_TRAILING_PUNCTUATION = "。．，,；;：！!、"
URL_WITH_ATTACHED_PUNCTUATION = re.compile(
    rf"(https?://[^\s<>\"']*?)([{re.escape(URL_TRAILING_PUNCTUATION)}])"
)


def sanitize_task_urls(task):
    return URL_WITH_ATTACHED_PUNCTUATION.sub(r"\1 \2", str(task or ""))


def task_with_language_instruction(task, language):
    instruction = {
        "zh": "必须全程使用简体中文输出所有用户可见的进度、状态和最终答复。",
        "zh-CN": "必须全程使用简体中文输出所有用户可见的进度、状态和最终答复。",
        "zh-TW": "必須全程使用繁體中文輸出所有使用者可見的進度、狀態和最終答覆。",
        "en": "Use English for all user-visible progress, status updates, and the final answer.",
    }.get(str(language or "").strip(), "Use English for all user-visible progress, status updates, and the final answer.")
    return f"{instruction}\n\n{task}"


def requires_click_activation(tag_name, attributes):
    tag = str(tag_name or "").lower()
    attrs = attributes if isinstance(attributes, dict) else {}
    return (
        attrs.get("contenteditable") in ("true", "")
        or (attrs.get("role") == "textbox" and tag not in ("input", "textarea"))
    )


def observable_state_changed(before, after):
    if before.get("url") != after.get("url"):
        return True

    def editor_values(snapshot):
        values = []
        for editor in snapshot.get("editors") or []:
            value = editor.get("value") if isinstance(editor, dict) else editor
            values.append(str(value or "").strip())
        return values

    before_editor_values = editor_values(before)
    after_editor_values = editor_values(after)
    submitted_values = {value for value in before_editor_values if value}
    if submitted_values and submitted_values.intersection(after_editor_values):
        return False
    if before_editor_values != after_editor_values:
        return True
    return before.get("actions") != after.get("actions")


def new_page_feedback(before, after):
    before_lines = {
        line.strip() for line in str(before.get("visibleText") or "").splitlines()
        if line.strip()
    }
    new_lines = [
        line.strip() for line in str(after.get("visibleText") or "").splitlines()
        if line.strip() and line.strip() not in before_lines
    ]
    return new_lines[-1] if new_lines else None


def public_progress_instruction(language):
    language_name = {
        "zh": "简体中文",
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        "en": "English",
    }.get(str(language or "").strip(), "English")
    return (
        f"Write every user-visible evaluation_previous_goal, next_goal, and final answer in {language_name}. "
        "Keep evaluation_previous_goal and next_goal concise and focused on observable browser work. "
        "Never expose private reasoning, chain of thought, memory, or hidden analysis. "
        "Treat collapsed comment boxes, rich-text placeholders, and contenteditable editors as interactive widgets: "
        "click the visible entry first, wait and observe the expanded editor, then input text. "
        "After send, publish, submit, purchase, delete, or download actions, verify an observable page-state change. "
        "If the page did not change, report the action as unconfirmed and change strategy instead of repeating the same click."
    )


def approval_reason(action_name, params, element_text):
    if action_name in WRITE_ACTIONS:
        return f"Browser action {action_name} changes external state"
    searchable = " ".join((action_name, json.dumps(params, ensure_ascii=False), element_text)).lower()
    matched = next((word for word in RISK_WORDS if word in searchable), None)
    if action_name == "click" and matched:
        return f"Browser click may trigger external side effect: {matched}"
    return None


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def json_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    return value


def build_step_events(output, *, step, operation_id, url=None, title=None):
    public_output = json_value(output)
    if not isinstance(public_output, dict):
        public_output = {}
    current_state = json_value(public_output.get("current_state"))
    if not isinstance(current_state, dict):
        current_state = public_output
    evaluation = str(current_state.get("evaluation_previous_goal") or "").strip()
    next_goal = str(current_state.get("next_goal") or "").strip()
    actions = []
    for raw_action in public_output.get("action") or current_state.get("action") or []:
        action = json_value(raw_action)
        if not isinstance(action, dict):
            continue
        for name, params in action.items():
            if params is not None:
                actions.append({"name": name, "params": json_value(params)})
                break
    model_update = {
        "evaluationPreviousGoal": evaluation,
        "nextGoal": next_goal,
        "actions": actions,
    }
    events = [{
        "type": "model_update",
        "step": step,
        "evaluation": evaluation,
        "nextGoal": next_goal,
        "actions": actions,
        "raw": model_update,
    }]
    if next_goal:
        events.append({
            "type": "narration",
            "step": step,
            "text": next_goal,
            "nextGoal": next_goal,
        })
    events.append({
        "type": "operation_started",
        "operationId": operation_id,
        "step": step,
        "actions": actions,
        "actionCount": len(actions),
        "url": url,
        "title": title,
    })
    return events


def _emit_public_event(event):
    event_payload = dict(event)
    event_type = event_payload.pop("type")
    emit(event_type, **event_payload)


def _public_action(action):
    action_value = json_value(action)
    if not isinstance(action_value, dict):
        return {"name": "unknown", "params": None}
    for name, params in action_value.items():
        if params is not None:
            return {"name": name, "params": json_value(params)}
    return {"name": "unknown", "params": None}


def _public_result(result):
    result_value = json_value(result)
    if not isinstance(result_value, dict):
        result_value = {}
    return {
        "extractedContent": result_value.get("extracted_content"),
        "error": result_value.get("error"),
        "isDone": bool(result_value.get("is_done", False)),
        "success": result_value.get("success"),
    }


class OperationEventTracker:
    def __init__(self, event_sink=_emit_public_event, operation_id_factory=None):
        self._event_sink = event_sink
        self._operation_id_factory = operation_id_factory or (
            lambda step: f"operation-{step}-{uuid.uuid4().hex}"
        )
        self._active = None

    @property
    def operation_id(self):
        return self._active["operationId"] if self._active else None

    def start(self, output, *, step, url=None, title=None, observation_source="hybrid"):
        operation_id = self._operation_id_factory(step)
        self._active = {
            "operationId": operation_id,
            "step": step,
            "observationSource": observation_source,
        }
        for event in build_step_events(
            output,
            step=step,
            operation_id=operation_id,
            url=url,
            title=title,
        ):
            self._event_sink(event)
        return operation_id

    def progress(self, action):
        if not self._active:
            return
        self._event_sink({
            "type": "operation_progress",
            **self._active,
            "action": _public_action(action),
        })

    def complete(self, results, *, url=None, title=None, error=None):
        if not self._active:
            return
        public_results = [_public_result(result) for result in (results or [])]
        success = error is None and all(
            result["error"] is None and result["success"] is not False
            for result in public_results
        )
        self._event_sink({
            "type": "operation_completed",
            "operationId": self._active["operationId"],
            "step": self._active["step"],
            "results": public_results,
            "success": success,
            "url": url,
            "title": title,
            "error": str(error) if error else None,
        })
        self._active = None


def create_owner_tab():
    broker_url = os.environ.get("ONMYAGENT_BROWSER_BROKER_URL", "").rstrip("/")
    broker_token = os.environ.get("ONMYAGENT_BROWSER_BROKER_TOKEN", "")
    if not broker_url or not broker_token:
        raise RuntimeError("Browser owner broker is required")
    request = urllib.request.Request(
        f"{broker_url}/v1/tabs",
        data=json.dumps({"url": "about:blank"}).encode("utf8"),
        headers={
            "Authorization": f"Bearer {broker_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 201:
            raise RuntimeError("Browser owner tab creation failed")
        created = json.loads(response.read().decode("utf8"))
    tab_id = str(created.get("tabId") or "").strip()
    if not tab_id:
        raise RuntimeError("Browser owner tab id is missing")
    return tab_id


class OwnerScopedBrowserSession(BrowserSession):
    _owner_tab_id: str = PrivateAttr()
    _owner_target_ids: set[str] = PrivateAttr(default_factory=set)
    _scope_ready: bool = PrivateAttr(default=False)

    def __init__(self, *, owner_tab_id: str, **kwargs):
        super().__init__(**kwargs)
        self._owner_tab_id = owner_tab_id

    @property
    def owner_tab_id(self):
        return self._owner_tab_id

    async def _target_marker(self, target_id):
        try:
            session = await self.get_or_create_cdp_session(
                target_id=target_id,
                focus=False,
            )
            result = await session.cdp_client.send.Runtime.evaluate(
                params={"expression": "window.name", "returnByValue": True},
                session_id=session.session_id,
            )
            return result.get("result", {}).get("value")
        except Exception:
            return None

    async def _wait_for_owner_target(self, tab_id):
        marker = f"onmyagent-browser:{tab_id}"
        for _ in range(100):
            targets = self.session_manager.get_all_targets() if self.session_manager else {}
            for target_id, target in targets.items():
                if target.target_type not in ("page", "tab"):
                    continue
                if await self._target_marker(target_id) == marker:
                    return target_id
            await asyncio.sleep(0.05)
        raise RuntimeError("Owner browser tab did not appear in CDP")

    async def start(self):
        await super().start()
        target_id = await self._wait_for_owner_target(self.owner_tab_id)
        self._owner_target_ids.add(target_id)
        await self.get_or_create_cdp_session(target_id=target_id, focus=True)
        self._scope_ready = True

    async def get_tabs(self):
        tabs = await super().get_tabs()
        if not self._scope_ready:
            return tabs
        return [tab for tab in tabs if tab.target_id in self._owner_target_ids]

    async def _cdp_create_new_page(self, url="about:blank", background=False, new_window=False):
        tab_id = await asyncio.to_thread(create_owner_tab)
        target_id = await self._wait_for_owner_target(tab_id)
        self._owner_target_ids.add(target_id)
        if url != "about:blank":
            session = await self.get_or_create_cdp_session(target_id=target_id, focus=not background)
            await session.cdp_client.send.Page.navigate(
                params={"url": url},
                session_id=session.session_id,
            )
        return target_id

    async def _cdp_close_page(self, target_id):
        if self._scope_ready and target_id not in self._owner_target_ids:
            raise RuntimeError("Cross-owner tab close was blocked")
        await super()._cdp_close_page(target_id)
        self._owner_target_ids.discard(target_id)


class ApprovalTools(Tools):
    def __init__(self, *, operation_tracker):
        super().__init__()
        self._operation_tracker = operation_tracker

    async def _execute_action(self, action, browser_session, **kwargs):
        return await super().act(action, browser_session, **kwargs)

    async def _click_node_at_coordinates(self, node, browser_session):
        session = await browser_session.cdp_client_for_node(node)
        coordinates = await browser_session.get_element_coordinates(
            node.backend_node_id,
            session,
        )
        if coordinates is None:
            event = browser_session.event_bus.dispatch(ClickElementEvent(node=node))
            await event
            await event.event_result(raise_if_any=True, raise_if_none=False)
            await asyncio.sleep(0.2)
            return ActionResult(extracted_content="Clicked page element")
        x = coordinates.x + coordinates.width / 2
        y = coordinates.y + coordinates.height / 2
        for event_type, buttons in (("mousePressed", 1), ("mouseReleased", 0)):
            await session.cdp_client.send.Input.dispatchMouseEvent(
                params={
                    "type": event_type,
                    "x": x,
                    "y": y,
                    "button": "left",
                    "buttons": buttons,
                    "clickCount": 1,
                },
                session_id=session.session_id,
            )
        await asyncio.sleep(0.2)
        return ActionResult(extracted_content="Clicked page element with trusted coordinates")

    async def _activate_rich_editor(self, node, browser_session):
        await self._click_node_at_coordinates(node, browser_session)

    async def _input_active_rich_editor(self, browser_session, text, clear):
        target_id = browser_session.agent_focus_target_id
        if not target_id:
            return ActionResult(error="Rich editor input has no active browser target")
        session = await browser_session.get_or_create_cdp_session(
            target_id=target_id,
            focus=True,
        )
        focus_result = await session.cdp_client.send.Runtime.evaluate(
            params={
                "expression": """
                    (() => {
                        const element = document.activeElement;
                        const editable = element && (
                            element.isContentEditable
                            || element.tagName === 'INPUT'
                            || element.tagName === 'TEXTAREA'
                            || element.getAttribute('role') === 'textbox'
                        );
                        if (!editable) return { editable: false };
                        if ('select' in element && typeof element.select === 'function') {
                            element.select();
                        } else {
                            const selection = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(element);
                            selection.removeAllRanges();
                            selection.addRange(range);
                        }
                        return {
                            editable: true,
                            tag: element.tagName,
                            value: 'value' in element ? element.value : element.textContent,
                        };
                    })()
                """,
                "returnByValue": True,
            },
            session_id=session.session_id,
        )
        focus_state = focus_result.get("result", {}).get("value") or {}
        if not focus_state.get("editable"):
            return ActionResult(
                error="Rich editor activation did not focus the expanded editor"
            )
        if clear:
            for event_type in ("keyDown", "keyUp"):
                await session.cdp_client.send.Input.dispatchKeyEvent(
                    params={
                        "type": event_type,
                        "key": "Backspace",
                        "code": "Backspace",
                        "windowsVirtualKeyCode": 8,
                    },
                    session_id=session.session_id,
                )
        await session.cdp_client.send.Input.insertText(
            params={"text": text},
            session_id=session.session_id,
        )
        await asyncio.sleep(0.1)
        readback_result = await session.cdp_client.send.Runtime.evaluate(
            params={
                "expression": """
                    (() => {
                        const element = document.activeElement;
                        if (!element) return null;
                        return 'value' in element ? element.value : element.textContent;
                    })()
                """,
                "returnByValue": True,
            },
            session_id=session.session_id,
        )
        actual_value = readback_result.get("result", {}).get("value")
        if actual_value != text:
            return ActionResult(
                error=(
                    "Rich editor input was not confirmed: "
                    f"expected {text!r}, got {actual_value!r}"
                )
            )
        return ActionResult(
            extracted_content=f"Typed {text!r} into the active rich editor",
            metadata={"actual_value": actual_value},
        )

    async def _snapshot_browser_state(self, browser_session):
        target_id = browser_session.agent_focus_target_id
        if not target_id:
            raise RuntimeError("Browser side-effect verification has no active target")
        session = await browser_session.get_or_create_cdp_session(
            target_id=target_id,
            focus=False,
        )
        result = await session.cdp_client.send.Runtime.evaluate(
            params={
                "expression": """
                    (() => {
                        const visible = (element) => {
                            const style = getComputedStyle(element);
                            const rect = element.getBoundingClientRect();
                            return style.visibility !== 'hidden' && style.display !== 'none'
                                && rect.width > 0 && rect.height > 0;
                        };
                        const editors = [...document.querySelectorAll(
                            'input:not([type=hidden]), textarea, [contenteditable=true], [role=textbox]'
                        )].filter(visible).map((element) => ({
                            tag: element.tagName,
                            value: 'value' in element ? element.value : element.textContent,
                            disabled: Boolean(element.disabled),
                            ariaDisabled: element.getAttribute('aria-disabled'),
                        }));
                        const actions = [...document.querySelectorAll('button, [role=button]')]
                            .filter(visible)
                            .map((element) => ({
                                text: (element.innerText || element.textContent || '').trim(),
                                disabled: Boolean(element.disabled),
                                ariaDisabled: element.getAttribute('aria-disabled'),
                                ariaPressed: element.getAttribute('aria-pressed'),
                                className: typeof element.className === 'string' ? element.className : '',
                            }));
                        return {
                            url: location.href,
                            editors,
                            actions,
                            visibleText: (document.body?.innerText || '').slice(-6000),
                        };
                    })()
                """,
                "returnByValue": True,
            },
            session_id=session.session_id,
        )
        snapshot = result.get("result", {}).get("value")
        if not isinstance(snapshot, dict):
            raise RuntimeError("Browser side-effect verification returned no page state")
        return snapshot

    async def _verify_side_effect(self, browser_session, before):
        last_after = before
        for delay in (0.25, 0.5, 1.0, 1.5):
            await asyncio.sleep(delay)
            after = await self._snapshot_browser_state(browser_session)
            last_after = after
            if observable_state_changed(before, after):
                return True, None
        return False, new_page_feedback(before, last_after)

    async def act(self, action, browser_session, **kwargs):
        self._operation_tracker.progress(action)
        action_data = action.model_dump(exclude_unset=True)
        rich_editor_node = None
        rich_editor_input = None
        risky_click = False
        risky_click_node = None
        for action_name, params in action_data.items():
            if params is None:
                continue
            element_text = ""
            index = params.get("index") if isinstance(params, dict) else None
            if isinstance(index, int):
                selector_map = await browser_session.get_selector_map()
                node = selector_map.get(index)
                if node is not None:
                    element_text = node.get_meaningful_text_for_llm()
                    if action_name == "input" and requires_click_activation(
                        node.tag_name,
                        node.attributes,
                    ):
                        rich_editor_node = node
                        rich_editor_input = {
                            "text": str(params.get("text") or ""),
                            "clear": params.get("clear", True) is not False,
                        }
            reason = approval_reason(action_name, params, element_text)
            if not reason:
                continue
            risky_click = action_name == "click"
            risky_click_node = node
            approval_id = str(uuid.uuid4())
            emit(
                "approval",
                approvalId=approval_id,
                operationId=self._operation_tracker.operation_id,
                action={action_name: json_value(params)},
                summary=reason,
                elementText=element_text[:200],
            )
            response = await asyncio.to_thread(sys.stdin.readline)
            command = json.loads(response) if response else {}
            accepted = (
                command.get("type") == "approval_response"
                and command.get("approvalId") == approval_id
                and command.get("decision") == "accept"
            )
            emit(
                "approval_resolved",
                approvalId=approval_id,
                operationId=self._operation_tracker.operation_id,
                decision="accept" if accepted else "reject",
            )
            if not accepted:
                return ActionResult(error=f"User rejected action: {action_name}")
        emit("phase", phase="acting")
        if rich_editor_node is not None:
            await self._activate_rich_editor(rich_editor_node, browser_session)
        before = await self._snapshot_browser_state(browser_session) if risky_click else None
        if rich_editor_input is not None:
            result = await self._input_active_rich_editor(
                browser_session,
                rich_editor_input["text"],
                rich_editor_input["clear"],
            )
        elif risky_click_node is not None:
            result = await self._click_node_at_coordinates(
                risky_click_node,
                browser_session,
            )
        else:
            result = await self._execute_action(action, browser_session, **kwargs)
        emit("phase", phase="verifying")
        if risky_click and not getattr(result, "error", None):
            verified, feedback = await self._verify_side_effect(browser_session, before)
            if not verified:
                feedback_suffix = f" Page feedback: {feedback}." if feedback else ""
                return ActionResult(
                    error=(
                        "Browser side effect was not confirmed: the page state did not change after the approved click. "
                        f"{feedback_suffix} "
                        "Re-observe the page and report a blocking page message instead of repeating the same click."
                    )
                )
        return result


class EventingChatModel(OnMyAgentChatModel):
    async def ainvoke(self, messages, output_format, **kwargs):
        emit("phase", phase="planning")
        try:
            return await super().ainvoke(messages, output_format, **kwargs)
        except Exception as error:
            emit("model_error", errorType=type(error).__name__, error=str(error))
            raise


class EventingAgent(Agent):
    def __init__(self, *args, operation_tracker, **kwargs):
        self._operation_tracker = operation_tracker
        super().__init__(*args, **kwargs)

    async def _execute_actions(self):
        try:
            await super()._execute_actions()
            url = await self.browser_session.get_current_page_url()
            title = await self.browser_session.get_current_page_title()
            self._operation_tracker.complete(self.state.last_result, url=url, title=title)
        except Exception as error:
            self._operation_tracker.complete([], error=error)
            raise


async def run_agent(request):
    task = sanitize_task_urls(str(request.get("task") or "").strip())
    if not task:
        raise ValueError("task is required")
    task = task_with_language_instruction(task, request.get("language"))
    cdp_url = os.environ.get("BU_CDP_URL", "").strip()
    if not cdp_url:
        raise RuntimeError("BU_CDP_URL is required")

    owner_tab_id = await asyncio.to_thread(create_owner_tab)
    browser = OwnerScopedBrowserSession(
        cdp_url=cdp_url,
        keep_alive=True,
        owner_tab_id=owner_tab_id,
    )
    llm = EventingChatModel()
    operation_tracker = OperationEventTracker()
    tools = ApprovalTools(operation_tracker=operation_tracker)

    async def on_step(state, output, step):
        operation_tracker.start(
            output,
            step=step,
            url=getattr(state, "url", None),
            title=getattr(state, "title", None),
            observation_source="hybrid" if request.get("useVision", "auto") != False else "dom",
        )

    agent = EventingAgent(
        task=task,
        llm=llm,
        tools=tools,
        operation_tracker=operation_tracker,
        browser_session=browser,
        use_vision=request.get("useVision", "auto"),
        max_actions_per_step=int(request.get("maxActionsPerStep") or 3),
        register_new_step_callback=on_step,
        use_judge=False,
        generate_gif=False,
        calculate_cost=False,
        extend_system_message=public_progress_instruction(request.get("language")),
    )
    emit("ready", agentClass="browser_use.Agent", model=llm.model, phase="observing")
    try:
        history = await agent.run(max_steps=int(request.get("maxSteps") or 50))
        final_result = history.final_result() if hasattr(history, "final_result") else None
        if final_result is None or (isinstance(final_result, str) and not final_result.strip()):
            raise RuntimeError("Browser Use Agent ended without a final result")
        emit("done", result=final_result)
    finally:
        await browser.stop()


def describe():
    print(json.dumps({
        "agentClass": "browser_use.Agent",
        "browserClass": "browser_use.BrowserSession",
        "modelClass": "OnMyAgentChatModel",
        "protocol": "jsonl-v1",
    }))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--describe", action="store_true")
    args = parser.parse_args()
    if args.describe:
        describe()
        return
    try:
        request = json.loads(sys.stdin.readline())
        asyncio.run(run_agent(request))
    except Exception as error:
        emit("error", error=str(error), errorType=type(error).__name__)
        raise


if __name__ == "__main__":
    main()
