# 前端性能监控（RUM）

> 范围：**Web / 小程序 / 跨端框架**的前端真实用户体验监控（Real User Monitoring）。属于 RUM 体系的"前端"分支。
>
> 边界：原生客户端（Android/iOS/鸿蒙/Flutter）走 [rum-app-pro.md](rum-app-pro.md)。告警走 [monitor-alarm.md](monitor-alarm.md)。
>
> 时间戳约定：数据接口为 Unix **秒**（int）；评分接口为字符串。具体看接口定义。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 前端真实用户体验监控（页面性能 + 错误质量） |
| 覆盖平台 | Web、微信小程序、QQ 小程序、Hippy、Weex、React Native、Flutter、Cocos |
| 接入形态 | 一行代码 SDK，无侵入 |
| tccli 服务名 | `rum`（与终端 Pro 共用，按 Action / 项目维度区分） |

```bash
tccli rum help --detail
```

`rum` 服务下同时存在 RUM 和终端 Pro 的 Action（产品历史原因）。**判断 Action 归属看名字 + 文档说明**，不是看服务名。RUM 的 Action 通常带 `Project` / `Web` / `Pv` / `Performance` / `WebVitals` / `Fetch` / `Static` 等关键字。

---

## 2. 业务核心概念

### 2.1 监控维度

| 类别 | 指标举例 |
|------|---------|
| 页面性能 | 首屏时间、白屏时间、DOM Ready、Load 完成 |
| 资源测速 | 资源加载耗时、成功率、CDN 命中率 |
| API 测速 | Ajax 接口耗时、成功率、错误码分布 |
| 前端质量 | JS 错误率、Ajax 错误率、未捕获异常 |
| 用户行为 | PV / UV、页面停留时长、跳出率 |

### 2.2 SDK 关键能力

- **无侵入**：不需在业务代码打点
- **白名单机制**：可过滤特定接口、域名
- **离线日志**：支持崩溃 / 异常时离线收集
- **首屏测速**：自动监听页面渲染时机

### 2.3 关键 ID 概念

| ID | 类型 | 用途 |
|----|------|------|
| 项目 ID（`ID` / `ProjectId` / `ProjectID`） | **Integer** | 数据接口主键，先 `DescribeProjects` 拿 |
| 实例 ID | String（`rum-xxxxxxxx`） | 实例级配置 |
| ProductId | String（`m-xxxxxxxx`） | 异常 / Issue 系列接口主键 |

### 2.4 与 APM 的联动

前端性能监控可与 APM 联动，实现**前后端一体化监控**——前端 trace 串联到后端 Trace（共享 Trace ID）。当用户问"前端慢请求接到后端是哪一段慢"时，需要 RUM + APM 联动查询。

---

## 3. 速查表

### 3.1 实例 / 项目 / 接入

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 实例 | `DescribeTawInstances` | 列出 RUM 实例 |
| 实例 | `DescribeTawAreas` | 列出可用区/地域 |
| 项目 | `DescribeProjects` | 列出项目（按 Filter） |
| 项目 | `DescribeProjectLimits` | 项目配额限制 |
| 白名单 | `DescribeWhitelists` | 查询白名单（按实例） |
| 接入 | `DescribeToken` | 查询/校验上报 Token |
| 发布版本 | `DescribeReleaseFiles` | 列出 SourceMap / 发布文件 |
| 发布版本 | `DescribeReleaseFileSign` | 上传发布文件签名 |

### 3.2 评分 / PV / UV

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 评分 | `DescribeScores` | 项目体验评分 |
| 评分 | `DescribeScoresV2` | 项目体验评分 V2 |
| PV/UV | `DescribePvList` | PV 列表 |
| PV/UV | `DescribeUvList` | UV 列表 |
| 通用查询 | `DescribeData` | 通用数据查询接口（自定义 Query） |

### 3.3 数据查询（V1/V2 通用模式 — 优先用 V2）

| 域 | V1 | V2（推荐） |
|----|-----|-----------|
| 桥接 | — | `DescribeDataBridgeUrlV2` |
| 自定义 | `DescribeDataCustomUrl` | `DescribeDataCustomUrlV2` |
| 事件 | `DescribeDataEventUrl` | `DescribeDataEventUrlV2` |
| Fetch（接口） | `DescribeDataFetchUrl` / `DescribeDataFetchUrlInfo` / `DescribeDataFetchProject` | `DescribeDataFetchUrlV2` |
| 日志 | `DescribeDataLogUrlInfo` / `DescribeDataLogUrlStatistics` | `DescribeDataLogUrlStatisticsV2` |
| 性能 | `DescribeDataPerformancePage` | `DescribeDataPerformancePageV2` |
| PV | `DescribeDataPvUrlInfo` / `DescribeDataPvUrlStatistics` | `DescribeDataPvUrlStatisticsV2` |
| Set | `DescribeDataSetUrlStatistics` | `DescribeDataSetUrlStatisticsV2` |
| Static-Project | `DescribeDataStaticProject` | `DescribeDataStaticProjectV2` |
| Static-Resource | `DescribeDataStaticResource` | `DescribeDataStaticResourceV2` |
| Static-Url | `DescribeDataStaticUrl` | `DescribeDataStaticUrlV2` |
| Web Vitals | `DescribeDataWebVitalsPage` | `DescribeDataWebVitalsPageV2` |
| 上报量 | `DescribeDataReportCount` | `DescribeDataReportCountV2` |

### 3.4 异常 / Issue（前端 JS 异常类，按 ProductId 操作）

| 动作 | 一句话用途 |
|------|------------|
| `DescribeError` | 单个错误堆栈 |
| `DescribeExceptionDetail` / `DescribeExceptionReportList` | 异常详情/列表 |
| `DescribeIssuesList` / `DescribeIssuesDistribution` / `DescribeIssuesStatisticsTrend` / `DescribeTopIssues` | Issue 聚合/分布/趋势/Top |

### 3.5 RUM 日志

| 动作 | 一句话用途 |
|------|------------|
| `DescribeRumLogList` / `DescribeRumLogTotalV2` | 日志列表/总量 |
| `DescribeRumStatsLogList[V2]` | 统计型日志 |
| `DescribeRumGroupLog[V2]` | 分组日志 |
| `DescribeRumLogDetailsV2` | 日志明细 |
| `DescribeRumLogExport[V2]` / `DescribeRumLogExports[V2]` | 日志导出任务 |

> 移动端原生 App 维度的 Action（`DescribeAppMetricsData` / `DescribeAppDimensionMetrics` / `DescribeAppSingleCase*` / `DescribeApplicationExitReport*` / FOOM / 卡顿 / ANR）属于终端 Pro，参见 [rum-app-pro.md](rum-app-pro.md)。

---

## 4. 详细 Action 用法

### 4.1 实例 / 项目

#### DescribeTawInstances
- 用途: 列出 RUM 实例。
- 必填: 无
- 可选: `--ChargeStatuses`, `--ChargeTypes`, `--Limit`, `--Offset`, `--AreaIds`, `--InstanceStatuses`, `--InstanceIds`, `--Filters`, `--IsDemo`
- 示例: `tccli rum DescribeTawInstances --Limit 20 --Offset 0`

#### DescribeTawAreas
- 用途: 列出可用区/地域。
- 必填: 无
- 可选: `--AreaIds`, `--AreaKeys`, `--AreaStatuses`, `--Limit`, `--Offset`

#### DescribeProjects
- 用途: 列出 RUM 项目。
- 必填: `--Limit` (int), `--Offset` (int)
- 可选: `--Filters`, `--IsDemo`
- 示例: `tccli rum DescribeProjects --Limit 20 --Offset 0`

#### DescribeProjectLimits
- 用途: 查询项目配额限制（PV/UV/上报量等）。
- 必填: `--ProjectID`, `--Limit`, `--Offset`
- 可选: `--Filters`, `--IsDemo`

#### DescribeWhitelists
- 用途: 查询实例白名单。
- 必填: `--InstanceID` (string)

### 4.2 接入 / 发布版本

#### DescribeToken
- 用途: 查询上报 Token（接入用）。
- 必填: `--ProductId`
- 可选: `--FormListString`, `--FormListAString`, `--FormListBString`, `--RequestHeader`, `--ExtraData`

#### DescribeReleaseFiles
- 用途: 列出已上传的 SourceMap / 发布文件。
- 必填: `--ProjectID`, `--OrderBy`, `--StartTime`, `--Limit`, `--Page`, `--Query`, `--EndTime`
- 可选: `--FileVersion`, `--FileName`

#### DescribeReleaseFileSign
- 用途: 获取上传发布文件的签名。
- 必填: `--ProjectID`
- 可选: `--Timeout`, `--FileType`, `--Site`, `--ID`

### 4.3 评分

#### DescribeScores
- 用途: 项目体验评分。
- 必填: `--StartTime` (string), `--EndTime` (string)
- 可选: `--ID`, `--IsDemo`, `--IDList`

#### DescribeScoresV2
- 用途: 项目体验评分 V2，支持类型/环境过滤。
- 必填: `--StartTime`, `--EndTime`
- 可选: `--IDList`, `--Type`, `--Env`

### 4.4 通用 / PV / UV

#### DescribeData
- 用途: 通用数据查询接口，可执行自定义 Query。
- 必填: `--Query` (string), `--ID` (int)
- 警告: `--Query` 是自由 SQL 文本，**慎用**，需熟悉数据表结构。

#### DescribePvList
- 用途: PV 列表。
- 必填: `--ProjectId`, `--StartTime`, `--EndTime`
- 可选: `--Dimension`

#### DescribeUvList
- 用途: UV 列表。
- 必填: `--ProjectId`, `--StartTime`, `--EndTime`
- 可选: `--Dimension`

### 4.5 数据查询（V1/V2 通用模式）

> 大部分 `DescribeDataXxxUrl` / `DescribeDataXxxUrlV2` 接口共享一组通用必填+过滤参数；
> **优先使用 V2 接口**（V2 比 V1 多了 `ExtFourth~ExtTenth` 与 `Granularity` 维度，更适合精细化查询）。

**通用必填参数**：
- `--ID` (int) — RUM 项目 ID
- `--StartTime` (int Unix 秒) — 起始时间
- `--EndTime` (int Unix 秒) — 结束时间
- `--Type` (string) — 子类型，因接口而异（如 `pagepv`、`allpvuv`、`status` 等）

**通用过滤参数（全部 Optional）**：
`--Level`, `--Isp`, `--Area`, `--NetType`, `--Platform`, `--Device`, `--VersionNum`, `--ExtFirst..ExtThird`, `--IsAbroad`, `--Browser`, `--Os`, `--Engine`, `--Brand`, `--From`, `--CostType`, `--Env`, `--Url`/`--Name`, `--Status`, `--Ret`, `--NetStatus`

**V2 额外参数**：`--ExtFourth..ExtTenth`, `--Granularity`。

**通用示例**：
```bash
# V2 接口推荐用 cli-input-json，避免参数过多导致命令行过长
tccli rum DescribeDataFetchUrlV2 --cli-input-json '{
  "ID": 12345,
  "StartTime": 1700000000,
  "EndTime": 1700003600,
  "Type": "allpvuv",
  "Env": "production",
  "Granularity": "minute"
}'
```

### 4.6 异常 / Issue（通用模式）

> Issue 类接口操作的实体是 **`ProductId`（字符串）**，不是 `ID`/`ProjectId`。

#### DescribeError
- 用途: 单个错误堆栈详情。
- 必填: `--Date`, `--ID`, `--ProductId`
- 可选: `--ClientIdentify`, `--ClusterStackType`, `--Feature`, `--IssueType`

#### DescribeExceptionReportList
- 用途: 异常上报列表。
- 必填: 无（实际需要 `--ProductId`）
- 可选: `--ProductId`, `--FormListString`, `--ParamToken`, `--IssueType`, `--SortField`, `--SortType`, `--Feature`, `--PageSize`, `--PageNumber`, `--ExtraData`, `--RequestHeader`

#### DescribeExceptionDetail
- 用途: 单个异常详情。
- 必填: `--ProductId`
- 可选: `--ClientIdentify`, `--ClusterStackType`, `--Feature`, `--IssueType`, `--StartEventTime`, `--EndEventTime`, `--ExtraData`, `--RequestHeader`

#### DescribeIssuesList
- 用途: Issue 聚合列表。
- 必填: 无（实际需要 `--ProductId`）
- 可选: `--ProductId`, `--FormList`, `--FormListA`, `--FormListB`, `--ParamToken`, `--IssueType`, `--SortField`, `--SortType`, `--PageSize`, `--PageNumber`

#### DescribeIssuesDistribution
- 用途: Issue 在某维度上的分布（如设备/版本/地域）。
- 必填: 无
- 可选: `--ProductId`, `--FormListString`, `--DimType`, `--Dimension`, `--Intervals`, `--ParamToken`, `--IssueId`, `--IssueType`, `--ParamLimit`, `--MapKey`

#### DescribeIssuesStatisticsTrend
- 用途: Issue 趋势曲线。
- 必填: `--ProductId`
- 可选: `--ParamToken`, `--FormList`, `--IssueId`, `--IssueType`, `--TimeWindow`, `--TotalSize`, `--Stat`, `--MetricType`, `--ExtraData`

#### DescribeTopIssues
- 用途: 排行榜 Top N Issue。
- 必填: `--ProductId`
- 可选: `--Compare`, `--Condition`, `--IssueType`, `--SortField`, `--SortType`, `--TopNum`, `--ExtraData`, `--RequestHeader`

### 4.7 RUM 日志

#### DescribeRumLogList
- 用途: RUM 日志列表（V1）。
- 必填: 通常需要 `--ID` + 时间范围。

#### DescribeRumLogTotalV2
- 用途: 日志总数（V2）。

#### DescribeRumStatsLogList / DescribeRumStatsLogListV2
- 用途: 统计型日志列表。

#### DescribeRumGroupLog / DescribeRumGroupLogV2
- 用途: 分组聚合日志。

#### DescribeRumLogDetailsV2
- 用途: 单条日志明细（V2）。

#### DescribeRumLogExport / DescribeRumLogExportV2
- 用途: 创建/查询日志导出任务（READ 部分）。

#### DescribeRumLogExports / DescribeRumLogExportsV2
- 用途: 列出日志导出任务。

> 日志类接口具体参数请用 `tccli rum <Action> help` 现场查询；多数接受 `--ID` (项目 ID, int)、`--StartTime`/`--EndTime` (Unix 秒)、`--Query` (Lucene 表达式)、`--Limit`/`--Offset` 或游标 `--Context`。

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| 大部分 `DescribeData*` | `--ID` 是 RUM 项目 ID（int），不是字符串 | 先 `DescribeProjects` 拿 `ID` |
| 异常/Issue 系列 | 使用 `--ProductId`（string），与项目 ID 不同 | 在 `DescribeProjects` 输出中找 ProductId |
| `DescribeProjects` | `Limit`/`Offset` 都 Required | 必传 `--Limit 20 --Offset 0` |
| 时间字段 | 数据接口为 Unix 秒（int）；评分接口为字符串 | 看 help 中的类型再决定 |
| V1 vs V2 | 维度有差异，不能混用 | 仅用 V2，除非接口仅有 V1 |
| `DescribeData` | `--Query` 自由 SQL 文本 | 慎用，需熟悉数据表结构 |
| 跟终端 Pro 混淆 | 原生 Android/iOS 应用走 rum-app-pro；React Native 等"跨端"框架虽然底层是原生，但 RUM 体系下归前端 | 按 SDK 接入方式判断 |
| 服务名误以为 `frontend` / `tam` | 实际还是 `rum` | 用 `tccli rum` |
| 以为 PV / UV 是云监控指标 | 这是 RUM 自有数据，走 rum 服务，不走 monitor | 走 `DescribePvList` / `DescribeUvList` |

---

## 6. 关键 ID 格式

| ID | 类型 | 示例 | 获取方式 |
|----|------|------|---------|
| 项目 ID (`ID` / `ProjectId` / `ProjectID`) | Integer | `12345` | `DescribeProjects` |
| 实例 ID | String | `rum-xxxxxxxx` | `DescribeTawInstances` |
| ProductId | String | `m-xxxxxxxx` | `DescribeProjects` 输出 |
