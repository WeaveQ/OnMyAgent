#!/usr/bin/env python3
"""Build deterministic POD tracking and reconciliation artifacts."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any


FEE_FIELDS = (
    "freight",
    "emptyRun",
    "waiting",
    "unloading",
    "fuelSubsidy",
    "informationFee",
    "penalty",
    "other",
)
REASON_CODES = {
    "WAITING_FEE",
    "EMPTY_RUN",
    "UNLOADING_FEE",
    "FUEL_SUBSIDY",
    "INFORMATION_FEE",
    "PENALTY",
    "DUPLICATE_LINE",
    "MISSING_LINE",
    "WAIT_VERIFY",
}


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


def parse_date(value: Any) -> date | None:
    raw = text(value)
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "recon"


def load_data(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("pod-recon-data.json must be an object")
    return data


def pod_satisfies(status: str, rule: str) -> bool:
    if rule == "pod_not_required":
        return True
    if rule == "electronic_allowed":
        return status in {"original", "electronic", "photo"}
    return status == "original"


def build_rows(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    as_of = parse_date(data.get("asOfDate")) or date.today()
    threshold = number(data.get("varianceThreshold")) or 50
    large_threshold = number(data.get("largeVarianceThreshold")) or 2000
    rule = text(data.get("settlementRule")) or "original_required"
    raw_rows = data.get("records") if isinstance(data.get("records"), list) else []
    rows: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_rows, start=1):
        if not isinstance(raw, dict):
            unmatched.append({"row": index, "reason": "记录不是对象"})
            continue
        waybill = text(raw.get("waybillNo"))
        fees = raw.get("fees") if isinstance(raw.get("fees"), dict) else {}
        fee_values = [number(fees.get(field)) for field in FEE_FIELDS]
        counterparty = number(raw.get("counterpartyAmount"))
        missing_fields: list[str] = []
        if not waybill:
            missing_fields.append("waybillNo")
        missing_fields.extend(
            f"fees.{field}" for field, value in zip(FEE_FIELDS, fee_values) if value is None
        )
        if counterparty is None:
            missing_fields.append("counterpartyAmount")
        if missing_fields:
            unmatched.append({
                "row": index,
                "waybillNo": waybill,
                "reason": "缺少 " + "、".join(missing_fields),
            })
            continue
        own_amount = round(sum(value for value in fee_values if value is not None), 2)
        variance = round(counterparty - own_amount, 2)
        pod_status = text(raw.get("podStatus")) or "missing"
        due_date = parse_date(raw.get("dueDate"))
        overdue_days = max(0, (as_of - due_date).days) if due_date else None
        reason_code = text(raw.get("varianceReasonCode"))
        if reason_code not in REASON_CODES:
            reason_code = "WAIT_VERIFY"
        has_variance = abs(variance) > threshold
        large_variance = abs(variance) > large_threshold
        pod_ok = pod_satisfies(pod_status, rule)
        recommendation = "建议结算"
        if not pod_ok:
            recommendation = "暂缓：回单条件未满足"
        if has_variance:
            recommendation = "暂缓：费用差异待核"
        if large_variance:
            recommendation = "人工拍板：大额差异"
        rows.append({
            "waybillNo": waybill,
            "route": text(raw.get("route")),
            "driverName": text(raw.get("driverName")),
            "podStatus": pod_status,
            "podHolder": text(raw.get("podHolder")),
            "dueDate": text(raw.get("dueDate")),
            "overdueDays": overdue_days,
            "ownAmount": own_amount,
            "counterpartyAmount": round(counterparty, 2),
            "variance": variance,
            "hasVariance": has_variance,
            "largeVariance": large_variance,
            "reasonCode": reason_code if has_variance else "",
            "recommendation": recommendation,
            "notes": text(raw.get("notes")),
        })
    return rows, unmatched


def money(value: float) -> str:
    return f"¥{value:,.2f}"


def pod_tracker(data: dict[str, Any], rows: list[dict[str, Any]], unmatched: list[dict[str, Any]]) -> str:
    lines = [
        f"# 回单跟踪 · {text(data.get('period')) or '未设账期'}",
        "",
        "| 运单 | 线路 | 司机 | 回单 | 持有人 | 应回日 | 超期 | 优先级 |",
        "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ]
    for row in rows:
        overdue = row["overdueDays"]
        priority = "高" if row["podStatus"] == "missing" and (overdue or 0) > 7 else "中" if row["podStatus"] != "original" else "低"
        overdue_text = "待确认" if overdue is None else str(overdue)
        lines.append(
            f"| {row['waybillNo']} | {row['route'] or '-'} | {row['driverName'] or '-'} | {row['podStatus']} | "
            f"{row['podHolder'] or '-'} | {row['dueDate'] or '-'} | {overdue_text} | {priority} |"
        )
    lines.extend(["", "## 无法匹配", *[f"- 第 {item['row']} 行：{item['reason']}" for item in unmatched], ""])
    if not unmatched:
        lines.insert(-1, "- 无")
    return "\n".join(lines)


def recon_markdown(data: dict[str, Any], rows: list[dict[str, Any]], unmatched: list[dict[str, Any]]) -> str:
    own_total = round(sum(row["ownAmount"] for row in rows), 2)
    counterparty_total = round(sum(row["counterpartyAmount"] for row in rows), 2)
    variance_total = round(counterparty_total - own_total, 2)
    lines = [
        f"# 对账单草稿 · {text(data.get('period')) or '未设账期'}",
        "",
        f"- 对方：{text(data.get('counterparty')) or '待确认'}",
        f"- 结算规则：{text(data.get('settlementRule')) or 'original_required'}",
        f"- 我方合计：{money(own_total)}",
        f"- 对方合计：{money(counterparty_total)}",
        f"- 合计差异：{money(variance_total)}",
        "",
        "| 运单 | 我方 | 对方 | 差异 | 回单 | 原因码 | 建议 |",
        "| --- | ---: | ---: | ---: | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['waybillNo']} | {money(row['ownAmount'])} | {money(row['counterpartyAmount'])} | "
            f"{money(row['variance'])} | {row['podStatus']} | {row['reasonCode'] or '-'} | {row['recommendation']} |"
        )
    lines.extend([
        "",
        f"- 无法匹配记录：{len(unmatched)} 条，未计入合计。",
        "> 本文件是草稿，不代表已入账、已付款或已更新回单状态。",
        "",
    ])
    return "\n".join(lines)


def variance_markdown(rows: list[dict[str, Any]]) -> str:
    lines = ["# 差异清单", ""]
    for row in rows:
        if not row["hasVariance"]:
            continue
        lines.append(
            f"- {row['waybillNo']}：{money(row['variance'])} / {row['reasonCode']} / {row['recommendation']} / {row['notes'] or '无证据说明'}"
        )
    if len(lines) == 2:
        lines.append("- 无超过阈值的差异")
    lines.append("")
    return "\n".join(lines)


def chase_scripts(data: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    lines = [f"# 催回单话术 · {text(data.get('period')) or '未设账期'}", ""]
    for row in rows:
        if row["podStatus"] == "original":
            continue
        lines.append(
            f"{row['driverName'] or '师傅'}您好，运单 {row['waybillNo']} 当前回单状态为 {row['podStatus']}，"
            f"登记持有人为 {row['podHolder'] or '待确认'}。请回复原件/电子件当前状态及预计回传日期，便于本期对账。"
        )
        lines.append("")
    lines.append("> 仅为催办草稿，不自动发送。")
    lines.append("")
    return "\n".join(lines)


def write_csv(path: Path, rows: list[dict[str, Any]], only_variance: bool = False) -> None:
    fields = ("waybillNo", "route", "driverName", "podStatus", "dueDate", "overdueDays", "ownAmount", "counterpartyAmount", "variance", "reasonCode", "recommendation", "notes")
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if only_variance and not row["hasVariance"]:
                continue
            writer.writerow({field: row.get(field, "") for field in fields})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()
    data = load_data(args.input)
    rows, unmatched = build_rows(data)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)
    pod_path = process / "pod-tracker.md"
    recon_path = process / "reconciliation-draft.md"
    variance_path = process / "variance-list.md"
    pod_path.write_text(pod_tracker(data, rows, unmatched), encoding="utf-8")
    recon_path.write_text(recon_markdown(data, rows, unmatched), encoding="utf-8")
    variance_path.write_text(variance_markdown(rows), encoding="utf-8")
    files = [str(pod_path), str(recon_path), str(variance_path)]
    if args.mode == "export":
        period = safe_name(text(data.get("period")))
        statement_path = args.output_dir / f"对账单_{period}.csv"
        diff_path = args.output_dir / f"差异清单_{period}.csv"
        chase_path = args.output_dir / f"催回单话术_{period}.md"
        write_csv(statement_path, rows)
        write_csv(diff_path, rows, only_variance=True)
        chase_path.write_text(chase_scripts(data, rows), encoding="utf-8")
        files.extend([str(statement_path), str(diff_path), str(chase_path)])
    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "period": text(data.get("period")),
        "rows": rows,
        "unmatched": unmatched,
        "totals": {
            "own": round(sum(row["ownAmount"] for row in rows), 2),
            "counterparty": round(sum(row["counterpartyAmount"] for row in rows), 2),
            "variance": round(sum(row["variance"] for row in rows), 2),
        },
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
