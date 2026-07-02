# 终端性能监控 Pro

> 范围：**原生客户端应用**的崩溃分析、性能监控、异常告警。覆盖 Android、iOS、鸿蒙、Windows、Unity、Flutter 等平台。
>
> 边界：Web / 小程序走 [rum.md](rum.md)。告警走 [monitor-alarm.md](monitor-alarm.md)。
>
> 调用通道：`tccli rum`（与 RUM 共用服务名，按 Action 名区分；并非两者属于同一产品）。如对某 Action 是否在 `rum` 服务下有疑问，用 `tccli rum help --detail | grep -i <关键字>` 现场确认。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 客户端应用质量监控与管理平台 |
| 覆盖平台 | Android、iOS、鸿蒙、Windows、Unity、Flutter、React Native（部分能力） |
| 核心能力 | 崩溃诊断、ANR 分析、卡顿分析、网络性能分析、性能 KPI 监控、闪退（FOOM） |
| tccli 服务名 | `rum`（与前端共用，按 Action 区分；终端 Pro 的 Action 通常带 `App` / `FOOM` / `LagANR` / `ApplicationExit` / `Crash` / `Anr` / `Symbol` / `Native` 等关键字） |

```bash
tccli rum help --detail
```

---

## 2. 业务核心概念

### 2.1 关键能力

| 能力 | 说明 |
|------|------|
| 多维崩溃诊断 | Native 崩溃、ANR、异常错误的堆栈、线程、设备信息、内存快照 |
| 卡顿智能分析 | 主线程阻塞追踪、耗时函数定位 |
| 网络性能分析 | 请求耗时、成功率、数据量、DNS 解析时间、连接建立时间 |
| 智能根因分析 | 崩溃点 + 堆栈聚合 + 系统日志 + 应用版本 + 设备型号关联 |
| 趋势分析与版本对比 | 崩溃率趋势、跨版本稳定性对比 |
| 符号表自动管理 | 自动上传 / 解析符号文件，还原可读堆栈 |

### 2.2 关键性能指标（KPI）

| 指标 | 关注点 |
|------|--------|
| 应用启动时间 | 冷启动 / 热启动分别看 |
| 页面加载时长 | 各 Activity / ViewController 渲染耗时 |
| FPS | 帧率，反映流畅度 |
| 内存占用 | 峰值 + 平均，OOM 分析 |
| 流量消耗 | 上行 / 下行流量 |
| 网络请求耗时与成功率 | API 维度统计 |
| 电池消耗 | 后台耗电分析 |

### 2.3 数据筛选维度

应用版本、设备型号、操作系统、地域、网络环境、用户标识——所有查询 API 都应支持这些维度作为过滤条件。

### 2.4 关键 ID 概念

| ID | 类型 | 用途 |
|----|------|------|
| ProductId | String（如 `m-xxxxxxxx`） | 终端 Pro 主键；FOOM / Issue / 卡顿 / ANR / ExitReport 系列接口都用它 |
| ProjectID | **Integer** | App 多维指标 / SingleCase 系列接口用整数项目 ID |
| 实例 ID | String（`rum-xxxxxxxx`） | 实例级配置 |

> 项目实体在 RUM 与终端 Pro 共用 `DescribeProjects`，输出里同时含 `ID`（int）与 `ProductId`（string）。终端 Pro 接入时主要看 `ProductId`。

---

## 3. 速查表

### 3.1 App 指标 / 单次会话

| 动作 | 一句话用途 |
|------|------------|
| `DescribeAppMetricsData` | App 多维指标 |
| `DescribeAppDimensionMetrics` | App 维度指标（按维度展开） |
| `DescribeAppSingleCaseList` | 单次会话（SingleCase）列表 |
| `DescribeAppSingleCaseDetailList` | 单次会话明细 |

### 3.2 闪退 / 退出（ApplicationExit）

| 动作 | 一句话用途 |
|------|------------|
| `DescribeApplicationExitReportList` | App 退出/闪退上报列表 |
| `DescribeApplicationExitReportDetail` | 单条退出/闪退上报详情 |

### 3.3 异常 / Issue（终端侧）

| 动作 | 一句话用途 |
|------|------------|
| `DescribeError` | 单个错误堆栈 |
| `DescribeExceptionDetail` / `DescribeExceptionReportList` | 异常详情 / 列表 |
| `DescribeIssuesList` / `DescribeIssuesDistribution` / `DescribeIssuesStatisticsTrend` / `DescribeTopIssues` | Issue 聚合 / 分布 / 趋势 / Top |

> 这组 Issue 接口与 RUM 共用同一组 Action，由 `ProductId` 区分项目类型。

### 3.4 FOOM / FOOM Malloc（iOS 内存类闪退）

| 接口 | 必填 | 用途 |
|------|------|------|
| `DescribeFOOMReportList` | `--ProductId` | FOOM 上报列表 |
| `DescribeFOOMProblemList` | `--ProductId` | FOOM 问题聚合 |
| `DescribeFOOMProblemDetail` | `--ProductId` | FOOM 单个问题详情 |
| `DescribeFOOMMallocReportList` | `--ProductId` | Malloc 类 FOOM 上报 |
| `DescribeFOOMMallocProblemList` | `--ProductId` | Malloc 问题聚合 |
| `DescribeFOOMMallocProblemDetail` | `--ProductId` | Malloc 单个问题详情 |

可选过滤多为 `--ClientIdentify`, `--Feature`, `--StartEventTime`, `--EndEventTime`, `--ExtraData`, `--RequestHeader`，FOOMProblemList 还有 `--FormListString`, `--PageSize`, `--PageNumber`, `--SortField`, `--SortType`。

### 3.5 卡顿 / ANR

| 动作 | 一句话用途 |
|------|------------|
| `DescribeLagANRProblemList` | 卡顿/ANR 问题列表 |
| `DescribeLagANRProblemAccountDetail` | 某账号的卡顿/ANR 详情 |
| `DescribeLagANRProblemFeatureAccounts` | 按特征聚合的账号列表 |

---

## 4. 详细 Action 用法

### 4.1 App 维度（移动端）

#### DescribeAppMetricsData
- 用途: App 多维指标查询。
- 必填: `--ProjectID` (int), `--From` (string), `--Fields` (string), `--Filter` (string)
- 可选: `--FilterSimple`, `--GroupBy`, `--OrderBy`, `--Limit`, `--Offset`, `--GroupByModifier`

#### DescribeAppDimensionMetrics
- 用途: App 维度指标（按维度展开）。
- 必填: `--ProjectID`, `--From`, `--Fields`, `--Filter`
- 可选: `--FilterSimple`, `--GroupBy`, `--OrderBy`, `--Limit`, `--Offset`, `--BusinessContext`

#### DescribeAppSingleCaseList
- 用途: 单次会话（SingleCase）列表。
- 必填: `--ProjectID`, `--From`, `--Fields`, `--Filter`
- 可选: `--FilterSimple`, `--GroupBy`, `--OrderBy`, `--Limit`, `--Offset`

#### DescribeAppSingleCaseDetailList
- 用途: 单次会话明细。
- 必填: 同 `DescribeAppSingleCaseList`

### 4.2 闪退 / 退出

#### DescribeApplicationExitReportList
- 用途: App 退出/闪退上报列表。
- 必填: `--ProductId`
- 可选: `--ParamToken`, `--FormListString`, `--PageNumber`, `--PageSize`, `--SortField`, `--SortType`, `--ExtraData`, `--RequestHeader`

#### DescribeApplicationExitReportDetail
- 用途: 单条退出/闪退上报详情。
- 必填: `--ProductId`
- 可选: `--ParamToken`, `--ClientIdentify`, `--StartEventTime`, `--EndEventTime`, `--ExtraData`, `--RequestHeader`

### 4.3 异常 / Issue（终端侧）

> 这组 Action 与 RUM 共用，详见 [rum.md §4.6](rum.md#46-异常--issue通用模式)。终端侧用法相同，重点关注 `IssueType`、`Feature` 字段区分平台特征。

### 4.4 卡顿 / ANR

#### DescribeLagANRProblemList
- 用途: 卡顿/ANR 问题列表。
- 必填: `--ProductId`
- 可选: 类似 Issue 系列的 `--FormListString`, `--PageSize`, `--PageNumber` 等。

#### DescribeLagANRProblemAccountDetail
- 用途: 某账号的卡顿/ANR 详情。
- 必填: `--ProductId`

#### DescribeLagANRProblemFeatureAccounts
- 用途: 按特征聚合的账号列表。
- 必填: `--ProductId`

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| 服务名混淆 | 终端 Pro 的服务名可能是 `rum` 或其他（视 tccli 版本） | 先 `tccli help` 自查 |
| 跟 RUM 混 | React Native、Flutter 在 RUM 产品分类里通常归"前端"，但纯 Android / iOS 原生归"终端 Pro" | 模糊时按 SDK 接入方式判断 |
| 崩溃堆栈不可读 | 缺符号表导致堆栈是地址而非函数名 | 检查"符号表是否已上传"(符号表上传是写操作,**不在本 skill 范围**,引导控制台) |
| 用错了 ID 类型 | App 系列用整数 `--ProjectID`；FOOM/Issue/Exit 系列用字符串 `--ProductId` | 看 help 中的类型再决定 |
| FOOM 仅 iOS 有效 | Android 没有对应概念 | Android 闪退看 ANR + Application Exit |

---

## 6. 关键 ID 格式

| ID | 类型 | 示例 | 获取方式 |
|----|------|------|---------|
| ProductId | String | `m-xxxxxxxx` | `DescribeProjects` 输出 |
| ProjectID | Integer | `12345` | `DescribeProjects` 输出（与前端共用项目实体） |
| 实例 ID | String | `rum-xxxxxxxx` | `DescribeTawInstances` |
