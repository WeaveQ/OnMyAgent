# 基础监控-告警

> 范围：腾讯云**告警(Alarm)** 的只读 API 调用入口。覆盖告警策略 / 告警历史 / 通知模板 / 告警平台元数据(产品/指标/事件)。
>
> 边界：写操作(`Create*` / `Modify*` / `Delete*` / `Pause*`)与告警通知历史(谁在何时收到通知)tccli 未接入,引导控制台。所有子业务(CVM/APM/RUM/Probe/TRTC/...)的告警都走这里,不在子业务模块。
>
> 时间戳约定:Unix **秒**(`date +%s`)。`--region` 必须小写(`--Region` 大写报 `Unknown options`)。所有 monitor.* Action 必带 `--Module monitor`。
>
> ⭐ **告警数据全账号全局视图**:Policy / Notice / History / 元数据**与地域无关**,`--region` 在告警接口里仅是 API 接入点(影响网络路径,不影响返回内容)。详见 § 1.5。

## 目录

- § 1 业务定位 — 模块定位 + 服务名 + 5 大能力分类
- § 1.5 ⭐ 关键认知 — 告警数据全局有效,`--region` 仅是 API 接入点
- § 2 速查表 — 10 个 Action + 模糊场景判断
- § 3 枚举值字典 — AlarmStatus / AlarmLevel / MonitorType / Enable / IsUnionRule
- § 4 产品名 → strategy_type 速查 — 热门产品表 + 多 strategy_type 处理 + alarm_lookup 用法
- § 5 详细 Action 用法 — 10 个 Action 的入参/出参/示例
- § 6 业务核心概念 — 告警 1.0/2.0 库辨识 + 三层数据模型 + 跨层关联路径 + 易混产品坑
- § 7 常见踩坑
- § 8 关键 ID 格式
- § 9 错误特化提示

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 腾讯云告警平台 — 策略/历史/通知/元数据只读查询 |
| 数据形态 | Policy(策略) / History(触发记录) / Notice(通知模板) / Namespace+Metric+Event(元数据) |
| tccli 服务名 | `monitor`(同名服务下还混了云产品监控查询、Prometheus、Dashboard,按 Action 名识别归属) |
| 覆盖能力 | 10 个只读 action,5 大类(策略管理 / 告警历史 / 通知配置 / 元数据 / namespace 字典) |

```bash
tccli monitor help --detail | grep -i alarm
```

⚠️ **能力边界**:
- ✅ 支持:告警策略**配置**类查询、告警**历史**事件查询、可监控**指标/事件元数据**列表、**全 MonitorType 的 namespace 字典**
- ❌ 不支持:指标**实时数值**(走 monitor-query/getmonitordata.md 的 GetMonitorData)、写操作、告警通知**历史**(谁/何时被通知)

---

## 1.5 ⭐ 关键认知：告警数据全局有效，`--region` 仅是 API 接入点

**告警策略/通知模板/告警历史/元数据**是**账号级全局数据**，与地域**无关**：

| 数据类型 | 是否地域相关 | 说明 |
|---------|-------------|------|
| Policy(策略) | ❌ 全局 | 同一 PolicyId 从任何 region 接入点查到的都是同一份 |
| Notice(通知模板) | ❌ 全局 | NoticeId 全账号唯一 |
| History(告警历史) | ❌ 全局返回 | 一次调用返回**全地域**触发记录,虽然 `AlarmObject` 实例本身有地域属性 |
| Metric / Event 元数据 | ❌ 全局 | `DescribeAlarmMetrics` / `DescribeAlarmEvents` 不涉及地域 |
| BindingPolicyObjectList | ❌ 全局返回 | 一次返回策略绑定的**全地域**实例,每项的 `List[].Region` 字段标示该实例所属地域 |

`--region` 在告警接口里**仅影响 SDK 接入点**(网络路径/延迟),**不影响返回内容**。

### 实操约定

- ✅ **默认 `--region ap-guangzhou` 即可**,无需反问用户用哪个地域
- ❌ **绝对不要**为了"覆盖多地域"分别调用 `ap-guangzhou` / `ap-shanghai` / `ap-beijing` 等再汇总——同一份数据会被原样返回 N 次,纯浪费时间和配额
- ❓ 用户问"**华南/华东 有哪些告警**"时,过滤维度是 **AlarmObject 实例所在地域**,不是 tccli 的 `--region`:
  - 路径 1: `DescribeAlarmHistories` 拿全部历史 → 看 `Histories[].Dimensions` 里的实例 ID 反推地域(实例 ID 自己不携带地域,需要结合上下文或调用方自己维护实例-地域映射)
  - 路径 2: `DescribeAlarmPolicies` → 逐策略 `DescribeBindingPolicyObjectList` → 按 `List[].Region` 过滤(如 `Region == "ap-guangzhou"`)

### 例外情况

- **`DescribeAlarmEvents` 的 `--region` 是必填**(罕见,详见 § 7),但仍是接入点用途,不影响返回内容
- 如果用户对延迟敏感(如海外账号查海外资源),可以用就近接入点(`na-siliconvalley` 等),但返回数据**仍然全局一致**

---

## 2. 速查表

| 域 | Action | 一句话用途 |
|----|--------|------------|
| 告警策略 | `DescribeAlarmPolicies` | 列出告警策略(按产品/启用状态/通知模板过滤) |
| 告警策略 | `DescribeAlarmPolicy` | 查单条策略详情(规则/阈值/通知配置) |
| 告警策略 | `DescribeBindingPolicyObjectList` | 查策略绑定的实例对象列表(策略覆盖了哪些机器) |
| 告警历史 | `DescribeAlarmHistories` | 查策略触发记录(支持时间窗/实例 ID/产品过滤) |
| 通知模板 | `DescribeAlarmNotices` | 列出通知模板(NoticeType/接收人/绑定策略) |
| 通知模板 | `DescribeAlarmNotice` | 查单条通知模板详情(用户/回调/CLS 投递配置) |
| 通知模板 | `DescribeAlarmNoticeCallbacks` | 查账号下所有回调 URL 列表 |
| 元数据 | `DescribeAllNamespaces` | 列 namespace 全集(QceNamespacesNew + CommonNamespaces),按 MonitorType 过滤,**APM/RUM/Probe/TRTC 类的 namespace 权威源** |
| 元数据 | `DescribeAlarmMetrics` | 查某产品可用于配置告警的指标列表(如 CVM 有 CpuUsage 等 27 项) |
| 元数据 | `DescribeAlarmEvents` | 查某产品可用于配置告警的事件列表(如 CVM 有 ping_unreachable 等 60 项) |

> 写动作(`Create*` / `Modify*` / `Delete*` / `Pause*`)**不在本 skill 范围**,引导用户前往腾讯云控制台;本文件不展开写接口。

### 模糊场景判断

| 用户原话 | LLM 应对 |
|---------|---------|
| "我有哪些告警" | **追问**:是"告警规则(策略)"还是"最近告警记录(历史)" |
| "为什么没收到通知" | 见 § 6.3 三层关联路径,串 history → policy → notice 三个 action 自查 |
| "华南有哪些告警" | **不要**用 `--region` 限定地域(告警是全局视图,见 § 1.5)。正确做法:① `DescribeAlarmHistories` 拿全部历史 → 按 `AlarmObject` 实例所属地域过滤;② 或 `DescribeAlarmPolicies` → 逐策略 `DescribeBindingPolicyObjectList` → 按 `List[].Region` 过滤 |
| "Redis / CLB 的告警" | 这两个产品有多个 strategy_type,先用 `scripts/alarm_lookup.py search <关键词>` 列出候选(见 § 4) |

---

## 3. 枚举值字典

### 3.1 AlarmStatus(告警状态,DescribeAlarmHistories 用)

| 值 | 含义 |
|----|------|
| `ALARM` | 未恢复(告警持续中) |
| `OK` | 已恢复 |
| `NO_CONF` | 策略已删除,状态无法确定 |
| `NO_DATA` | 数据不足,无法判断 |

> ⚠️ **语义碰撞**:`AlarmStatus.ALARM` = "尚未恢复"(历史)、`NoticeType.ALARM` = "仅触发时发通知"(策略),同字面量含义不同。

### 3.2 AlarmLevel(告警级别)

| 值 | 中文 |
|----|------|
| `Serious` | 严重 |
| `Warn` | 警告 |
| `Remind` | 提醒 |

### 3.3 MonitorType(监控类型)

| 值 | 说明 |
|----|------|
| `MT_QCE` | 腾讯云标准产品监控(最常用,CVM/MySQL/Redis 等所有云产品) |
| `MT_PROBE` | 拨测监控 |
| `MT_TAW` | 应用性能监控 APM |
| `MT_RUM` | 前端性能监控(Web/小程序) |
| `MT_RUMAPP` | RUM 移动端(Android/iOS/鸿蒙/Flutter) |
| `MT_TRTC` | 实时音视频 |

### 3.4 Enable / IsUnionRule

| 字段 | 值 | 含义 |
|------|----|------|
| Enable | `0` / `1` | 已禁用 / 已启用 |
| IsUnionRule | `1` | AND — 所有规则同时满足才触发 |
| IsUnionRule | `0` | OR — 任意规则满足即触发 |

---

## 4. 产品名 → strategy_type 速查

> ⚠️ **术语**:本文档 `strategy_type` 等价于告警 2.0 的 `viewName`(老称呼),底层都是同一概念。`DescribeAlarmPolicies` / `DescribeAlarmHistories` 的 Namespace 字段填的就是 strategy_type。
>
> `DescribeAlarmMetrics` / `DescribeAlarmEvents` 必须双参 `MonitorType + Namespace`(详见 § 7 陷阱表)。

### 4.1 热门产品

| 用户常说 | MonitorType | strategy_type(传 Namespace 字段) |
|---------|-------------|----------------------------------|
| CVM / 云服务器 | MT_QCE | `cvm_device` |
| MySQL / CDB | MT_QCE | `cdb_detail` |
| COS / 对象存储 | MT_QCE | `COS` |
| MongoDB | MT_QCE | `cmongo_instance` |
| CKafka | MT_QCE | `CKAFKA_INSTANCE` |
| 拨测 / Probe | MT_PROBE | —(查 Policies/Histories 不传 Namespace) |
| APM | MT_TAW | —(查 Policies/Histories 不传 Namespace) |
| RUM | MT_RUM | —(查 Policies/Histories 不传 Namespace) |
| RUM 移动端 | MT_RUMAPP | —(查 Policies/Histories 不传 Namespace) |
| TRTC / 实时音视频 | MT_TRTC | —(查 Policies/Histories 不传 Namespace) |

> 📍 **MT_QCE 类**:strategy_type 取值参考上表,或用 `scripts/alarm_lookup.py search` 兜底查询。
> 📍 **APM/RUM/Probe/TRTC/RUMAPP 类(非 MT_QCE)**:strategy_type 取值用 `DescribeAllNamespaces --MonitorTypes '["MT_TAW"]'`(或对应 MonitorType)实时查询,取返回的 `CommonNamespaces[].Id` 作为 Namespace 值(见 § 5 DescribeAllNamespaces)。

### 4.2 表外产品(Redis / CLB / PostgreSQL / ES / CDN 等)

用 `scripts/alarm_lookup.py` 查全量字典(本工具内部读 `references/data/alarm_strategy.jsonl`,与调用方 cwd 无关):

```bash
# 在产品中文名(strategy_show_name_zh)字段上按正则搜索,默认大小写不敏感
# 输出格式: strategy_type \t strategy_show_name_zh \t namespace
python3 scripts/alarm_lookup.py search "Redis|CLB|PostgreSQL"

# 也可指定其他字段:--field strategy_show_name_en|strategy_type|cloud_product_show_name_zh|namespace
python3 scripts/alarm_lookup.py search "^cvm_" --field strategy_type

# 按 strategy_type 精确反查(输出完整 JSON 单行)
python3 scripts/alarm_lookup.py get cvm_device
```

### 4.3 多 strategy_type 产品的处理规则

部分产品在告警平台对应**多个 strategy_type**(不同部署形态/版本/粒度),LLM 不能凭空挑一个。

**已知多 strategy_type 的产品**(实测):

| 产品 | strategy_type 数量 | 典型差异维度 |
|------|------------------|-------------|
| Redis | 10 | CKV/集群版/内存版(1 分钟/5 秒粒度)/Memcached 版 各自独立 |
| CLB | 多个 | 公网/内网、四层/七层 |
| MongoDB | 多个 | 实例/副本集/分片 |

**处理流程**:

> 💡 **搜索 keyword 选取**:`alarm_lookup.py search` 在 `strategy_show_name_zh`(中文名)上匹配,用户口语词与 jsonl 里**未必一致**。常见映射:
> - `CLB` → jsonl 叫"**负载均衡**"(如"负载均衡-内网"`CLB_PRIVATE`、"负载均衡-外网"`CLB_PUBLIC`)
> - `MySQL` → jsonl 叫"**云数据库-MySQL**"
> - `MongoDB` → jsonl 叫"**云数据库-MongoDB**"
> - 拿不准时直接搜更宽的关键词(如先 `search 负载均衡` 看候选,再按部署类型挑)

1. 用户**显式说了部署类型**(如"Redis 内存版"、"内网 CLB") → 用 `alarm_lookup.py search` 找匹配的 strategy_type 后直接用
2. 用户**只说产品名**(如"Redis 的告警") → **追问**部署类型,或 `search Redis` 列出所有候选让用户选
3. 用户**不在意细分** → 可传所有相关 strategy_type 数组(`--Namespaces '["redis_mem_edition","REDIS-CLUSTER",...]'`),返回结果合并展示

> ⚠️ **不要硬编码** — 如 Redis 实测 10 个 strategy_type(`redisUuid` / `REDIS-CLUSTER` / `redis_mem_edition` / `redis_mem_proxy` / `redis_mem_node` / `redis_mem_proxy_dim` / `redis_mem_node_dim` / `redis_mem_command` / `redis_mem_global` / `memcached_instance`),硬编码列表会过时,**永远以 `alarm_lookup.py search` 实时查询为准**。

---

## 5. 详细 Action 用法

### 5.1 DescribeAlarmPolicies — 告警策略列表

- 用途:列出告警策略,支持产品/启用状态/通知模板等筛选
- 必填:无
- 可选:`--Namespaces`(Array of String)、`--Enable`(Array of Integer)、`--PolicyType`(Array)、`--RuleTypes`(Array)、`--NoticeIds`(Array)、`--PageNumber`、`--PageSize`
- 示例:

```bash
tccli monitor DescribeAlarmPolicies --Module monitor \
  --region ap-guangzhou \
  --PageNumber 1 --PageSize 50 \
  --Namespaces '["cvm_device"]' \
  --Enable '[1]'
```

### 5.2 DescribeAlarmPolicy — 单条策略详情

- 必填:`--PolicyId`(string)
- 示例:`tccli monitor DescribeAlarmPolicy --Module monitor --region ap-guangzhou --PolicyId policy-xxx`

### 5.3 DescribeBindingPolicyObjectList — 策略绑定对象列表

- 用途:查某条告警策略绑定的实例对象(策略覆盖了哪些机器)
- 必填:`--GroupId`(int) — 用 PolicyId 时必传 0
- 可选:`--PolicyId`(string)、`--Limit`(int 1-100,默认 20)、`--Offset`(int,默认 0)
- 示例:

```bash
tccli monitor DescribeBindingPolicyObjectList --Module monitor \
  --region ap-guangzhou \
  --GroupId 0 --PolicyId policy-xxx \
  --Limit 20 --Offset 0
```

- 出参:`Total` / `NoShieldedSum`(未屏蔽数) / `List[]`(每项含 `Dimensions` / `IsShielded` / `Region` / `UniqueId`)

### 5.4 DescribeAlarmHistories — 告警历史

- 用途:查告警触发记录,支持时间窗 + 实例 ID 模糊 + 产品过滤
- 必填:无(默认 24h)
- 可选:`--StartTime`(int Unix 秒)、`--EndTime`(int)、`--Namespaces`(Array of MonitorTypeNamespace 嵌套对象)、`--AlarmObject`(string)、`--AlarmStatus`(Array)、`--AlarmLevels`(Array)、`--PolicyIds`(Array)、`--PageNumber`、`--PageSize`
- 示例:

```bash
tccli monitor DescribeAlarmHistories --Module monitor \
  --region ap-guangzhou \
  --StartTime 1717804800 --PageNumber 1 --PageSize 50 \
  --Namespaces '[{"MonitorType":"MT_QCE","Namespace":"cvm_device"}]' \
  --AlarmStatus '["ALARM"]'
```

### 5.5 DescribeAlarmNotices — 通知模板列表

- 必填:`--PageNumber`(int)、`--Order`(string,ASC/DESC) — **即使想用默认值也不能省**
- 可选:`--PageSize`、`--NoticeIds`、`--ReceiverType`(USER/GROUP)
- 示例:`tccli monitor DescribeAlarmNotices --Module monitor --region ap-guangzhou --PageNumber 1 --PageSize 50 --Order ASC`

### 5.6 DescribeAlarmNotice — 单条通知模板详情

- 必填:`--NoticeId`(string)
- 出参:`Notice` 单对象,含 `Name` / `NoticeType` / `UserNotices[]` / `URLNotices[]` / `CLSNotices[]` / `PolicyIds[]`(绑定的策略 ID 列表)
- ⚠️ 接口名跟列表 `DescribeAlarmNotices` 仅差最后一个 s

### 5.7 DescribeAlarmNoticeCallbacks — 回调 URL 列表

- 用途:查账号下所有告警回调 URL(全局视图,不分策略)
- 必填:无业务参数
- 出参:`URLNotices[]`,每项含 `URL` + `IsValid`(0=无效 / 1=有效)

### 5.8 DescribeAlarmMetrics — 告警可用指标列表

- 必填:`--MonitorType`(string,如 `MT_QCE`)、`--Namespace`(string,strategy_type 如 `cvm_device`)
- 出参:`Metrics[]`,每项含 `MetricName`(英文)、`Description`(中文)、`Unit`、`Dimensions`、`MetricConfig`(含 Period/Operator)

### 5.9 DescribeAlarmEvents — 告警可用事件列表

- 必填:`--region`(⚠️ 这个接口 region 是必填,不像其他接口可选)、`--Namespace`(strategy_type)
- 可选:`--MonitorType`(默认 `MT_QCE`)
- 出参:`Events[]`,每项含 `EventName`(英文,如 `ping_unreachable`)、`Description`(中文)、`Namespace`

### 5.10 DescribeAllNamespaces — 全 namespace 字典

- 用途:列出告警平台支持的全部 namespace,按 MonitorType 分类返回。**APM/RUM/Probe/TRTC/RUMAPP 类 Namespace 取值的权威源**(`alarm_strategy.jsonl` 不覆盖这些类的完整字段)
- 必填:`--Module monitor`、`--SceneType ST_ALARM`(告警场景固定值)
- 可选:`--MonitorTypes`(Array,如 `'["MT_TAW","MT_RUM"]'`)、`--Ids`(按 Id 过滤)
- 示例:

```bash
# 列 APM 类全部 namespace
tccli monitor DescribeAllNamespaces --Module monitor \
  --region ap-guangzhou \
  --SceneType ST_ALARM \
  --MonitorTypes '["MT_TAW"]'
```

- 出参分组:
  - `QceNamespacesNew[]` — MT_QCE 类(云产品监控,~707 条),与 `alarm_strategy.jsonl` 中 MT_QCE 行对应
  - `CommonNamespaces[]` — 非 MT_QCE 类(APM/RUM/Probe/TRTC/RUMAPP 等),~32 条;每项含 `Id`(用作 Namespace 入参)、`Name`(中文名)、`MonitorType`、`Dimensions[]`(策略可用的维度键如 `tapm.instance.key`/`service.name` 等)
  - `CustomNamespacesNew[]` — 用户自定义监控 namespace
- ⚠️ `Value` 字段在 `CommonNamespaces` 里**为 None**(仅 QceNamespacesNew 才有);非 MT_QCE 类调 `DescribeAlarmMetrics/Events` 时,Namespace 入参用 `Id` 字段(如 APM 的 `performance_metric`)

**典型工作流**(用户问"APM 有哪些可监控指标"):
1. `DescribeAllNamespaces --MonitorTypes '["MT_TAW"]'` → 拿到 4 个 APM Id(`performance_metric` / `performance_billing_metric` / `performance_database_metric` / `error_metric`)
2. 让用户选 → `DescribeAlarmMetrics --MonitorType MT_TAW --Namespace performance_metric` → 列具体指标

---

## 6. 业务核心概念

### 6.1 告警 1.0 vs 2.0 库辨识(影响 namespace 字段语义)

腾讯云告警系统 1.0 和 2.0 并存,**相同字段含义不同**:

| 库 | namespace 含义 | viewName 含义 | 快速识别 |
|----|---------------|--------------|---------|
| **2.0 库**(本文档主对象) | 告警的 viewName(策略类型,即 strategy_type) | —— | namespace 取值像 `cvm_device`、`clb_lb_view` |
| **1.0 中心库** | 告警的 namespace | 告警的 viewName | namespace 取值带 `qce/` 前缀,如 `qce/cvm` |
| **1.0 地域库** / **adp 库** | Barad namespace | Barad viewName | 字段名相似但视图名含地域;adp 用 `measurement` 主键 |

**口诀**:看到 `qce/xxx` → 1.0;看到看起来像视图名的 namespace → 2.0;看到 `measurement` → adp。

> 本文档 § 4 / § 5 / § 7 全部按 2.0 库口径(strategy_type / Namespace 取值如 `cvm_device`)。`alarm_strategy.jsonl` 行里的 `namespace` 字段(`qce/cvm`)是 1.0 风格元数据,**不是** 告警 API 入参。

### 6.2 三层数据模型(Policy ↔ Notice ↔ History)

```
Layer 1 策略 Policy   ← 触发规则、绑定对象、关联通知模板
Layer 2 通知模板 Notice ← 通知谁、怎么通知
Layer 3 告警历史 History ← 策略触发后产生的事件记录
```

### 6.3 跨层关联路径(LLM 在跨层提问时主动串联)

| 起点 | 终点 | 中继字段 |
|------|------|---------|
| history-list | policy-detail | `Histories[].PolicyId` |
| policy-detail | notification-list | `Policy.Notices[].NoticeId` |
| notification-list | policy-list | `Notices[].PolicyIds[]` |
| policy-list | policy-detail(批量) | `Policies[].PolicyId` |

**典型联动**(诊断"为什么没收到通知"):
- DescribeAlarmHistories → `Histories[].PolicyId` 取出策略 ID
- DescribeAlarmPolicy → `Policy.Notices[].NoticeId` 取出绑定的通知模板 ID
- DescribeAlarmNotice → `Notice.UserNotices[]` / `URLNotices[]` 看是否有接收人 + `NoticeType` 是否覆盖事件方向(`ALARM` 仅触发 / `OK` 仅恢复 / `ALL` 都通知)

具体诊断流程不在本 skill 范围(本 skill 是 API 指引);LLM 拿到上述三层关联路径自行组合 tccli 调用即可。

### 6.4 易混淆产品坑

- **CLB 内外网混杂**:同一视图 `clb_lb_view` 同时包含内网和外网实例。配置"全部对象告警"时,内网实例可能误进外网策略 — 用户问 CLB 告警时,主动追问"内网还是外网"
- **AppID 维度筛选不靠谱**:AppID 维度键名各产品不统一,**不能**简单用 AppID 判定"全部对象"。判定全量绑定时,优先看 `DescribeBindingPolicyObjectList` 的 `Total` 字段

---

## 7. 常见踩坑

| 接口 | 陷阱 | 正确做法 |
|------|------|---------|
| **所有 monitor.\*** | 漏 `--Module monitor` 报参数错误 | 必带 `--Module monitor` |
| **所有 tccli** | `--Region` 大写报 `Unknown options` | 用小写 `--region` |
| 地域参数取值 | 用户用中文(广州/上海/中国香港)、英文缩写(gz/sh/hk)、行政区(华南/华东)、海外别称(硅谷/美西)指代 | 查 [common/region_dict.md](common/region_dict.md);海外地域用 `na-`/`eu-`/`sa-` 前缀(硅谷=`na-siliconvalley`,不是 `ap-siliconvalley`) |
| `DescribeAlarmHistories` | `Namespaces` 是 `Array of MonitorTypeNamespace` 嵌套对象 | `'[{"MonitorType":"MT_QCE","Namespace":"cvm_device"}]'`,**不是** `'["cvm_device"]'` |
| `DescribeAlarmPolicies` | `Namespaces` 是 `Array of String`(平铺) | `'["cvm_device"]'`,跟 history 嵌套对象不一样 |
| `DescribeAlarmNotices` | `--PageNumber` 和 `--Order` 是 Required | `--PageNumber 1 --Order ASC`,即使想用默认值也不能省 |
| `DescribeAlarmNotice` vs `DescribeAlarmNotices` | 单复数仅差末尾 s,功能不同 | 接力查详情用单数 `DescribeAlarmNotice --NoticeId notice-xxx` |
| `DescribeBindingPolicyObjectList` | `GroupId` 和 `PolicyId` 互斥;新策略 PolicyId 形态时 GroupId 必传 0,不能省 | `--GroupId 0 --PolicyId policy-xxx` |
| `DescribeBindingPolicyObjectList` | 分页用 `--Limit/--Offset`,不是 `--PageNumber/--PageSize` | `--Limit 20 --Offset 0` |
| `DescribeAlarmEvents` | region 是**必填**(罕见,多数 monitor 接口 region 可选) | 一定带 `--region ap-guangzhou` |
| `DescribeAlarmMetrics`/`DescribeAlarmEvents` | 必须双参 `MonitorType + Namespace`,缺一会报参数错误 | `--MonitorType MT_QCE --Namespace cvm_device` |
| 时间字段 | `StartTime`/`EndTime` 必须 Unix 秒整数 | 跨平台推荐 `python3 -c "import time;print(int(time.time())-7*86400)"`；macOS `$(date -v-7d +%s)`、Linux `$(date -d '7 days ago' +%s)`、Windows PowerShell `[int][double]::Parse((Get-Date -UFormat %s ((Get-Date).AddDays(-7))))` |
| 输出 `Dimensions` | 是 JSON 字符串而非对象 | 二次解析,如 `python3 -c "import json,sys; print(json.loads(sys.stdin.read()))"` |
| 多 strategy_type 产品(Redis/CLB) | 硬编码具体取值易过时 | 用 `scripts/alarm_lookup.py search` 实时查 alarm_strategy.jsonl,见 § 4.3 |
| 按指标名过滤策略 | `DescribeAlarmPolicies` 无 `MetricName` 入参 | 用 `DescribeAlarmMetrics --Namespace <strategy_type>` 列出指标后让用户筛选;深度过滤去控制台 |
| 写操作(创建/修改/删除/暂停) | tccli 仅做只读;调写接口需用户显式确认 | 引导用户前往腾讯云监控控制台 |
| 通知历史(谁/何时被通知) | tccli 未接入 `DescribeAlarmNotifyHistories` | 引导腾讯云控制台 → 告警管理 → 通知历史 |
| 跨地域汇总(误区) | 告警策略/历史/通知模板都是**全局视图**(见 § 1.5),分地域调只会把同一份数据返回 N 次 | `--region` 任选其一(默认 `ap-guangzhou`)即可;真看地域分析需要看告警历史返回的详细信息中是否带有地域标识，不是 tccli 入参 |

---

## 8. 关键 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| 告警策略 ID | `policy-sm4v7my4` | DescribeAlarmPolicies → `Policies[].PolicyId` |
| 通知模板 ID | `notice-qvq836vc` | DescribeAlarmNotices → `Notices[].Id` |
| 绑定对象 UniqueId | 字符串(具体格式因产品而异) | DescribeBindingPolicyObjectList → `List[].UniqueId` |
| 实例 ID(传 AlarmObject) | `ins-fw8lcjpk` / `cdb-xxxxxxx` | 用户提供,前缀决定产品 |
| strategy_type | `cvm_device` / `cdb_detail` | 见 § 4 或 `alarm_lookup.py search/get` 查 alarm_strategy.jsonl |
| MetricName | `CpuUsage` / `MemUsage` / `DiskUsage` | DescribeAlarmMetrics → `Metrics[].MetricName` |
| EventName | `ping_unreachable` / `disk_readonly` | DescribeAlarmEvents → `Events[].EventName` |

---

## 9. 错误特化提示

通用错误码 → 友好提示见 [common/error_handling.md](common/error_handling.md)。以下为告警特化(优先级高于通用表):

### 9.1 policy-detail 找不到 PolicyId

```
未找到 PolicyId `policy-xxx` 对应的告警策略,请确认 ID 是否正确。
您可以使用「告警策略列表」(DescribeAlarmPolicies)查看可用策略。
```

### 9.2 Notice PageNumber/Order 缺失

```
通知模板查询缺少必填参数。tccli 调用必须同时传 --PageNumber 1 --Order ASC,
即使想用默认值也不能省略。
```

### 9.3 Namespaces 嵌套对象格式错误

```
告警历史查询的 Namespaces 是 MonitorTypeNamespace 嵌套对象数组,
正确格式:--Namespaces '[{"MonitorType":"MT_QCE","Namespace":"cvm_device"}]'
不是平铺字符串数组(那个格式只用于 DescribeAlarmPolicies)。
```
