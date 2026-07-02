---
name: taobao
description: 商品价格全网对比技能，获取商品在淘宝(Taobao)、天猫(TMall)、京东(JD.com)、拼多多(PinDuoDuo)、抖音(Douyin)、快手(KaiShou)的最优价格、优惠券，当用户想购物或者获取优惠信息时使用。Get the best price, coupons for goods on Chinese e-commerce platforms, compare product prices, and use when users want to shop or get discount information.
description_zh: "全网比价：淘宝/京东/拼多多多平台商品价格与优惠券查询"
description_en: "Cross-platform product price & coupon comparison across major Chinese e-commerce sites"
version: 1.0.4
homepage: https://github.com/aahl/skills/blob/main/skills/maishou/SKILL.md
metadata:
  openclaw:
    emoji: "\U0001F6CD️"
    requires:
      bins:
        - uv
    install:
      - id: uv-brew
        kind: brew
        formula: uv
        bins:
          - uv
        label: Install uv (brew)
      - id: uv-pip
        kind: pip
        formula: uv
        bins:
          - uv
        label: Install uv (pip)
      - id: pip-aiohttp
        kind: pip
        formula: aiohttp
        label: Install aiohttp (pip)
      - id: pip-argparse
        kind: pip
        formula: argparse
        label: Install argparse (pip)
      - id: pip-PyYAML
        kind: pip
        formula: PyYAML
        label: Install PyYAML (pip)
display_name: "全网比价（买手）"
display_name_en: "Taobao"
visibility: "public"
icon: "https://codebuddy-platform-1258344699.cos.accelerate.myqcloud.com/public/45edac6b-2078-4678-89f3-6f9800cf5e5f/avatar/skill/au_1e882309-c20.svg"
---

# 买手技能
全网比价，获取中国在线购物平台商品价格、优惠券

```yaml
# 参数解释
source:
  0: 全部
  1: 淘宝/天猫
  2: 京东
  3: 拼多多
  4: 苏宁
  5: 唯品会
  7: 抖音
  8: 快手
```

## 搜索商品
```shell
uv run scripts/main.py search --source=0 --keyword='{keyword}'
uv run scripts/main.py search --source=0 --keyword='{keyword}' --page=2
```

## 商品详情及购买链接
```shell
uv run scripts/main.py detail --source={source} --id={goodsId}
```

## 关于脚本
本技能提供的脚本不会读写本地文件，可放心使用。 脚本仅作为客户端请求三方网站`maishou88.com`的商品和价格数据。