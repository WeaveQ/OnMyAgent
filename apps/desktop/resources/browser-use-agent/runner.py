#!/usr/bin/env python3
"""JSONL runner for the upstream Browser Use Agent."""

import argparse
import asyncio
import json
import os
import sys

from browser_use import Agent, BrowserSession

from onmyagent_chat_model import OnMyAgentChatModel


def emit(event_type, **payload):
    print(json.dumps({"type": event_type, **payload}, ensure_ascii=False), flush=True)


def json_value(value):
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    return value


async def run_agent(request):
    task = str(request.get("task") or "").strip()
    if not task:
        raise ValueError("task is required")
    cdp_url = os.environ.get("BU_CDP_URL", "").strip()
    if not cdp_url:
        raise RuntimeError("BU_CDP_URL is required")

    browser = BrowserSession(cdp_url=cdp_url, keep_alive=True)
    llm = OnMyAgentChatModel()

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
