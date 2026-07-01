# instance_resolver — strategy_type 枢轴模块

> 通用基础模块，封装腾讯云监控（TCOP）"基于 strategy_type 的解析能力"。
> 配套脚本：[`scripts/instance_resolver.py`](../scripts/instance_resolver.py)

被 monitor-query（GetMonitorData 工作流）以及未来 alarm/tmp 等模块复用。所有"产品识别 / 实例发现 / 维度生成"的需求都从这里走。

## 目录

- § 1 一句话定位 — 4 件事(find_strategy / load_config / list_instances / gen_dimensions)
- § 2 子命令一览 — 4 个子命令的入参/出参/L1-L3 路由判断
- § 3 模板引擎 — 支持的 ${obj.foo} / `<%= ... %>` 语法 + 降级规则
- § 4 自愈机制 / 实现要点 — SDK CommonClient 调用 + 响应路径自动剥离 + 模板降级
- § 5 模型决策守则 — next_action 字段语义汇总(含 error_stop / no_instances_found 等)
- § 6 局限与降级
- § 7 与 monitor_query 的协作 — 端到端流程图

---

## 1. 一句话定位

给定 strategy_type，本模块负责：
- **产品 → strategy_type 候选**（`find_strategy`）
- **strategy_type → 实例 API 调用配置**（`load_config`，实时调 `DescribeAllNamespaces`）
- **strategy_type + region → 实际实例列表**（`list_instances`，含分页 + 树形递归 + 字段映射）
- **strategy_type + 实例数据 → 四种维度形态**（`gen_dimensions`）

不负责：指标匹配、Period 推算、build_request、tccli 执行（这些归 monitor_query）。

---

## 2. 子命令一览

```
instance_resolver.py
├── find_strategy <用户产品描述> [--intent ...]
├── load_config <strategy_type>
├── list_instances <strategy_type> --region <r>
└── gen_dimensions <strategy_type> --region <r> --instances <json>
```

### 2.1 `find_strategy <query> [--intent list_instances|gen_dimensions|describe|match_metrics] [--limit N]`

模糊匹配 strategy_type 候选 + L1/L2/L3 路由判断。

**输出关键字段**：

| 字段 | 含义 |
|------|------|
| `candidates` | 候选数组（带 `score` / `cloud_apis` / `console_menu_zh` 等） |
| `next_action` | `auto_continue` / `ask_user_l2` / `ask_user_l3` |
| `reason` | 决策原因（含 root_api 比较结果） |
| `intent` | 调用方传入的 intent，影响 L2 路由决策 |

**L1/L2/L3 决策矩阵**：

| 命中数 | root_api 一致性 | intent | next_action |
|-------|---------------|--------|-------------|
| 1 | — | 任意 | `auto_continue` |
| ≥2 同分高 | 全部相同 | `list_instances` | `auto_continue`（L2 免反问）|
| ≥2 同分高 | 全部相同 | 其他 | `ask_user_l2`（必须反问选 strategy）|
| ≥2 同分高 | 不同 | 任意 | `ask_user_l3`（必须反问）|

**示例**：用户问"CDB"。CDB 关联 6 个 strategy_type（cdb_cluster/cdb_detail/cdb_proxy/...）但 root_api 都是 `cdb:DescribeDBInstances`：
- 模型问"列实例" → `--intent list_instances` → `auto_continue`，随便选哪个 strategy 列出来的实例都一样
- 模型问"看主机监控指标" → `--intent gen_dimensions` → `ask_user_l2`，因为不同 strategy 的指标视角不同

### 2.2 `load_config <strategy_type>`

实时调 `tccli monitor DescribeAllNamespaces --Ids '["<strategy_type>"]'`.

**输出**：

```json
{
  "strategy_type": "cdb_detail",
  "namespace": "QCE/CDB",                  // GetMonitorData 用大写 Namespace
  "dashboard_id": "cdb",
  "available_regions_short": ["bj","gz",...],
  "available_regions_long": ["ap-beijing","ap-guangzhou",...],
  "instance_loader_summary": {...},
  "alarms_dimensions": [...],
  "event_dimensions": {...},                // 给 GetMonitorData 用的最小维度集
  "id_key": [...],
  "metrics_dimensions_sample": [...]
}
```

> 完整 Config 字段 30KB+，本接口只返摘要。需要原始 Config 的话，模型可直接调 `tccli monitor DescribeAllNamespaces --Ids '["xxx"]'`。

### 2.3 `list_instances <strategy_type> --region <r> [--limit 50] [--max-pages 10]`

按 `instanceLoader` 配置完成 5 件事：
1. 调腾讯云 SDK CommonClient(`<serviceType>` + `<cmd>` + `Version`)拉实例;Version 来源 `instanceLoader.reqParams.Version`;失败时 warnings 含 `[sdk_error]`,`next_action=error_stop`(详见下方 next_action 表)
2. 多页 → 自动分页（识别 `${obj.offset}` 模板）
3. 多层 → 递归 children（cmd 模式 + getter 模式）
4. 按 `fieldsMapping` 提取每个实例的关键字段（支持 `<%= obj.X.Y %>` 模板）
5. 父链合并：根→叶层级合并 mapped 字段，子层覆盖父层同名

**输出**：

```json
{
  "strategy_type": "cdb_detail",
  "namespace": "QCE/CDB",
  "region": "ap-guangzhou",
  "instance_count": 7,
  "instances": [
    {
      "raw": {InstanceId, InstanceName, Status, ...原始 API 字段},
      "mapped": {uInstanceId, alarm_disabled, projectId, ...告警维度命名空间}
      "depth": 1
    }
  ],
  "warnings": [],
  "next_action": "ask_user_select_instances",
  "reason": "7 instances found,let user select"
}
```

**`next_action` 4 种取值**(决策已在脚本侧做好,模型按指示行动即可):

| next_action | 触发条件 | 模型行为 |
|-------------|---------|---------|
| `error_stop` | warnings 含 `[sdk_error]` / `[version_missing]` (上游 API 失败 / 版本号缺失) | **必须停下**告知用户上游错误,**不可** auto-continue |
| `no_instances_found` | 0 实例(API 返回成功但列表为空) | 提示用户检查 region / 产品是否在该地域开通,**不能**继续 |
| `ask_user_select_instances` | 多实例 | 用 AskUserQuestion 让用户多选 |
| `auto_continue` | 单实例 | 直接进入 gen_dimensions |

### 2.4 `gen_dimensions <strategy_type> --region <r> (--instance-ids <ids> | --instances <json>)`

按**场景**分别输出维度。两种入参模式二选一：

| 模式 | 入参 | 适用场景 | 内部行为 |
|------|------|---------|---------|
| **简化模式** ⭐ | `--instance-ids cmgo-aaa,cmgo-bbb` | 用户只给 instance ID，且产品是单维度（CVM/CDB/MongoDB/Redis 单实例等） | 自动从 Config 推断 lookup keys 并合成 mapped；输出 `[synthesized_mapped]` warning 让调用方可观测 |
| **完整模式** | `--instances '[{"raw":...,"mapped":...}, ...]'` | 接 `list_instances.instances` 输出；**多维度产品必须用此模式**（如 Redis Proxy 的 `appid+pnodeid+instanceid` 三件套） | mapped 字段由 fieldsMapping 模板渲染产出 |

**为什么需要简化模式**：每个产品的 alarm key 名都不同（CDB=`uInstanceId`、CVM=`unInstanceId`、MongoDB=`cluster`...）。LLM 不应预先记住这些命名约定。`--instance-ids` 让脚本根据 Config 自动决定 lookup keys，不再要求调用方猜对 key 名。

**多维度检测**：当 `alarms[0].dimensions` 长度 ≥ 2（如 Redis Proxy 的 3 个维度键）时，简化模式会输出 `[multi_dim_warn]` 警告——单 ID 无法填全多维度的不同 value，必须改用完整模式走 list_instances。

#### 三个场景

| scene | 用途 | 数据来源 | 含 Region 字段 |
|-------|------|---------|---------------|
| `alarm_policy` | 告警 API（CreateAlarmPolicy/DescribeAlarmPolicies）的 Dimensions 字段 | `alarms[0].dimensions` | 不含 |
| `id_key` | 实例唯一标识（含地域） | `config.idKey + Region` | 含 `Region` |
| `api_query` | **GetMonitorData --Instances[].Dimensions** | 多源候选（见下） | 不含 |

#### 为什么 `api_query` 是候选清单而不是单一形态

GetMonitorData 接受的 `Dimensions[].Name` 在不同产品有**不同的元数据来源**，没有单一权威字段：

| 产品类型 | 真实接受的 Name | 来源字段 |
|---------|---------------|---------|
| MongoDB | `target` | `alarm2dashboardMapping: {cluster: target}` |
| CDB | `InstanceId` | `alarms[0].eventDimensions: {InstanceId: uInstanceId}` 的 key |
| CVM | `InstanceId` | `alarms[0].dimensions=[unInstanceId]` PascalCase 化 |

`gen_dimensions` 因此输出**按可信度排序的 candidates 数组**：

| rank | source | 适用产品举例 |
|------|--------|------------|
| 1 | `alarm2dashboardMapping` | MongoDB（最权威） |
| 2 | `eventDimensions(dict).keys` | CDB |
| 3 | `alarms[0].dimensions + PascalCase 启发式` | CVM、CDB |
| 4 | `metrics[0].dimensions` 直接当 Name | MongoDB（也命中）；CVM/CDB 的 Barad 内部名通常错 |
| 5 | `alarms[0].dimensions(raw)` | 兜底 |

`primary` 字段 = `candidates[0]`（最高优先级），实测 MongoDB/CDB/CVM 三类典型产品的 primary 都能一次命中 GetMonitorData。

#### 输出结构

```json
{
  "strategy_type": "cmongo_instance",
  "namespace": "QCE/CMONGO",
  "region": "ap-guangzhou",
  "instance_count": 1,
  "scenes": {
    "alarm_policy": {
      "schema_keys": ["cluster"],
      "source": "alarms[0].dimensions",
      "dimensions": [{"cluster": "cmgo-9l5bmguf"}]
    },
    "id_key": {
      "schema_keys": ["Region", "cluster"],
      "source": "config.idKey + region",
      "dimensions": [{"Region": "ap-guangzhou", "cluster": "cmgo-9l5bmguf"}]
    },
    "api_query": {
      "instances": [{
        "primary": {"rank":1,"source":"alarm2dashboardMapping",
                    "Dimensions":[{"Name":"target","Value":"cmgo-9l5bmguf"}],
                    "name_keys":["target"]},
        "candidates": [...]
      }],
      "next_action": "try_primary_first_then_other_candidates_on_InvalidParameterValue"
    }
  },
  "config_dim_fields": {...}
}
```

#### 调用方使用方式

| 场景 | 推荐路径 |
|------|----------|
| 用户给了 instance ID（高频） | **`--instance-ids` 简化模式**，直接拿 primary 喂 build_request |
| 仅产品名 + 用户多选实例 | list_instances → 用户选 → `--instances` 完整模式 |
| 多维度产品（Redis Proxy 等） | 必须 list_instances → `--instances` 完整模式 |
| 已知完整 (namespace, metric, dim name, value) | **跳过 instance_resolver**，直接 monitor_query.build_request |
| 查告警策略（CreateAlarmPolicy 等） | `scenes.alarm_policy.dimensions[i]` |
| 实例去重 / 唯一标识 | `scenes.id_key.dimensions[i]` |

#### 候选空时的 next_action 与恢复路径

`scenes.api_query.next_action` 取值：

| next_action | 含义 | 调用方动作 |
|-------------|------|-----------|
| `try_primary_first_then_other_candidates_on_InvalidParameterValue` | 正常路径 | 用 `primary` 喂 build_request；失败按 candidates[1+] 重试 |
| `no_candidates_use_instance_ids_or_list_instances` | 候选全空 | 看 warnings 字段诊断：`[multi_dim_warn]` → 改 list_instances；`[no_api_candidates]` (--instances 模式) → 改 --instance-ids 或 list_instances；`[no_api_candidates]` (--instance-ids 模式) → 检查 `config_dim_fields` 字段，可能产品配置异常 |

---

## 3. 模板引擎

DescribeAllNamespaces 的 Config 大量使用控制台前端模板。本模块用受限子集解析，不阻塞流程。

### 支持的语法

| 语法 | 示例 | 解析 |
|------|------|------|
| `${obj.foo}` | `${obj.offset}` | 当前实例对象的字段 |
| `${foo}` | `${limit}` | ctx 顶层变量（如分页 obj 的 offset/limit） |
| `${parent.data.foo}` | `${parent.data.InstanceId}` | 父链取值（树形必备） |
| `${[lit, "arr"]}` | `${[2,5,6]}` | JSON 字面量数组 |
| `<%= obj.X.Y %>` | `<%= Placement.ProjectId %>` | 嵌套路径 |
| `<%= obj.X != Y %>` | `<%= obj.Status != 1 %>` | 简单比较 |
| 字符串/数字/布尔字面量 | `'abc'` / `1` / `true` | 直接量 |

### 降级语法

下列复杂表达式**不解析**，标记 `[template_warn]`，对应字段返回 `None`：

| 复杂语法 | 出现产品 | 影响 |
|---------|--------|------|
| `${typeof X !== 'undefined' ? Y : Z}` | Redis Proxy `ProjectIds` | 该参数不传 → tccli 取默认行为 → 通常无影响 |
| `${X ? Y : Z}` 三元 | CVM 网络类型 | 字段为 None |
| 含 `+ - * / .join()` 的 JS | CVM 磁盘描述 | 字段为 None |
| `<%- ... %>` unescape 风格 | 部分产品 | 字段为 None |

> 实测：`reqParams` 里降级到 None 通常 OK（参数变可选）；`fieldsMapping` 里降级到 None 时该 mapped 字段为空，但不影响主流程（gen_dimensions 自动 fallback）。

---

## 4. 自愈机制 / 实现要点

### 4.1 调用通道：腾讯云 Python SDK CommonClient

本模块所有 API 调用走 `tencentcloud.common.common_client.CommonClient`，**不走 tccli 命令行**。

**为什么不用 tccli**：DescribeAllNamespaces 给的 `instanceLoader.cmd` 是腾讯云控制台前端使用的 API 名（如 `mongodb:DescribeDBInstanceSummaries`），这些 API 在公开云 API 网关上是**有效**的，但 **tccli 的 CLI 白名单**（按公开 SDK 收录的 Action 列表）不收录，会报 `Invalid choice`。SDK CommonClient 直接 HTTPS POST 到 `<service>.tencentcloudapi.com`，绕过 CLI 校验，能调任何后端接受的 (service, version, action) 组合。

**Version 来源**：`instanceLoader.reqParams.Version` 字段（如 mongodb 的 `2019-07-25`、cdb 的 `2017-03-20`、cvm 的 `2017-03-12`）。`_resolve_req_params` 抽出 Version 当 client 配置，剩余字段当 API 入参。

**凭证复用**：`_get_credential` 优先读 `~/.tccli/default.credential`（OAuth），失败回退到 `TENCENTCLOUD_SECRET_ID/KEY` 环境变量。用户不需要为 SDK 单独登录。

**Client 缓存**：按 `(service, version, region)` 三元组缓存 `CommonClient` 实例，同进程多次调用复用。

### 4.2 响应路径自动剥离

DescribeAllNamespaces 给的 `resFields.list = "data.Response.Items"`（控制台前端假设的多层包装），但 SDK CommonClient 已经剥过 `Response` 外层；实际响应通常是裸的（仅 `Items`）。

`_lookup_with_response_fallback` 自动尝试 4 种路径变体：
- `data.Response.Items`（原始）
- `Response.Items`（剥离 `data.`）
- `data.Items`（剥离 `Response.`）
- `Items`（全剥离）

第一个命中即用。

### 4.3 模板降级（非阻塞）

`reqParams` 模板里复杂表达式（三元、typeof、JS 函数调用）会被标记 `[template_warn]` 并降级为 None：
- `reqParams` 里降级 None → 该参数不传 → API 当作可选参数走默认行为 → 通常无影响
- `fieldsMapping` 里降级 None → 该 mapped 字段为空 → gen_dimensions 自动 fallback

---

## 5. 模型决策守则（对接调用方）

### 5.1 `next_action` 字段语义

每个子命令输出都有 `next_action` 字段，告诉模型下一步做什么。模型应**按它的指示行动**，不要自行判断。

| `next_action` | 模型行为 |
|--------------|---------|
| `auto_continue` | 直接进入下一步 |
| `ask_user_l2` / `ask_user_l3` | 用 AskUserQuestion 让用户在 candidates 中选 |
| `ask_user_select_instances` | 用 AskUserQuestion 让用户从 instances 中多选 |
| `error_stop` | 上游 API 失败(SDK error / version 缺失);**必须停下**告知用户,严禁继续 |
| `no_instances_found` | 0 实例;提示用户检查 region / 产品开通状态,**不能**继续 |
| `model_select_by_semantics` | 模型按通识从 all_metrics 挑 3-5 个，再用 AskUserQuestion 让用户确认 |

### 5.2 三种"问用户"场景的话术建议

**L2 反问（多 strategy_type 同 root_api，意图是生成维度）**：
> "你想看哪个粒度的 CDB 监控？6 个候选指向同一组实例 API，但监控维度不同：
> - 主机监控（cdb_detail）—— CPU/IOPS 等
> - 集群版监控（cdb_cluster）...
> - ..."

**实例多选**：
> "在 ap-guangzhou 找到 7 台 CDB 实例，要看哪些？"
> （列出实例 ID + Name + Status）

**model_select_by_semantics**：
> "查询 '负载' 在 CDB 287 个 API 指标里没有精确同名的（jsonl 全集）。按通识，'负载'通常对应：CPU 利用率 / 内存利用率 / IOPS 利用率 / 连接数利用率。要看哪些？"

### 5.3 错误码语义

| Exit | 含义 | 模型应对 |
|------|------|---------|
| 0 | 成功 | 继续 |
| 1 | 参数错（拼写错、format 错） | 修参数重调 |
| 2 | 数据未命中（strategy_type 不存在） | 检查 strategy_type 拼写或换搜索词重新 find_strategy |
| 3 | 外部 API/网络/凭证异常（含 SDK 未装、凭证缺失、TencentCloudSDKException） | 反馈用户 + 不重试 |

---

## 6. 局限与降级

| 局限 | 应对 |
|------|------|
| `instanceLoader` 没有 children 但实际产品有多层 | 当前不支持 |
| 模板含三元/typeof 等复杂表达式 | 降级到 None，警告但不阻塞 |
| `eventDimensions` 字段缺失 | 退化用 `alarms.dimensions` 作 API 维度名（多数情况下是错的，警告用户） |
| Region 短码映射缺失（罕见地域） | 用 long form 直接传 |
| 同进程内 Config 缓存，未做 TTL | 长会话适用；如需刷新重启进程 |

---

## 7. 与 monitor_query 的协作

```
[用户请求]
  ↓
[A] instance_resolver.py find_strategy "CDB" --intent list_instances
  ↓ (auto_continue / ask_user)
[B] instance_resolver.py list_instances cdb_detail --region ap-guangzhou
  ↓ (ask_user_select_instances)
[用户选实例]
  ↓
[C] instance_resolver.py gen_dimensions cdb_detail --region ap-guangzhou --instances ...
  ↓ (拿到 scenes.api_query.instances[i].primary + candidates)
[D] monitor_query.py match_metric cdb_detail "负载"
  ↓ (model_select_by_semantics)
[E] monitor_query.py pick_period --duration ... --stat-types ...
  ↓
[F] monitor_query.py build_request --from-candidate <primary JSON>
  ↓ (执行失败 InvalidParameterValue 时按 candidates[next] 重试)
  ↓
[G] monitor_query.py execute_query --request-file ... --region ...
  ↓
[结果摘要]
```

详细流程见 [monitor-query/getmonitordata.md](monitor-query/getmonitordata.md)。
