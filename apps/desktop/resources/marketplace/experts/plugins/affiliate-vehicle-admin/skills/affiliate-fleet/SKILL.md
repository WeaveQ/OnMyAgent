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

## 铁律

- 不编造日期与证件信息。  
- 风险提醒 ≠ 法律结论。  
- 日期不清标待确认。  
- 停运/清退须用户授权。  
- **禁止未确认创建定时任务**。  
- 会话根落文件，禁止多余 `output/`。

## 参考资料

- `references/data-protocol.md`  
- `references/onmyagent-automations.md`  
- `references/ledger-fields.md`  
- `references/expiry-alerts.md`  
- `references/risk-and-scripts.md`  
- `scripts/build_fleet_artifacts.py`  
