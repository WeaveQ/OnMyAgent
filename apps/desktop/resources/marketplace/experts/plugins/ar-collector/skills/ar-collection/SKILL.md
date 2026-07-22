---
name: ar-collection
description: 物流应收台账与催收方法论。根据账期、开票、回款与运单维护 ar-ledger.json，计算账龄节点，生成看板/CSV/话术包，并在用户确认后创建 OnMyAgent 定时催收任务。禁止非法催收与编造金额。
---

# 应收催收技能（AR Collection）

把账期、发票、回款、运单收成 **可看、可催、可跟、可定时** 的台账与产物。

## 标准作业流程

1. **立规则**：账期起算（对账确认日 / 开票日 / 月结固定日）、是否接受承兑。见 `references/ar-ledger.md`。  
2. **维护单一数据源**：更新会话根 `ar-ledger.json`（结构见 `references/data-protocol.md`）。禁止手改 CSV 当主数据。  
3. **算账龄与节点**：`references/aging-nodes.md` 默认 D-7 / due / +3 / +15。  
4. **生成过程产物**：
   ```bash
   python3 <Skill根目录>/scripts/build_ar_artifacts.py --input ar-ledger.json --output-dir . --mode preview
   ```
5. **定力度与话术**：`references/scripts-by-stage.md`。  
6. **用户确认后 export**：
   ```bash
   python3 <Skill根目录>/scripts/build_ar_artifacts.py --input ar-ledger.json --output-dir . --mode export
   ```
   产出 CSV、话术包、每日看板 proposal，并为每笔未结清应收生成“下一个 D-7 / 到期 / +3 / +15 节点”的 once proposal。
7. **定时任务**：按 `references/onmyagent-automations.md` 列出建议任务 → **用户确认** → 由宿主问答面板批量创建 OnMyAgent automation；创建结果卡才是成功依据。
8. **回款后**：更新核销，重跑 preview；必要时调整/停用定时任务。

## 铁律

- 无来源不编造金额、票号、客户承诺。  
- 不威胁、不骚扰式催收；停运/法务升级须用户授权。  
- 承兑未兑付 ≠ 现金已回清。  
- 话术默认「你确认后再发」。  
- **禁止未确认创建定时任务**。  
- 节点任务只生成话术并提醒负责人，禁止自动向客户发送消息。
- 会话根直接落文件，禁止多余 `output/` 套层。

## 参考资料

- `references/data-protocol.md` — JSON/产物/命令  
- `references/onmyagent-automations.md` — 定时任务门禁与载荷  
- `references/ar-ledger.md` — 台账字段、核销、状态  
- `references/aging-nodes.md` — 账龄与催收节点  
- `references/scripts-by-stage.md` — 分阶段话术与力度  
- `scripts/build_ar_artifacts.py` — 看板/CSV/话术/提案生成  
