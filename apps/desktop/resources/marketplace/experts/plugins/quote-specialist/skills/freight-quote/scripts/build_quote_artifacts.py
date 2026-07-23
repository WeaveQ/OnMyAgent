#!/usr/bin/env python3
"""Build deterministic freight quote options and floor-price guard artifacts."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path
from typing import Any


OPTION_LABELS = {
    "fastest": "最快",
    "balanced": "平衡",
    "cheapest": "最便宜",
}
COST_FIELDS = (
    "linehaul",
    "pickup",
    "delivery",
    "handling",
    "pod",
    "insurance",
    "tax",
    "other",
)
REQUIRED_INQUIRY = (
    "origin",
    "destination",
    "cargoName",
    "weightKg",
    "volumeM3",
    "requiredHours",
)


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    raw = text(value).replace(",", "")
    if not raw:
        return None
    try:
        parsed = float(raw)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "quote"


def load_request(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("quote-request.json must be an object")
    return data


def mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def request_gaps(data: dict[str, Any]) -> list[str]:
    inquiry = mapping(data, "inquiry")
    gaps = [f"inquiry.{key}" for key in REQUIRED_INQUIRY if not text(inquiry.get(key))]
    costs = mapping(data, "costBase")
    gaps.extend(f"costBase.{key}" for key in COST_FIELDS if number(costs.get(key)) is None)
    return gaps


def bounded_rate(value: Any, fallback: float) -> float:
    parsed = number(value)
    if parsed is None or parsed < 0 or parsed >= 0.8:
        return fallback
    return parsed


def money(value: float | None) -> str:
    return "待确认" if value is None else f"¥{value:,.2f}"


def calculate_options(data: dict[str, Any], gaps: list[str]) -> list[dict[str, Any]]:
    if any(gap.startswith("costBase.") for gap in gaps):
        return [
            {
                "key": key,
                "label": label,
                "cost": None,
                "floor": None,
                "price": None,
                "marginRate": None,
                "hours": None,
                "service": "待补成本后计算",
                "floorClamped": False,
            }
            for key, label in OPTION_LABELS.items()
        ]

    costs = mapping(data, "costBase")
    base_cost = sum(number(costs.get(key)) or 0 for key in COST_FIELDS)
    policy = mapping(data, "pricingPolicy")
    adjustments = mapping(data, "optionAdjustments")
    floor_margin = bounded_rate(policy.get("floorMarginRate"), 0.08)
    target_margin = bounded_rate(policy.get("targetMarginRate"), 0.15)
    fastest_markup = bounded_rate(policy.get("fastestMarkupRate"), 0.12)
    cheapest_discount = bounded_rate(policy.get("cheapestDiscountRate"), 0.06)
    options: list[dict[str, Any]] = []
    for key, label in OPTION_LABELS.items():
        adjustment = adjustments.get(key)
        detail = adjustment if isinstance(adjustment, dict) else {}
        cost = max(0, base_cost + (number(detail.get("cost")) or 0))
        floor = cost / (1 - floor_margin)
        target = cost / (1 - target_margin)
        proposed = target
        if key == "fastest":
            proposed = target * (1 + fastest_markup)
        elif key == "cheapest":
            proposed = target * (1 - cheapest_discount)
        price = max(floor, proposed)
        options.append({
            "key": key,
            "label": label,
            "cost": round(cost, 2),
            "floor": round(floor, 2),
            "price": round(price, 2),
            "marginRate": round((price - cost) / price, 4) if price else 0,
            "hours": number(detail.get("hours")),
            "service": text(detail.get("service")) or "待确认",
            "floorClamped": proposed < floor,
        })
    return options


def quote_markdown(data: dict[str, Any], gaps: list[str], options: list[dict[str, Any]]) -> str:
    inquiry = mapping(data, "inquiry")
    policy = mapping(data, "pricingPolicy")
    pending = data.get("pendingConditions")
    pending_items = pending if isinstance(pending, list) else []
    lines = [
        f"# 报价方案 · {text(data.get('quoteId')) or '未编号'}",
        "",
        f"- 线路：{text(inquiry.get('origin')) or '待确认'} → {text(inquiry.get('destination')) or '待确认'}",
        f"- 货物：{text(inquiry.get('cargoName')) or '待确认'} / {text(inquiry.get('weightKg')) or '?'} kg / {text(inquiry.get('volumeM3')) or '?'} m³",
        f"- 车型/方式：{text(inquiry.get('vehicleType')) or '待确认'}",
        f"- 报价有效期：{text(policy.get('validHours')) or '待确认'} 小时",
        "",
        "## 三档对比",
        "",
        "| 档位 | 服务 | 时效 | 内部成本 | 内部底价 | 建议报价 | 毛利率 |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for option in options:
        margin = option["marginRate"]
        margin_text = "待确认" if margin is None else f"{margin * 100:.2f}%"
        hours = option["hours"]
        hours_text = "待确认" if hours is None else f"{hours:g}h"
        lines.append(
            f"| {option['label']} | {option['service']} | {hours_text} | {money(option['cost'])} | "
            f"{money(option['floor'])} | {money(option['price'])} | {margin_text} |"
        )
    lines.extend(["", "## 待确认与隐藏条件", ""])
    combined = [*gaps, *[text(item) for item in pending_items if text(item)]]
    lines.extend(f"- {item}" for item in combined)
    if not combined:
        lines.append("- 当前结构化字段齐全；对外发送前仍需人工复核。")
    lines.extend([
        "",
        "> 内部底价不得对外转发。最终成交价、服务范围与有效期须由业务负责人确认。",
        "",
    ])
    return "\n".join(lines)


def floor_guard_markdown(options: list[dict[str, Any]], gaps: list[str]) -> str:
    lines = ["# 底价保护检查", ""]
    if any(gap.startswith("costBase.") for gap in gaps):
        lines.append("- BLOCKED：成本字段不完整，只能输出结构，禁止给出真实报价数字。")
    else:
        for option in options:
            status = "已钳制到底价" if option["floorClamped"] else "通过"
            lines.append(
                f"- {option['label']}：建议 {money(option['price'])} / 底价 {money(option['floor'])} / {status}"
            )
    lines.extend(["", "- 禁止自动对外发送报价；禁止绕过人工拍板。", ""])
    return "\n".join(lines)


def scripts_markdown(data: dict[str, Any], options: list[dict[str, Any]]) -> str:
    inquiry = mapping(data, "inquiry")
    balanced = next(option for option in options if option["key"] == "balanced")
    route = f"{text(inquiry.get('origin')) or '起点'}→{text(inquiry.get('destination')) or '终点'}"
    lines = [f"# 报价与砍价话术 · {text(data.get('quoteId')) or '未编号'}", ""]
    if balanced["price"] is None:
        lines.append("成本尚未补齐，暂不生成含金额的对客话术。请先补全底价依据。")
    else:
        lines.extend([
            "## 首次报价",
            f"{route} 这票建议先看平衡方案：{money(balanced['price'])}，时效与服务边界见报价表；报价有效期内请确认档位。",
            "",
            "## 客户嫌贵",
            "可以优先放宽时效、改拼载或减少非必要服务项重新核价，但不能直接跌破内部底价。",
            "",
            "## 客户要求死价",
            "在装卸、等待、回单、税费和进仓条件确认后才能锁价；未确认项应列为另计或排除项。",
        ])
    lines.extend(["", "> 话术为草稿，发送给客户前必须人工确认。", ""])
    return "\n".join(lines)


def write_csv(path: Path, options: list[dict[str, Any]]) -> None:
    fields = ("option", "service", "hours", "internalCost", "internalFloor", "suggestedPrice", "marginRate")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for option in options:
            writer.writerow({
                "option": option["label"],
                "service": option["service"],
                "hours": option["hours"],
                "internalCost": option["cost"],
                "internalFloor": option["floor"],
                "suggestedPrice": option["price"],
                "marginRate": option["marginRate"],
            })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    data = load_request(args.input)
    gaps = request_gaps(data)
    options = calculate_options(data, gaps)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)
    options_path = process / "quote-options.md"
    guard_path = process / "quote-floor-guard.md"
    options_path.write_text(quote_markdown(data, gaps, options), encoding="utf-8")
    guard_path.write_text(floor_guard_markdown(options, gaps), encoding="utf-8")
    files = [str(options_path), str(guard_path)]

    if args.mode == "export":
        quote_id = safe_name(text(data.get("quoteId")))
        quote_path = args.output_dir / f"报价方案_{quote_id}.md"
        csv_path = args.output_dir / f"报价方案_{quote_id}.csv"
        script_path = args.output_dir / f"砍价话术_{quote_id}.md"
        quote_path.write_text(quote_markdown(data, gaps, options), encoding="utf-8")
        write_csv(csv_path, options)
        script_path.write_text(scripts_markdown(data, options), encoding="utf-8")
        files.extend([str(quote_path), str(csv_path), str(script_path)])

    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "quoteId": text(data.get("quoteId")),
        "gaps": gaps,
        "options": options,
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
