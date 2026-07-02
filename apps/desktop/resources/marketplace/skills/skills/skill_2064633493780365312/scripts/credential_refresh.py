#!/usr/bin/env python3
"""
credential_refresh.py — 静默刷新腾讯云 OAuth 凭证

功能：
  读取 ~/.tccli/default.credential 中的 oauth 块，
  用 refreshToken 刷新 accessToken（如果快过期），
  再用 accessToken 兑换 STS 临时凭证，写回文件。

端点（与 tccli 源码 oauth.py 一致）：
  - 刷新 token: POST https://cli.cloud.tencent.com/refresh_user_token
  - 兑换 STS:   POST https://cli.cloud.tencent.com/get_temp_cred

输出约定：
  - 成功：stdout 输出 "REFRESH_OK"
  - 失败：stdout 输出 "REFRESH_FAILED: <原因>"

前置条件：
  - Python >= 3.7（仅用标准库）
  - ~/.tccli/default.credential 存在且含 oauth 块
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid

CREDENTIAL_PATH = os.path.expanduser("~/.tccli/default.credential")
API_ENDPOINT = "https://cli.cloud.tencent.com"
_ACCESS_REFRESH_SAFE_DUR = 60 * 5  # 与 tccli 一致：accessToken 剩余 < 5 分钟时刷新

# tccli 源码用 verify=False
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def http_post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return None, f"HTTP {e.code}: {body[:300]}"
    except urllib.error.URLError as e:
        return None, f"网络错误: {e.reason}"
    except Exception as e:
        return None, f"请求异常: {e}"


def refresh_user_token(refresh_token, open_id, site):
    """刷新 accessToken（与 tccli oauth.refresh_user_token 一致）"""
    resp, err = http_post_json(f"{API_ENDPOINT}/refresh_user_token", {
        "TraceId": str(uuid.uuid4()),
        "RefreshToken": refresh_token,
        "OpenId": open_id,
        "Site": site,
    })
    if err:
        return None, err
    if "Error" in resp:
        return None, f"API 错误: {json.dumps(resp['Error'])}"
    if "AccessToken" not in resp:
        return None, f"响应缺少 AccessToken: {json.dumps(resp)[:200]}"
    return {
        "accessToken": resp["AccessToken"],
        "expiresAt": resp["ExpiresAt"],
    }, None


def get_temp_cred(access_token, site):
    """兑换 STS 临时凭证（与 tccli oauth.get_temp_cred 一致）"""
    resp, err = http_post_json(f"{API_ENDPOINT}/get_temp_cred", {
        "TraceId": str(uuid.uuid4()),
        "AccessToken": access_token,
        "Site": site,
    })
    if err:
        return None, err
    if "Error" in resp:
        return None, f"API 错误: {json.dumps(resp['Error'])}"
    if "SecretId" not in resp:
        return None, f"响应缺少 SecretId: {json.dumps(resp)[:200]}"
    return {
        "secretId": resp["SecretId"],
        "secretKey": resp["SecretKey"],
        "token": resp["Token"],
        "expiresAt": resp["ExpiresAt"],
    }, None


def main():
    # 1. 加载凭证
    if not os.path.isfile(CREDENTIAL_PATH):
        print("REFRESH_FAILED: 凭证文件不存在")
        return 1

    try:
        with open(CREDENTIAL_PATH, "r") as f:
            cred = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"REFRESH_FAILED: 凭证文件解析失败: {e}")
        return 1

    if cred.get("type") != "oauth":
        print("REFRESH_FAILED: 凭证类型不是 oauth")
        return 1

    oauth = cred.get("oauth")
    if not oauth or not isinstance(oauth, dict):
        print("REFRESH_FAILED: 凭证文件中无 oauth 块")
        return 1

    refresh_token = oauth.get("refreshToken", "")
    if not refresh_token:
        print("REFRESH_FAILED: 无 refreshToken")
        return 1

    open_id = oauth.get("openId", "")
    site = oauth.get("site", "cn")
    access_token = oauth.get("accessToken", "")
    access_expires = oauth.get("expiresAt", 0)

    now = time.time()

    # 2. 如果 accessToken 快过期或为空，先刷新它
    if not access_token or (access_expires - now < _ACCESS_REFRESH_SAFE_DUR):
        new_token, err = refresh_user_token(refresh_token, open_id, site)
        if err:
            print(f"REFRESH_FAILED: 刷新 accessToken 失败: {err}")
            return 1
        access_token = new_token["accessToken"]
        access_expires = new_token["expiresAt"]
        # 更新 oauth 块
        oauth["accessToken"] = access_token
        oauth["expiresAt"] = access_expires

    # 3. 用 accessToken 兑换 STS
    sts, err = get_temp_cred(access_token, site)

    # 如果 accessToken 被后端拒绝（虽然本地看没过期），fallback 刷新后重试
    if err and "token error or expire" in err.lower() or (err and "access" in err.lower()):
        new_token, refresh_err = refresh_user_token(refresh_token, open_id, site)
        if refresh_err:
            print(f"REFRESH_FAILED: STS 兑换失败且 refreshToken 也无法刷新: {refresh_err}")
            return 1
        access_token = new_token["accessToken"]
        access_expires = new_token["expiresAt"]
        oauth["accessToken"] = access_token
        oauth["expiresAt"] = access_expires
        # 重试 STS
        sts, err = get_temp_cred(access_token, site)

    if err:
        print(f"REFRESH_FAILED: STS 兑换失败: {err}")
        return 1

    # 4. 写回凭证文件
    cred["secretId"] = sts["secretId"]
    cred["secretKey"] = sts["secretKey"]
    cred["token"] = sts["token"]
    cred["expiresAt"] = sts["expiresAt"]
    cred["oauth"] = oauth

    with open(CREDENTIAL_PATH, "w") as f:
        json.dump(cred, f, indent=4)

    print("REFRESH_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
