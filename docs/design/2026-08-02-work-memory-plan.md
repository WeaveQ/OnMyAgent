# 工作记忆（个人 / 记忆）开发计划

> **Status**: 规划真源（v1.1 + 专家域记忆必做）  
> **Date**: 2026-08-02  
> **对标**: WorkBuddy（个性化 + 记忆）× 千问办公（意识文件包）  
> **范围**: OpenCode **主轨 only** · 本地 md · **无**向量库 · **无** Personal 辅轨  
> **导航**: 设置内两个菜单——**个人** + **记忆**  
> **必做（已锁定）**: 全局工作记忆 + **专家域记忆（本地 per-expert 文件）**

---

## 0. 执行摘要

| 项 | 决定 |
| ---- | ---- |
| 产品形态 | **个人**（人设/规则）与 **记忆**（学到的内容）二分 |
| 全局存储 | `~/.onmyagent/awareness/main/`（style / profile / MEMORY / pending / short…） |
| **专家域存储（必做）** | `~/.onmyagent/awareness/main/experts/<expertId>/`（MEMORY + pending + 可选 meta） |
| 项目存储 | `<workspace>/.onmyagent/awareness/handbook.md`（+ P2 workspace MEMORY） |
| 注入 | 仅主轨；统一组装扩展现有 `joinSystemParts`；人设与记忆开关解耦（B'） |
| 自动记忆 | 默认关；抽取 → **pending（与 UI 同交付）** → 确认后写入；**专家会话默认写入专家槽 C** |
| 不做 | Personal 注入、向量库、技能进化、自动改仓库 `AGENTS.md` / handbook |
| 里程碑 | P0 契约迁移 → P1 MVP（含专家槽）→ P1.5 信任 → P2 变聪明 |

**一句话**: WorkBuddy 级好懂两页 + 千问级本机文件；专家合作攒下的记忆单独落盘、单独注入；只服务主会话。

---

## 1. 目标与非目标

### 1.1 目标

1. **个人** 设称呼/指令/画像/手册后，主会话稳定遵守。  
2. **记忆** 开自动记录后，候选在 pending 可见可确认；确认后跨会话仍在。  
3. **专家会话** 可沉淀 **仅对该专家生效** 的记忆；本机有可打开/可清空的文件。  
4. 桌面端 Finder 可打开目录；可导出/清空（阶段交付）。  
5. 关「启用工作记忆」后不带 MEMORY/short；人设/指令按 B' 仍可注入。  
6. 记忆块与整包 system 均有预算约束。

### 1.2 非目标

- Personal Local Agent / CLI 辅轨读写记忆  
- 向量库 / embedding  
- 云同步  
- 自动写 handbook 或仓库根 `AGENTS.md`  
- 把专家包内 `systemPrompt` 与用户记忆写在同一路径  
- 卸载专家时静默删除用户专家槽（须确认或保留孤儿）  
- P1 宣称「越聊越懂你」（降级为「可确认的条目记忆」；P2 再加强话术）

---

## 2. 产品规格

### 2.1 信息架构（两菜单）

```text
设置
├── 个人          ← 你设定的（慢变、人写为主）
└── 记忆          ← 学到的（可自动、可确认/删）
```

- **工程**: 不强制改 route id（现网 `memory` = 个人、`conversation-memory` = 记忆），只改 label/文案。  
- **互链**: 个人页脚 →「对话记忆请到「记忆」」；记忆页 →「称呼与规则在「个人」」。

#### 个人

| 区块 | 内容 |
| ---- | ---- |
| 称呼与身份 | 对你的称呼、助手名 |
| 协作风格 | 语气 + 自定义指令（**≤1500 字**；与 `customInstructions` / `responseTone` 合并为唯一源） |
| 用户画像 | 角色/行业/工具/任务等 |
| 工作手册 | 查看/编辑 md、恢复模板（绑定当前 workspace） |
| 本机人设文件 | 说明 + 打开文件夹（Desktop only） |
| 危险 | 重置风格、重置手册 |

#### 记忆

| 区块 | 内容 |
| ---- | ---- |
| 启用工作记忆 | **仅**控制 MEMORY + short（含专家槽确认后内容）是否注入 |
| 自动记录 | 是否抽取 → pending |
| 待确认 | pending 列表（全局 + 标注来源专家） |
| 记忆卡片 | 全局 MEMORY；来源、时间、删除 |
| **专家记忆** | 概览（专家名 + 条数）→ 点进该专家槽；或链到专家页 |
| 写一条 / 粘贴 / 显式「记入记忆」 | 手动；专家会话默认 target=专家槽 |
| 从其他 AI 导入 | P1.5 |
| 近期摘要 | P1 可空壳；P1.5–P2 实装 |
| 本机记忆文件 | 路径、打开、导出/导入（Desktop） |
| 危险 | 清空**全局**记忆；清空**某专家**记忆分入口 |

### 2.2 记忆分层（含专家）

| 层级 | 含义 | 谁写 | 谁读 | 放置 |
| ---- | ---- | ---- | ---- | ---- |
| **A** | 专家人设 / SOP | 专家包作者 | 绑该专家的会话 | 专家安装包 `systemPrompt`（**非** awareness 用户目录） |
| **B** | 用户全局工作记忆 | 用户 + 自动记录 | 主会话（含专家会话） | `awareness/main/` style·profile·MEMORY… |
| **C** | **用户 × 专家** 域记忆（**必做**） | 用户确认 / 专家会话抽取 | **仅该专家会话** | `awareness/main/experts/<expertId>/` |
| **D** | 项目 / workspace | 用户 / 确认后 | 该 workspace 会话 | `<workspace>/.onmyagent/awareness/` |
| **E** | 当次会话 | 系统 | 当前 session | session / archive（**不当**长期记忆产品） |

专家包文案里的 “Identity & Memory” 多为 **A** 或 skill 私有落盘（如 `~/travel-planning/`），**不合并进** B/C 的 MEMORY.md。

### 2.3 注入策略（B'）+ 专家

| 来源 | 何时注入 |
| ---- | ---- |
| A 专家 systemPrompt | 会话绑定该专家时 |
| D handbook | 有当前 workspace 时 |
| B style / profile | **有内容即注入**（不依赖记忆总闸） |
| **C 专家槽 MEMORY** | 会话 `expertId` 匹配 **且** 启用工作记忆 |
| B 全局 MEMORY / short | 启用工作记忆时 |
| pending（B 或 C） | **永不注入** |

**优先级（文案 + 尽量落实组装顺序）**

```text
A 专家 systemPrompt
> D handbook
> B style（tone + instructions）
> B profile
> C 专家域 MEMORY
> B 全局 MEMORY
> short
```

与专家冲突时：**听专家（A）**；全局指令作补充。

**相对现网 Breaking（B'）**

| 现网 | 本计划 |
| ---- | ---- |
| `conversationMemory.enabled` 与 profile 捆在同一 builder，关则可能整段不注入 | enabled **只关** MEMORY/short（含 C 的注入）；人设仍注入 |
| 自动记录 `appendMemoryItems` 直写 items | → **pending**，确认后写入 B 或 C |

P0 必须：升级文案、可选 banner、B' 单测。

### 2.4 自动记录路由

```text
用户消息（主会话 composer）
  → 自动记录开？
  → 敏感过滤
  → 规则抽取 → Candidate
  → 默认 target:
       绑定专家？ → C experts/<id>/pending
       否则       → 全局 pending
  → 用户确认 → 对应 MEMORY.md
  → 用户可选手动「提升为全局 / 仅本专家」（P1.5）
  → 「以后所有对话都…」类话术 → 可进全局 pending（P1.5）
```

- handbook **禁止**自动写  
- 自动化 / channel：**默认不 extract**；人设仍可按 B' 注入  
- **禁止**「只写 pending、无 UI」中间发布态  
- P1 提供显式「记入记忆」（不把体验只押 regex）

### 2.5 存储布局（真源）

```text
~/.onmyagent/awareness/main/
  meta.json
  style.md
  profile.md
  MEMORY.md
  pending.json
  short/YYYY-MM-DD.md
  activity.log.jsonl              # 可选
  index/manifest.json             # P2
  experts/                        # 必做：专家域
    <expertId>/                   # 稳定 id：packageName 或 registry id
      meta.json                   # 可选：enabled、schema、条数
      MEMORY.md
      pending.json

<workspace>/.onmyagent/awareness/
  handbook.md
  MEMORY.md                       # P2
  .gitignore
```

| 环境 | 真相源 |
| ---- | ---- |
| Electron 桌面 | 文件；prefs 迁移期双写 |
| 纯 Web / headless | prefs only；隐藏打开文件夹/导出；文案说明完整能力在桌面端 |

**硬规则**

- 用户 C 槽 **不得**写在专家安装包目录（避免升级覆盖、卸载误删资产）。  
- 卸装专家：默认 **保留** `experts/<id>/`（可标「已卸载」）；删除须二次确认。  
- 清空全局记忆 **默认不清** C；危险区分子操作。  
- Recovery / 清本地数据：须提示或默认同处理 awareness（含 experts/），防幽灵注入。  
- 文件写：temp + rename；多窗口 P1 以打开设置重读 + 保存失效为准。

### 2.6 Handbook resolve

| 场景 | 行为 |
| ---- | ---- |
| 有本地 workspace | `<workspace>/.onmyagent/awareness/handbook.md` |
| 切换 workspace | 与当次 prompt 的 `directory` / `taskWorkspaceRoot` 一致 |
| 无 workspace | 手册禁用；注入不含 handbook |
| 远程无可靠本地路径 | P1 禁用手册文件能力 |
| 仓库 `AGENTS.md` | v1 不自动改 |

### 2.7 Token 预算

**记忆相关（字符软顶）**

| 块 | 上限 |
| ---- | ---- |
| 自定义指令 | 1500 字 |
| handbook | 4k |
| profile | 2k |
| 全局 MEMORY | 6k / ≤80 条 |
| **单专家 C MEMORY** | **2–3k / ≤30 条** |
| short | 2k / 近 3 日 |
| 记忆子系统合计 | ~12–14k 字量级 |

**整包 system**: 监控 `combinedSystem`；超软顶先裁 short → 旧全局 MEMORY → 旧 C → handbook 非 Hard rules。  
裁剪时 **优先保留 A 与 style/profile 要点**。

### 2.8 注入实现约束（贴现网）

**唯一主组装点**

`apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts` 的 `joinSystemParts`。

合并今日拆开的：

- `buildOnboardingProfileSystemPrompt`
- `buildResponseToneSystemPrompt`
- `buildCustomInstructionsSystemPrompt`
- handbook / 全局 MEMORY / short / **C 专家 MEMORY**

**调用点矩阵**

| 入口 | P1 |
| ---- | ---- |
| Composer `promptAsync`（surface-props-hook-impl） | 必须统一组装 |
| 其它 `session.prompt*` | 审计后接入或标明不注入 |
| 自动化 | 注入人设（B'）；**不** extract |
| 飞书/微信 channel | 同自动化；**不**自动记录 |
| Personal 辅轨 | **不接入** |

---

## 3. 专家域记忆（必做专章）

### 3.1 为何必做

- 专家会话产生的客户口径、垂类偏好进全局会 **串味、费 token、泄域**。  
- 只写进专家 `systemPrompt` 会 **升级覆盖、用户不可审计**。  
- 产品承诺「可记录」须有 **本机文件 + 可确认 + 可清空**。

### 3.2 本地是否有配置/文件？

**有。** 与全局并列，按专家分子目录（见 §2.5）：

| 文件 | 性质 |
| ---- | ---- |
| `experts/<id>/meta.json` | 偏配置（开关、schema） |
| `experts/<id>/MEMORY.md` | 记忆内容真相源 |
| `experts/<id>/pending.json` | 待确认状态 |

专家包内文件 = **A 说明书**；`awareness/experts/` = **用户笔记本**。二者禁止混路径。

### 3.3 UI 归属

| 位置 | 内容 | 阶段 |
| ---- | ---- | ---- |
| 专家会话 | 自动记录默认进 C；显式「记入（本专家）记忆」；pending 提示 | **P1** |
| 专家详情 / 管理 | 「此专家的记忆」列表、清空、打开文件夹 | **P1 最小**（列表+清空） |
| 设置 → 记忆 | 全局为主；**专家记忆概览**（名+条数→下钻） | **P1 最小概览或链**；P1.5 打磨 |
| 确认对话框 | 「仅本专家」/「全局」（可选） | P1.5 |

### 3.4 expertId

稳定键：优先 registry / `packageName`，与 `ExpertMarketplaceEntry` / session agent 绑定 id 对齐；禁止用展示名当目录名。

### 3.5 验收（专家）

- [ ] 专家会话自动记录写入 `experts/<id>/pending`，确认后进该目录 `MEMORY.md`  
- [ ] 非该专家会话 **不注入** 该 C  
- [ ] 全局 MEMORY 在启用时仍可注入专家会话（预算次于 C）  
- [ ] 清空全局不清 C；可单独清空该专家  
- [ ] Desktop 可打开 `experts/<id>/`  
- [ ] 专家包升级 **不覆盖** C  
- [ ] 无 Personal 路径读写 C  

---

## 4. 技术架构摘要

```text
apps/app
  settings: memory-view（个人）, conversation-memory-view（记忆 + 专家概览）
  shared/memory 或 work-memory: parse, pending, budget, migrate, expert slot
  shell: buildWorkMemoryContext + surface-props-hook-impl 注入
  expert UI: 此专家记忆入口
  reset-local-storage: 联动 awareness（含 experts/）

apps/desktop
  awareness I/O / reveal / export-import
  不碰 personal-agent-runtime
```

映射现网：`appendMemoryItems` 直写 → pending；`MAX_CONVERSATION_MEMORY_ITEMS` 与 80 条对齐；Personal `context-injection` 不接。

---

## 5. 分期

### Phase 0 — 契约 / 迁移 / B' / pending+UI / 专家槽骨架

| 任务 | 说明 |
| ---- | ---- |
| P0-1 | 路径模板（**含 `experts/<id>/`**）、meta schema |
| P0-2 | Desktop I/O + 降级旗标 |
| P0-3/4 | prefs 迁移双写；读优先文件 |
| P0-5 | B' 开关拆分 + 升级文案 |
| P0-6/7 | extract → pending + **记忆页 pending UI**（同列车） |
| P0-8 | prompt 入口审计表 |
| P0-9 | reset 与 awareness（含 experts）策略 |
| P0-10 | 本文档为 SoT；可再补 Architecture 一句 |
| P0-11 | handbook resolve 函数 |
| **P0-12** | **专家槽 store API**：resolve expertId、读写 C pending/MEMORY |

**退出**: 迁移不丢；B' 测过；pending 可见可确认；专家槽 API 可单测（可先无华丽 UI）。

**预估**: 6–9 人日  

### Phase 1 — MVP（**含专家域记录闭环**）

| 轨 | 交付 |
| ---- | ---- |
| 个人 | 称呼/指令 1500/画像/手册/打开目录/互链 |
| 记忆 | 双开关、卡片、pending、手动/显式记入、隐私句、**专家概览或入口** |
| 注入 | 统一 builder；A+B+C+D 按规则；预算 |
| **专家** | 会话默认写 C；确认写 C MEMORY；注入仅匹配专家；专家页最小「此专家记忆」 |
| 平台 | Desktop 文件；非桌面 prefs 降级 |

**退出**: 见 §1.1 + §3.5；话术不做「越聊越懂」。

**预估**: 14–20 人日  

### Phase 1.5 — 信任

导出/导入（含 experts/）、危险重置三件套、确认时「全局/仅专家」、他 AI 导入、short UI。

**预估**: 5–8 人日  

### Phase 2 — 变聪明

限频反思（可按 expertId 分桶）、short 自动、workspace MEMORY、索引、占用提示。

**预估**: 8–14 人日  

### Phase 3 — 按需

handbook↔AGENTS 同步、FTS、向量单独立项、trusted_rules。

---

## 6. PR 切片建议

1. store + migrate + desktop I/O + reset + **experts/ 骨架**  
2. B' + pending extract + pending UI  
3. buildWorkMemoryContext（合并 tone/instructions + C 注入）  
4. 个人页 file-backed + handbook  
5. 记忆页卡片 + **专家概览**  
6. 专家页「此专家记忆」+ 会话写 C  
7. test + i18n + changelog  

Desktop 改动注意 human gate。

---

## 7. 测试要点

- migrate / B' / pending / budget / combinedSystem  
- **专家隔离**: 专家1 的 C 不出现在专家2 system  
- 全局清空 vs 专家清空  
- reset 无幽灵文件  
- dogfood: 专家会话记一条 → 换专家会话不带 → 回原专家仍在  

---

## 8. 决策记录（锁定）

| # | 决策 |
| ---- | ---- |
| 1 | 菜单：个人、记忆（两个） |
| 2 | 工程名 awareness；启用工作记忆 / 自动记录 |
| 3 | 注入 B' |
| 4 | Personal 不做 |
| 5 | md 文件；无向量 v1 |
| 6 | confirm_first / pending 与 UI 同交付 |
| 7 | 手册人工 only；resolve 跟 prompt workspace |
| 8 | 非桌面 prefs 降级 |
| 9 | 重置覆盖磁盘 awareness |
| 10 | **专家域记忆必做**：`experts/<id>/` 本地文件；会话默认写 C；与专家包路径分离 |
| 11 | 清空全局默认不清 C；卸装默认保留 C |

---

## 9. 实现约束速查

1. 注入主点：`surface-props-hook-impl` `joinSystemParts`；合并 tone/instructions/profile/handbook/B MEMORY/C MEMORY。  
2. `memory.enabled` 只控制记忆类注入（B MEMORY/short/C）；人设独立。  
3. extract → pending + UI；专家会话默认 C。  
4. Electron 文件真相；非桌面 prefs；reset 处理 awareness（含 experts）。  
5. handbook 绑定当次 workspaceRoot。  
6. 记忆块硬顶 + 整包 system 软裁剪。  
7. P1 显式记入；话术克制。  
8. 自动化/channel 默认不自动记录。  
9. **用户专家记忆永不写入专家安装包目录。**

---

## 10. 相关代码锚点（实现时）

| 区域 | 路径 |
| ---- | ---- |
| 注入 + 现网直写 items | `apps/app/src/react-app/shell/session-route/surface-props-hook-impl.ts` |
| profile builder | `apps/app/src/react-app/shell/onboarding-profile.ts` |
| 抽取/append | `apps/app/src/react-app/domains/shared/memory/conversation-memory.ts` |
| 个人/记忆 UI | `.../settings/pages/memory-view.tsx`, `conversation-memory-view.tsx` |
| 专家类型/systemPrompt | `.../plugins/expert-marketplace/types.ts`, packages 安装目录 |
| prefs | `apps/app/src/react-app/kernel/local-provider.tsx` |
| 重置 | `apps/app/src/react-app/kernel/reset-local-storage.ts` |

---

## 11. 修订历史

| 版本 | 说明 |
| ---- | ---- |
| v1.0 | 初版两菜单 + 全局文件计划（对话稿） |
| v1.1 | 审核补丁：注入链、B'、pending UI、降级、handbook resolve、整包预算、工期 |
| **v1.2（本文）** | **专家域记忆定为必做**；本地 `experts/<id>/`；分层 A/B/C/D；注入/自动路由/验收/分期写入 SoT |
