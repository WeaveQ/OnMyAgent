# 对账原因码（受控）

只使用下表 code，说明可补充一句。

| code | 含义 | 常见处理 |
|------|------|----------|
| `RATE_DIFF` | 运价/单价约定不一致 | 查合同或成交截图 |
| `EXTRA_DETENTION` | 压车/等待费 | 要压车证明与时长 |
| `EXTRA_UNLOAD` | 卸货/进仓/上楼费 | 查是否书面确认 |
| `EXTRA_MULTIPOINT` | 多点提送 | 查约定点数 |
| `WEIGHT_VOLUME` | 吨方计费争议 | 要过磅单/量方记录 |
| `POD_MISSING` | 回单未回 | 暂缓付或扣质保 |
| `POD_QUALIFY` | 回单不合格 | 退回补签 |
| `DUP_BILL` | 重复计费 | 拒付重复段 |
| `ALREADY_PAID` | 已付仍开 | 查流水 |
| `WRONG_ORDER` | 张冠李戴 | 重新匹配 |
| `FUEL_TOLL` | 油费/路桥分摊 | 查约定是否含 |
| `FINE_CLAIM` | 罚款/货损扣款 | 转异常台闭环 |
| `ROUNDING` | 四舍五入/分位 | 可接受则放过 |
| `UNKNOWN` | 待查证 | 列证据缺口 |

禁止使用模糊原因如「有问题」「不对」而不带 code。
