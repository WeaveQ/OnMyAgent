# tccli 通用用法（skill 内化版）

> 蒸馏自 `testrun/ref_docs/tccli-使用指南-API参数探索.md`。本文件回答"我知道要调用某个 API 了，怎么探索参数、怎么把命令拼出来"。

## 1. 一句话定位

`tccli <service> <action> [--param=value ...]` 是腾讯云命令行工具，覆盖所有腾讯云产品的所有 API 版本，无需写 SDK 代码即可调用。

## 2. 参数探索四种方法（按推荐度排序）

### ⭐ 方法 1：`help --detail`（最常用）

```bash
tccli monitor GetMonitorData help --detail
```

输出**完整中文说明 + 嵌套类型展开 + 可空字段标记**。等价于 API 文档，且永远跟 tccli 当前版本一致。**绝大多数情况下这一条就够用。**

输出结构：
- `DESCRIPTION`：API 整体说明
- 入参：`--FieldName (Type | Required/Optional)` + 中文说明 + 嵌套 `JSON Syntax` 块
- `OUTPUT PARAMETER`：出参，含嵌套展开

### 方法 2：`help`（基础概览）

```bash
tccli monitor GetMonitorData help
```

只列字段名 + 类型 + Required/Optional，**不展开嵌套类型、无中文说明**。适合快速扫一眼有哪些字段。

### 方法 3：`--generate-cli-skeleton`（生成 JSON 模板）

```bash
tccli monitor GetMonitorData --generate-cli-skeleton > /tmp/req.json
```

输出纯净的 JSON 骨架，类型位置填了占位符（`"String"` / `"Integer"` / `"Timestamp"`）。**适合复杂参数结构，编辑后用 `--cli-input-json file://...` 调用。**

> ⚠️ 当前 tccli 版本**不支持** `--generate-cli-skeleton output`，要查出参结构就用方法 1 的 `help --detail`。

### 方法 4：浏览服务下所有 Action

```bash
tccli monitor help              # 仅 Action 名
tccli monitor help --detail     # Action 名 + 一行中文描述（推荐）
tccli monitor help --version 2023-06-16  # 指定版本
```

**模糊场景下建议先 `tccli <svc> help --detail` 浏览一遍**，再选具体 Action。

---

## 3. 调用方式

### 3.1 命令行直接传参（简单参数适用）

```bash
tccli monitor GetMonitorData \
  --Namespace "QCE/CVM" \
  --MetricName "CpuUsage" \
  --Period 300 \
  --StartTime "2026-03-30T10:00:00+08:00" \
  --EndTime "2026-03-30T11:00:00+08:00" \
  --Instances '[{"Dimensions":[{"Name":"InstanceId","Value":"ins-abc12345"}]}]' \
  --region ap-guangzhou
```

### 3.2 通过 JSON 文件传参（**复杂参数推荐**）

> 跨平台提示：临时文件路径 Unix/macOS 用 `/tmp/req.json`，Windows 用 `%TEMP%\req.json`（cmd）或 `$env:TEMP\req.json`（PowerShell）。生成文件 Windows 推荐用 `Set-Content`/`Out-File` 或直接用编辑器 / Edit 工具，不要套用 heredoc。

```bash
# Unix/macOS
cat > /tmp/req.json << 'EOF'
{
    "Namespace": "QCE/CVM",
    "MetricName": "CpuUsage",
    "Period": 300,
    "StartTime": "2026-03-30T10:00:00+08:00",
    "EndTime": "2026-03-30T11:00:00+08:00",
    "Instances": [
        {"Dimensions": [{"Name": "InstanceId", "Value": "ins-abc12345"}]}
    ]
}
EOF

# Windows PowerShell 等价：
# @'
# { ...同上 JSON... }
# '@ | Set-Content -Encoding utf8 $env:TEMP\req.json

tccli monitor GetMonitorData \
  --cli-input-json file:///tmp/req.json \
  --region ap-guangzhou
```

**为什么推荐文件方式？** 数组、嵌套对象用命令行 `'[{"a":"b"}]'` 拼写极易在 shell 引号里翻车。文件方式可读性好、可复用、可版本化。

### 3.3 推荐工作流

> 探索 → 模板 → 编辑 → 调用
>
> 路径占位：下方 `/tmp/req.json` 是 Unix/macOS 写法，Windows 请改用 `%TEMP%\req.json`（cmd）或 `$env:TEMP\req.json`（PowerShell）；编辑环节 `vim` 仅 Unix 可用，Windows 用记事本 / VSCode / Edit 工具。

```bash
# 1) 看一下入参长啥样
tccli monitor GetMonitorData help --detail

# 2) 拿到模板（Unix）
tccli monitor GetMonitorData --generate-cli-skeleton > /tmp/req.json
# Windows PowerShell 等价：tccli monitor GetMonitorData --generate-cli-skeleton | Set-Content $env:TEMP\req.json

# 3) 编辑填值
vim /tmp/req.json   # Unix；Windows 用 notepad %TEMP%\req.json 或 Edit 工具

# 4) 调用
tccli monitor GetMonitorData --cli-input-json file:///tmp/req.json --region ap-guangzhou
# Windows PowerShell 等价：tccli monitor GetMonitorData --cli-input-json "file:///$($env:TEMP -replace '\\','/')/req.json" --region ap-guangzhou
```

---

## 4. 常用选项速查

| 选项 | 说明 |
|------|------|
| `--region <地域>` | 指定地域，如 `ap-guangzhou`、`ap-shanghai`、`ap-hongkong` |
| `--version <版本>` | API 版本，多数 API 默认最新版无需传 |
| `--output <格式>` | `json`（默认）/ `text` / `table` |
| `--filter <JMESPath>` | JMESPath 表达式过滤输出，如 `"Histories[*].Content"` |
| `--cli-input-json file://<路径>` | 从 JSON 文件读取参数 |
| `--cli-unfold-argument` | 启用点号展开（`--Filters.0.Name zone`） |
| `--timeout <秒>` | 单请求超时 |
| `--language zh-CN` | 响应语言（`zh-CN` / `en-US`），影响错误码描述 |
| `--profile <名称>` | 切换凭证 profile（多账号场景用） |
| `--waiter <JSON>` | 轮询等待条件满足，用于异步操作 |

### 输出格式示例

```bash
# 表格化（适合给用户看）
tccli monitor DescribeAlarmHistories --region ap-guangzhou --output table

# JMESPath 过滤
tccli monitor DescribeAlarmHistories --region ap-guangzhou \
  --filter "Histories[*].Content"
```

---

## 5. 常见 FAQ

**Q：复杂参数（数组 / 嵌套对象）总是出 `InvalidParameter`？**
A：99% 是 shell 转义问题。改用 `--cli-input-json file:///tmp/req.json`，把参数写到文件里。

**Q：怎么查某个 API 有哪些版本？**
A：`tccli <service> help` 顶部会列出可用版本。

**Q：怎么在一个请求里查多个实例？**
A：在 `Instances` 数组中追加元素：
```json
"Instances": [
  {"Dimensions": [{"Name": "InstanceId", "Value": "ins-aaa"}]},
  {"Dimensions": [{"Name": "InstanceId", "Value": "ins-bbb"}]}
]
```
单次请求最多 50 个实例，数据点上限 7200。

**Q：报 403 Unauthorized？**
A：先 `tccli configure list` 看登录状态；登录正常的话检查当前账号是否有该产品的 API 权限和实例访问权限。

**Q：明明 API Action 名是对的，为什么 `tccli xxx yyy help` 报"未知子命令"？**
A：极少数情况下 tccli 版本落后于云端 API。`pip install --upgrade tccli` 升级后重试。

---

## 6. 安全红线（再强调一次）

- ❌ **禁止**在命令行、脚本、配置文件中硬编码 SecretId / SecretKey 明文
- ❌ **禁止**回显完整凭证给用户
- ✅ 用 `tccli auth login` 走 OAuth 流（有头）或 `tccli auth login --browser no`（无头）
- ✅ 多账号用 `--profile <名称>` 切换，凭证由 tccli 安全保存
