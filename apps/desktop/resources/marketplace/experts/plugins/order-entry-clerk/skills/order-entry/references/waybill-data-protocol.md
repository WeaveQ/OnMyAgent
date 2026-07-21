# 物流单数据协议与状态门禁

所有预览和导出必须使用同一份 `waybill-data.json`。Agent 只负责从对话中维护这份数据，HTML、PDF、Excel 必须交给 `scripts/generate_waybill.py` 生成，禁止分别手工填写造成字段不一致。

## 状态机

| 状态 | 进入条件 | 允许产物 |
| --- | --- | --- |
| `awaiting_template` | 用户尚未说明是否有指定模板 | 不生成版式，只抽取字段 |
| `collecting` | 模板已确定，但客户必填信息缺失或有冲突/低置信度字段 | HTML 草稿预览 |
| `awaiting_confirmation` | 客户必填信息齐全，等待用户确认 | HTML 待确认预览 |
| `pending_dispatch` | 客户必填信息齐全并经用户确认，但车辆/司机未齐 | HTML + PDF + XLSX“待派车确认稿” |
| `final` | 客户必填、车辆/司机均齐全，无冲突/低置信度字段，且用户明确确认 | HTML + PDF + XLSX“最终版” |

不得跳过状态。用户说“照旧”“就这样”只能确认当前回复中明确列出的字段；没有明确展示过的空字段不能据此补全。

## 数据示例

```json
{
  "document": {
    "number": "WX-20260721-001",
    "date": "2026-07-21"
  },
  "route": {
    "origin": "深圳市宝安区福永街道 1 号门",
    "destination": "东莞市长安镇乌沙社区 2 号门"
  },
  "shipper": {
    "name": "深圳某机械有限公司",
    "contact": "张经理",
    "phone": "13800000000",
    "address": "深圳市宝安区福永街道 1 号门"
  },
  "consignee": {
    "name": "东莞某工厂",
    "contact": "刘经理",
    "phone": "13900000000",
    "address": "东莞市长安镇乌沙社区 2 号门"
  },
  "cargo": [
    {
      "name": "注塑机",
      "quantity": "2 台",
      "packaging": "木架",
      "weight": "4.8 吨",
      "volume": "",
      "declaredValue": "",
      "insuranceFee": "",
      "codAmount": ""
    }
  ],
  "timeline": {
    "pickup": "2026-07-22 上午",
    "delivery": "2026-07-22 18:00 前"
  },
  "vehicleRequirement": "9.6 米尾板车",
  "vehicle": {
    "plate": "粤B12345",
    "licenseNumber": "4403XXXXXXXXXXXXXX",
    "driverName": "王师傅",
    "driverPhone": "13700000000",
    "driverAddress": ""
  },
  "carrier": {
    "name": "",
    "address": "",
    "phone": ""
  },
  "payment": {
    "method": "到付",
    "amount": "3200.00",
    "amountUppercase": "叁仟贰佰元整"
  },
  "handover": "送货",
  "remarks": "计划提货：2026-07-22 上午；要求到达：2026-07-22 18:00 前；车型：9.6 米尾板车",
  "userConfirmed": true,
  "conflicts": [],
  "lowConfidenceFields": [],
  "fieldMeta": {
    "consignee.phone": { "source": "客户微信原文", "confidence": "high" }
  }
}
```

## 客户必填门禁

- `document.number`、`document.date`
- `route.origin`、`route.destination`
- `shipper.name/contact/phone/address`
- `consignee.name/contact/phone/address`
- 至少一条货物，且每条有 `name`、`quantity`、`packaging`，并至少有 `weight` 或 `volume`
- `timeline.pickup`、`timeline.delivery`
- `payment.method`
- `handover`
- `conflicts` 与 `lowConfidenceFields` 均为空

缺失金额不阻塞客户确认稿；未确认费用必须显示“待补充”，不能填 0。相对日期必须换成绝对日期并由用户确认。

## 最终版派车门禁

最终版还必须有：

- `vehicle.plate`
- `vehicle.licenseNumber`
- `vehicle.driverName`
- `vehicle.driverPhone`

缺任一项时只允许“待派车确认稿”。司机家庭住址不是最终版门禁，缺失时显示“—”。

## 固定模板字段映射

- 详细装货/卸货地址：分别写入起运地点、目的地点；过长时保留区县和门牌，并将完整地址写入备注。
- 提货与到达时间、车型要求、装卸/回单/温控等模板外业务信息：按固定顺序写入备注。
- 多条货物：HTML 固定货物行中用“；”分隔摘要；Excel `字段数据` 每条货物独立展开，禁止丢行。
- 用户指定模板：仍使用同一数据协议与状态门禁，但 HTML/PDF 版式改用用户模板；Excel `字段数据` 保持不变。

## 生成命令

过程预览：

```bash
python3 <Skill根目录>/scripts/generate_waybill.py --input output/waybill-data.json --output-dir output --mode preview
```

用户确认后导出：

```bash
python3 <Skill根目录>/scripts/generate_waybill.py --input output/waybill-data.json --output-dir output --mode export
```

脚本以 JSON 输出实际生成的文件、状态和 `inlineWidget`。每轮回复把完整 `inlineWidget` 原样放入 `show_widget` 围栏，使当前单据直接展示在会话中；再用 `preview:` 提供放大入口。退出码非 0 或返回文件不存在时，必须原样说明失败原因，不得回复“已生成”。
