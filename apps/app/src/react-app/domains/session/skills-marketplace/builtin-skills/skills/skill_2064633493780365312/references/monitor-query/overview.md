# 基础监控-查询（云产品监控）

> 范围：腾讯云**云产品监控（旧 Barad 架构）**的指标数据查询通道。覆盖 CVM、CDB、CLB、COS、CDN、Redis 等所有云产品的监控数据拉取。

## 1. 业务定位

云产品监控是**横切模块**——所有云产品的指标查询都经此入口。它**不**是某个子业务的查询接口（APM / RUM 有自己独立的性能数据通道，不要混）。

| 维度 | 说明 |
|------|------|
| 模块定位 | 腾讯云云产品监控指标查询 |
| 数据来源 | Barad（云产品上报） → API 模型（封装后对外） |
| tccli 服务名 | `monitor` |
| 客户感知形态 | Namespace + MetricName + Instances 维度 |

## 2. tccli 服务名 + 版本

```bash
tccli monitor help --detail   # 查看所有 Action
```

> 注意 `monitor` 服务下混了云产品监控查询、告警、Prometheus、Dashboard 多个模块。判断 Action 归属看名字，不看服务名。

## 3. Action 索引

| Action | 用途 | 状态 | 工作流文档 |
|--------|------|------|-----------|
| `GetMonitorData` | 拉取指定云产品 + 指标 + 实例的时序数据 | ✅ 已实现 | [getmonitordata.md](getmonitordata.md) |
| `DescribeStatisticData` | 多维度聚合统计(按维度分组的统计值,Dashboard 复杂面板的底层接口之一) | 🚧 待补充 | — |
| `DescribeBaseMetrics` | 查询云产品支持哪些指标 | 🚧 待补充 | — |
| `DescribeProductList` | 列出所有支持监控的云产品 | 🚧 待补充 | — |
| `DescribeMonitorTypes` | 查询监控类型分类 | 🚧 待补充 | — |

> 详细出入参用 `tccli monitor <Action> help --detail` 现场获取。

## 4. 业务核心概念

### 4.1 同名异义警告（最大坑点）

云产品监控领域内部有 **4 套独立子模型**，同一个名词含义不同：

| 名词 | Barad 含义 | API 含义 | 告警 1.0 含义 | 告警 2.0 含义 |
|------|-----------|---------|--------------|--------------|
| `namespace` | 云产品上报区分键 | API 自己的 namespace（如 `QCE/CVM`） | 同 Barad | **= 告警的 viewName（策略类型）** |
| `viewName` | 维度组合别名 | 无（通过 `cApiMetric` 反查） | 告警的 viewName ≠ Barad viewName | — |
| `metric` | namespace 粒度的原始指标 | API 自己的 metric | 同 Barad，但 viewName 字段指向告警 | — |
| `dimension` | 实例标识键（appid/region/...） | API 自己的维度 | 用户输入维度 ≠ 内部检测维度 | — |

**给模型的实操建议**：用户问"云产品的 CPU 监控"时，走 API 模型——`GetMonitorData` 用 API 的 `Namespace` 形如 `QCE/CVM`、`QCE/CDB`，**不要**直接传 Barad 的 viewName。

### 4.2 指标的权威源 = 离线 `api_metric_union.jsonl`

**关键约束**：API 查询能用的指标全集必须以 `api_metric_union.jsonl` 为准。

不要用 `DescribeAllNamespaces` 返回的 `metrics` 数组来选指标——那是**告警视角**的指标列表，跟 GetMonitorData 能查的 API 指标不是同一套。`instance_resolver.load_config` 只用 DescribeAllNamespaces 拿 `eventDimensions`（API 维度名）和 `instanceLoader`（实例发现），**不用**它的 `metrics`。

### 4.3 dash_id 颗粒度切割（容易漏指标的坑）

同一个 `api_namespace`（如 `QCE/CDB`）在 jsonl 里按 `dashboard_config_id` 拆成多份：

| api_namespace | dash_id | 含义 | 指标数 |
|---------------|---------|------|-------|
| `QCE/CDB` | `cdb` | 主机版 | 125 |
| `QCE/CDB` | `cdb_cluster` | 集群版 | 123 |
| `QCE/CDB` | `cdb_proxy` | 数据库代理 | 10 |
| `QCE/CDB` | `cdb_libradb_node` | LibraDB 节点 | 18 |
| `QCE/CDB` | `cdb_libradb_instance` | LibraDB 实例 | 11 |

`strategy_type=cdb_detail` 只对应 `dash_id=cdb` 的 125 条主指标。如果直接按 `dashboard_config_id == dash_id` 严格过滤，用户问"集群版 / LibraDB"的指标就**全部漏掉**。

`monitor_query.py` 的 `list_metrics` 和 `match_metric` 默认走 `--scope both`：
- **primary**：`dash_id` 主集（推荐候选）
- **extended**：同 `api_namespace` 下其他 `dash_id` 的扩展候选

`match_metric` 主集 0 命中时**自动回退** extended，并在结果里标 `matched_source=extended` + `note` 提示模型"用户可能想要别的子产品，必要时回到 instance_resolver 重选 strategy_type"。

### 4.4 Namespace 速查（典型云产品）

| 云产品 | Namespace（GetMonitorData 入参用大写） |
|--------|---------------------------------------|
| CVM 云服务器 | `QCE/CVM` |
| CDB MySQL | `QCE/CDB` |
| Redis | `QCE/REDIS_MEM` |
| CLB 负载均衡 | `QCE/LB_PUBLIC`（外网）/ `QCE/LB_PRIVATE`（内网） |
| COS 对象存储 | `QCE/COS` |
| CDN | `QCE/CDN` |
| CKAFKA | `QCE/CKAFKA` |

> 完整 Namespace 列表用 `tccli monitor DescribeProductList --Module monitor` 拉。注意 `DescribeProductList` 返回的是**小写形式**（`qce/cvm`），但 GetMonitorData 入参必须**大写**（`QCE/CVM`）——这是个坑。

### 4.5 调用约束

| 约束 | 阈值 |
|------|------|
| 单请求批量实例数 | ≤ 50 |
| 单请求数据点数 | ≤ 7200 |
| Period 粒度 | 10 / 60 / 300 / 3600 / 86400（秒），各指标支持的子集不同 |
| 时间范围跨度 | 受 Period 和数据点上限共同约束 |

## 5. 常见踩坑

- ❌ **dash_id 颗粒度漏指标**：cdb_detail 严格过滤 `dash_id=cdb` 只能看到 125/287 个 CDB 指标（详见 §4.3，已默认走 scope=both 修复）
- ❌ **`is_external=1` 默认过滤**：旧版默认行为会过滤掉 12 个 CDB 内部指标（如 `AliveStatus` 存活状态），现已改为默认不过滤；需要纯对外候选可加 `--external-only`
- ❌ **指标用 DescribeAllNamespaces 选**：那是告警视角，不是 API 视角（详见 §4.2）
- ❌ **地域错乱**：早期香港无机房，部分云产品在广州 set 上报"香港"数据。查不到时尝试切 region；离线数据中 `region_mapping` 字段标识此类映射
- ❌ **AppID 维度键名不统一**：不同云产品里 AppID 维度的 key 名可能是 `appid` / `Appid` / `uin`，不要硬编码
- ❌ **MetricName 大小写敏感**：`CpuUsage` 不是 `CPUUsage`、不是 `cpu_usage`，以离线数据 / `DescribeBaseMetrics` 输出为准
- ❌ **混用 Barad 和 API 模型字段**：传给 API 的 Namespace 是 `QCE/xxx`（大写带前缀），不是 Barad 视图名

## 6. 模块支撑数据（离线）

⭐ **重要**:模块用到的离线数据放在 `references/data/` 目录,**与 monitor-alarm 共用**(`alarm_strategy.jsonl` 同时被 `instance_resolver` 与 `alarm_lookup` 消费):

| 文件 | 行数 | 用途 |
|------|------|------|
| `alarm_strategy.jsonl` | 922 | 产品 → strategy_type → 实例 API 映射;含 namespace / dimension_group / available_regions 等字段(2026-06 由原 alarm-products.jsonl 合并而来) |
| `show_product_dash.jsonl` | 896 | strategy_type → dashboard_config_id |
| `api_metric_union.jsonl` | 12,910 | **API 查询指标全集**（按 dashboard_config_id 归属，详见 §4.2 §4.3） |

封装查询逻辑的脚本：
- [`scripts/monitor_query.py`](../../scripts/monitor_query.py) — GetMonitorData 工作流（list_metrics / match_metric / pick_period / build_request / execute_query）
- [`scripts/instance_resolver.py`](../../scripts/instance_resolver.py) — strategy_type 枢轴（find_strategy / load_config / list_instances / gen_dimensions），通用基础模块。详见 [instance-resolver.md](../instance-resolver.md)

## 7. 待补充 Action

- [ ] `DescribeBaseMetrics`：实时获取最权威的指标 schema 与维度 keys；目前以离线 jsonl 为权威，本 API 作为产品演进时的兜底
- [ ] `DescribeProductList`：在线获取产品列表
- [ ] `DescribeMonitorTypes`：监控类型分类
