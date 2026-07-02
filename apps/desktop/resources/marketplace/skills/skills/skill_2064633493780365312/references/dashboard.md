# Dashboard（云监控自带仪表盘）

> 范围：腾讯云可观测平台**自带的智能仪表盘**（区别于托管 Grafana）。覆盖云产品监控数据的可视化与智能分析。
>
> 边界：托管 Grafana 走 [grafana.md](grafana.md)；Prometheus 自定义仪表盘走 [tmp.md](tmp.md)。
>
> ⚠️ **API 通道说明**：`DescribeUnifyDashboards` / `DescribeUnifyDashboard` / `DescribeDashboardMetricData` 三个查询 Action **未在 `tccli monitor` 公开 choice 中暴露**（`tccli monitor DescribeUnifyDashboards` 会报 `Invalid choice`），但服务端实际可用,需走腾讯云公共 API 网关 `https://monitor.tencentcloudapi.com`(TC3-HMAC-SHA256 签名)。本 skill 已内置 `scripts/query_dashboard.py` 完成签名与批次切片,直接调用即可。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 针对云产品指标监控数据的可视化与分析仪表盘 |
| 数据来源 | 主要对接基础监控（云产品监控） |
| 核心价值 | 通过 Dashboard 分析指标异常原因 |
| API 入口 | `https://monitor.tencentcloudapi.com`（公共 API，TC3-HMAC-SHA256） |
| tccli 服务名 | `monitor`（但 Unify Dashboard 系列不在 tccli choice 中） |

```bash
# 自查 monitor 服务下 Dashboard 关键字 Action（结果只有 Grafana Dashboard 的两条写动作，不是本文档要的）
tccli monitor help --detail | grep -i dashboard
```

---

## 2. 业务核心概念

### 2.1 实体层级

```
账号
 └── Folder (UUID 以 f-* 开头, IsFolder=true)
      └── Dashboard (UUID, Type ∈ {PRESET, CUSTOM})
           ├── Templating       → 模板变量 + 用户已选实例 (CUSTOM 才有)
           └── Panels[]         → 面板
                └── Targets[]   → 单个指标查询表达式
                     └── Namespace + MetricName + Dimensions + Period
```

### 2.2 PRESET vs CUSTOM 副本

| 类型 | 含义 | `Templating.Selected` | 能直接查指标吗 |
|------|------|----------------------|---------------|
| `PRESET` | 系统预设面板（每个云产品自带） | 通常为空 | ❌ 无实例上下文 |
| `CUSTOM` | 用户基于 PRESET 复制的自定义副本 | 控制台保存后会带已选实例 | ✅ |

> 分析 PRESET 面板时如果 `Templating.Selected` 为空，会导致 `DescribeDashboardMetricData` 返回"无效的参数值"。**应优先查找同名 CUSTOM 副本**；都没有就引导用户去控制台先选实例保存。

### 2.3 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| Dashboard UUID | `0d6ygvlym66edjx6` | `DescribeUnifyDashboards` 返回的 `Dashboards[].UUID` |
| Folder UUID | `f-dfj2nniwioah3573` | 同上，`UUID.startswith("f-")` 标识文件夹 |
| 控制台 URL | `https://console.cloud.tencent.com/monitor/dashboard/dashboards/d/{UUID}/{slug}` | slug = Title 中文转拼音 + 英数小写 + `-` 连接 |

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|-----------|
| 仪表盘列表 | `DescribeUnifyDashboards` | 列出当前账号下所有 Dashboard（含 PRESET / CUSTOM / 文件夹） |
| 仪表盘详情 | `DescribeUnifyDashboard` | 获取单个 Dashboard 的完整面板配置（Panels / Templating） |
| 指标数据 | `DescribeDashboardMetricData` | 批量查询 Dashboard 内 Panel 对应的指标时序数据 |

---

## 4. 详细 Action 用法

> 所有调用走公共 API：`POST https://monitor.tencentcloudapi.com`，`X-TC-Action: <Action>`，`X-TC-Version: 2018-07-24`，签名算法 `TC3-HMAC-SHA256`。
### 4.1 DescribeUnifyDashboards（仪表盘列表）

- 用途：列出当前账号下所有 Dashboard，含文件夹、PRESET、CUSTOM。
- Body：`{}`（无入参）
- 输出关键字段：`Response.Dashboards[].{UUID, Title, Type, IsFolder, FolderUUID, TemplateVariables, GroupMetrics}`
- 示例：

```bash
python3 scripts/query_dashboard.py \
  --action DescribeUnifyDashboards \
  --output ./dashboard_list.json
```

- 单条记录示例：

```json
{
  "UUID": "0d6ygvlym66edjx6",
  "Title": "云服务器 CVM",
  "Type": "PRESET",
  "FolderUUID": "f-dfj2nniwioah3573",
  "IsFolder": false,
  "TemplateVariables": ["CVM实例ID", "存储磁盘ID", "GPU实例ID"],
  "GroupMetrics": [{"Title": "CPU 相关指标", "Metrics": ["CPU利用率(%)"]}]
}
```

- **匹配技巧**：同一标题常同时存在 PRESET（系统预设）和 CUSTOM（用户副本）两条记录；分析时**优先 CUSTOM**（带实例）。文件夹（`UUID.startswith("f-")`）需过滤掉。

### 4.2 DescribeUnifyDashboard（仪表盘详情）

- 用途：根据 UUID 获取 Dashboard 完整配置。
- Body：`{"UUID": "<dashboard_uuid>"}`
- 输出：`Response.Data` 是 **JSON 字符串**（业务侧需 `json.loads(Data)` 一次），含 `Panels`、`Templating.List`、`Templating.Selected`、`Variables`、`Description`、`Links`。
- 示例：

```bash
python3 scripts/query_dashboard.py \
  --action DescribeUnifyDashboard \
  --uuid 0d6ygvlym66edjx6 \
  --output ./dashboard_detail.json
```

- 关键字段：

| 路径 | 说明 |
|------|------|
| `Data.Panels[i].Title` | 面板标题（"CPU 相关指标"） |
| `Data.Panels[i].Type` | `row` 是分组行；其他类型才有 Targets |
| `Data.Panels[i].Targets[j]` | 单个指标查询，含 `Namespace` / `MetricName` / `Dimensions` / `Period` |
| `Data.Templating.List` | 模板变量定义（`CVM实例ID` 等） |
| `Data.Templating.Selected` | 用户保存的实例选择（PRESET 通常为空，CUSTOM 才有） |

### 4.3 DescribeDashboardMetricData（批量指标数据查询）

- 用途：对 Dashboard 中的多个 Panel 指标做批量时序查询，是 Dashboard 视图渲染的底层接口。
- Body 必填：
  - `Module`：固定 `monitor`
  - `Queries`：`Array`，每项含 `Namespace` / `MetricName` / `Dimensions[]` / `Period` / `StartTime` / `EndTime`
- **批次大小**：每批 ≤ 20 个 Query（脚本默认按此切片，超过会被服务端拒绝）。
- 单独调用比较繁琐，**强烈建议**走脚本聚合动作 `BulkAnalysis`（自动 `DescribeUnifyDashboards` → `DescribeUnifyDashboard` → 切批 `DescribeDashboardMetricData`）：

```bash
python3 scripts/query_dashboard.py \
  --action BulkAnalysis \
  --uuid-list u2fomlagepa3rt4t \
  --dashboard-list ./dashboard_list.json \
  --region ap-guangzhou \
  --max-instances 0 \
  --output ./out
```
---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `tccli monitor DescribeUnifyDashboards` 直调 | 报 `Invalid choice`，tccli 公开 choice 不含此 Action | 走脚本封装的公共 API（TC3-HMAC 签名） |
| `Response.Data` 是字符串 | 直接当对象用导致字段访问失败 | 必须先 `json.loads(Data)` 一次 |
| PRESET 面板查不到数据 | `Templating.Selected` 为空，无实例 | 找同名 CUSTOM 副本；都没有就让用户在控制台选实例保存 |
| `DescribeDashboardMetricData` 一批 query 太多 | 服务端拒绝超大批次 | 控制 ≤ 20 个 query / 批 |
| 文件夹被当成 Dashboard | UUID `f-` 开头实际是文件夹 | 过滤 `UUID.startswith("f-")` 或看 `IsFolder` |
| `Panels[i].Type == "row"` 没有 Targets | 是分组行不是数据面板 | 跳过 `Type=="row"` |
| 误用 `Uninstall/UpgradeGrafanaDashboard` | 这是 Grafana 实例域写动作，与本模块无关 | 走 [grafana.md](grafana.md);写动作**不在本 skill 范围**,引导控制台 |
| 用户说"仪表盘"含糊 | 跟 Grafana 混淆 | 用 [routing-decision.md](routing-decision.md) 模板 D 收敛 |

---

## 6. 路由决策

```
用户说"仪表盘 / 大盘 / Dashboard"
  ├─ 含糊不清                    → routing-decision.md 模板 D 收敛
  ├─ 明确是 Grafana                 → grafana.md
  ├─ 明确是云监控自带 Dashboard      → 本文档（公共 API + 内置脚本 scripts/query_dashboard.py）
  └─ 实际想要的是单指标曲线          → monitor-query/getmonitordata.md
```

| 用户诉求 | 实际走哪 |
|----------|---------|
| 看某云产品的指标曲线（单指标） | `GetMonitorData`（见 [monitor-query/getmonitordata.md](monitor-query/getmonitordata.md)） |
| 多维度聚合统计 | `DescribeStatisticData`（见 [monitor-query/overview.md](monitor-query/overview.md)） |
| 整张大盘批量分析 | 本文档  `DescribeDashboardMetricData` |
| 多数据源大盘 | 托管 Grafana，见 [grafana.md](grafana.md) |
| Prometheus 自定义指标看板 | 见 [tmp.md](tmp.md) + Grafana |
