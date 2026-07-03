# 应用性能监控 APM

> 范围：腾讯云**应用性能监控 APM** 的 API 调用入口。覆盖业务系统、应用、链路追踪、Span 分析、接口分析、数据库调用、漏洞扫描等场景。
>
> 边界：本文件**不**含告警相关 API。APM 的告警走 [monitor-alarm.md](monitor-alarm.md)。
>
> 时间戳约定：除特别注明外，统一用 Unix **秒**（非毫秒），`date +%s` 取当前。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 分布式应用性能管理（OpenTelemetry / Skywalking / Jaeger 兼容） |
| 数据形态 | 指标（Metrics）+ 链路（Trace）+ 日志（Logs） |
| tccli 服务名 | `apm` |
| 业务系统 ID 前缀 | `apm-`（如 `apm-lX3OgKtRC`） |

```bash
tccli apm help --detail
```

---

## 2. 业务核心概念

### 2.1 实体层级

```
业务系统 (apm-xxx)
 └── 应用 / 服务 (Service)
      └── 实例 (Instance, 一个进程)
           └── 接口 (Endpoint / Operation)
                └── Trace (调用链)
                     └── Span (调用单元)
```

| 概念 | 说明 |
|------|------|
| **业务系统** | 用于分类管理应用，每个业务系统有唯一 Token；不同业务系统间数据完全隔离 |
| **应用 / 服务** | 多个使用相同应用名接入的进程的逻辑组合，等同于微服务架构中的一个服务 |
| **实例** | 应用的实际部署单元，通常对应一个进程 |
| **Span** | 分布式追踪中的最小工作单元，记录单一操作 |
| **Trace** | 一组关联 Span 构成的有向无环图，对应一次完整请求 |

### 2.2 调用角色（Span Kind）

`Client` / `Server` / `Producer` / `Consumer` / `Internal` —— OpenTelemetry 标准。

### 2.3 关键性能指标

| 指标 | 说明 |
|------|------|
| 响应时间（Duration） | P50 / P95 / P99 分位值 |
| 错误率（Error Rate） | 区分客户端/服务端错误 |
| 吞吐量（Throughput / QPS） | 单位时间请求数 |
| Apdex | 应用性能满意度，0-1 区间 |

### 2.4 常见性能问题模式

| 模式 | Span 特征 | 建议 |
|------|----------|------|
| 慢查询 | DB 类型 Exit Span 耗时高 | 优化 SQL、加索引 |
| N+1 查询 | 同一 Trace 大量重复 DB Span | 改批量查询 |
| 级联超时 | 上游超时引发下游连锁失败 | 设超时、加熔断 |
| 长尾延迟 | P99 远高于 P50 | 排查 GC / 锁竞争 |

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 实例 | `DescribeApmInstances` | 列出 / 过滤 APM 业务系统实例 |
| 实例 | `DescribeApmAgent` | 查询某实例的 Agent 接入信息（语言/上报方式） |
| 实例 | `DescribeApmAssociation` | 查询实例与外部产品的关联关系 |
| 应用配置 | `DescribeApmApplicationConfig` | 查询单个服务的 APM 应用配置 |
| 应用配置 | `DescribeGeneralApmApplicationConfig` | 通用应用配置视图（更全字段） |
| 服务指标 | `DescribeApmServiceMetric` | 服务级核心指标列表（响应时间/错误率/请求量） |
| 服务指标 | `DescribeServiceOverview` | 服务概览聚合指标（按 GroupBy 维度） |
| 服务指标 | `DescribeGeneralMetricData` | 通用多维度聚合指标（任意 ViewName） |
| 服务指标 | `DescribeMetricRecords` | 通用指标明细（含分页/排序/OrFilter） |
| 调用链 | `DescribeGeneralSpanList` | 结构化 Span 列表 |
| 调用链 | `DescribeGeneralOTSpanList` | OpenTelemetry 原始 Span（字符串） |
| 拓扑 | `DescribeTopologyNew` | 服务拓扑图（节点 + 边） |
| 标签 | `DescribeTagValues` | 维度值枚举（service_name 等可选值） |
| 采样 | `DescribeApmSampleConfig` | 查询采样规则配置 |
| 告警规则 | `DescribeApmPrometheusRule` | 查询 APM Prometheus 告警规则（仅规则查询，告警策略走 monitor-alarm） |
| 漏洞 | `DescribeApmAllVulCount` | APM 全局漏洞计数 |
| 漏洞 | `DescribeOPRAllVulCount` | OPR 全局漏洞计数 |
| 漏洞 | `DescribeApmVulnerabilityCount` | 单服务漏洞计数 |
| 漏洞 | `DescribeApmVulnerabilityDetail` | 单实例漏洞详情 |
| 漏洞 | `DescribeApmSQLInjectionDetail` | SQL 注入风险明细 |

---

## 4. 详细 Action 用法

### 4.1 实例

#### DescribeApmInstances
- 用途: 列出 APM 业务系统实例（`apm-xxx`），支持按名称/ID/Tag 过滤。
- 必填: 无
- 可选: `--InstanceName`, `--InstanceId`, `--InstanceIds`, `--Tags`, `--DemoInstanceFlag`, `--AllRegionsFlag`
- 示例: `tccli apm DescribeApmInstances --region ap-guangzhou --InstanceName my-app`

#### DescribeApmAgent
- 用途: 查询某实例的 APM Agent 接入信息（接入命令/语言/上报方式）。**用于排查"为什么没数据"。**
- 必填: `--InstanceId` (string)
- 可选: `--AgentType`, `--NetworkMode`, `--LanguageEnvironment`, `--ReportMethod`
- 示例: `tccli apm DescribeApmAgent --InstanceId apm-xxxxxxxx --LanguageEnvironment java`

#### DescribeApmAssociation
- 用途: 查询实例与外部腾讯云产品的关联关系。
- 必填: `--ProductName` (string), `--InstanceId` (string)
- 示例: `tccli apm DescribeApmAssociation --ProductName monitor --InstanceId apm-xxxxxxxx`

### 4.2 应用配置

#### DescribeApmApplicationConfig
- 用途: 查询单个服务在 APM 中的应用配置（采样、过滤、慢调用阈值等）。
- 必填: `--InstanceId`, `--ServiceName`
- 示例: `tccli apm DescribeApmApplicationConfig --InstanceId apm-xxx --ServiceName my-svc`

#### DescribeGeneralApmApplicationConfig
- 用途: 服务的通用应用配置视图（字段更全，新版接口）。
- 必填: `--ServiceName`, `--InstanceId`
- 示例: `tccli apm DescribeGeneralApmApplicationConfig --InstanceId apm-xxx --ServiceName my-svc`

### 4.3 服务指标

#### DescribeApmServiceMetric
- 用途: 服务级核心指标列表（响应时间/错误率/请求量），支持分页/排序。
- 必填: `--InstanceId`
- 可选: `--ServiceName`, `--ServiceID`, `--StartTime`, `--EndTime`, `--Tags`, `--Filters`, `--ServiceStatus`, `--Page`, `--PageSize`, `--OrderBy`
- 示例: `tccli apm DescribeApmServiceMetric --InstanceId apm-xxx --StartTime 1700000000 --EndTime 1700003600 --PageSize 20`

#### DescribeServiceOverview
- 用途: 服务概览聚合指标，按 GroupBy 维度聚合。
- 必填: `--InstanceId`, `--Metrics` (Array of QueryMetricItem), `--StartTime`, `--EndTime`, `--GroupBy`
- 可选: `--Filters`, `--OrderBy`, `--Limit`, `--Offset`
- 示例:
  ```bash
  tccli apm DescribeServiceOverview --cli-input-json '{
    "InstanceId":"apm-xxx",
    "Metrics":[{"MetricName":"ResponseTime"}],
    "StartTime":1700000000,"EndTime":1700003600,
    "GroupBy":["ServiceName"]
  }'
  ```

#### DescribeGeneralMetricData
- 用途: 通用多维度聚合指标查询，可指定任意 `ViewName`（如 `span_service`、`span_db`）。
- 必填: `--InstanceId`, `--Metrics` (Array of String), `--ViewName`, `--Filters` (Array of GeneralFilter)
- 可选: `--GroupBy`, `--StartTime`, `--EndTime`, `--Period`, `--OrderBy`, `--PageSize`
- 示例:
  ```bash
  tccli apm DescribeGeneralMetricData --cli-input-json '{
    "InstanceId":"apm-xxx",
    "Metrics":["ResponseTime","ErrorCount"],
    "ViewName":"span_service",
    "Filters":[{"Key":"service_name","Value":["my-svc"]}],
    "StartTime":1700000000,"EndTime":1700003600,"Period":60
  }'
  ```

#### DescribeMetricRecords
- 用途: 通用指标明细记录查询，相比 ServiceOverview 提供 OrFilter / 多分页参数。
- 必填: `--InstanceId`, `--Metrics` (Array of QueryMetricItem), `--StartTime`, `--EndTime`, `--GroupBy`
- 可选: `--Filters`, `--OrFilters`, `--OrderBy`, `--BusinessName`, `--Type`, `--Limit`, `--Offset`, `--PageIndex`, `--PageSize`

### 4.4 调用链 / Span

#### DescribeGeneralSpanList
- 用途: 查询结构化 Span 列表（按 service_name / trace_id 过滤），返回 `Array of Span`。
- 必填: `--InstanceId`, `--StartTime`, `--EndTime`
- 可选: `--Filters`, `--OrderBy`, `--BusinessName`, `--Limit`, `--Offset`
- 常用 Filter Key: `service_name` / `span_name` / `trace_id` / `error` / `http.status_code`
- 示例:
  ```bash
  tccli apm DescribeGeneralSpanList --cli-input-json '{
    "InstanceId":"apm-xxx","StartTime":1700000000,"EndTime":1700003600,
    "Filters":[{"Key":"trace_id","Op":"=","Value":"abc123"}],"Limit":100
  }'
  ```

#### DescribeGeneralOTSpanList
- 用途: 同 GeneralSpanList，但返回 OpenTelemetry 原始 Span 字符串（`Spans` 为 String），用于跨平台导出。
- 必填: `--InstanceId`, `--StartTime`, `--EndTime`
- 可选: `--Filters`, `--OrderBy`, `--BusinessName`, `--Limit`, `--Offset`

### 4.5 拓扑

#### DescribeTopologyNew
- 用途: 服务拓扑图（节点 + 上下游边），支持上/下游层级控制。
- 必填: `--InstanceId`, `--StartTime`, `--EndTime`
- 可选: `--ServiceName`, `--ServiceInstance`, `--UpLevel`, `--DownLevel`, `--View`, `--Filters`, `--Tags`, `--TraceID`, `--IsSlowTopFive`, `--GetResource`, `--Selectors`, `--Hidden`, `--Topic`, `--Id`

### 4.6 标签 / 维度值

#### DescribeTagValues
- 用途: 枚举某 TagKey 在时间窗口内的所有可选值（如所有 service_name）。
- 必填: `--InstanceId`, `--TagKey`, `--StartTime`, `--EndTime`
- 可选: `--Filters`, `--OrFilters`, `--Type`
- 示例: `tccli apm DescribeTagValues --InstanceId apm-xxx --TagKey service_name --StartTime 1700000000 --EndTime 1700003600`

### 4.7 采样配置

#### DescribeApmSampleConfig
- 用途: 查询实例下的采样规则配置列表。
- 必填: `--InstanceId`
- 可选: `--SampleName`

### 4.8 告警规则（仅规则查询）

#### DescribeApmPrometheusRule
- 用途: 查询 APM 关联的 Prometheus 告警规则集合。
- 必填: `--InstanceId`
- 注: 告警策略 / 通知人 / 触发记录走 `monitor` 服务，参见 [monitor-alarm.md](monitor-alarm.md)。

### 4.9 漏洞 / SQL 注入

#### DescribeApmAllVulCount
- 用途: APM 全局漏洞计数（含一般/重要/严重三档）。
- 必填: `--StartTime`, `--EndTime`

#### DescribeOPRAllVulCount
- 用途: OPR（运营场景）全局漏洞计数。
- 必填: `--StartTime`, `--EndTime`

#### DescribeApmVulnerabilityCount
- 用途: 单个服务的漏洞计数。
- 必填: `--InstanceId`, `--ServiceName`, `--StartTime`
- 可选: `--EndTime`, `--Type`

#### DescribeApmVulnerabilityDetail
- 用途: 服务实例级漏洞详情（哪个实例触发哪类漏洞）。
- 必填: `--StartTime`, `--EndTime`, `--InstanceId`
- 可选: `--Filters`

#### DescribeApmSQLInjectionDetail
- 用途: SQL 注入风险明细记录，支持自定义 GroupBy/Metrics。
- 必填: `--InstanceId`
- 可选: `--StartTime`, `--EndTime`, `--Limit`, `--Offset`, `--Filters`, `--GroupBy`, `--Metrics`, `--OrderBy`

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `DescribeGeneralMetricData` | `Metrics`/`InstanceId`/`ViewName`/`Filters` 全部必填 | 用 `--cli-input-json` 传完整 JSON |
| `DescribeServiceOverview` | `Metrics`/`StartTime`/`EndTime`/`GroupBy` 全部必填 | 同上 |
| `DescribeMetricRecords` | `GroupBy` 必填，遗漏会报错 | 至少传一个分组维度 |
| `DescribeGeneralSpanList` | 时间窗口过大易超限 | 建议 ≤ 1 小时 |
| `DescribeApmVulnerabilityCount` | `EndTime` 可选但 `StartTime` 必填 | 不传 EndTime 默认到现在 |
| 时间戳 | Unix 秒（非毫秒） | `date +%s` |
| 没有数据 | Agent 未接入或上报失败 | 用 `DescribeApmAgent` 排查接入状态 |
| 告警查询想走 apm 服务 | 告警 API 全在 `monitor` 服务下 | 改走 [monitor-alarm.md](monitor-alarm.md) |

---

## 6. 关键 ID 格式

| ID | 格式示例 | 获取方式 |
|----|---------|---------|
| APM 实例 ID | `apm-xxxxxxxx` | `DescribeApmInstances` |
| 服务名 | 业务自定义字符串 | `DescribeTagValues --TagKey service_name` |
| TraceID | 32 hex 字符串 | `DescribeGeneralSpanList` 输出 |
