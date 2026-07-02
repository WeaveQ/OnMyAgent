# 事件总线（EventBridge / EB）

> 范围：腾讯云**事件总线（EventBridge）** 的 API 调用入口。覆盖事件集（EventBus）、事件规则（Rule）、事件目标（Target）、事件连接器（Connection）、事件转换器（Transformation）、平台产品事件、事件日志查询等资源的查询。
>
>
> 调用通道：`tccli eb`

---

## 1. 业务定位

| 维度 | 说明 |
|------|------|
| 模块定位 | 安全、稳定、高效的云上事件连接器 |
| 核心能力 | 流数据和事件的自动收集、处理、分发 |
| 应用场景 | 数据转投、数据处理、自动化运维 |
| tccli 服务名 | `eb` |

```bash
tccli eb help --detail
```

---

## 2. 业务核心概念

### 2.1 资源模型

```
事件集 (EventBus)
 ├── 事件连接器 (Connection)        → 事件源接入配置
 ├── 事件规则 (Rule)                → 事件匹配 / 路由规则
 │    ├── 事件目标 (Target)         → 事件去向
 │    └── 事件转换器 (Transformation) → 字段映射 / 格式转换
 └── 事件日志 (SearchLog)           → 事件流转链路审计
```

### 2.2 资源 ID 格式

| ID | 示例 | 获取方式 |
|----|------|---------|
| 事件集 ID | `eb-xxxxxxxx` | `ListEventBuses` |
| 规则 ID | `rule-xxxxxxxx` | `ListRules` |
| 目标 ID | `target-xxxxxxxx` | `ListTargets` |
| 连接器 ID | `connection-xxxxxxxx` | `ListConnections` |
| 转换器 ID | `transformation-xxxxxxxx` | `GetRule` 关联或 `GetTransformation` |

### 2.3 典型场景

| 场景 | 说明 |
|------|------|
| 数据转投 | 将一个云产品产生的事件转发到另一个目标（如 SCF / CKafka / CLS） |
| 数据处理 | 对事件做规则过滤、字段转换 |
| 自动化运维 | 监听特定事件触发自动化动作 |

---

## 3. 速查表

| 域 | 动作 | 一句话用途 |
|----|------|-----------|
| 事件集 | `ListEventBuses` | 列出事件集 |
| 事件集 | `GetEventBus` | 事件集详情 |
| 规则 | `ListRules` | 列出某个事件集下的规则 |
| 规则 | `GetRule` | 规则详情（含事件匹配模式） |
| 目标 | `ListTargets` | 列出某个规则下的事件目标 |
| 连接器 | `ListConnections` | 列出事件连接器 |
| 转换器 | `GetTransformation` | 转换器详情 |
| 平台产品 | `ListPlatformProducts` | 平台产品列表（事件源类型） |
| 平台产品 | `ListPlatformEventNames` | 平台产品事件名列表 |
| 平台产品 | `ListPlatformEventPatterns` | 平台产品事件匹配规则模板 |
| 平台产品 | `GetPlatformEventTemplate` | 平台产品事件 JSON 模板 |
| 事件日志 | `SearchLog` | 事件流转日志检索 |
| 事件日志 | `DescribeLogTagValue` | 按字段聚合的标签值 |
| 校验 | `CheckRule` | 校验事件匹配规则是否命中（dry-run） |
| 校验 | `CheckTransformation` | 校验转换器输出（dry-run） |

---

## 4. 详细 Action 用法

### 4.1 事件集（EventBus）

#### ListEventBuses
- 用途：列出事件集。
- 必填：无
- 可选：`--Offset`, `--Limit`, `--Order`(asc/desc), `--OrderBy`, `--Filters`(Array of Filter)
- 示例：`tccli eb ListEventBuses --Offset 0 --Limit 20`

#### GetEventBus
- 用途：查询事件集详情（含 CLS 投递配置、保留天数、计费模式等）。
- 必填：`--EventBusId`
- 输出关键字段：`EventBusName`、`Type`、`PayMode`、`SaveDays`、`EnableStore`、`ClsLogsetId`、`ClsTopicId`、`LinkMode`

### 4.2 规则（Rule）/ 目标（Target）

#### ListRules
- 用途：列出某事件集下的规则。
- 必填：`--EventBusId`
- 可选：`--Offset`, `--Limit`, `--Order`, `--OrderBy`

#### GetRule
- 用途：查询规则详情，含 `EventPattern`（JSON 字符串形式的事件匹配模式）。
- 必填：`--EventBusId`, `--RuleId`
- 输出关键字段：`EventPattern`、`Enable`、`Status`、`Description`

#### ListTargets
- 用途：列出某规则下绑定的事件目标。
- 必填：`--EventBusId`, `--RuleId`
- 可选：`--Offset`, `--Limit`, `--Order`, `--OrderBy`

### 4.3 连接器 / 转换器

#### ListConnections
- 用途：列出事件连接器（事件源接入）。
- 必填：`--EventBusId`
- 可选：`--Offset`, `--Limit`, `--Order`, `--OrderBy`

#### GetTransformation
- 用途：查询转换器详情。
- 必填：`--EventBusId`, `--RuleId`, `--TransformationId`

### 4.4 平台产品事件元数据

#### ListPlatformProducts
- 用途：列出可作为事件源的平台产品（无入参）。
- 必填：无

#### ListPlatformEventNames
- 用途：查询某平台产品下的事件名列表。
- 必填：`--ProductType`

#### ListPlatformEventPatterns
- 用途：查询某平台产品的事件匹配规则模板（用于配置 Rule 时参考）。
- 必填：`--ProductType`

#### GetPlatformEventTemplate
- 用途：获取某事件类型的 JSON 模板（用于调试 / 测试投递）。
- 必填：`--EventType`

### 4.5 事件日志查询

#### SearchLog
- 用途：检索事件流转日志（投递成功/失败、规则命中、目标分发）。
- 必填：`--StartTime`(Unix 秒), `--EndTime`(Unix 秒), `--EventBusId`, `--Page`, `--Limit`
- 可选：`--Filter`(Array of LogFilter)、`--OrderFields`、`--OrderBy`
- 提示：`Page` 从 1 开始计；`Filter` 中可按 `RuleId` / `TargetId` / `Status` 等维度过滤。

#### DescribeLogTagValue
- 用途：按字段聚合返回去重后的标签值（常用于做下拉枚举）。
- 必填：`--StartTime`, `--EndTime`, `--EventBusId`, `--GroupField`, `--Page`, `--Limit`
- 可选：`--Filter`

### 4.6 校验类（dry-run，无副作用）

#### CheckRule
- 用途：校验给定事件是否命中某个 `EventPattern`，规则上线前 dry-run。
- 必填：`--Event`(JSON 字符串), `--EventPattern`(JSON 字符串)

#### CheckTransformation
- 用途：校验转换器输出。
- 必填：`--Input`(JSON 字符串), `--Transformations`(Array of Transformation)

---

## 5. 常见踩坑

| 接口 / 场景 | 陷阱 | 正确做法 |
|------|------|---------|
| `SearchLog` | `StartTime`/`EndTime` 是 Unix **秒**（Integer），不是毫秒、不是 RFC3339 | 用 `date +%s` 取秒级时间戳 |
| `SearchLog` | `Page` 从 **1** 开始（不是从 0） | 翻页传 1, 2, 3 ... |
| `ListRules` / `ListTargets` | 必须传 `EventBusId` 才能列规则；`ListTargets` 还要 `RuleId` | 先 `ListEventBuses` → `ListRules` → `ListTargets` 三级钻取 |
| `GetRule.EventPattern` | 返回的是 JSON **字符串**而非对象 | 业务侧需要先 `JSON.parse` |
| `CheckRule` | 验证规则匹配但不会真的投递事件 | 上线前 dry-run 必跑，省去事件丢失排查 |
| 事件目标权限 | 事件目标需要事件总线服务角色有目标资源的写权限 | 排查事件未到目标时优先查权限 |
| 区域/地域 | 事件总线分地域部署，事件集 ID 不跨地域 | 跨地域查询需切 `--region` |
| 写事件投递 | `PutEvents` / `PublishEvent` 是写操作 | **不在本 skill 范围**,引导控制台 |

---

## 6. 典型查询路径

### 排查"事件没有路由到目标"

```
1. ListEventBuses                                          → 找到事件集 EventBusId
2. ListRules --EventBusId xxx                              → 找到目标 RuleId，确认 Enable=true
3. GetRule --EventBusId xxx --RuleId yyy                   → 取 EventPattern，确认匹配模式正确
4. CheckRule --Event '{...}' --EventPattern '{...}'        → dry-run 确认事件命中
5. ListTargets --EventBusId xxx --RuleId yyy               → 确认目标已绑定
6. SearchLog --EventBusId xxx --StartTime ... --EndTime ...→ 看具体投递记录与失败原因
```
