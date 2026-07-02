# 通用错误处理参考

> 本文档是 tcop-api **跨子产品共享**的错误处理规则,所有 tccli 调用失败的场景都按本表查映射。
> 子产品的特化错误处理(例如告警的 PolicyId 不存在友好提示),见对应子产品文档的"错误特化"章节(如 `references/monitor-alarm.md` §十一)。

---

## 一、错误分类主表

| 错误类别     | 常见 Code                                                      | 用户提示                                                                                                                                | 重试策略                           |
|------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|------------------------------------|
| 地域错误     | `InvalidParameterValue.Region` / message 含 `X-TC-Region`      | "当前地域可能不支持本接口,建议切换到 ap-guangzhou 或您账号的主地域"                                                                  | 不重试                             |
| 权限不足     | `UnauthorizedOperation` / `AuthFailure.UnauthorizedOperation` | "当前账号无该接口读权限,请联系账号管理员开通对应接口的读权限"                                                                       | 不重试                             |
| STS token 过期 | `AuthFailure.TokenFailure`                                  | **不直接报错给用户**——先静默执行 `scripts/credential_refresh.py` 尝试自动刷新；刷新成功则重试原 API 调用；刷新失败再走本文 §四“认证修复链路”中的交互式登录 | 自动刷新 1 次                      |
| 签名过期     | `AuthFailure.SignatureExpire`                                  | "系统时钟可能有偏移,请检查:`date` 与实际时间是否一致。如时钟正常则凭据已失效,需重新登录"                                              | 不重试                             |
| 凭据缺失     | (本地 ~/.tccli/default.credential 不存在 或 secretId 为空)    | 走本文 §四“认证修复链路”中的交互式登录 SOP；**不要只输出一句 `tccli auth login`**——LLM 无 TTY 环境下该命令会 EOF 退出 | 不重试                             |
| SecretId 无效 | `AuthFailure.SecretIdNotFound`                               | 凭证文件内容损坏或被手动清空，走本文 §四“认证修复链路”中的交互式登录 SOP                                                                        | 不重试                             |
| 参数错误     | `InvalidParameter.*` / `InvalidParameterValue.*`              | "参数 [字段名透传] 有误,请检查取值。如不确定 strategy_type 取值,可用 `scripts/alarm_lookup.py search <关键词>` 查 references/data/alarm_strategy.jsonl"             | 不重试                             |
| 资源未找到   | `ResourceNotFound.*`                                          | "未找到对应资源,请确认 ID 是否正确,或先用列表类查询列出当前账号下可用资源"                                                          | 不重试                             |
| 接口不存在   | `UnsupportedOperation` / `InvalidAction`                      | "该 action 在当前 tccli 版本不可用,请升级 tccli 到最新版:`pip install -U tccli`"                                                    | 不重试                             |
| 限流         | `RequestLimitExceeded`                                        | "调用频率过高,已退避 1 秒后重试一次。如仍失败,请稍后再试"                                                                           | **退避 1 秒重试一次**,失败则放弃  |
| 网络/超时    | (subprocess timeout / connection refused)                     | "无法连接腾讯云 API,请检查网络/代理配置"                                                                                              | 不重试                             |

---

## 二、tccli 错误识别约定

tccli 业务错误的输出特点(LLM 必须知道):

- **stdout 有 JSON** → 调用成功,即使数据为空数组也算成功
- **stdout 为空 + stderr 含 `[TencentCloudSDKException]` + 退出码非 0** → 业务错误(典型表现:`exit code = 255`),stderr 里可能掺杂 tccli 的 `usage:` 帮助文本(忽略),只看 `[TencentCloudSDKException]` 那一行
- **stderr SDKException 格式**:
  ```
  [TencentCloudSDKException] code:ResourceNotFound message:"NOT_FOUND": policy not found requestId:xxx
  ```
  LLM 渲染时把 code / message / requestId 透传给用户
- **stdout 空 + stderr 含 `usage:` + 退出码非 0** → 参数拼写错(如 `--Region` 写成大写、漏 `--Module`),LLM 应根据 stderr 提示重检查命令

---

## 三、重试与禁忌

> ⚠️ **禁止硬重试**:除限流(`RequestLimitExceeded`)外,所有错误**只调用一次**,不做循环重试。

> ⚠️ **禁止伪造数据掩盖错误**:LLM 渲染时必须如实告知用户调用失败,**严禁**编造看似合理的数据。

> ⚠️ **禁止吞掉 RequestId**:tccli 返回的 `RequestId` 必须传递到 LLM 渲染层,以便用户报障时引用。

---

## 四、认证修复链路（仅在 tccli 真实调用报认证错误时触发）

触发条件（命中任一即进入本链路）：

- `AuthFailure.TokenFailure`
- `AuthFailure.SecretIdNotFound`
- 本地凭据缺失（`~/.tccli/default.credential` 不存在或 secretId 为空）

处理顺序：

1. 先静默刷新：
   ```bash
   python3 scripts/credential_refresh.py 2>&1
   ```
   - 输出 `REFRESH_OK`：立刻重试原 tccli 命令一次
   - 输出 `REFRESH_FAILED`：进入第 2 步交互式登录

2. 交互式登录

   阶段 1，获取 OAuth URL：
   ```bash
   # Unix/macOS（GNU grep）
   timeout 5 tccli auth login --browser no 2>&1 | grep -oP 'https://\S+'
   # Windows
   python3 -c "import re,subprocess;o=subprocess.run(['tccli','auth','login','--browser','no'],capture_output=True,text=True,timeout=5).stdout+subprocess.run(['tccli','auth','login','--browser','no'],capture_output=True,text=True,timeout=5).stderr;m=re.search(r'https://\S+',o);print(m.group(0) if m else '')"
   ```

   将 URL 发给用户并引导：“请在浏览器打开该链接，授权后把页面显示的 Base64 验证码回贴”。

   阶段 2，处理验证码：
   ```bash
   python3 scripts/credential_from_code.py '<用户贴回的Base64验证码>' 2>&1
   ```
   - 输出 `LOGIN_OK`：重试原 tccli 命令一次
   - 输出 `LOGIN_FAILED: <原因>`：向用户报告失败原因并停止

>    若用户环境无法打开浏览器或无法完成验证码授权，提示其改用环境变量方式提供凭据后再重试：
>- `TENCENTCLOUD_SECRET_ID`
>- `TENCENTCLOUD_SECRET_KEY`
3. 重试后的收敛规则

- 认证修复链路最多执行 1 轮（刷新 1 次 + 登录 1 次）
- 若重试后仍报认证类错误，停止自动处理，向用户输出错误码 + message + RequestId

---

## 五、LLM 渲染建议

错误回答统一模板:

```
未能完成查询(原因:[错误类别中文])
错误码:[Code 透传]
建议:[根据错误类别给出的具体建议]
RequestId:[透传,小字附带]
```

示例:

```
未能完成查询(原因:权限不足)
错误码:UnauthorizedOperation
建议:当前账号无该接口读权限,请联系账号管理员开通对应接口的读权限
RequestId:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

子产品如有特化提示(例如告警的 policy-detail 找不到时建议先列出策略列表),见对应子产品文档的"错误特化"章节(如 `references/monitor-alarm.md` §十一),**特化提示优先于本表通用提示**。
