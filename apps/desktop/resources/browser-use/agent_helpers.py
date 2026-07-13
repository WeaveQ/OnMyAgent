"""OnMyAgent embedded-browser bindings for browser-harness."""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from browser_harness import helpers as _core


_MARKER_PREFIX = "onmyagent-browser:"


def _broker_request(method, route, payload=None):
    base_url = os.environ.get("ONMYAGENT_BROWSER_BROKER_URL", "").rstrip("/")
    token = os.environ.get("ONMYAGENT_BROWSER_BROKER_TOKEN", "")
    if not base_url or not token:
        raise RuntimeError("OnMyAgent Browser Broker environment is unavailable")
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{route}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"OnMyAgent Browser Broker returned HTTP {error.code}: {detail}"
        ) from error


def list_onmyagent_tabs():
    return _broker_request("GET", "/v1/tabs").get("tabs", [])


def _target_marker(target_id):
    try:
        return _core.js("window.name", target_id=target_id)
    except Exception:
        return None


def _target_for_tab(tab_id, timeout=10.0):
    marker = f"{_MARKER_PREFIX}{tab_id}"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for target in _core.list_tabs(include_chrome=False):
            target_id = target.get("targetId") or target.get("target_id")
            if target_id and _target_marker(target_id) == marker:
                return target
        time.sleep(0.05)
    raise RuntimeError(f"Embedded browser target was not found for tab {tab_id}")


def switch_onmyagent_tab(tab_id):
    encoded = urllib.parse.quote(str(tab_id), safe="")
    _broker_request("POST", f"/v1/tabs/{encoded}/select")
    target = _target_for_tab(tab_id)
    _core.switch_tab(target)
    return target


def new_tab(url="about:blank"):
    created = _broker_request("POST", "/v1/tabs", {"url": url, "select": True})
    target = _target_for_tab(created["tabId"])
    _core.switch_tab(target)
    if url != "about:blank":
        _core.wait_for_load()
    return target.get("targetId") or target.get("target_id")


def ensure_real_tab():
    owned_tabs = list_onmyagent_tabs()
    owned_ids = {tab.get("tabId") for tab in owned_tabs}
    try:
        current = _core.current_tab()
        marker = _core.js("window.name")
        if isinstance(marker, str) and marker.startswith(_MARKER_PREFIX):
            if marker[len(_MARKER_PREFIX) :] in owned_ids:
                return current
    except Exception:
        pass
    if not owned_tabs:
        new_tab()
        return _core.current_tab()
    preferred = next((tab for tab in owned_tabs if tab.get("isActive")), owned_tabs[0])
    return switch_onmyagent_tab(preferred["tabId"])


def close_tab(target=None):
    if target is None:
        target_id = _core.current_tab().get("targetId")
    elif isinstance(target, dict):
        target_id = target.get("targetId") or target.get("target_id")
    else:
        target_id = target
    marker = _target_marker(target_id)
    if not isinstance(marker, str) or not marker.startswith(_MARKER_PREFIX):
        raise RuntimeError("Refusing to close a tab not owned by OnMyAgent")
    tab_id = marker[len(_MARKER_PREFIX) :]
    encoded = urllib.parse.quote(tab_id, safe="")
    _broker_request("DELETE", f"/v1/tabs/{encoded}")
    remaining = list_onmyagent_tabs()
    if remaining:
        switch_onmyagent_tab(remaining[0]["tabId"])
    return tab_id
