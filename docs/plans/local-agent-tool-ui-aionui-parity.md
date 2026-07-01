# 本地 Agent 工具 UI 对标 AionUi — 实施方案

## 背景与约束
- **铁律**：专家/助理聊天界面（`session-surface.tsx` → `message-list.tsx` / `composer.tsx`）禁止改。已全部回退，本方案不触碰。
- 改动只落在本地 agent 聊天页 `personal-local-agent-page.tsx`，复用 `index.css` 已就绪的 AionUi 工具类。

## 对照诊断（已核对 AionUi 源码 `~/AionUi`）

### 问题 1：空工具
AionUi 三层兜底，绝不空：
1. name：`title` → 渲染层 `getKindDisplayName(kind)`（edit→File Edit / read→File Read / execute→Shell Command）
2. description：`buildParamSummary(kind, rawInput)`（提取 file_path/command/pattern…）→ `rawInput.command` → **最终兜底 `kind`**

我们的现状：
- 后端 `contract.mjs:149` name 兜底是 `... || "tool"` → 出现字面量 **"tool"** 的空壳。
- 前端 `localAgentToolDisplay` 只有 `tool.name || localAgentToolSummary(text)`，description 无 kind 兜底 → "有名无述"。
- **完全没有 `getKindDisplayName` 友好名映射。**

### 问题 2：多工具分组（已部分具备）
- AionUi：连续工具消息合并成一张 "View Steps · N" 折叠卡片（`MessageToolGroupSummary`）。
- 我们：`groupLocalAgentTimeline` + `LocalAgentToolGroupSummary` + `LocalAgentToolRow` **已实现合并骨架**，缺的是 AionUi 的卡片视觉（浅蓝容器、状态点呼吸、圆角卡片、运行中自动展开 + 结束收起）。

## 实施（纯前端，不动后端，零风险于 runtime 单测）

### 改动 1 — 新增 kind 友好名映射（对标 `getKindDisplayName` + `buildParamSummary`）
在 `personal-local-agent-page.tsx` 新增：
- `LOCAL_AGENT_TOOL_KIND_LABELS`：`edit→File Edit`、`read→File Read`、`write→File Write`、`execute→Shell Command`、`search→Search`、`grep→Search`、`glob→Find Files`、`fetch→Fetch`、`think→Thinking`… 兜底首字母大写。
- 改造 `localAgentToolDisplay`：
  - title：`tool.name`（若是泛词 "tool"/"unknown"/空 则视作缺失）→ `getKindLabel(tool.name/kind)` → `localAgentToolSummary(text)`。
  - description：现有 `tool.description` → 兜底 `tool.input` 首行（命令/路径）→ 兜底友好 kind 文案。保证非空。

### 改动 2 — `LocalAgentToolRow` / `LocalAgentToolGroupSummary` 视觉对标 AionUi
- 组容器：`aionui-tool-container`（accent 10% 混色）+ `rounded-2xl` + `border-dls-border/60`。
- 组头："查看步骤 · N"，运行中 `Loader2` 旋转、完成 `CheckCircle2`；运行中默认展开，结束自动收起（保留手动开关）。
- 单行状态点：running=accent + `aionui-tool-breathing`（替换当前 `animate-pulse`）；failed=danger；completed=success；pending=灰。
- 单行展开详情：圆角 `pre` 块 Input/Output，保留截断提示。

### 改动 3 — i18n（如需）
现有 `timeline_tool_group_title` / `timeline_tool_detail` / `timeline_tool_truncated` 已够用。若新增友好 kind 文案，走硬编码英文（与 AionUi 的 File Edit 等一致，不进 i18n），保持与 AionUi 行为一致。

## 验证
1. `pnpm exec tsc --noEmit` 通过。
2. **视觉验证（UI 质量门）**：跑应用，触发本地 agent 多工具调用，截图对照 AionUi——确认：无空工具、多工具合并为一张卡、状态点呼吸、运行中自动展开。

## 不做
- 不动后端 adapter/contract（避免破坏 runtime.test.mjs；前端兜底已能消灭空工具）。
- 不动专家/助理共享组件。
