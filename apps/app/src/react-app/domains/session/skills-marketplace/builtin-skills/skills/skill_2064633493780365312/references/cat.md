# 云拨测（CAT）

> 范围：腾讯云**云拨测 CAT** 的 API 调用入口。覆盖网络质量、页面性能、端口性能、文件传输、音视频体验、域名 whois 六大场景的拨测任务管理与结果查询。
>
> 边界：拨测告警走 [monitor-alarm.md](monitor-alarm.md)。
>
> 时间戳约定：`BeginTime`/`EndTime` 一律 Unix **秒**（`date +%s`）。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 全球分布式终端节点的可用性 / 性能模拟探测 |
| 数据视角 | 真实终端用户使用场景（最后一公里） |
| 节点资源 | PC IDC + PC 用户终端 + 手机网络（覆盖国内外） |
| tccli 服务名 | `cat` |

```bash
tccli cat help --detail
```

---

## 2. 业务核心概念

### 2.1 六大监控场景

| 场景 | 监控目标 |
|------|---------|
| 网络质量 | 网络稳定性、路由稳定性、DNS 解析正确率、ICMP 时延、丢包率 |
| 页面性能 | 不同运营商/城市/浏览器/操作系统/设备下访问 Web 页面的体验数据 |
| 文件传输（上传/下载） | 数据资源传输速率，反映真实带宽波动性 |
| 端口性能 | GET / POST 协议或端口的响应性能、可用性 |
| 音视频体验 | 流媒体播放过程的卡顿率、卡顿用时、首帧用时 |
| 域名 whois | 域名注册信息查询（注册商、注册日期、过期日期等） |

### 2.2 拨测节点资源

| 类型 | 覆盖 |
|------|------|
| IDC 终端拨测点 | 国内 100+ 城市 100 个数据中心节点 / 国外 65+ 城市 150 个 |
| PC 用户终端拨测点 | 国内 200+ 城市 / 国外 50+ 城市，200+ 城市运营商 |
| 手机拨测网络 | 100+ 城市，7500+ 部真实手机；4G 接入 |

### 2.3 多维分析

地图分析、多类型图表趋势分析、地区分析、运营商分析。所有查询 API 应支持这些维度作为过滤条件。

### 2.4 应用场景

| 场景 | 业务价值 |
|------|---------|
| 服务质量优化 | 全球模拟用户访问，获取页面/接口/视频/CDN 等场景指标 |
| 发布验证 | 系统升级 / 新功能发布后的可用性与性能验证 |
| CDN 质量评估 | 主动式拨测对比 CDN 前后效果 |
| 防劫持和防篡改 | 监测域名劫持、流量劫持、页面篡改并告警 |
| 竞品性能对比 | 拨测竞品应用获取行业内对比数据 |
| IPv6 监测 | 验证 IPv6 改造后效果与连通性 |

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 拨测任务 | `DescribeProbeTasks` | 列出拨测任务（按状态/类型/Tag 过滤） |
| 拨测任务 | `DescribeInstantTasks` | 列出即时拨测任务 |
| 拨测节点 | `DescribeNodes` | 列出可用拨测节点（基础信息） |
| 拨测节点 | `DescribeProbeNodes` | 列出拨测节点（精简版） |
| 拨测节点 | `DescribeNodeGroups` | 节点组 / 地域 / 运营商分组树 |
| 拨测结果 | `DescribeDetailedSingleProbeData` | 单次拨测明细数据（按字段筛选） |
| 指标数据 | `DescribeProbeMetricData` | 拨测聚合指标（可分组） |
| 指标数据 | `DescribeProbeMetricTagValues` | 拨测指标某维度的可选值 |

> 写动作（任务创建 / 修改 / 删除 / 暂停 / 启用）**不在本 skill 范围**,引导用户前往腾讯云控制台;本文件不展开写接口。

---

## 4. 详细 Action 用法

### 4.1 拨测任务

#### DescribeProbeTasks
- 用途: 列出拨测任务，支持按 ID/名称/目标地址/状态/类型/Tag 筛选。
- 必填: 无
- 可选: `--TaskIDs`, `--TaskName`, `--TargetAddress`, `--TaskStatus` (Array of Integer), `--Offset`, `--Limit`, `--PayMode`, `--OrderState`, `--TaskType` (Array), `--TaskCategory` (Array), `--OrderBy`, `--Ascend`, `--TagFilters`
- 示例: `tccli cat DescribeProbeTasks --Limit 20 --Offset 0 --TaskName my-probe`

#### DescribeInstantTasks
- 用途: 列出即时拨测任务。
- 必填: `--Limit` (int), `--Offset` (int)
- 示例: `tccli cat DescribeInstantTasks --Limit 20 --Offset 0`

### 4.2 拨测节点

#### DescribeNodes
- 用途: 列出拨测节点（带扩展信息 `NodeDefineExt`）。
- 必填: 无
- 可选: `--NodeType`, `--Location`, `--IsIPv6`, `--NodeName`, `--PayMode`, `--TaskType`
- 示例: `tccli cat DescribeNodes --NodeType 1 --IsIPv6 false`

#### DescribeProbeNodes
- 用途: 列出拨测节点（精简版 `NodeDefine`）。
- 必填: 无
- 可选: `--NodeType`, `--Location`, `--IsIPv6`, `--NodeName`, `--PayMode`
- 示例: `tccli cat DescribeProbeNodes --NodeType 1`

#### DescribeNodeGroups
- 用途: 拨测节点的分组树（含地域 / 运营商 / 节点组）。
- 必填: 无
- 可选: `--NodeType` (Array), `--TaskCategory`, `--IPType`, `--Name`, `--RegionID`, `--DistrictID`, `--NetServiceID`, `--NodeGroupType`, `--TaskType`, `--ProbeType`
- 示例: `tccli cat DescribeNodeGroups --TaskCategory 1`

### 4.3 拨测结果

#### DescribeDetailedSingleProbeData
- 用途: 查询单次拨测的详细记录，支持地域/运营商/错误类型筛选 + 滚动游标分页。
- 必填: `--BeginTime` (int Unix 秒), `--EndTime` (int), `--TaskType` (string), `--SortField` (string), `--Ascending` (bool), `--SelectedFields` (Array of string), `--Offset` (int), `--Limit` (int)
- 可选: `--TaskID` (Array), `--Operators` (Array), `--Districts` (Array), `--ErrorTypes` (Array), `--City` (Array), `--ScrollID`, `--QueryFlag`
- 示例:
  ```bash
  tccli cat DescribeDetailedSingleProbeData --cli-input-json '{
    "BeginTime":1700000000,"EndTime":1700003600,
    "TaskType":"http","SortField":"ReactionTime","Ascending":false,
    "SelectedFields":["TaskID","ReactionTime","ErrorType"],
    "Offset":0,"Limit":20
  }'
  ```

### 4.4 指标数据

#### DescribeProbeMetricData
- 用途: 拨测聚合指标查询（按 GroupBy 维度，返回 `MetricSet` JSON 字符串）。
- 必填: 无（实际使用通常需要 `--AnalyzeTaskType`/`--MetricType`/`--Filter` 任意组合）
- 可选: `--AnalyzeTaskType`, `--MetricType`, `--Field`, `--Filter`, `--GroupBy`, `--Filters` (Array)
- 示例: `tccli cat DescribeProbeMetricData --AnalyzeTaskType http --MetricType availability --GroupBy district`

#### DescribeProbeMetricTagValues
- 用途: 查询拨测指标某维度（Key）的可选值集合。
- 必填: 无
- 可选: `--AnalyzeTaskType`, `--Key`, `--Filter`, `--Filters`, `--TimeRange`
- 示例: `tccli cat DescribeProbeMetricTagValues --AnalyzeTaskType http --Key district`

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `DescribeDetailedSingleProbeData` | 8 个必填参数全部缺一不可 | 用 `--cli-input-json` 整体传 |
| `DescribeProbeTasks` | `Limit`/`Offset` 都是 Optional 但生产环境必填 | 显式传 `--Limit 20 --Offset 0` 避免被默认值阻塞 |
| 时间字段 | `BeginTime`/`EndTime` 为 Unix 秒 | `date +%s` |
| 输出 `MetricSet` | 是 JSON 字符串而非结构化对象 | 用 `--filter "MetricSet"` 取出，再 `python3 -c "import json,sys;print(json.dumps(json.loads(sys.stdin.read()), indent=2, ensure_ascii=False))"` 反序列化（本 skill 不假设环境装有 jq） |
| 节点选择不匹配业务 | 海外业务用国内节点拨测看不出问题；运营商隔离场景需要选对应运营商节点 | 按目标用户分布选节点 |
| 拨测频率与配额 | 高频拨测可能受配额限制 | 控制频率或申请配额扩容 |
| 拨测告警去查 cat 服务 | 告警 API 不在 cat 下，全在 monitor 下 | 走 [monitor-alarm.md](monitor-alarm.md) |

---

## 6. 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| 拨测任务 ID | `task-xxxxxxxx` | `DescribeProbeTasks` |
| 节点 ID | 数字 ID | `DescribeNodes` / `DescribeProbeNodes` |
