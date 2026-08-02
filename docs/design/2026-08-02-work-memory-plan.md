# OnMyAgent 记忆模块 · 整体开发计划书

| 字段 | 内容 |
| ---- | ---- |
| 文档状态 | **规划真源（SoT）v1.5** |
| 日期 | 2026-08-02 |
| 产品名（用户可见） | 设置内 **个人** + **记忆** |
| 工程名 | Work Memory / `awareness` |
| 对标 | WorkBuddy（个性化 + 记忆）× 千问办公（意识文件包） |
| 对齐 OMA 设计 | 0726 设想对照 · 0802 双模式 · 0802 配置迁移 · 产品分层 |
| 工程仓关联 | 本文；实现以 monorepo 为准 |

---

## 0. 一页纸摘要

### 0.1 要解决什么

办公 Agent 缺「本机可审计的人设 + 跨会话记忆」：现有 Personal 表单与 conversation memory 停在 prefs 角落，**Memory 非一等资产**（设想对照约 4.5/10）。本次把记忆做成 **本机文件真相源 + 可确认写入 + 专家域隔离**，只服务 **OpenCode 主轨**。

### 0.2 做成什么样

```text
设置
├── 个人     你设定的：称呼、风格/指令、画像、工作手册
└── 记忆     学到的：开关、pending、卡片、专家记忆、本机文件、危险区
```

- 全局与专家域 **本机 Markdown/JSON**，无向量库（v1）。  
- 自动记录默认 **pending 确认** 后写入。  
- 专家会话默认写入 **用户×专家槽**，与专家安装包路径分离。

### 0.3 明确不做

| 不做 | 原因 |
| ---- | ---- |
| Personal 辅轨读写记忆 | 辅轨弱化；主轨唯一 |
| 向量数据库 | 体量小；文件 + 硬顶注入足够 |
| 企业为权威的双向冲突合并 | 采用「本机为源 + 登录后异步备份」；非双向 CRDT |
| 自动改 handbook / 仓库 AGENTS.md | 规范仅人工 |
| Evidence / Validation 一等资产 | 另题；本期不混做 |
| 「越聊越懂」P1 话术 | P1 只承诺可确认条目记忆 |

### 0.4 工期量级（单人全栈乐观×1.3–1.5）

| 里程碑 | 内容 | 粗估 |
| ---- | ---- | ---- |
| M0 | 契约、路径、迁移、B'、pending+UI、专家槽骨架 | 6–9 人日 |
| M1 MVP | 两页 + 注入 + 手册 + 专家闭环 + 溯源最低线 | 14–20 人日 |
| M2 Trust | 导出导入、危险区、全局/专家确认分流 | 5–8 人日 |
| M3 Smart | 限频反思、short 自动、项目 MEMORY | 8–14 人日 |

---

## 1. 背景与目标

### 1.1 背景

| 现状 | 问题 |
| ---- | ---- |
| `onboardingProfile` + `customInstructions` + `conversationMemory` 在 prefs | 用户打不开文件、难备份 |
| 发送时 `appendMemoryItems` 直写 items | 无确认、弱审计 |
| `buildOnboardingProfileSystemPrompt` 与 tone/instructions 分路拼接 | 难统一预算与优先级 |
| 设想对照：Memory provenance **低** | 缺「写什么、从哪次 Session、能否审计」 |

### 1.2 产品目标（可验收）

1. **个人**：称呼/指令/画像/手册稳定注入主会话。  
2. **记忆**：自动记录 → pending 可见 → 确认后跨会话仍在。  
3. **专家**：仅对该专家生效的记忆可记录、可清空、本机有文件。  
4. **信任**：Desktop 可打开文件夹；可导出/清空（阶段交付）；仅本机。  
5. **开关**：关「启用工作记忆」不注入 MEMORY/short/C；人设仍可注入（B'）。  
6. **成本**：记忆块与整包 system 有硬顶/软裁。  
7. **溯源最低线**：条目含 `source` + `updatedAt` + **`sessionId`（可空）**。  
8. **双模式（已定 1）**：**逻辑同步**——本机/企业会话同一套写入与注入；**始终写本机**；**登录后异步备份到企业**（非企业会话禁止写本机）。

### 1.3 成功标准（发布门槛 M1）

- [ ] 新用户/老用户迁移后，人设与旧记忆不丢  
- [ ] Dogfood：指令 + 手册 + 确认一条记忆 + 专家槽隔离 全过  
- [ ] 未登录、无企业 URL 可用（模式 A）  
- [ ] 不写 session-archive；不碰 Personal runtime  
- [ ] 路径与 §3 权威表一致  

---

## 2. 与 OMA 既有设计的对齐（合规）

| OMA 要求 | 本模块做法 |
| ---- | ---- |
| local-first、未登录可用 | 本机文件；不依赖登录 |
| 配置迁移：开关 ≠ 正文 | `settings.json` 开关；正文在 awareness |
| 不迁 workspace / archive / keys | 遵守 |
| 专家安装在 profile config | **用户记忆不进安装树** |
| Memory 可溯源 | sessionId + source + 确认流 |
| 主轨 / Personal 辅 | 仅主轨 |
| 本机/企业数据关系 | **记忆：逻辑同一 + 本机落盘 + 登录异步备份企业**（工作区/审批等仍可分区，见双模式文档） |
| Evidence/Validation | 非本期 |

**路径权威（与 0802 配置迁移统一后的字面约定）**

| 内容 | 权威路径 |
| ---- | ---- |
| 记忆开关（迁移 P3） | `~/.onmyagent/profiles/local/config/memory/settings.json` |
| 记忆正文 / 人设文件 / 专家用户槽 | `~/.onmyagent/data/user/awareness/`（见 §3） |
| 专家**安装包** | `profiles/local/config/experts/**`（配置迁移，**非本模块写**） |
| Skills 安装 | `profiles/local/config/skills/**`（非本模块） |

> 实现允许迁移期双读 prefs；**禁止**把用户 MEMORY 写入 `config/experts`。

---

## 3. 信息架构与存储

### 3.1 设置导航（两菜单）

| 菜单 | 心智 | 内容 |
| ---- | ---- | ---- |
| **个人** | 我教它怎么对我 | 称呼、助手名、协作风格、自定义指令（≤1500 字）、画像、工作手册、打开人设目录、重置风格/手册 |
| **记忆** | 它记住了什么 | 启用工作记忆、自动记录、pending、全局卡片、专家记忆入口、手动/显式记入、打开目录、导出导入、清空 |

互链：个人页脚 → 记忆；记忆页 → 个人。  
工程 route id 可保持 `memory` / `conversation-memory`，只改文案。

### 3.2 记忆分层（A–E）

| 层 | 含义 | 存放 |
| ---- | ---- | ---- |
| **A** | 专家人设/SOP | 专家安装包 `systemPrompt`（只读为主） |
| **B** | 用户全局工作记忆 | `data/user/awareness/main/` |
| **C** | 用户 × 专家记忆（**必做**） | `data/user/awareness/main/experts/<expertId>/` |
| **D** | 项目手册/项目记忆 | `<workspace>/.onmyagent/awareness/` |
| **E** | 当次会话 | session / archive（**不当**本模块长期库） |

### 3.3 目录布局

```text
~/.onmyagent/
  profiles/local/config/
    memory/
      settings.json           # enabled, autoCapture, autoCaptureMode, schemaVersion
    experts/                  # 【安装包】配置迁移负责，本模块只读 expertId
    skills/                   # 安装包
  data/user/awareness/
    main/
      meta.json               # 可与 settings 同步；实现定单一写权威
      style.md                # 语气 + 自定义指令
      profile.md              # 用户画像
      MEMORY.md               # 全局长期记忆
      pending.json            # 全局待确认
      short/YYYY-MM-DD.md     # 近期摘要
      activity.log.jsonl      # 可选
      experts/
        <expertId>/
          meta.json           # 可选
          MEMORY.md
          pending.json
    # 可选兼容别名：若实现短期使用 ~/.onmyagent/awareness → 必须 redirect 到 data/user/awareness

<workspace>/.onmyagent/awareness/
  handbook.md
  MEMORY.md                   # P2 项目记忆
  .gitignore
```

### 3.4 平台降级

| 环境 | 行为 |
| ---- | ---- |
| Electron | 文件真相；reveal in Finder；导出 zip |
| Web / headless | prefs 降级；隐藏打开文件夹/导出；文案说明完整能力在桌面端 |

### 3.5 重置与恢复

- 设置「清除本地数据」须 **提示或处理** awareness 目录，防幽灵注入。  
- 清空全局记忆 **默认不清** C；危险区分子操作。  
- 卸装专家：默认 **保留** C 槽；删除须确认。

---

## 4. 注入与运行时

### 4.1 唯一主组装点

`apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts`  
扩展现有 `joinSystemParts`，合并：

- 原 `buildOnboardingProfileSystemPrompt`
- `buildResponseToneSystemPrompt` / `buildCustomInstructionsSystemPrompt`
- handbook、全局 MEMORY、short、**C 专家 MEMORY**

### 4.2 注入策略 B'

| 块 | 条件 |
| ---- | ---- |
| style / profile / handbook | **有内容即注入**（不依赖记忆总闸） |
| 全局 MEMORY / short / C | **启用工作记忆 = 开** |
| pending | **永不注入** |

**优先级**

```text
A 专家 systemPrompt
> D handbook
> B style
> B profile
> C 专家 MEMORY（仅 expertId 匹配）
> B 全局 MEMORY
> short
```

文案规则：与专家冲突时听专家。

### 4.3 双模式（已定方案 1）

**产品一句话**：本机和企业 **同一套记忆逻辑**；内容 **始终以本机 awareness 为权威落盘**；用户 **已登录企业** 后，将本机记忆 **异步备份** 到企业侧（失败不挡本机读写）。

| 场景 | 读 / 注入 | 写（自动记录 / 确认 / 手动） |
| ---- | ---- | ---- |
| 未登录 · 本机会话 | 读本机 awareness | 写本机 B/C（开关开时） |
| 已登录 · 本机会话 | 同上 | 写本机；触发异步备份队列 |
| 已登录 · 企业 workspace 会话（`origin=company`） | **同一套**注入规则 | **同样写本机**；触发异步备份队列 |
| 备份失败 / 断网 | 本机不受影响 | 入重试队列；不回滚本机写入 |
| 未登录 | — | **不**调用企业 API、不建 company 记忆镜像 |

**阶段边界**

| 阶段 | 双模式相关交付 |
| ---- | ---- |
| **M0–M1** | 逻辑统一：不按 origin 分叉写入；只保证本机管线 |
| **M1.5 或企业联调档** | 异步备份协议（范围、鉴权、幂等）；可先 stub |
| **不在 M1** | 企业→本机回拉、双向合并、组织共享记忆（全员可见） |

**备份范围（默认建议，联调时可收窄）**

- 含：全局 `MEMORY` / `pending`（确认后）、专家槽 C、`style`/`profile` 可选  
- 可不含或后置：`short/`、handbook（workspace 项目文件，跟工作区走）  
- 备份前走同一敏感过滤；**不是**把企业安装包 `config/experts` 当用户记忆传

**与「工作区/审批分区」的关系**：会话列表、审批队列、默认 workspace 仍可按双模式文档分区；**仅记忆模块**采用「逻辑同步 + 本机为源 + 登录异步备份」，避免再出现 `origin=company` 不写本机的分叉。

### 4.4 调用点矩阵

| 入口 | 注入 | 自动记录 |
| ---- | ---- | ---- |
| Composer 主路径 | 是 | 是（开关） |
| 其它 prompt* | 审计后接入或标明否 | 否 |
| 自动化 | 人设可注 | **否** |
| 飞书/微信 channel | 人设可注 | **否** |
| Personal 辅轨 | **否** | **否** |

### 4.5 Token 预算

| 块 | 软顶（字符） |
| ---- | ---- |
| 自定义指令 | 1500 |
| handbook | 4k |
| profile | 2k |
| 全局 MEMORY | 6k / ≤80 条 |
| 单专家 C | 2–3k / ≤30 条 |
| short | 2k / 近 3 日 |
| 记忆子系统合计 | ~12–14k 字量级 |

另：监控整包 `combinedSystem`；超限先裁 short → 旧全局 MEMORY → 旧 C。

---

## 5. 自动记忆与 provenance

### 5.1 流水线

```text
用户消息（local composer）
  → settings.autoCapture？
  → 敏感过滤
  → 规则抽取 → Candidate
  → target: 绑定专家？ → C pending : 全局 pending
  → UI 确认/拒绝
  → 确认 → 对应 MEMORY.md（带 sessionId, source, updatedAt）
```

- 默认 `autoCaptureMode = confirm_first`  
- handbook **禁止**自动写  
- **禁止**「只写 pending 无 UI」分开发布  
- P1 显式「记入记忆」入口（不靠 regex  alone）

### 5.2 Provenance 最低线（对齐 0726）

每条已确认记忆必须可还原：

| 字段 | 说明 |
| ---- | ---- |
| text / category | 写了什么 |
| source | dialog \| manual \| import \| reflect |
| sessionId | 从哪次会话（可空，手动可无） |
| updatedAt / confirmedAt | 何时 |
| expertId | 仅 C 槽 |

P1 验收：列表可见来源与时间；有 sessionId 时可展示「来自会话」（可点或可复制 id）。  
完整 Evidence 系统 **不**在本期。

### 5.3 分类

沿用并扩展：instruction / identity / career / project / preference / fact。  
project 倾向 workspace MEMORY（P2）；专家会话默认 C。

---

## 6. 功能清单（按模块）

### M1 开关与配置

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M1.1 | 启用工作记忆 | P0–P1 |
| M1.2 | 自动记录 | P0–P1 |
| M1.3 | settings.json ↔ 运行时 | P0 |
| M1.4 | 占用上下文弱提示 | P2 |

### M2 个人页

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M2.1 | 称呼 / 助手名 | P1 |
| M2.2 | 风格 + 指令 ≤1500 | P1 |
| M2.3 | 画像表单 ↔ profile.md | P1 |
| M2.4 | 工作手册 + resolve | P1 |
| M2.5 | 打开人设目录 | P1 |
| M2.6 | 重置风格 / 手册 | P1.5 |

### M3 记忆页与自动记录

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M3.1 | 卡片列表 + 删除 | P1 |
| M3.2 | MEMORY.md 行格式 | P0 |
| M3.3 | pending UI 确认/拒绝 | P0–P1 **同列车** |
| M3.4 | 规则抽取 → pending | P0 |
| M3.5 | 手动添加 / 粘贴 | P1 |
| M3.6 | 敏感过滤 | P0 |
| M3.7 | 显式「记入记忆」 | P1 |
| M3.8 | sessionId 溯源展示 | P1 |
| M3.9 | 从其他 AI 导入 | P1.5 |
| M3.10 | short 日摘要 | P1.5–P2 |
| M3.11 | 限频反思 | P2 |

### M4 专家域（必做）

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M4.1 | `experts/<id>/` store API | P0 |
| M4.2 | 专家会话默认写 C | P1 |
| M4.3 | 注入仅匹配 expertId | P1 |
| M4.4 | 专家页「此专家记忆」最小 UI | P1 |
| M4.5 | 设置记忆页专家概览 | P1 |
| M4.6 | 确认时可选「仅专家/全局」 | P1.5 |
| M4.7 | 单独清空 C | P1.5 |

### M5 注入

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M5.1 | buildWorkMemoryContext | P0–P1 |
| M5.2 | 挂主路径 + 预算 | P1 |
| M5.3 | 双模式：写入不按 origin 分叉；登录异步备份（可 stub） | P1 逻辑 / 备份接口后置 |
| M5.4 | prompt 入口审计表 | P0 |

### M6 本机文件与备份

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M6.1 | Desktop I/O + reveal | P0 |
| M6.2 | 导出/导入 zip（含 experts） | P1.5 |
| M6.3 | reset 联动 | P0 |
| M6.4 | manifest 索引 | P2 |

### M7 工程门禁

| ID | 功能 | 阶段 |
| ---- | ---- | ---- |
| M7.1 | i18n en/zh/zh-TW | P1 |
| M7.2 | 单测 migrate/B'/pending/budget/专家隔离 | P0–P1 |
| M7.3 | 改 deprecated 直写 API 与测试 | P0 |

---

## 7. 分期交付

### Phase 0 — 契约与骨架

**交付**：路径与模板、Desktop I/O、prefs 迁移双写、B' 拆分、pending 数据+最小 UI、专家槽 API、prompt 审计表、reset 策略、handbook resolve 函数；写入路径 **不按 origin 分叉**（双模式方案 1）。

**退出**：迁移不丢；B' 测过；pending 可见可确认；C 槽可单测读写。

### Phase 1 — MVP（可对外）

**交付**：个人页、记忆页、统一注入、手册、专家写/注/最小 UI、显式记入、sessionId 展示、Desktop 打开目录；local/company 会话同一写本机逻辑；企业异步备份可接口预留/stub。

**退出**：§1.3 清单；dogfood §9。

**话术**：本机人设 + 可确认对话记忆；**不说**越聊越懂。

### Phase 1.5 — 信任

导出导入、危险重置、全局/专家确认分流、他 AI 导入、short 只读列表。

### Phase 2 — 变聪明

限频反思、short 自动、workspace MEMORY、索引、占用提示。

### Phase 3 — 按需

handbook↔AGENTS 可选同步、FTS、向量单独立项、trusted_rules。

---

## 8. 技术架构

```text
apps/app
  settings: memory-view（个人）, conversation-memory-view（记忆）
  shared/memory|work-memory: parse, pending, budget, migrate, expert slot
  shell: buildWorkMemoryContext + surface-props-hook-impl
  expert UI: 此专家记忆
  kernel: prefs 双写过渡; reset-local-storage 联动

apps/desktop
  awareness 文件 I/O, reveal, export-import
  不碰 personal-agent-runtime
  可与 ensureLocalConfigMigrated 协调：settings 写入 profile config

apps/server
  不持有记忆正文库；禁止 session-archive 当地记忆库
```

### 关键现网锚点

| 区域 | 路径 |
| ---- | ---- |
| 注入 + 现网直写 | `.../session-route/surface-props-hook-impl.ts` |
| profile builder | `.../shell/onboarding-profile.ts` |
| 抽取 | `.../shared/memory/conversation-memory.ts` |
| 设置 UI | `.../settings/pages/memory-view.tsx`, `conversation-memory-view.tsx` |
| prefs | `.../kernel/local-provider.tsx` |

### PR 切片建议

1. store + 路径 + migrate + desktop I/O + reset + experts 骨架  
2. B' + pending extract + pending UI  
3. buildWorkMemoryContext + budget（写入不分 origin）
4. 个人页  
5. 记忆页 + 溯源展示  
6. 专家页入口 + 会话写 C  
7. test + i18n + changelog  

Desktop 改动注意 human gate。

---

## 9. 测试与 Dogfood

### 9.1 自动化

- migrate、parse、敏感、budget、B' 矩阵  
- extract → pending 不进 system；confirm 晋升带 sessionId  
- 专家隔离：C1 不注入专家 2  
- local 与 company 会话写入同一本机路径（单测）；备份失败不回滚本机（若有 stub）
- combinedSystem 长度/关键片段  
- i18n-cjk / boundaries  

### 9.2 Dogfood（M1）

1. 称呼 + 指令 → 新会话生效  
2. 有 workspace 手册 hard rule → 生效；切换 workspace → 手册变  
3. 无 workspace → 手册禁用  
4. 关启用工作记忆 → 无 MEMORY；人设仍在  
5. 自动记录 → pending → 确认/拒绝  
6. 显式记入；条目可见来源/时间/session  
7. 专家 A 记一条 → 专家 B 会话不带 → 回 A 仍在  
8. 敏感跳过  
9. Desktop 打开目录  
10. 清除本地后无幽灵记忆（按策略）  

---

## 10. 风险与缓解

| 风险 | 缓解 |
| ---- | ---- |
| 与配置迁移路径分叉 | §2 权威表；实现前锁死 |
| config/experts 与 awareness/experts 混淆 | 命名空间 + 代码 review 清单 |
| pending 无 UI | 同列车强制 |
| B' breaking | 升级文案 + 测试 |
| system 叠爆 | 整包软裁 |
| 企业会话写入本机后备份泄漏 | 敏感过滤；备份范围可控；非组织共享默认 |
| 工期膨胀 | M1 话术降级；反思放 P2 |
| 多窗口文件 | 原子写 + 设置页重读 |

---

## 11. 决策记录（锁定）

| # | 决策 |
| ---- | ---- |
| 1 | 两菜单：个人、记忆 |
| 2 | 正文路径：`data/user/awareness/`；开关：`profiles/local/config/memory/settings.json` |
| 3 | 注入 B'；仅主轨 |
| 4 | Personal 不做 |
| 5 | 无向量 v1 |
| 6 | confirm_first；pending 与 UI 同交付 |
| 7 | 专家域 C 必做；与安装包分离 |
| 8 | provenance：source + time + sessionId |
| 9 | 双模式方案 1：逻辑同步 + 始终写本机 + 登录后异步备份企业 |
| 10 | handbook 人工 only；resolve 跟 prompt workspace |
| 11 | 非桌面 prefs 降级 |

---

## 12. 实现约束速查（可贴 PR）

```text
1. 注入主点：surface-props-hook-impl joinSystemParts；合并 tone/instructions/profile/handbook/B/C。
2. memory.enabled 只控制记忆类注入；人设独立（B'）。
3. extract → pending + UI；专家会话默认 C；禁止无 UI pending 发布。
4. 正文只写 data/user/awareness/**；禁止写入 profiles/**/config/experts 安装树。
5. settings 开关可与 config/memory/settings.json 对齐迁移文档。
6. 双模式：local/company 同一写入与注入；始终写本机 awareness；登录后异步备份企业（失败不挡本机）；M1 可不实现备份传输。
7. 条目保留 sessionId/source/updatedAt。
8. 不写 session-archive；不接 Personal。
9. 自动化/channel 默认不自动记录。
10. 重置本地须处理 awareness，防幽灵注入。
```

---

## 13. 文档与发布

| 文档 | 时机 |
| ---- | ---- |
| 本文 | SoT，实现与评审以此为准 |
| vault `AI 产品跟踪/OnMyAgent/` | 可选同步摘要 + 链到本文 |
| 0802 配置迁移 | 实现时补一句：正文权威 = data/user/awareness |
| CHANGELOG / README 一句 | M1 |
| Architecture 一句边界 | M1 |

**M1 对外话术**  
「在「个人」设定规则与手册；在「记忆」管理本机对话与专家记忆，确认后再生效。仅存本机。」

---

## 14. 修订历史

| 版本 | 说明 |
| ---- | ---- |
| v1.0 | 对话稿：两菜单 + 全局文件 |
| v1.1 | 审核：注入链、B'、pending UI、降级、预算、工期 |
| v1.2 | 专家域必做 |
| **v1.3** | **整体开发计划书**：OMA 合规路径、provenance、双模式 origin、功能 ID 全表、分期与验收 |
| **v1.4** | 双模式改为方案 1：逻辑同步 + 始终写本机 + 登录异步备份企业；删除 company 禁写本机 |
| **v1.5** | 短期记忆加回；自动写入开关（勾选才自动写）；个人页去掉假「本机人设文件」清单；画像留在个人/USER |

---

## 15. 评审检查清单（给你看计划时用）

- [ ] 两菜单分工是否接受  
- [ ] 路径 `data/user/awareness` + `config/memory/settings.json` 是否接受  
- [ ] 专家槽 C 必做与安装包分离是否接受  
- [x] 双模式方案 1（逻辑同步 + 本机为源 + 登录异步备份）已接受  

- [ ] M1 范围是否可砍（若要再缩：可砍手册编辑深度，不可砍 pending UI 与路径）  
- [ ] 工期是否按 1.3× 排期  

**批准后下一步**：开 M0 PR（store + migrate + pending UI 最小集 + 专家槽 API）。
