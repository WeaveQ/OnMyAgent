# 云压测（PTS）

> 范围：腾讯云**云压测 PTS** 的 API 调用入口。覆盖压测项目 / 场景 / 任务 / 指标 / 日志 / 文件 / 告警查询。
>
> 时间戳约定：PTS 多数为 Timestamp 类型（**RFC3339 / ISO8601 字符串**，如 `2024-01-01T00:00:00+08:00`），具体接口需以 `tccli pts <Action> help --detail` 为准。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 分布式性能测试服务，模拟海量用户的真实业务场景 |
| 能力 | 百万并发、多协议压测、原生 JMeter 兼容 |
| tccli 服务名 | `pts` |

```bash
tccli pts help --detail
```

---

## 2. 业务核心概念

### 2.1 应用场景

| 场景 | 说明 |
|------|------|
| 应用性能评估 | 系统上线前的容量与稳定性评估 |
| 多地域压测 | 模拟不同地域用户并发访问 |
| 复杂场景模拟 | 多步骤业务流、登录态压测、参数化测试 |

### 2.2 协议支持

HTTP/HTTPS、WebSocket、TCP/UDP、原生 JMeter 脚本等。具体协议清单以 tccli 当前版本支持为准。

### 2.3 实体层级

```
项目 (project-xxx)
 └── 场景 (scenario-xxx)
      └── 任务 / Job (job-xxx)         → 压测运行实例
           └── 指标 / 日志 / 错误汇总
```

三元组 `(ProjectId, ScenarioId, JobId)` 是绝大多数任务级查询接口的必填组合。

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 项目 | `DescribeProjects` | 列出 PTS 项目 |
| 场景 | `DescribeScenarios` | 列出压测场景 |
| 场景 | `DescribeScenarioWithJobs` | 列出场景及其关联 Job |
| 任务 | `DescribeJobs` | 列出压测任务（按场景/项目） |
| 任务 | `DescribeCronJobs` | 列出定时任务 |
| 任务 | `DescribeCheckSummary` | 任务断言通过率汇总 |
| 任务 | `DescribeRequestSummary` | 任务请求级汇总（QPS/响应时间） |
| 任务 | `DescribeErrorSummary` | 任务错误汇总 |
| 指标 | `DescribeAvailableMetrics` | 列出可用指标元数据 |
| 指标 | `DescribeSampleQuery` | 单指标即时点查询 |
| 指标 | `DescribeSampleBatchQuery` | 多指标批量即时点查询 |
| 指标 | `DescribeSampleMatrixQuery` | 单指标时序查询 |
| 指标 | `DescribeSampleMatrixBatchQuery` | 多指标批量时序查询 |
| 指标 | `DescribeMetricLabelWithValues` | 任务可用指标 + 标签 + 标签值树 |
| 指标 | `DescribeLabelValues` | 单指标某 Label 的可选值 |
| 日志 | `DescribeNormalLogs` | 普通运行日志（流量/错误/调试） |
| 日志 | `DescribeSampleLogs` | 采样请求日志（含完整请求响应） |
| 文件 | `DescribeFiles` | 数据集 / 脚本文件列表 |
| 环境 | `DescribeEnvironments` | 环境变量配置列表 |
| 告警 | `DescribeAlertChannels` | 告警通知渠道列表 |
| 告警 | `DescribeAlertRecords` | 告警触发记录 |
| 通用 | `DescribeRegions` | 可用压测发起地域 |

> 写动作（`Create*` / `Update*` / `Delete*` / `Abort*` / `Adjust*` / `Copy*` / `Restart*` / `StartJob` / `GenerateTmpKey`）**不在本 skill 范围**,引导用户前往腾讯云控制台。⚠️ 启动压测涉及消耗资源、可能击穿被压目标,本 skill **严格不构造**任何压测启动命令。

---

## 4. 详细 Action 用法

### 4.1 项目 / 场景

#### DescribeProjects
- 用途: 列出 PTS 项目。
- 必填: 无
- 可选: `--Offset`, `--Limit`, `--ProjectIds`, `--ProjectName`, `--OrderBy`, `--Ascend`, `--TagFilters`
- 示例: `tccli pts DescribeProjects --Limit 20 --Offset 0`

#### DescribeScenarios
- 用途: 列出压测场景，按项目/状态/类型筛选。
- 必填: 无
- 可选: `--ScenarioIds`, `--ScenarioName`, `--ScenarioStatus` (Array), `--Offset`, `--Limit`, `--OrderBy`, `--Ascend`, `--ProjectIds`, `--ScenarioType`
- 示例: `tccli pts DescribeScenarios --ProjectIds project-xxx --Limit 20`

#### DescribeScenarioWithJobs
- 用途: 列出场景及其关联 Job，可同时过滤场景与 Job 字段。
- 必填: 无
- 可选: `--Offset`, `--Limit`, `--ProjectIds`, `--ScenarioIds`, `--ScenarioName`, `--ScenarioStatus`, `--OrderBy`, `--Ascend`, `--ScenarioRelatedJobsParams`, `--IgnoreScript`, `--IgnoreDataset`, `--ScenarioType`, `--Owner`

### 4.2 任务（Job / CronJob）

#### DescribeJobs
- 用途: 列出压测任务（运行实例）。
- 必填: `--ScenarioIds` (Array), `--ProjectIds` (Array)
- 可选: `--Offset`, `--Limit`, `--JobIds`, `--OrderBy`, `--Ascend`, `--StartTime` (Timestamp), `--EndTime`, `--Debug`, `--Status` (Array)
- 示例: `tccli pts DescribeJobs --ScenarioIds scenario-xxx --ProjectIds project-xxx --Limit 20`

#### DescribeCronJobs
- 用途: 列出定时压测任务。
- 必填: `--ProjectIds` (Array)
- 可选: `--Offset`, `--Limit`, `--CronJobIds`, `--CronJobName`, `--CronJobStatus` (Array), `--OrderBy`, `--Ascend`

#### DescribeCheckSummary
- 用途: 单任务断言通过/失败统计。
- 必填: `--JobId`, `--ScenarioId`, `--ProjectId`

#### DescribeRequestSummary
- 用途: 单任务请求级汇总（QPS、响应时间分位等）。
- 必填: `--JobId`, `--ScenarioId`, `--ProjectId`

#### DescribeErrorSummary
- 用途: 单任务错误汇总。
- 必填: `--JobId`, `--ScenarioId`, `--ProjectId`
- 可选: `--Filters` (Array of Filter)

### 4.3 指标查询

#### DescribeAvailableMetrics
- 用途: 列出 PTS 全量可用指标元数据。
- 必填: 无
- 示例: `tccli pts DescribeAvailableMetrics`

#### DescribeSampleQuery
- 用途: 单指标即时点查询（按 Job + Metric + Aggregation）。
- 必填: `--JobId`, `--ScenarioId`, `--Metric`, `--Aggregation`, `--ProjectId`
- 可选: `--Labels` (Array of Label)

#### DescribeSampleBatchQuery
- 用途: 一次查询多指标即时点。
- 必填: `--JobId`, `--ScenarioId`, `--Queries` (Array of InternalMetricQuery), `--ProjectId`

#### DescribeSampleMatrixQuery
- 用途: 单指标时序矩阵（多 Label 多时间点）。
- 必填: `--JobId`, `--ProjectId`, `--ScenarioId`, `--Metric`, `--Aggregation`
- 可选: `--Filters` (Array of Filter), `--GroupBy` (Array of String), `--MaxPoint`

#### DescribeSampleMatrixBatchQuery
- 用途: 多指标批量时序查询（一次拿全图）。
- 必填: `--JobId`, `--ProjectId`, `--ScenarioId`, `--Queries`
- 可选: `--MaxPoint`

#### DescribeMetricLabelWithValues
- 用途: 列出任务下可用指标及每个指标的 Label/Value 树。
- 必填: `--JobId`, `--ProjectId`, `--ScenarioId`

#### DescribeLabelValues
- 用途: 某个 Metric 上某 Label 的可选值。
- 必填: `--JobId`, `--ScenarioId`, `--Metric`, `--LabelName`, `--ProjectId`

### 4.4 日志

#### DescribeNormalLogs
- 用途: 压测过程普通日志（采样器/插件输出/调试信息）。
- 必填: `--ProjectId`, `--ScenarioId`, `--JobId`
- 可选: `--Context`, `--From` (Timestamp), `--To`, `--SeverityText`, `--Instance`, `--InstanceRegion`, `--LogType`, `--Limit`

#### DescribeSampleLogs
- 用途: 采样请求日志（包含完整请求/响应原文）。
- 必填: `--ProjectId`, `--ScenarioId`, `--JobId`
- 可选: `--Context`, `--From`, `--To`, `--SeverityText`, `--InstanceRegion`, `--Instance`, `--LogType`, `--Offset`, `--Limit`, `--ReactionTimeRange`, `--Status`, `--Result`, `--Method`, `--Service`

### 4.5 文件 / 环境

#### DescribeFiles
- 用途: 列出项目下的数据集 / 脚本文件。
- 必填: `--ProjectIds` (Array)
- 可选: `--FileIds`, `--FileName`, `--Offset`, `--Limit`, `--Kind`

#### DescribeEnvironments
- 用途: 列出环境变量配置（接口当前无入参约束，按账号粒度）。
- 必填: 无

### 4.6 告警

#### DescribeAlertChannels
- 用途: 列出告警通知渠道（关联到项目）。
- 必填: `--ProjectIds` (Array)
- 可选: `--Offset`, `--Limit`, `--NoticeIds`, `--OrderBy`, `--Ascend`

#### DescribeAlertRecords
- 用途: 列出告警触发记录。
- 必填: `--ProjectIds` (Array)
- 可选: `--ScenarioIds`, `--JobIds`, `--Ascend`, `--OrderBy`, `--Offset`, `--Limit`, `--ScenarioNames`

### 4.7 通用

#### DescribeRegions
- 用途: 列出可用的压测发起地域。
- 必填: 无
- 可选: `--LoadType`

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `DescribeJobs` | `ScenarioIds`/`ProjectIds` 都是 Required | 必须同时传两个数组 |
| `DescribeCheckSummary`/`RequestSummary`/`ErrorSummary` | 三元组（JobId/ScenarioId/ProjectId）缺一不可 | 通过 `DescribeJobs` 拿到三元组后再查 |
| `DescribeSampleMatrixQuery` | `Aggregation` 必填，PTS 内置 `avg`/`sum`/`p99` 等 | 不熟悉时先 `DescribeAvailableMetrics` |
| `From`/`To` 时间字段 | Timestamp 类型（字符串） | 用 ISO8601：`2024-01-01T00:00:00+08:00` |
| `Context` 字段 | 翻页游标，不要手填 | 取上次响应的 `Context` 回填 |
| 启动压测写操作 | 启动压测会消耗资源、可能击穿被压目标 | **不在本 skill 范围**,引导用户前往腾讯云控制台,本 skill **严格不构造**任何压测启动命令 |
| 报告数据时延 | 压测结束后报告数据可能有几分钟延迟 | 等待几分钟再查询，避免空数据误判 |

---

## 6. 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| 项目 ID | `project-xxxxxxxx` | `DescribeProjects` |
| 场景 ID | `scenario-xxxxxxxx` | `DescribeScenarios` |
| 任务 ID | `job-xxxxxxxx` | `DescribeJobs` |
| 文件 ID | `file-xxxxxxxx` | `DescribeFiles` |
