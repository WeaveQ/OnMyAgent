---
name: affiliate-fleet
description: 挂靠车队合规台账方法论。汇总证件/保险/年检/违章为 fleet-ledger.json，生成到期与高风险看板、CSV 与催办话术，用户确认后创建 OnMyAgent 定时扫描任务。非法律意见。
---

# 挂靠车队合规技能（Affiliate Fleet）

把分散的挂靠车/司机资料收成 **可查、可催、可预警、可定时** 的合规作业。

## 标准作业流程

1. **收资料** → 2. **维护 `fleet-ledger.json`**（`ledger-fields.md` + `data-protocol.md`）
3. **算提醒**（`expiry-alerts.md`）→ 4. **扫高风险**（`risk-and-scripts.md`）
5. **preview**：
   ```bash
   python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode preview
   ```
6. **用户确认后 export** + **定时任务**（`onmyagent-automations.md`）：
   ```bash
   python3 <Skill根目录>/scripts/build_fleet_artifacts.py --input fleet-ledger.json --output-dir . --mode export
   ```
   export 会生成台账 CSV、催办话术、每日扫描提案，并为每台车计算证件/保险/年检中最近的 D-30 / D-15 / D-7 / 到期日 once 提案。宿主仅在用户确认后创建，并用结果卡反馈成功或失败。
    **交付产物（强制表格）**：过程看板（`.process/`）不提供用户链接。结果台账/话术必须用两列表格交付，不得自由发挥：

    ```markdown
    | 文件 | 操作 |
    | --- | --- |
    | <脚本返回的实际文件名.csv> | [查看](artifact:<实际文件名.csv>) |
    | <脚本返回的实际文件名.md> | [查看](artifact:<实际文件名.md>) |
    ```

    - 操作列文案固定为 **「查看」**；链接协议固定 `artifact:...`，点击 = 打开侧边栏「文件」并选中该文件进行预览。
    - 只列本次 `export` 真实生成的文件；未生成不要造行。定时任务提案不进表格，由 AutomationCreateResultCard 单独交付。
    - 禁止普通相对链接 / `file://` / `sandbox:`。

## 铁律

- 不编造日期与证件信息。
- 风险提醒 ≠ 法律结论。
- 日期不清标待确认。
- **禁止自动停运、清退、处罚或发送外部消息**；相关动作须用户授权。
- **禁止未确认创建定时任务**。
- 会话根落文件，禁止多余 `output/`。
- 结果产物（台账/催办话术）必须用两列表格 + `artifact:` 链接交付，操作列固定「查看」；过程产物（`.process/`）不提供用户链接，禁止 `file://` / `sandbox:` / 普通相对链接。

## 参考资料

- `references/data-protocol.md`
- `references/onmyagent-automations.md`
- `references/ledger-fields.md`
- `references/expiry-alerts.md`
- `references/risk-and-scripts.md`
- `scripts/build_fleet_artifacts.py`
