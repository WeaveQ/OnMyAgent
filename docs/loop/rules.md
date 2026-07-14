# Loop Rules

Detailed loop, durable ledger, safety, and graphify rules for OnMyAgent agents. `../../AGENTS.md` is the short entrypoint; this file is the required detailed rule source for non-trivial loop work.

## Loop 设计

默认运行级别为 **L2 辅助期**：可修改 docs、低风险代码、补测试脚本；不能无人确认地改高风险路径。

```yaml
loop_name: OnMyAgent-sweeper
goal: 修复项目中的检查、文档或低风险实现问题
verification:
  - 相关 lint/typecheck/test 退出码 0
  - 文档链接和旧引用检查通过
  - diff 只触及允许路径
boundaries:
  - 同一错误连续 3 次停止
  - 不改 secrets / production config
  - 不做真实删除、队列 purge、成本型批处理、外部消息发送
escalation: 超限或触及 Human gate 时停止并上报用户
```

### 可自动继续

- 代码实现、文档更新。
- 运行 lint / typecheck / test。
- 修复明确的测试或 lint 错误。

### Reference Parity / 外部项目对标

当用户要求 Studio “对齐 / 对标 / 复刻 / 按某项目接入”时，必须先读取参考项目源码并建立 required parity checklist。不得把任务降级成“类似体验”“外层 facade”“UI/文案对齐”或“旧链路还能跑”。

对标任务的 required checklist 必须包含：

- 参考项目核心链路：runtime、IPC/API、conversation/session、event stream、process lifecycle、persistence、permission、config/model capability、UI 状态。
- Studio 目标链路：哪些模块必须真正替换或接入参考链路，哪些旧链路明确保留。
- 用户可见反证：UI 文案、debug details、运行日志、连接模式、命令路径不能仍显示旧链路，除非该旧链路被 ledger 明确标为 required 保留或用户批准 descoped。
- 验证证据：源码映射、自动化测试、Electron/UI smoke、必要的 live provider smoke；泛型 typecheck 或“能发消息”不能替代 parity 验证。

示例：ACP 对齐不能只验证 Local Agent 能列出或能聊天；必须验证 ACP-style conversation bridge、agent metadata/handshake、normalized event stream、process registry、permission/config/session 行为，以及 UI/debug 不再把未对齐 provider 冒充为 ACP。

### 必须跳出问用户

- 改数据结构或业务 schema。
- 访问、重刷、删除线上数据。
- push / deploy / 对外发消息。
- 任务范围超出当前边界。
- 同一错误连续失败超过 3 次。
- 需要产品判断、架构取舍或优先级决策。
- 写入长期记忆或重大状态规则。

## Maker / Checker

- Implementer 必须给 Verifier 可运行命令，不能只靠自述证明正确。
- Verifier 必须跑测试或明确说明不能跑的原因。
- Verifier 默认立场是“找理由拒绝这个变更”。
- 单 Agent 执行时，也必须在实现后单独进入 Verifier 阶段审 diff、审边界、跑命令。

### Ledger 结构强制（Verifier 阶段）

每个 durable execution ledger（`.loop/plans/*ledger*.md` / `*execution*.md` / `*plan*.md`）必须包含一个**结构上独立**的 `## [VX] Verifier 阶段` 段落，与 Implementer 阶段（Px）明确分开，**不得把验证仅作为实现阶段的尾巴或自查**。Verifier 阶段要求：

- 以「找理由拒绝这个变更」的立场独立执行：重读本次 diff、核对 Denylist 与用户脏文件、独立跑验证命令；
- 结论写入 ledger 的 Verifier 结论行；Implementer 阶段完成**不得自行标记 done**，须经 Verifier 阶段通过后才可以；
- 新 ledger 一律从 `.loop/plans/_LEDGER_TEMPLATE.md` 复制骨架（该模板已内置 `[VX] Verifier 阶段` 段）。

## 验证链

| 层 | 何时 | 做什么 |
|----|------|--------|
| L0 | 每次改代码 | 相关 `tsc` / test / import smoke / `git diff --check`；默认优先用 `pnpm check:type` |
| L1 | Loop 提议修改 | 审 diff 范围，确认未触及 Denylist 和用户脏文件 |
| L2 | PR 或交付前 | `pnpm check`，并按改动范围补跑 `test:unit` / `test:api` / `test:runtime` / `test:ui` |
| L3 | 上生产或真实资源 | 人审 diff，确认环境、成本和回滚 |

文档变更也必须验证：至少检查链接、旧引用、文件位置和项目最小检查命令；无法运行时写明原因。

## 状态管理

记忆在磁盘上，不在上下文里。新会话先读状态，再开始工作。

| 文件 | 用途 |
|------|------|
| `.loop/state/PROGRESS.md` | 本地当前任务、观察项、下一步和 handoff，不提交 |
| `.loop/runs/YYYY-MM-DD.md` | 本地当前日运行日志、验证结果、下一步，不提交 |
| `.loop/plans/*.md` | 本地执行计划、临时 ledger、AI 运行用 acceptance ledger，不提交 |
| `.loop/state/intent-debt.md` | 本地 AI 猜错、边界模糊和临时债务，不提交；稳定规则再提升到 `../../AGENTS.md` 或 skill |
| `docs/loop/incidents.md` | 仅记录严重事故：误删、越权、真实资源/生产/成本风险 |
| `docs/README.md` | 文档地图；不写动态 loop 状态 |
| `.loop/archive/` | 本地历史归档，不提交 |

卫生规则：运行前读 `.loop/state/PROGRESS.md`（不存在则继续）；运行后把验证摘要追加到 `.loop/runs/YYYY-MM-DD.md`；动态 loop 状态只写 `.loop/`；重复问题回写 `../../AGENTS.md` 或 skill；普通 TODO 不写进事故复盘。执行 plan 只写 `.loop/plans/`（`docs/plans/` / `docs/archive/` / `docs/features/` / `docs/superpowers/` 已 gitignore，禁止提交）。

### Durable Long Task / Plan Ledger Rule

长任务、大迁移、大重构、跨多阶段功能、overnight execution，或用户明确要求“按计划执行 / 不要停 / 继续完成”的任务，必须使用 durable execution ledger，不能只依赖对话上下文。

权威 ledger 位置按优先级确定：

1. 用户明确指定的 ledger / plan 文件。
2. 当前任务已创建或已存在的 `.loop/plans/*ledger*.md`、`.loop/plans/*execution*.md`、`.loop/plans/*plan*.md`。
3. 如果没有现成文件，先在 `.loop/plans/<task-name>-execution-ledger.md` 创建一个。
4. 不要把执行 ledger 或 feature design draft 写入 `docs/`；稳定架构事实写入 `docs/Architecture.md` 或对应代码旁 README。

执行任何 durable ledger 任务时：

- 该 ledger 是当前任务唯一权威 Execution Packet + Acceptance Ledger，不是参考文档。
- 每轮开始必须先读本 `../../AGENTS.md`、对应 ledger，以及本地 `.loop/state/PROGRESS.md` / `.loop/runs/` 最近日志（不存在则继续）。
- 必须从 ledger 中第一个 `pending` / `in_progress` 的 required item 继续。
- 不得重新规划成更小任务，不得静默缩小 scope，不得只执行当前 prompt 里最显眼的局部事项。
- ledger 中标为 required 的 phase / item 全部 required；`descoped` 必须由用户明确批准。
- 阶段完成不是任务完成；只完成早期 slice / checkpoint / phase 时，Status 必须是 Partial，并继续下一个 required item。
- 功能完成但 ledger 要求的架构重构、文档、验证未完成时，Status 必须是 Partial。
- required verification 未全过时，Status 必须是 Partial 或 Blocked。
- **无法 live 验证的 required verification 必须标 `blocked-external`**：若某 required 验证项（如 UI CDP live smoke、需真实运行中的桌面 app、需真实凭证/外部服务）在当前环境无法实际运行，该项状态必须为 `blocked-external`（注明具体缺失：实机 / 用户状态 / 凭证 / 外部服务），且整个 ledger 的 Status 必须为 `Partial`，**不得用「预期重启后即生效」「预计无回归」「逻辑上等价」等推断代替真实证据写 `Completed`**。仅当用户明确批准该项 `descoped` / `WONT_PORT` 时，方可从 blocked 移除。
- 每完成一个子项必须更新 ledger：status、evidence、touched files、verification、next item。
- required verification 失败必须先 inspect → fix → rerun；只有同一失败连续 3 次、新产品/架构决策、缺外部凭证/账号/线上权限、破坏性/外部副作用/secrets 风险，或 required 目标与技术约束发生客观冲突时，才允许停止。
- **禁止早停在 Partial**：任何 final report、matrix、ledger、run log、`Next Required Work` 中出现 required item 仍为 `PARTIAL` / `MISSING` / 未解决 `BLOCKED` / unchecked gate 时，这些项不是后续建议，而是 completion blocker；必须把它们转成下一个 atomic task 继续执行，除非用户明确要求停在 Partial、该项被用户批准 `descoped`/`WONT_PORT`，或存在证据充分的真实 blocker。
- **Terminal reconciliation 必须在最终回复前执行**：逐项核对 ledger/matrix/test plan/final report；确认 required items 全部 `done`/用户批准 `descoped`/有理由 `WONT_PORT`，required verification 全过，UI/用户路径 evidence 已保存；否则不得写 `Completed`，也不得只写 Handoff。
- `Next` / `Remaining Gap` / `Partial, not Completed` 只能作为诊断，不是停止条件；如果 gap 在当前授权 scope 内且可验证，继续做。
- context 快满、任务中断或跨夜交接时，不得宣布 Completed；必须更新 ledger，并写 Handoff Summary + Continuation Packet。
- 不允许 commit / pull / merge / rebase / push，除非用户当次明确授权。

只有当前 ledger 的 required items 全部 `done` 或由用户明确批准 `descoped`，且 required verification 全部通过，才允许本地实现 `Status = Completed`。

## 安全护栏

### Kill Switch

- 暂停条件：同一问题 3 次失败、预算超 2x、触及 Human gate、疑似泄露 secrets、发现用户脏文件会被覆盖。
- 停止命令：本地 dev 服务优先用 `Ctrl-C` 停止；后台进程先 `lsof -i :<port>` 定位，再按 PID 终止。
- 恢复步骤：读 `.loop/state/PROGRESS.md` → 读 `.loop/runs/` 最近日志 → 查 `git status --short --branch` → 从最后通过验证点继续。

### graphify

`graphify-out/` 下有知识图谱。它是 AI Coding 的定位加速器，不是测试替代品。

默认流程：

1. 跨模块、架构、启动链路、MCP/i18n/server/Electron、安全面任务：先跑 `graphify update .` 构建/增量更新 AST 图谱（无需 LLM/API key；产物在 `graphify-out/graph.json`）。
2. 影响范围不清楚时：对目标 `文件或符号` 跑 `graphify explain "<文件或符号>"` 看其邻居与依赖。
3. 需要串联两个模块时：跑 `graphify path "<A>" "<B>"` 看最短调用/依赖路径。
4. 只解释单个模块/符号时：跑 `graphify explain "<节点>"`。
5. 图谱异常（同端点边坍缩风险）：跑 `graphify diagnose multigraph`。
5. 根据图谱结果只打开命中的关键文件，再用 `rg` / 源码阅读做精查。
6. 修改代码后默认运行增量 `graphify update .`，再跑相关 typecheck/test/build；不要常规使用 `--force`。

跳过条件：

- 用户明确给出单文件、小范围改动，且无需判断影响范围。
- 纯视觉微调，优先用浏览器/CDP/截图验证。
- UI token、按钮 primitive、spacing、文案等连续小 diff 可以先合并成一个 checkpoint：每轮先跑相关 typecheck / `git diff --check`，到 checkpoint 或交付前再跑一次增量 `graphify update .`。
- `graphify` 命令不可用；此时记录到 `.loop/runs/YYYY-MM-DD.md`，不要把不可用当作代码失败。

规则：

- dirty 文件不是跳过 graphify 的理由。
- `graphify update . --force` 只允许在增量更新被 CLI 明确拒绝（例如删除导致图谱 shrink 拒绝覆盖）或缓存异常时作为兜底；使用前后都要记录原因，不能把 `--force` 当作默认验证命令。
- `graphify-out/GRAPH_TREE.html` 是当前大仓库默认可视化入口；完整 `graph.html` 对 10k+ 节点图不稳定，不强求生成。
- `graphify-out/GRAPH_REPORT` 用于宽泛导航；若不存在，查 `graphify-out/graph.json` 或记录缺失原因。
- 没有 `GEMINI_API_KEY` / `GOOGLE_API_KEY` 时，`graphify update .` 仍可维护源码 AST 图谱；不要要求或伪造任何私有 API key。
- `graphify-out/**` 是生成物，不提交。
