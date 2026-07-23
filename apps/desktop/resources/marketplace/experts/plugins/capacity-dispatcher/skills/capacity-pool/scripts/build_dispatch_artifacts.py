#!/usr/bin/env python3
"""Build deterministic capacity freshness boards and dispatch candidates."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    try:
        parsed = float(text(value).replace(",", ""))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def timestamp(value: Any) -> datetime | None:
    raw = text(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def string_list(value: Any) -> list[str]:
    return [text(item) for item in value if text(item)] if isinstance(value, list) else []


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "dispatch"


def load_data(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("capacity-dispatch.json must be an object")
    return data


def mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def freshness(vehicle: dict[str, Any], as_of: datetime, fresh_minutes: float, aging_minutes: float) -> tuple[str, float | None]:
    updated = timestamp(vehicle.get("updatedAt"))
    if updated is None:
        return "stale", None
    minutes = max(0, (as_of - updated).total_seconds() / 60)
    if minutes <= fresh_minutes:
        return "fresh", round(minutes, 1)
    if minutes <= aging_minutes:
        return "aging", round(minutes, 1)
    return "stale", round(minutes, 1)


def region_matches(actual: str, expected: str) -> bool:
    return bool(actual and expected and (actual in expected or expected in actual))


def direction_matches(destinations: list[str], destination: str) -> bool:
    return any(region_matches(item, destination) for item in destinations)


def evaluate(
    vehicle: dict[str, Any],
    order: dict[str, Any],
    as_of: datetime,
    fresh_minutes: float,
    aging_minutes: float,
) -> tuple[dict[str, Any] | None, list[str]]:
    reasons: list[str] = []
    freshness_name, age_minutes = freshness(vehicle, as_of, fresh_minutes, aging_minutes)
    if freshness_name == "stale":
        reasons.append("运力信息 stale，须先确认")
    if text(vehicle.get("status")) != "available":
        reasons.append("车辆状态非 available")
    required_weight = number(order.get("weightKg"))
    remaining_weight = number(vehicle.get("remainingWeightKg"))
    if required_weight is None or remaining_weight is None:
        reasons.append("载重信息缺失")
    elif remaining_weight < required_weight:
        reasons.append("剩余载重不足")
    required_volume = number(order.get("volumeM3"))
    remaining_volume = number(vehicle.get("remainingVolumeM3"))
    if required_volume is None or remaining_volume is None:
        reasons.append("方数信息缺失")
    elif remaining_volume < required_volume:
        reasons.append("剩余方数不足")
    allowed_types = string_list(order.get("allowedVehicleTypes"))
    vehicle_type = text(vehicle.get("vehicleType"))
    if allowed_types and vehicle_type not in allowed_types:
        reasons.append("车型不符")
    required_capabilities = set(string_list(order.get("requiredCapabilities")))
    capabilities = set(string_list(vehicle.get("capabilities")))
    if not required_capabilities.issubset(capabilities):
        reasons.append("能力/资质不符")
    available_at = timestamp(vehicle.get("availableAt"))
    pickup_at = timestamp(order.get("pickupAt"))
    if available_at is None or pickup_at is None:
        reasons.append("可用或装货时间缺失")
    elif available_at > pickup_at:
        reasons.append("预计可用时间晚于装货时间")
    if reasons:
        return None, reasons

    origin = text(order.get("originRegion"))
    destination = text(order.get("destinationRegion"))
    current = text(vehicle.get("currentRegion"))
    willing = string_list(vehicle.get("willingDestinations"))
    empty_distance = number(vehicle.get("emptyDistanceKm"))
    score_parts = {
        "freshness": 30 if freshness_name == "fresh" else 15,
        "originFit": 25 if region_matches(current, origin) else 8,
        "directionWillingness": 20 if direction_matches(willing, destination) else 0,
        "emptyDistance": max(0, 20 - min(empty_distance if empty_distance is not None else 100, 100) * 0.2),
        "capacityKnown": 5,
    }
    score = round(sum(score_parts.values()), 2)
    risks = ["信息处于 aging，锁车前复核"] if freshness_name == "aging" else []
    if empty_distance is None:
        risks.append("空驶距离未知")
    return {
        "plate": text(vehicle.get("plate")) or "未登记车牌",
        "driverName": text(vehicle.get("driverName")) or "未登记司机",
        "vehicleType": vehicle_type,
        "currentRegion": current,
        "freshness": freshness_name,
        "ageMinutes": age_minutes,
        "emptyDistanceKm": empty_distance,
        "score": score,
        "scoreParts": score_parts,
        "reasons": [
            f"信息新鲜度 {freshness_name}",
            "起点区域贴合" if score_parts["originFit"] == 25 else "需额外空驶至起点",
            "司机方向意愿匹配" if score_parts["directionWillingness"] == 20 else "方向意愿未确认",
            "吨方与硬性能力通过",
        ],
        "risks": risks,
    }, []


def build_results(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], datetime]:
    as_of = timestamp(data.get("asOf"))
    if as_of is None:
        raise SystemExit("asOf must be an ISO timestamp with timezone")
    order = mapping(data, "order")
    settings = mapping(data, "freshness")
    fresh_minutes = number(settings.get("freshMinutes")) or 60
    aging_minutes = number(settings.get("agingMinutes")) or 180
    vehicles = data.get("vehicles") if isinstance(data.get("vehicles"), list) else []
    candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for raw in vehicles:
        if not isinstance(raw, dict):
            continue
        candidate, reasons = evaluate(raw, order, as_of, fresh_minutes, aging_minutes)
        if candidate is not None:
            candidates.append(candidate)
        else:
            rejected.append({
                "plate": text(raw.get("plate")) or "未登记车牌",
                "driverName": text(raw.get("driverName")) or "未登记司机",
                "reasons": reasons,
            })
    candidates.sort(key=lambda item: (-item["score"], item["plate"]))
    return candidates[:3], rejected, order, as_of


def capacity_board(data: dict[str, Any], as_of: datetime) -> str:
    settings = mapping(data, "freshness")
    fresh_minutes = number(settings.get("freshMinutes")) or 60
    aging_minutes = number(settings.get("agingMinutes")) or 180
    lines = [
        f"# 动态运力池 · {as_of.isoformat()}",
        "",
        "| 车牌 | 司机 | 位置 | 车型 | 状态 | 剩余吨/方 | 更新时间 | 新鲜度 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    vehicles = data.get("vehicles") if isinstance(data.get("vehicles"), list) else []
    for raw in vehicles:
        if not isinstance(raw, dict):
            continue
        level, age = freshness(raw, as_of, fresh_minutes, aging_minutes)
        age_text = "未知" if age is None else f"{age:g}min"
        weight = number(raw.get("remainingWeightKg"))
        volume = number(raw.get("remainingVolumeM3"))
        load_text = f"{weight / 1000:g}t/{volume:g}m³" if weight is not None and volume is not None else "待确认"
        lines.append(
            f"| {text(raw.get('plate')) or '-'} | {text(raw.get('driverName')) or '-'} | "
            f"{text(raw.get('currentRegion')) or '-'} | {text(raw.get('vehicleType')) or '-'} | "
            f"{text(raw.get('status')) or '-'} | {load_text} | {text(raw.get('updatedAt')) or '-'} | {level} ({age_text}) |"
        )
    lines.append("")
    return "\n".join(lines)


def options_markdown(order: dict[str, Any], candidates: list[dict[str, Any]]) -> str:
    lines = [
        f"# 配载候选 · {text(order.get('orderId')) or '未编号'}",
        "",
        f"线路：{text(order.get('originRegion')) or '?'} → {text(order.get('destinationRegion')) or '?'}",
        "",
    ]
    if not candidates:
        lines.append("- 当前无通过硬性条件的候选，禁止勉强派车；请补充或刷新运力。")
    for index, item in enumerate(candidates, start=1):
        lines.extend([
            f"## 方案 {index} · {item['plate']} / {item['driverName']} · {item['score']:.2f} 分",
            f"- 车型/位置：{item['vehicleType']} / {item['currentRegion']}",
            f"- 空驶：{item['emptyDistanceKm'] if item['emptyDistanceKm'] is not None else '未知'} km",
            *[f"- 理由：{reason}" for reason in item["reasons"]],
            *[f"- 风险：{risk}" for risk in item["risks"]],
            "- 拍板项：确认司机意愿、实时位置、装货时间与最终价格后再锁车。",
            "",
        ])
    lines.append("> 本结果不会自动锁车、改状态或发送外部消息。")
    lines.append("")
    return "\n".join(lines)


def rejected_markdown(rejected: list[dict[str, Any]]) -> str:
    lines = ["# 未入选运力", ""]
    lines.extend(
        f"- {item['plate']} / {item['driverName']}：{'、'.join(item['reasons'])}"
        for item in rejected
    )
    if not rejected:
        lines.append("- 无")
    lines.append("")
    return "\n".join(lines)


def scripts_markdown(order: dict[str, Any], candidates: list[dict[str, Any]]) -> str:
    lines = [f"# 司机确认话术 · {text(order.get('orderId')) or '未编号'}", ""]
    for item in candidates:
        lines.append(
            f"{item['driverName']}师傅，请确认当前实时位置、剩余吨方、能否在 {text(order.get('pickupAt')) or '待确认时间'} "
            f"前到达 {text(order.get('originRegion')) or '装货点'}，并确认是否愿接往 {text(order.get('destinationRegion')) or '目的地'} 的货。收到明确回复后再锁车。"
        )
        lines.append("")
    lines.append("> 仅为草稿，不自动发送。")
    lines.append("")
    return "\n".join(lines)


def write_csv(path: Path, candidates: list[dict[str, Any]]) -> None:
    fields = ("rank", "plate", "driverName", "score", "freshness", "currentRegion", "vehicleType", "emptyDistanceKm", "risks")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for index, item in enumerate(candidates, start=1):
            writer.writerow({
                "rank": index,
                "plate": item["plate"],
                "driverName": item["driverName"],
                "score": item["score"],
                "freshness": item["freshness"],
                "currentRegion": item["currentRegion"],
                "vehicleType": item["vehicleType"],
                "emptyDistanceKm": item["emptyDistanceKm"],
                "risks": "；".join(item["risks"]),
            })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    data = load_data(args.input)
    candidates, rejected, order, as_of = build_results(data)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)
    board_path = process / "capacity-board.md"
    options_path = process / "dispatch-options.md"
    rejected_path = process / "rejected-capacity.md"
    board_path.write_text(capacity_board(data, as_of), encoding="utf-8")
    options_path.write_text(options_markdown(order, candidates), encoding="utf-8")
    rejected_path.write_text(rejected_markdown(rejected), encoding="utf-8")
    files = [str(board_path), str(options_path), str(rejected_path)]
    if args.mode == "export":
        order_id = safe_name(text(order.get("orderId")))
        plan_path = args.output_dir / f"运力调配方案_{order_id}.md"
        csv_path = args.output_dir / f"运力候选_{order_id}.csv"
        script_path = args.output_dir / f"司机确认话术_{order_id}.md"
        plan_path.write_text(options_markdown(order, candidates), encoding="utf-8")
        write_csv(csv_path, candidates)
        script_path.write_text(scripts_markdown(order, candidates), encoding="utf-8")
        files.extend([str(plan_path), str(csv_path), str(script_path)])
    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "orderId": text(order.get("orderId")),
        "candidates": candidates,
        "rejected": rejected,
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
