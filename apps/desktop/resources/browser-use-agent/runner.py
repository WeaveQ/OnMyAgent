#!/usr/bin/env python3
"""JSONL runner for the upstream Browser Use Agent."""

import argparse
import asyncio
import json
import os
import sys
import uuid

from browser_use import Agent, BrowserSession
from browser_use.agent.views import ActionResult
from browser_use.tools.service import Tools

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

    browser = BrowserSession(cdp_url=cdp_url, keep_alive=True)
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
