# 回单与费用字段

## 对齐键（优先级）

1. 运单号 `waybillNo`
2. 货主单号 / 客户单号 `customerRef`
3. 车牌 + 发车日 + 线路 `plateNo` + `departDate` + `lane`
4. 仍对不上 → **无法匹配** 区

## 回单字段

| 中文 | JSON | 说明 |
|------|------|------|
| 运单号 | waybillNo | 主键优先 |
| 线路 | lane | 装→卸简述 |
| 司机/承运 | carrierOrDriver | 催办对象 |
| 回单状态 | pod.status | 见状态枚举 |
| 回单形态 | pod.form | original / e_pod / photo / none |
| 签收人 | pod.signedBy | 可选 |
| 签收日 | pod.signedAt | 可选 |
| 应回日 | pod.dueAt | 约定或默认发车+N 天 |
| 实际回收日 | pod.receivedAt | 我方收到原件/合格电子日 |
| 当前持有人 | pod.holder | driver / hub / customer / archived / unknown |
| 超期天 | pod.overdueDays | 相对应回日或自定义规则 |
| 催收优先级 | pod.chasePriority | P0/P1/P2 |
| 备注 | remarks | 缺页、污损、仅照片等 |

### pod.status 枚举

| 值 | 中文 | 结账含义（默认） |
|----|------|------------------|
| not_required | 无需回单 | 可不卡结 |
| pending | 未回 | 建议暂缓全额结 |
| partial | 部分回（缺页/缺章） | 暂缓或扣款条件 |
| e_received | 仅电子/照片已收 | 按你们规则：可付部分或待原件 |
| original_received | 原件已收齐 | 可进入可付 |
| archived | 已归档 | 可付且闭环 |
| disputed | 争议（拒签/货损夹单） | 暂缓，转异常台 |

### 催收优先级（默认）

| 级 | 条件 |
|----|------|
| P0 | 已超期 ≥ 7 天，或结账卡点票、大额票 |
| P1 | 超期 3–6 天，或仅电子待原件 |
| P2 | 未超期但未回，提前提醒 |

## 费用字段

| 中文 | JSON | 说明 |
|------|------|------|
| 基础运费 | fee.freight | 合同/议价运费 |
| 放空费 | fee.emptyRun | |
| 等候/压车 | fee.waiting | |
| 装卸/叉车 | fee.handling | |
| 油补/路桥 | fee.fuelOrToll | |
| 信息费/回扣 | fee.commission | 记录但不协助逃税表述 |
| 罚款/扣款 | fee.deduction | 负向 |
| 其它 | fee.other | 须写说明 |
| 我方应付合计 | amount.payable | 各分项合计 |
| 对方账单金额 | amount.counterparty | 有对方账单时 |
| 差异 | amount.variance | 对方 − 我方（可配置） |
| 已付 | amount.paid | 可选 |
| 未付 | amount.open | 可选 |
| 币种 | currency | 默认 CNY |

## 对账单头信息

- 账期 `period`（如 2026-07 或 第 N 周）
- 对账对象 `counterparty`（客户 / 承运商 / 司机）
- 规则说明 `rules`（回单是否卡付、差异阈值、电子回单是否认可）
- 生成时间 `generatedAt`
