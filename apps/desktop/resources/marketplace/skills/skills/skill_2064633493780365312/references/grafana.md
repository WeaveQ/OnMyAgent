# Grafana 服务（TCMG）

> 范围：腾讯云**托管 Grafana 服务（TencentCloud Managed Service for Grafana，TCMG）** 的 API 调用入口。覆盖 Grafana 实例管理、配置、白名单、数据源集成、告警通道、插件、SSO。
>
> 边界：Prometheus 监控服务走 [tmp.md](tmp.md)；云监控自带的"智能仪表盘"走 [dashboard.md](dashboard.md)。
>
> 调用通道：`tccli grafana`（与 monitor 服务名独立）。Grafana 实例 ID 为 `grafana-xxxxxxxx`。

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 安全、免运维的 Grafana 托管服务，与 Grafana Lab 合作开发 |
| 核心能力 | 多数据源统一可视化、SSO 集成、内外网访问控制 |
| 预置数据源 | 腾讯云产品监控、Prometheus 监控服务、日志服务、容器服务、Graphite、InfluxDB、Elasticsearch 等 |
| tccli 服务名 | `grafana` |

```bash
tccli grafana help --detail
```

> 注意：腾讯云 Grafana 实例的查询 API 也会同时通过 `tccli monitor` 暴露（如 `DescribeGrafanaInstances` 等带 `Grafana` 前缀的 Action 出现在 `monitor` 服务下）。两条路径都可以；推荐统一用 `monitor` 与 Prometheus 共用 profile。

---

## 2. 业务核心概念

### 2.1 安全可靠

- 与腾讯云账号 **SSO 整合**
- 通过腾讯云**二次校验**鉴权
- 支持 **VPC 内外网访问控制**
- 细粒度管控仪表板及监控数据安全

### 2.2 数据源统一

预置腾讯云数据源插件，开箱可对接：
- 腾讯云可观测平台（云产品监控）
- Prometheus 监控服务
- 日志服务（CLS）
- Elasticsearch 服务
- Graphite / InfluxDB / OpenTSDB 等开源数据源

### 2.3 低成本运维

- 自动构建、安装、部署、升级和管理 Grafana
- 预建远程图片渲染服务
- 预设云产品监控仪表板与插件，开箱即用

### 2.4 与 Dashboard 的边界

| 选哪个？ | 场景 |
|---------|------|
| 走 grafana | 用户明确说"Grafana"、要装 Grafana 插件、要用 PromQL 数据源、跨数据源大盘 |
| 走 dashboard | 用户说"云监控仪表盘"、用云产品监控自带的智能仪表盘 |

模糊时用 [routing-decision.md](routing-decision.md#模板-d用户说dashboard--大盘--仪表盘) 中的 AskUserQuestion 模板 D 收敛。

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|------------|
| 实例 | `DescribeGrafanaInstances` | 列出 Grafana 实例 |
| 配置 | `DescribeGrafanaConfig` | 实例 grafana.ini 配置 |
| 配置 | `DescribeDNSConfig` | 实例 DNS 配置 |
| 环境 | `DescribeGrafanaEnvironments` | 实例环境变量 |
| 白名单 | `DescribeGrafanaWhiteList` | 公网访问白名单 |
| 集成 | `DescribeGrafanaIntegrations` | 数据源集成列表 |
| 通道 | `DescribeGrafanaChannels` | 告警通道（旧版） |
| 通道 | `DescribeGrafanaNotificationChannels` | 告警通知通道 |
| 插件 | `DescribeInstalledPlugins` | 已安装插件 |
| 插件 | `DescribePluginOverviews` | 全部可装插件总览 |
| SSO | `DescribeSSOAccount` | SSO 账号列表 |

> 写动作（`Create*` / `Modify*` / `Delete*` / `Bind*` / `Unbind*` / `Install*` / `Uninstall*` / `Upgrade*` / `Clean*` / `Destroy*`）**不在本 skill 范围**,引导用户前往腾讯云控制台。

---

## 4. 详细 Action 用法

### 4.1 实例 / 配置

#### DescribeGrafanaInstances
- 用途: 列出 Grafana 实例。
- 必填: `--Offset`, `--Limit`
- 可选: `--InstanceIds`, `--InstanceName`, `--InstanceStatus` (Array), `--TagFilters`
- 示例: `tccli monitor DescribeGrafanaInstances --Offset 0 --Limit 20`

#### DescribeGrafanaConfig
- 用途: 查询 grafana.ini 配置内容。
- 必填: `--InstanceId`

#### DescribeDNSConfig
- 用途: 查询实例 DNS 配置。
- 必填: `--InstanceId`

#### DescribeGrafanaEnvironments
- 用途: 查询实例环境变量。
- 必填: `--InstanceId`

#### DescribeGrafanaWhiteList
- 用途: 公网访问白名单。
- 必填: `--InstanceId`

### 4.2 集成 / 通道

#### DescribeGrafanaIntegrations
- 用途: 数据源集成列表（Prometheus/CLS 等）。
- 必填: `--InstanceId`
- 可选: `--IntegrationId`, `--Kind`

#### DescribeGrafanaChannels
- 用途: 告警通道列表（旧版）。
- 必填: `--InstanceId`, `--Offset`, `--Limit`
- 可选: `--ChannelName`, `--ChannelIds`, `--ChannelState`

#### DescribeGrafanaNotificationChannels
- 用途: 告警通知通道列表（与 Channels 类似的另一接口）。
- 必填: `--InstanceId`, `--Offset`, `--Limit`
- 可选: `--ChannelName`, `--ChannelIDs`, `--ChannelState`

### 4.3 插件 / SSO

#### DescribeInstalledPlugins
- 用途: 列出已安装插件。
- 必填: `--InstanceId`
- 可选: `--PluginId`

#### DescribePluginOverviews
- 用途: 全部可装插件清单（无入参）。
- 必填: 无

#### DescribeSSOAccount
- 用途: 列出 SSO 账号。
- 必填: `--InstanceId`
- 可选: `--UserId`

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `DescribeGrafanaInstances` | `Offset`/`Limit` 都是 Required | 必传，不能省略 |
| 跟 Dashboard 模块混淆 | Grafana 是托管 Grafana，Dashboard 是云监控自带仪表盘 | 两套独立产品，看用户具体场景路由 |
| 数据源对接漏鉴权 | 对接 Prometheus 时需要 Token / 内网授权配置正确 | 先 `DescribeGrafanaIntegrations` 检查现状 |
| VPC 网络隔离 | 内网访问需要 Grafana 实例与目标数据源同 VPC 或建立打通 | 检查 `DescribeDNSConfig` / `DescribeGrafanaWhiteList` |
| 服务名混淆 | `tccli grafana` 与 `tccli monitor` 都暴露 Grafana 接口 | 两条路径等价，统一用 `monitor` 较省心 |

---

## 6. 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| Grafana 实例 ID | `grafana-xxxxxxxx` | `DescribeGrafanaInstances` |
