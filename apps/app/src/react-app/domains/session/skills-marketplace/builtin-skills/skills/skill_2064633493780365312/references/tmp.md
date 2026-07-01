# Prometheus 监控服务（TMP）

> 范围：腾讯云**Prometheus 监控服务（TMP）** 的 API 调用入口。覆盖 Prometheus 实例管理、Agent 管理、采集配置、PromQL 查询、Recording / Alerting Rule、模板、远程读写、集成中心。
>
> 边界：基于 Prometheus 数据的告警**通知策略**走 [monitor-alarm.md](monitor-alarm.md)；Prometheus 自有的 Alerting Rule 配置走本文件。Grafana 服务走 [grafana.md](grafana.md)。
>
> 调用通道：`tccli monitor`（Prometheus 子集，按 Action 名识别 — 通常带 `Prometheus` 前缀）。地域处理见 [common/region_dict.md](common/region_dict.md):列表类(`DescribePrometheusInstances` 等)默认 `ap-guangzhou` + 输出声明,实例特定查询反问 region。

## 目录

- § 1 业务定位
- § 2 业务核心概念 — 实体层级 / 关键术语 / 规格限制 / 上报与查询限制
- § 3 速查表 — 实例 / Agent / 配置 / 集成 / 告警规则 等
- § 4 详细 Action 用法
- § 5 常见踩坑
- § 6 关键 ID 格式

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 高可用全托管的 Prometheus 监控服务，深度集成 TKE 容器服务 |
| 能力 | 多维数据模型、PromQL 查询、动态服务发现、Recording Rule、Alerting Rule |
| tccli 服务名 | `monitor`（Prometheus 子集） |
| Prometheus 实例 ID | `prom-xxxxxxxx` |

```bash
tccli monitor help --detail | grep -i prom
```

---

## 2. 业务核心概念

### 2.1 实体层级

```
Prometheus 实例 (prom-xxx)
 ├── Prometheus 探针 (Agent)        → 部署在 K8s 集群，采集指标
 │    ├── 服务发现                   → Service Monitor / Pod Monitor
 │    ├── Job                       → 一组 Target 的抓取配置
 │    └── Target                    → 采集目标（Exporter / 应用）
 ├── PromQL 查询                    → 瞬时查询 / 时间跨度查询
 ├── Recording Rule                 → PromQL 预加工指标
 ├── Alerting Rule                  → PromQL 告警条件（通知配置归 monitor-alarm）
 ├── 集成中心                        → 一键安装第三方监控
 └── 云产品监控集成                   → 一键接入腾讯云产品的指标
```

### 2.2 关键术语

| 术语 | 说明 |
|------|------|
| **指标（Metric）** | 由指标名（`__name__`）+ 一组 Label 唯一标识 |
| **Label** | 描述指标的 Key-Value，组合维度 |
| **时间序列（Series）** | 指标名 + Label 组合唯一确定的一条时间线 |
| **TPS** | 每秒数据点上报总数 |
| **Exporter** | 暴露监控数据的组件 |
| **PromQL** | 查询语言，支持瞬时 / 时间跨度查询 |

### 2.3 实例规格与限制

| 限制项 | 付费实例 | 免费试用 |
|-------|---------|---------|
| Series 上限 | 450 万 | 200 万 |
| 数据点上报速率 | 30 万/秒 | 10 万/秒 |

### 2.4 数据上报规范

| 限制项 | 阈值 |
|-------|------|
| 指标名规范 | `[a-zA-Z_:][a-zA-Z0-9_:]*` |
| 标签名规范 | `[a-zA-Z_][a-zA-Z0-9_]*`，`__` 开头仅供内部使用 |
| 单指标标签数上限 | 32 |
| 标签名/值长度 | 1024 / 2048 字符 |
| 单指标维度组合上限 | 10 万（histogram 类型不支持调整） |

### 2.5 查询限制

| 限制项 | 阈值 |
|-------|------|
| 单查询最大 series 数 | 100,000 |
| 单查询最大数据量 | 100 MB |
| 查询并发 | 无频次限制，> 15 可能排队 |

> 时间跨度 > 2 周的大查询延时风险升高。建议拆分查询或先预聚合。

### 2.6 告警与预聚合限制

| 限制项 | 阈值 |
|-------|------|
| 单实例告警规则数上限 | 150 |
| 单实例总告警数量上限 | 2,000（超出丢弃） |
| 单实例所有告警字段总大小 | 20 MiB（超出丢弃） |
| 单实例 Recording Rule 上限 | 150 |
| 单 Recording Rule 分组规则上限 | 35 |

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 实例 | `DescribePrometheusInstances` | 列出实例（按名称/状态/Tag 过滤） |
| 实例 | `DescribePrometheusInstancesOverview` | 实例总览（轻量列表 + 状态） |
| 实例 | `DescribePrometheusInstanceDetail` | 单实例详情（含 Grafana 关联） |
| 实例 | `DescribePrometheusInstanceInitStatus` | 实例初始化进度 |
| 实例 | `DescribePrometheusInstanceUsage` | 实例用量（指标量/上报量） |
| Agent | `DescribePrometheusAgents` | Agent 列表 |
| Agent | `DescribePrometheusAgentInstances` | 集群关联的 Agent 实例 |
| Agent | `GetPrometheusAgentManagementCommand` | 查询 Agent 安装/卸载命令 |
| 集群 | `DescribePrometheusClusterAgents` | 关联集群（TKE/EKS/外部）列表 |
| 集群 | `DescribeClusterAgentCreatingProgress` | 集群关联进度 |
| 采集配置 | `DescribePrometheusConfig` | 集群级采集配置 |
| 采集配置 | `DescribePrometheusGlobalConfig` | 实例级全局采集配置 |
| 采集任务 | `DescribePrometheusScrapeJobs` | 抓取任务列表（按 Agent） |
| 采集任务 | `DescribePrometheusScrapeStatistics` | 抓取统计 |
| 抓取目标 | `DescribePrometheusTargetsTMP` | TMP 实例下的抓取目标列表 |
| 服务发现 | `DescribeServiceDiscovery` | K8s 服务发现配置 |
| 模板 | `DescribePrometheusTemp` | 抓取/告警模板列表 |
| 模板 | `DescribePrometheusTempSync` | 模板同步状态 |
| 告警 | `DescribePrometheusAlertGroups` | 告警分组（新版） |
| 告警 | `DescribePrometheusAlertPolicy` | 告警策略 |
| 告警 | `DescribePrometheusGlobalNotification` | 全局告警通知配置 |
| 告警 | `DescribeAlertRules` | 告警规则（基础版） |
| 聚合规则 | `DescribePrometheusRecordRules` | Prometheus Record Rule（YAML） |
| 聚合规则 | `DescribeRecordingRules` | 聚合规则（结构化） |
| 远程读写 | `DescribeRemoteURLs` | Remote URL 列表 |
| 远程读写 | `DescribeRemoteWrites` | RemoteWrite 配置列表 |
| 集成 | `DescribePrometheusIntegrationMetrics` | 集成中心可用指标 |
| 地域 | `DescribePrometheusRegions` | 可用地域列表 |
| 地域 | `DescribePrometheusZones` | 可用区列表 |
| 探测 | `CheckAddressByPrometheus` | 检查地址是否可达 |
| **直通** | `ExportPrometheusReadOnlyDynamicAPI` | **直接代理 Prometheus HTTP API（PromQL/查询）** |

> 写动作（`Create*` / `Modify*` / `Update*` / `Delete*` / `Run*` / `Sync*` / `Terminate*` / `Bind*` / `Unbind*` / `Resume*` / `Enable*` / `Install*` / `Uninstall*` / `Upgrade*` / `Clean*` / `Destroy*`）**不在本 skill 范围**,引导用户前往腾讯云控制台。

---

## 4. 详细 Action 用法

### 4.1 实例

#### DescribePrometheusInstances
- 用途: 列出 Prometheus 实例。
- 必填: 无
- 可选: `--InstanceIds`, `--InstanceStatus` (Array), `--InstanceName`, `--Zones`, `--TagFilters`, `--IPv4Address`, `--Limit`, `--Offset`, `--InstanceChargeType`
- 示例: `tccli monitor DescribePrometheusInstances --Limit 20 --Offset 0 --InstanceName my-prom`

#### DescribePrometheusInstancesOverview
- 用途: 实例总览列表（含运行状态、计费、Grafana 关联）。
- 必填: 无
- 可选: `--Offset`, `--Limit`, `--Filters`

#### DescribePrometheusInstanceDetail
- 用途: 单实例详情（含 Grafana URL、IPv4、子网等）。
- 必填: `--InstanceId`

#### DescribePrometheusInstanceInitStatus
- 用途: 查询实例初始化进度（新购实例时使用）。
- 必填: `--InstanceId`

#### DescribePrometheusInstanceUsage
- 用途: 实例计量用量（按时间区间）。
- 必填: `--InstanceIds` (Array), `--StartCalcDate` (string YYYY-MM-DD), `--EndCalcDate`
- 示例: `tccli monitor DescribePrometheusInstanceUsage --InstanceIds prom-xxx --StartCalcDate 2024-01-01 --EndCalcDate 2024-01-31`

### 4.2 Agent / 集群关联

#### DescribePrometheusAgents
- 用途: 列出实例下的 Agent。
- 必填: `--InstanceId`
- 可选: `--Name`, `--AgentIds`, `--Offset`, `--Limit`

#### DescribePrometheusAgentInstances
- 用途: 给定集群 ID 列出已关联的 TMP 实例。
- 必填: `--ClusterId`

#### GetPrometheusAgentManagementCommand
- 用途: 获取 Agent 安装/卸载命令。
- 必填: `--InstanceId`, `--AgentId`

#### DescribePrometheusClusterAgents
- 用途: 列出实例已关联的 K8s 集群 Agent。
- 必填: `--InstanceId`
- 可选: `--Offset`, `--Limit`, `--ClusterIds`, `--ClusterTypes`, `--ClusterName`

#### DescribeClusterAgentCreatingProgress
- 用途: 集群 Agent 创建进度。
- 必填: `--InstanceId`, `--ClusterIds` (Array)

### 4.3 采集配置 / 抓取任务 / 服务发现

#### DescribePrometheusConfig
- 用途: 集群级采集配置（ServiceMonitor / PodMonitor / RawJob 列表）。
- 必填: `--InstanceId`, `--ClusterId`, `--ClusterType` (TKE/EKS/MDP/...)

#### DescribePrometheusGlobalConfig
- 用途: 实例全局采集配置（实例级 RawJobs/ServiceMonitors/PodMonitors）。
- 必填: `--InstanceId`
- 可选: `--DisableStatistics`

#### DescribePrometheusScrapeJobs
- 用途: 列出抓取任务（按 Agent）。
- 必填: `--InstanceId`, `--AgentId`
- 可选: `--Name`, `--JobIds`, `--Offset`, `--Limit`

#### DescribePrometheusScrapeStatistics
- 用途: 抓取任务统计（指标量/Target 数）。
- 必填: `--InstanceIds` (Array)
- 可选: `--ClusterId`, `--JobType`, `--Job`

#### DescribePrometheusTargetsTMP
- 用途: TMP 实例下抓取目标列表（含 health/lastScrape）。
- 必填: `--InstanceId`, `--ClusterId`
- 可选: `--ClusterType`, `--Filters`, `--Offset`, `--Limit`

#### DescribeServiceDiscovery
- 用途: K8s 集群服务发现规则（ServiceMonitor/PodMonitor）。
- 必填: `--InstanceId`, `--KubeClusterId`, `--KubeType` (1=TKE, 2=EKS, 3=外部)

### 4.4 模板 / 聚合规则

#### DescribePrometheusTemp
- 用途: 列出抓取/告警/聚合规则模板。
- 必填: 无
- 可选: `--Filters`, `--Offset`, `--Limit`

#### DescribePrometheusTempSync
- 用途: 模板同步状态（哪些实例已同步该模板）。
- 必填: `--TemplateId`

#### DescribePrometheusRecordRules
- 用途: 列出 Record Rule（YAML 形式）。
- 必填: `--InstanceId`
- 可选: `--Offset`, `--Limit`, `--Filters`

#### DescribeRecordingRules
- 用途: 列出聚合规则（结构化形式，与 RecordRules 等价的另一接口）。
- 必填: `--InstanceId`
- 可选: `--Limit`, `--Offset`, `--RuleId`, `--RuleState`, `--Name`

### 4.5 告警

#### DescribePrometheusAlertGroups
- 用途: 列出告警分组（新版告警）。
- 必填: 无（建议传 `--InstanceId`）
- 可选: `--InstanceId`, `--Limit`, `--Offset`, `--GroupId`, `--GroupName`

#### DescribePrometheusAlertPolicy
- 用途: 列出告警策略。
- 必填: `--InstanceId`
- 可选: `--Offset`, `--Limit`, `--Filters`

#### DescribePrometheusGlobalNotification
- 用途: 实例全局告警通知配置。
- 必填: `--InstanceId`

#### DescribeAlertRules
- 用途: 列出告警规则（基础版兼容接口）。
- 必填: `--InstanceId`
- 可选: `--Limit`, `--Offset`, `--RuleId`, `--RuleState`, `--RuleName`, `--Type`

### 4.6 远程读写 / 集成

#### DescribeRemoteURLs
- 用途: 列出 Remote URL（Remote Read/Write 端点）。
- 必填: `--InstanceId`
- 可选: `--RemoteURLs` (Array)

#### DescribeRemoteWrites
- 用途: RemoteWrite 配置列表。
- 必填: `--InstanceId`
- 可选: `--Offset`, `--Limit`

#### DescribePrometheusIntegrationMetrics
- 用途: 查询集成中心某集成（如 Redis / MySQL）暴露的指标。
- 必填: `--IntegrationCode`

### 4.7 地域 / 探测

#### DescribePrometheusRegions
- 用途: 列出 Prometheus 可用地域。
- 必填: 无
- 可选: `--PayMode`

#### DescribePrometheusZones
- 用途: 列出可用区。
- 必填: 无
- 可选: `--RegionId`, `--RegionName`

#### CheckAddressByPrometheus
- 用途: 通过 Prometheus 探针检查目标地址连通性。
- 必填: `--InstanceId`, `--Target`
- 可选: `--ProbeProtocol` (http/https/tcp)

### 4.8 直通 Prometheus HTTP API（关键能力）

#### ExportPrometheusReadOnlyDynamicAPI
- 用途: **直接代理 Prometheus 原生 HTTP API**（执行 PromQL、查 Series、查 Labels 等只读接口）。
- 必填: `--InstanceId`, `--Method` (GET/POST), `--Path` (如 `/api/v1/query`、`/api/v1/query_range`、`/api/v1/series`、`/api/v1/labels`)
- 可选: `--RequestBody`, `--Headers`, `--SelfMonitor`
- 示例 - 即时 PromQL 查询:
  ```bash
  tccli monitor ExportPrometheusReadOnlyDynamicAPI --cli-input-json '{
    "InstanceId": "prom-xxx",
    "Method": "GET",
    "Path": "/api/v1/query?query=up"
  }'
  ```
- 示例 - 范围查询:
  ```bash
  tccli monitor ExportPrometheusReadOnlyDynamicAPI --cli-input-json '{
    "InstanceId": "prom-xxx",
    "Method": "GET",
    "Path": "/api/v1/query_range?query=rate(http_requests_total[5m])&start=1700000000&end=1700003600&step=60"
  }'
  ```

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `DescribePrometheusConfig` | `ClusterId`/`ClusterType` 必填 | 先 `DescribePrometheusClusterAgents` 拿集群三元组 |
| `DescribePrometheusScrapeJobs` | 需要 `AgentId` 而非 ClusterId | 先 `DescribePrometheusAgents` 拿 AgentId |
| `DescribePrometheusInstanceUsage` | 时间字段是 `YYYY-MM-DD` 字符串 | 不要传 Unix 时间戳 |
| `ExportPrometheusReadOnlyDynamicAPI` | Path 需带前导 `/api/v1/...` | 与原生 Prometheus HTTP API 完全一致 |
| `DescribeServiceDiscovery` | `KubeType` 是整数（1/2/3） | 1=TKE, 2=EKS, 3=外部集群 |
| `DescribeAlertRules` vs `DescribePrometheusAlertGroups` | 对应基础版告警 vs 新版告警分组 | 新版优先用 `*AlertGroups` / `*AlertPolicy` |
| `DescribePrometheusRecordRules` vs `DescribeRecordingRules` | 一个返回 YAML，一个返回结构化 | 看下游消费方式选 |
| Prometheus Alerting Rule vs 云监控告警混淆 | Prometheus 自有的 Alerting Rule（PromQL 触发条件）配在 TMP 实例下；通知人 / 通知渠道配置归 monitor-alarm | 别把两套混在一起查 |
| PromQL 查询超时 | 跨度超 2 周或涉及 series 过多时慢 | 拆分查询或先预聚合（Recording Rule） |
| Series 暴涨 | 高基数 Label（如 user_id）导致 series 维度组合超限 | 移除高基数 Label 或聚合后上报 |
| 指标名 / 标签名不合规 | 上报会被丢弃 | 以 §2.4 规范校验 |

---

## 6. 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| Prometheus 实例 ID | `prom-xxxxxxxx` | `DescribePrometheusInstances` |
| Agent ID | `agent-xxxxxxxx` | `DescribePrometheusAgents` |
| 集群 ID | `cls-xxxxxxxx` (TKE) / 自定义 | `DescribePrometheusClusterAgents` |
| 模板 ID | `temp-xxxxxxxx` | `DescribePrometheusTemp` |
| 集成 Code | 字符串（如 `qcloud-redis`） | 控制台或 `DescribePrometheusIntegrationMetrics` 文档 |
