#!/usr/bin/env python3
"""JSONL runner for the upstream Browser Use Agent."""

import argparse
import asyncio
import json
import os
import sys
import uuid
import urllib.request

from browser_use import Agent, BrowserSession
from browser_use.agent.views import ActionResult
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


def create_owner_tab():
    broker_url = os.environ.get("ONMYAGENT_BROWSER_BROKER_URL", "").rstrip("/")
    broker_token = os.environ.get("ONMYAGENT_BROWSER_BROKER_TOKEN", "")
    if not broker_url or not broker_token:
        raise RuntimeError("Browser owner broker is required")
    marker_url = f"about:blank#onmyagent-browser-use-{uuid.uuid4().hex}"
    request = urllib.request.Request(
        f"{broker_url}/v1/tabs",
        data=json.dumps({"url": marker_url}).encode("utf8"),
        headers={
            "Authorization": f"Bearer {broker_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 201:
            raise RuntimeError("Browser owner tab creation failed")
    return marker_url


class OwnerScopedBrowserSession(BrowserSession):
    owner_marker_url: str
    _owner_target_ids: set[str] = PrivateAttr(default_factory=set)
    _scope_ready: bool = PrivateAttr(default=False)

    async def _wait_for_owner_target(self, marker_url):
        for _ in range(100):
            try:
                return await self.get_target_id_from_url(marker_url)
            except ValueError:
                await asyncio.sleep(0.05)
        raise RuntimeError("Owner browser tab did not appear in CDP")

    async def start(self):
        await super().start()
        target_id = await self._wait_for_owner_target(self.owner_marker_url)
        self._owner_target_ids.add(target_id)
        await self.get_or_create_cdp_session(target_id=target_id, focus=True)
        self._scope_ready = True

    async def get_tabs(self):
        tabs = await super().get_tabs()
        if not self._scope_ready:
            return tabs
        return [tab for tab in tabs if tab.target_id in self._owner_target_ids]

    async def _cdp_create_new_page(self, url="about:blank", background=False, new_window=False):
        marker_url = await asyncio.to_thread(create_owner_tab)
        target_id = await self._wait_for_owner_target(marker_url)
        self._owner_target_ids.add(target_id)
        if url != marker_url:
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
    async def act(self, action, browser_session, **kwargs):
        action_data = action.model_dump(exclude_unset=True)
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
            reason = approval_reason(action_name, params, element_text)
            if not reason:
                continue
            approval_id = str(uuid.uuid4())
            emit(
                "approval",
                approvalId=approval_id,
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
            if not accepted:
                return ActionResult(error=f"User rejected action: {action_name}")
        return await super().act(action, browser_session, **kwargs)


async def run_agent(request):
    task = str(request.get("task") or "").strip()
    if not task:
        raise ValueError("task is required")
    cdp_url = os.environ.get("BU_CDP_URL", "").strip()
    if not cdp_url:
        raise RuntimeError("BU_CDP_URL is required")

    marker_url = await asyncio.to_thread(create_owner_tab)
    browser = OwnerScopedBrowserSession(
        cdp_url=cdp_url,
        keep_alive=True,
        owner_marker_url=marker_url,
    )
    llm = OnMyAgentChatModel()
    tools = ApprovalTools()

    async def on_step(state, output, step):
        emit(
            "step",
            step=step,
            url=getattr(state, "url", None),
            title=getattr(state, "title", None),
            output=json_value(output),
        )

    agent = Agent(
        task=task,
        llm=llm,
        tools=tools,
        browser_session=browser,
        use_vision=request.get("useVision", "auto"),
        max_actions_per_step=int(request.get("maxActionsPerStep") or 3),
        register_new_step_callback=on_step,
        generate_gif=False,
        calculate_cost=False,
    )
    emit("ready", agentClass="browser_use.Agent", model=llm.model)
    try:
        history = await agent.run(max_steps=int(request.get("maxSteps") or 50))
        final_result = history.final_result() if hasattr(history, "final_result") else None
        emit("done", result=final_result, history=json_value(history))
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
