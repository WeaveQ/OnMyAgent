# 仓储作业 · 仓储管理员

把入库、出库、移库、盘点信息发给我，我维护 **库存台账与流水**，发现异常时提醒，生成 **库存简报**，导出 **CSV**，并在你确认后创建 **OnMyAgent 每日库存定时任务**。

## 类型

Agent 型（单个 AI 专家）

## 功能

- `warehouse-ledger.json` 单一数据源  
- 账面快照 / 异常清单 / 日简报（`.process`）  
- 库存台账 CSV + 流水 CSV  
- **确认后** 每日进销存定时任务  

## 怎么用

发交接/盘点/流水 → 核对台账与异常 → 选择是否导出与创建定时简报。

## Skill

`warehouse-ledger`（含 `build_warehouse_artifacts.py`）。

## 头像

`avatars/expert.png`。
