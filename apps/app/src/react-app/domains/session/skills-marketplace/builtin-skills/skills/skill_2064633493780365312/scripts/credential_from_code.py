#!/usr/bin/env python3
"""
credential_from_code.py — 解析 OAuth 验证码并写入凭证

职责：
  解码用户提供的 Base64 验证码 → 用其中的 accessToken 调腾讯云端点兑换 STS → 写入凭证文件。
  不负责获取 OAuth URL（由 tccli auth login --browser no 完成）。

端点（与 tccli 源码 oauth.py 一致）：
  - 兑换 STS: POST https://cli.cloud.tencent.com/get_temp_cred

用法：
  python3 credential_from_code.py '<Base64验证码>'

输出：
  成功 → "LOGIN_OK"
  失败 → "LOGIN_FAILED: <原因>"
"""

import base64
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


def cmd_finish(code_b64):
    """解码验证码 → 兑换 STS → 写凭证文件"""
    # 1. 解码 Base64
    try:
        decoded = base64.b64decode(code_b64).decode("utf-8")
        oauth_data = json.loads(decoded)
    except Exception as e:
        print(f"LOGIN_FAILED: 验证码解码失败: {e}")
        return 1

    access_token = oauth_data.get("accessToken", "")
    refresh_token = oauth_data.get("refreshToken", "")
    open_id = oauth_data.get("openId", "")
    expires_at = oauth_data.get("expiresAt", 0)
    site = oauth_data.get("site", "cn")

    if not access_token or not open_id:
        print("LOGIN_FAILED: 验证码缺少必要字段 (accessToken/openId)")
        return 1

    # 2. 兑换 STS 临时凭证
    sts, err = get_temp_cred(access_token, site)
    if err:
        print(f"LOGIN_FAILED: STS 兑换失败: {err}")
        return 1

    # 3. 写入凭证文件（格式与 tccli save_credential 一致）
    credential = {
        "type": "oauth",
        "secretId": sts["secretId"],
        "secretKey": sts["secretKey"],
        "token": sts["token"],
        "expiresAt": sts["expiresAt"],
        "oauth": {
            "openId": open_id,
            "accessToken": access_token,
            "expiresAt": expires_at,
            "refreshToken": refresh_token,
            "site": site,
        },
    }

    cred_dir = os.path.dirname(CREDENTIAL_PATH)
    os.makedirs(cred_dir, exist_ok=True)
    with open(CREDENTIAL_PATH, "w") as f:
        json.dump(credential, f, indent=4)

    print("LOGIN_OK")
    return 0


def main():
    if len(sys.argv) < 2:
        print("用法: credential_from_code.py <Base64验证码>")
        return 1

    code_b64 = sys.argv[1]
    # 兼容旧调用方式 "finish <code>"
    if code_b64 == "finish" and len(sys.argv) >= 3:
        code_b64 = sys.argv[2]

    return cmd_finish(code_b64)


if __name__ == "__main__":
    sys.exit(main())
