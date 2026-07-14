"""Browser Use LLM adapter backed by the local OnMyAgent model gateway."""

import asyncio
import json
import os
import urllib.error
import urllib.request

from browser_use.llm.views import ChatInvokeCompletion, ChatInvokeUsage


class OnMyAgentChatModel:
    _verified_api_keys = True

    def __init__(self):
        self.model = os.environ.get("ONMYAGENT_BROWSER_USE_MODEL", "onmyagent-selected-model")
        self._url = os.environ.get("ONMYAGENT_MODEL_GATEWAY_URL", "").rstrip("/")
        self._token = os.environ.get("ONMYAGENT_MODEL_GATEWAY_TOKEN", "")
        if not self._url or not self._token:
            raise RuntimeError("OnMyAgent model gateway environment is unavailable")

    @property
    def provider(self):
        return "onmyagent"

    @property
    def name(self):
        return self.model

    @property
    def model_name(self):
        return self.model

    def _invoke(self, messages, output_format):
        payload = {
            "messages": [message.model_dump(mode="json", exclude_none=True) for message in messages],
        }
        if output_format is not None:
            payload["outputSchema"] = output_format.model_json_schema()
        request = urllib.request.Request(
            f"{self._url}/v1/invoke",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OnMyAgent model gateway returned HTTP {error.code}: {detail}") from error

    async def ainvoke(self, messages, output_format=None, **_kwargs):
        response = await asyncio.to_thread(self._invoke, messages, output_format)
        value = response.get("value")
        completion = output_format.model_validate(value) if output_format is not None else str(value or "")
        raw_usage = response.get("usage") or {}
        prompt_tokens = int(raw_usage.get("inputTokens") or 0)
        completion_tokens = int(raw_usage.get("outputTokens") or 0)
        usage = ChatInvokeUsage(
            prompt_tokens=prompt_tokens,
            prompt_cached_tokens=None,
            prompt_cache_creation_tokens=None,
            prompt_cache_creation_5m_tokens=None,
            prompt_cache_creation_1h_tokens=None,
            prompt_image_tokens=None,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )
        return ChatInvokeCompletion(
            completion=completion,
            usage=usage,
            stop_reason="end_turn",
        )
