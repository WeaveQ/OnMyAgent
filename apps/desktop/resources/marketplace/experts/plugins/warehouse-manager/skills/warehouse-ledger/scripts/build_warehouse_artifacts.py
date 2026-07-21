#!/usr/bin/env python3
"""Build warehouse stock snapshot, anomaly list, brief, CSVs, automation proposals."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def parse_date(value: str) -> date | None:
    raw = text(value)
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    return None


def load_ledger(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("warehouse-ledger.json must be an object")
    if not isinstance(data.get("movements"), list):
        data["movements"] = []
    if not isinstance(data.get("balances"), list):
        data["balances"] = []
    if not isinstance(data.get("anomalies"), list):
        data["anomalies"] = []
    return data


def process_dir(output_dir: Path) -> Path:
    path = output_dir / ".process"
    path.mkdir(parents=True, exist_ok=True)
    return path


def dwell_days(inbound: date | None, as_of: date) -> int | None:
    if inbound is None:
        return None
    return (as_of - inbound).days


def build_snapshot(balances: list[dict[str, Any]], as_of: date, dwell_alert: int) -> str:
    lines = [
        f"# Stock snapshot ({as_of.isoformat()})",
        "",
        "| Waybill | SKU | Bin | Qty | Unit | Inbound | Dwell | Status |",
        "| --- | --- | --- | ---: | --- | --- | ---: | --- |",
    ]
    for row in balances:
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        status = text(row.get("status")) or "in_stock"
        if dwell is not None and dwell >= dwell_alert and status == "in_stock":
            status = f"dwell>={dwell_alert}d"
        lines.append(
            "| {wb} | {sku} | {bin_} | {qty} | {unit} | {inbound} | {dwell} | {status} |".format(
                wb=text(row.get("waybill")) or "-",
                sku=text(row.get("sku")) or "-",
                bin_=text(row.get("bin")) or "-",
                qty=text(row.get("qty")) or "0",
                unit=text(row.get("unit")) or "-",
                inbound=inbound.isoformat() if inbound else text(row.get("inboundDate")) or "-",
                dwell="" if dwell is None else dwell,
                status=status,
            )
        )
    lines.append("")
    return "\n".join(lines)


def build_anomalies(
    balances: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
    as_of: date,
    dwell_alert: int,
) -> str:
    lines = [f"# Anomalies ({as_of.isoformat()})", ""]
    derived = 0
    for row in balances:
        qty = float(text(row.get("qty")) or 0)
        if qty < 0:
            derived += 1
            lines.append(
                f"- **negative_stock** {text(row.get('waybill'))} bin={text(row.get('bin'))} qty={qty}"
            )
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        if dwell is not None and dwell >= dwell_alert and text(row.get("status")) in {"", "in_stock"}:
            derived += 1
            lines.append(
                f"- **overstay** {text(row.get('waybill'))} dwell={dwell}d bin={text(row.get('bin'))}"
            )
    for item in anomalies:
        if not isinstance(item, dict):
            continue
        derived += 1
        lines.append(
            f"- **{text(item.get('type')) or 'anomaly'}** {text(item.get('object')) or '-'} "
            f"book={text(item.get('book'))} physical={text(item.get('physical'))} "
            f"note={text(item.get('note')) or '-'}"
        )
    if derived == 0:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def build_brief(
    movements: list[dict[str, Any]],
    balances: list[dict[str, Any]],
    as_of: date,
    dwell_alert: int,
) -> str:
    counts = {"in": 0, "out": 0, "transfer": 0, "count_gain": 0, "count_loss": 0, "adjust": 0}
    for move in movements:
        if not isinstance(move, dict):
            continue
        key = text(move.get("type")) or "adjust"
        counts[key] = counts.get(key, 0) + 1
    overstay = 0
    for row in balances:
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        if dwell is not None and dwell >= dwell_alert:
            overstay += 1
    lines = [
        f"# Daily brief ({as_of.isoformat()})",
        "",
        f"- movements in/out/transfer: {counts.get('in', 0)}/{counts.get('out', 0)}/{counts.get('transfer', 0)}",
        f"- count gain/loss/adjust: {counts.get('count_gain', 0)}/{counts.get('count_loss', 0)}/{counts.get('adjust', 0)}",
        f"- balance lines: {len(balances)}",
        f"- overstay (>={dwell_alert}d): {overstay}",
        "",
    ]
    return "\n".join(lines)


def write_balance_csv(path: Path, balances: list[dict[str, Any]], as_of: date) -> None:
    fields = ["waybill", "sku", "bin", "qty", "unit", "inboundDate", "dwellDays", "status"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in balances:
            inbound = parse_date(text(row.get("inboundDate")))
            writer.writerow({
                "waybill": text(row.get("waybill")),
                "sku": text(row.get("sku")),
                "bin": text(row.get("bin")),
                "qty": text(row.get("qty")),
                "unit": text(row.get("unit")),
                "inboundDate": inbound.isoformat() if inbound else text(row.get("inboundDate")),
                "dwellDays": dwell_days(inbound, as_of) if inbound else "",
                "status": text(row.get("status")),
            })


def write_movement_csv(path: Path, movements: list[dict[str, Any]]) -> None:
    fields = ["time", "type", "waybill", "sku", "qtyDelta", "unit", "bin", "operator", "note"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for move in movements:
            if not isinstance(move, dict):
                continue
            writer.writerow({key: text(move.get(key)) for key in fields})


def write_daily_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "仓储·每日库存简报",
        "prompt": (
            "你是仓储作业专家。读取 warehouse-ledger.json，按 anomaly-playbook 刷新异常与滞留，"
            "生成当日进销存简报到 .process；禁止编造件数与货位。"
        ),
        "schedule": {
            "mode": "interval",
            "day": "daily",
            "time": "18:00",
            "intervalMinutes": 1440,
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

    ledger = load_ledger(args.input)
    as_of = parse_date(text(ledger.get("asOfDate"))) or date.today()
    dwell_alert = int(ledger.get("dwellAlertDays") or 7)
    movements = [m for m in ledger.get("movements", []) if isinstance(m, dict)]
    balances = [b for b in ledger.get("balances", []) if isinstance(b, dict)]
    anomalies = [a for a in ledger.get("anomalies", []) if isinstance(a, dict)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    proc = process_dir(args.output_dir)
    snap = proc / "stock-snapshot.md"
    anom = proc / "anomaly-list.md"
    brief = proc / "daily-brief.md"
    snap.write_text(build_snapshot(balances, as_of, dwell_alert), encoding="utf-8")
    anom.write_text(build_anomalies(balances, anomalies, as_of, dwell_alert), encoding="utf-8")
    brief.write_text(build_brief(movements, balances, as_of, dwell_alert), encoding="utf-8")
    files = [str(snap), str(anom), str(brief)]

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        bal_csv = args.output_dir / f"库存台账_{stamp}.csv"
        mov_csv = args.output_dir / f"库存流水_{stamp}.csv"
        proposal = args.output_dir / "automations" / "proposals" / "warehouse-daily-brief.json"
        write_balance_csv(bal_csv, balances, as_of)
        write_movement_csv(mov_csv, movements)
        write_daily_proposal(proposal)
        files.extend([str(bal_csv), str(mov_csv), str(proposal)])

    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "movementCount": len(movements),
        "balanceCount": len(balances),
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
