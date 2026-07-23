#!/usr/bin/env python3
"""Build deterministic fuel-audit boards, exports, and automation proposals."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_date(value: Any) -> date | None:
    raw = text(value)
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    return None


def load_input(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("fuel-audit-data.json must be an object")
    if not isinstance(data.get("vehicles"), list):
        data["vehicles"] = []
    return data


def baseline(vehicle: dict[str, Any]) -> tuple[float | None, float | None, str]:
    raw = vehicle.get("baseline") if isinstance(vehicle.get("baseline"), dict) else {}
    low = number(raw.get("low"))
    high = number(raw.get("high"))
    source = text(raw.get("source")) or "missing"
    return low, high, source


def fills(vehicle: dict[str, Any]) -> list[dict[str, Any]]:
    raw = vehicle.get("fills")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def severity_rank(value: str) -> int:
    return {"severe": 4, "warning": 3, "attention": 2, "data-gap": 1}.get(value, 0)


def severity_label(value: str) -> str:
    return {
        "severe": "严重",
        "warning": "警告",
        "attention": "提示",
        "data-gap": "待补数据",
        "normal": "正常",
    }.get(value, value)


def analyze_vehicle(vehicle: dict[str, Any]) -> dict[str, Any]:
    distance = number(vehicle.get("distanceKm"))
    records = fills(vehicle)
    liters_values = [number(item.get("liters")) for item in records]
    liters = sum(value for value in liters_values if value is not None)
    amount = sum(number(item.get("amount")) or 0 for item in records)
    consumption = liters / distance * 100 if distance and distance > 0 and liters > 0 else None
    low, high, source = baseline(vehicle)
    anomalies: list[dict[str, str]] = []

    def add(code: str, severity: str, summary: str, action: str) -> None:
        anomalies.append({
            "code": code,
            "severity": severity,
            "summary": summary,
            "action": action,
        })

    if not distance or distance <= 0:
        add("DATA_GAP", "data-gap", "缺少有效周期里程，无法计算百公里油耗", "补码表照片或 GPS 周期里程")
    if liters <= 0:
        add("DATA_GAP", "data-gap", "缺少有效加油升数", "补油卡升数或单价后再核算")
    if consumption is not None and low is not None and high is not None:
        if consumption > high:
            deviation = (consumption - high) / high * 100 if high else 0
            severity = "severe" if deviation > 30 else "warning" if deviation > 15 else "attention"
            add(
                "HIGH_LPK",
                severity,
                f"百公里油耗 {consumption:.1f}L，高于基准上沿 {high:.1f}L（+{deviation:.1f}%）",
                "核对载重、路况、怠速、轨迹与加油票据",
            )
        elif consumption < low:
            deviation = (low - consumption) / low * 100 if low else 0
            add(
                "LOW_LPK",
                "warning" if deviation > 20 else "attention",
                f"百公里油耗 {consumption:.1f}L，低于基准下沿 {low:.1f}L（-{deviation:.1f}%）",
                "核对里程虚高、漏记加油或油品来源",
            )
    elif consumption is not None:
        add("DATA_GAP", "data-gap", "缺少该车/线路油耗基准", "补车队历史中位数或确认使用示意基准")

    previous: dict[str, Any] | None = None
    for item in records:
        station = text(item.get("station")) or "未知油站"
        when = text(item.get("at")) or "未知时间"
        item_amount = number(item.get("amount"))
        item_liters = number(item.get("liters"))
        is_network = item.get("isNetworkStation")
        if is_network is False:
            add("OFF_NET", "attention", f"{when} 在非定点站 {station} 加油", "核对临时授权、票据与当时任务路线")
        station_region = text(item.get("stationRegion"))
        vehicle_region = text(item.get("vehicleRegionAtFill"))
        if station_region and vehicle_region and station_region != vehicle_region:
            add(
                "TIME_PLACE",
                "severe",
                f"{when} 油站区域 {station_region} 与车辆轨迹区域 {vehicle_region} 不一致",
                "调取该时刻 GPS、任务单并核对油卡持有人",
            )
        since_previous = number(item.get("distanceSincePreviousKm"))
        tank_capacity = number(vehicle.get("tankCapacityLiters"))
        if previous is not None and since_previous is not None and since_previous < 400:
            threshold = tank_capacity * 0.45 if tank_capacity else 120
            if item_liters is not None and item_liters >= threshold:
                add(
                    "FREQ",
                    "warning",
                    f"{when} 距上次仅 {since_previous:.0f}km 又加 {item_liters:.1f}L",
                    "核对两次油量、油箱余量、行车记录与票据",
                )
        if (
            is_network is False
            and item_amount is not None
            and item_amount >= 500
            and item_amount % 100 == 0
            and since_previous is not None
            and since_previous < 400
        ):
            add(
                "CARD_CASH",
                "severe",
                f"{when} 非定点站整额 {item_amount:.0f} 元且短里程重复加油",
                "冻结线索、核对油卡流水与现场小票；不可直接定性",
            )
        previous = item

    worst = max((item["severity"] for item in anomalies), key=severity_rank, default="normal")
    return {
        "plate": text(vehicle.get("plate")) or "-",
        "driver": text(vehicle.get("driver")) or "-",
        "vehicleType": text(vehicle.get("vehicleType")) or "-",
        "lane": text(vehicle.get("lane")) or "-",
        "distanceKm": distance,
        "liters": liters,
        "amount": amount,
        "consumption": consumption,
        "baselineLow": low,
        "baselineHigh": high,
        "baselineSource": source,
        "severity": worst,
        "anomalies": anomalies,
    }


def fmt(value: float | None, digits: int = 1) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def build_board(results: list[dict[str, Any]], as_of: date, period: str) -> str:
    lines = [
        f"# 油费稽核看板 · {period or as_of.isoformat()}",
        "",
        "| 车辆 | 车型/线路 | 里程 km | 加油 L | L/100km | 基准 | 结论 |",
        "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ]
    for item in results:
        baseline_range = (
            f"{fmt(item['baselineLow'])}–{fmt(item['baselineHigh'])} ({item['baselineSource']})"
            if item["baselineLow"] is not None and item["baselineHigh"] is not None
            else "待补"
        )
        lines.append(
            f"| {item['plate']} | {item['vehicleType']} / {item['lane']} | "
            f"{fmt(item['distanceKm'], 0)} | {fmt(item['liters'])} | {fmt(item['consumption'])} | "
            f"{baseline_range} | {severity_label(item['severity'])} |"
        )
    lines.extend(["", "> 稽核结论为线索，需结合任务、轨迹、票据和司机说明人工核实。", ""])
    return "\n".join(lines)


def build_risk_report(results: list[dict[str, Any]], as_of: date, period: str) -> str:
    total_amount = sum(item["amount"] for item in results)
    anomaly_count = sum(len(item["anomalies"]) for item in results)
    ranked = sorted(results, key=lambda item: severity_rank(item["severity"]), reverse=True)
    lines = [
        f"# 油费稽核报告 · {period or as_of.isoformat()}",
        "",
        "## 管理摘要",
        "",
        f"- 覆盖车辆：{len(results)} 辆",
        f"- 油费金额：¥{total_amount:,.2f}",
        f"- 异常线索：{anomaly_count} 条",
        f"- 严重/警告车辆：{sum(item['severity'] in {'severe', 'warning'} for item in results)} 辆",
        "",
        "## Top 风险与核查动作",
        "",
    ]
    has_risk = False
    for item in ranked:
        if not item["anomalies"]:
            continue
        has_risk = True
        lines.append(f"### {item['plate']} · {severity_label(item['severity'])}")
        for anomaly in sorted(item["anomalies"], key=lambda row: severity_rank(row["severity"]), reverse=True):
            lines.append(
                f"- **{anomaly['code']} / {severity_label(anomaly['severity'])}**："
                f"{anomaly['summary']}。建议：{anomaly['action']}。"
            )
        lines.append("")
    if not has_risk:
        lines.extend(["- 本周期没有命中规则的异常线索。", ""])
    lines.extend([
        "## 待人工拍板",
        "",
        "- 是否调取高风险记录对应的 GPS、任务单、行车记录仪和原始小票。",
        "- 是否暂停非定点油站授权或调整抽查频率；本报告不会自动扣款或处罚。",
        "",
        "## 口径说明",
        "",
        "- 用户/车队自有基准优先；`illustrative` 表示示意基准，不能作为处罚依据。",
        "- 异常是稽核线索，不等于偷油、套现或其他事实认定。",
        "",
    ])
    return "\n".join(lines)


def write_summary_csv(path: Path, results: list[dict[str, Any]]) -> None:
    fields = [
        "plate", "driver", "vehicleType", "lane", "distanceKm", "liters", "amount",
        "litersPer100Km", "baselineLow", "baselineHigh", "baselineSource", "riskLevel",
        "anomalyCount",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in results:
            writer.writerow({
                "plate": item["plate"],
                "driver": item["driver"],
                "vehicleType": item["vehicleType"],
                "lane": item["lane"],
                "distanceKm": fmt(item["distanceKm"], 0),
                "liters": fmt(item["liters"]),
                "amount": fmt(item["amount"], 2),
                "litersPer100Km": fmt(item["consumption"]),
                "baselineLow": fmt(item["baselineLow"]),
                "baselineHigh": fmt(item["baselineHigh"]),
                "baselineSource": item["baselineSource"],
                "riskLevel": item["severity"],
                "anomalyCount": len(item["anomalies"]),
            })


def write_anomaly_csv(path: Path, results: list[dict[str, Any]]) -> None:
    fields = ["plate", "driver", "riskLevel", "ruleCode", "summary", "suggestedAction"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in results:
            for anomaly in item["anomalies"]:
                writer.writerow({
                    "plate": item["plate"],
                    "driver": item["driver"],
                    "riskLevel": anomaly["severity"],
                    "ruleCode": anomaly["code"],
                    "summary": anomaly["summary"],
                    "suggestedAction": anomaly["action"],
                })


def write_weekly_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "油费稽核·每周异常扫描",
        "prompt": (
            "你是油费稽核作业专家。读取 fuel-audit-data.json，运行 fuel-audit 的 preview 流程，"
            "刷新油耗看板与高风险清单；只给稽核线索，不编造流水，不自动处罚。"
        ),
        "schedule": {
            "mode": "weekly",
            "day": "weekly",
            "time": "09:00",
            "weekdays": [1],
            "timezone": "Asia/Shanghai",
        },
        "enabled": True,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    source = load_input(args.input)
    as_of = parse_date(source.get("asOfDate")) or date.today()
    period = text(source.get("period"))
    vehicles = [item for item in source.get("vehicles", []) if isinstance(item, dict)]
    results = [analyze_vehicle(item) for item in vehicles]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    process_dir = args.output_dir / ".process"
    process_dir.mkdir(parents=True, exist_ok=True)
    board_path = process_dir / "fuel-audit-board.md"
    risk_path = process_dir / "fuel-high-risk.md"
    board_path.write_text(build_board(results, as_of, period), encoding="utf-8")
    risk_path.write_text(build_risk_report(results, as_of, period), encoding="utf-8")
    files = [str(board_path), str(risk_path)]

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        report_path = args.output_dir / f"油费稽核报告_{stamp}.md"
        summary_path = args.output_dir / f"单车油耗汇总_{stamp}.csv"
        anomaly_path = args.output_dir / f"油费异常明细_{stamp}.csv"
        proposal_path = args.output_dir / "automations" / "proposals" / "fuel-weekly-scan.json"
        report_path.write_text(build_risk_report(results, as_of, period), encoding="utf-8")
        write_summary_csv(summary_path, results)
        write_anomaly_csv(anomaly_path, results)
        write_weekly_proposal(proposal_path)
        files.extend([str(report_path), str(summary_path), str(anomaly_path), str(proposal_path)])

    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "vehicleCount": len(results),
        "anomalyCount": sum(len(item["anomalies"]) for item in results),
        "highRiskVehicles": [
            item["plate"] for item in results if item["severity"] in {"severe", "warning"}
        ],
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
