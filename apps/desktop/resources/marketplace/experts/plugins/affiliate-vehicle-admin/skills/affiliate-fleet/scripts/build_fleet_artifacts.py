#!/usr/bin/env python3
"""Build fleet compliance boards, CSV, chase scripts, automation proposals."""

from __future__ import annotations

import argparse
import csv
import json
import re
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


def remaining_days(expire: date | None, as_of: date) -> int | None:
    if expire is None:
        return None
    return (expire - as_of).days


def level(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days < 0:
        return "expired"
    if days <= 7:
        return "D-7"
    if days <= 15:
        return "D-15"
    if days <= 30:
        return "D-30"
    return "ok"


DOC_LABELS = {
    "driverLicenseExpire": "驾驶证",
    "qualificationExpire": "从业资格",
    "vehicleLicenseExpire": "行驶证",
    "operationPermitExpire": "营运证",
    "compulsoryExpire": "交强险",
    "commercialExpire": "商业险",
    "annualInspectionExpire": "年检",
}


def collect_items(vehicle: dict[str, Any], as_of: date) -> list[tuple[str, date | None, int | None, str]]:
    items: list[tuple[str, date | None, int | None, str]] = []
    docs = vehicle.get("docs") if isinstance(vehicle.get("docs"), dict) else {}
    insurance = vehicle.get("insurance") if isinstance(vehicle.get("insurance"), dict) else {}
    pairs = [
        *[(k, docs.get(k)) for k in ("driverLicenseExpire", "qualificationExpire", "vehicleLicenseExpire", "operationPermitExpire")],
        *[(k, insurance.get(k)) for k in ("compulsoryExpire", "commercialExpire")],
        ("annualInspectionExpire", vehicle.get("annualInspectionExpire")),
    ]
    for key, raw in pairs:
        d = parse_date(text(raw))
        days = remaining_days(d, as_of)
        items.append((DOC_LABELS.get(key, key), d, days, level(days)))
    return items


def worst_level(levels: list[str]) -> str:
    order = ["expired", "D-7", "D-15", "D-30", "unknown", "ok"]
    for name in order:
        if name in levels:
            return name
    return "ok"


def load_ledger(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("fleet-ledger.json must be an object")
    if not isinstance(data.get("vehicles"), list):
        data["vehicles"] = []
    return data


def process_dir(output_dir: Path) -> Path:
    path = output_dir / ".process"
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_expiry_board(vehicles: list[dict[str, Any]], as_of: date) -> str:
    lines = [
        f"# Fleet expiry board ({as_of.isoformat()})",
        "",
        "| Plate | Driver | Worst | Open violations | Notes |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for vehicle in vehicles:
        items = collect_items(vehicle, as_of)
        worst = worst_level([item[3] for item in items])
        lines.append(
            "| {plate} | {driver} | {worst} | {vio} | {notes} |".format(
                plate=text(vehicle.get("plate")) or "-",
                driver=text(vehicle.get("driverName")) or "-",
                worst=worst,
                vio=text(vehicle.get("violationsOpen")) or "0",
                notes=text(vehicle.get("notes")) or "-",
            )
        )
    lines.append("")
    lines.append("## Details")
    for vehicle in vehicles:
        plate = text(vehicle.get("plate")) or "-"
        lines.append(f"### {plate}")
        for label, d, days, lvl in collect_items(vehicle, as_of):
            if lvl == "ok":
                continue
            lines.append(
                f"- {label}: {d.isoformat() if d else '?'} ({lvl}, remaining={days})"
            )
        lines.append("")
    return "\n".join(lines)


def build_high_risk(vehicles: list[dict[str, Any]], as_of: date) -> str:
    lines = [f"# High risk ({as_of.isoformat()})", ""]
    count = 0
    for vehicle in vehicles:
        items = collect_items(vehicle, as_of)
        flags = vehicle.get("riskFlags") if isinstance(vehicle.get("riskFlags"), list) else []
        reasons: list[str] = [text(f) for f in flags if text(f)]
        for label, _d, days, lvl in items:
            if lvl in {"expired", "D-7"}:
                reasons.append(f"{label}:{lvl}")
            if label in {"交强险", "商业险"} and days is not None and days <= 15:
                reasons.append(f"{label}:insurance-tight")
        if int(float(text(vehicle.get("violationsOpen")) or 0)) >= 3:
            reasons.append("violations>=3")
        if not reasons:
            continue
        count += 1
        lines.append(
            f"- **{text(vehicle.get('plate')) or '-'}** / {text(vehicle.get('driverName')) or '-'} — {', '.join(reasons)}"
        )
    if count == 0:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def write_csv(path: Path, vehicles: list[dict[str, Any]], as_of: date) -> None:
    fields = [
        "plate", "driverName", "ownerOrAffiliate", "worstLevel", "violationsOpen",
        "compulsoryExpire", "commercialExpire", "driverLicenseExpire", "annualInspectionExpire",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for vehicle in vehicles:
            docs = vehicle.get("docs") if isinstance(vehicle.get("docs"), dict) else {}
            insurance = vehicle.get("insurance") if isinstance(vehicle.get("insurance"), dict) else {}
            items = collect_items(vehicle, as_of)
            writer.writerow({
                "plate": text(vehicle.get("plate")),
                "driverName": text(vehicle.get("driverName")),
                "ownerOrAffiliate": text(vehicle.get("ownerOrAffiliate")),
                "worstLevel": worst_level([i[3] for i in items]),
                "violationsOpen": text(vehicle.get("violationsOpen")),
                "compulsoryExpire": text(insurance.get("compulsoryExpire")),
                "commercialExpire": text(insurance.get("commercialExpire")),
                "driverLicenseExpire": text(docs.get("driverLicenseExpire")),
                "annualInspectionExpire": text(vehicle.get("annualInspectionExpire")),
            })


def write_chase_scripts(path: Path, vehicles: list[dict[str, Any]], as_of: date) -> None:
    lines = [f"# Renewal chase scripts ({as_of.isoformat()})", ""]
    for vehicle in vehicles:
        plate = text(vehicle.get("plate")) or "车辆"
        driver = text(vehicle.get("driverName")) or "师傅"
        phone = text(vehicle.get("driverPhone"))
        hot = [(label, d, days, lvl) for label, d, days, lvl in collect_items(vehicle, as_of) if lvl in {"expired", "D-7", "D-15"}]
        if not hot:
            continue
        detail = "、".join(
            f"{label}({d.isoformat() if d else '?'}·{lvl})" for label, d, _days, lvl in hot
        )
        lines.append(f"## {plate} / {driver}")
        lines.append(
            f"{driver}您好，挂靠车辆 {plate} 资料需尽快处理：{detail}。"
            f"请于本周内回传更新后的证件/保单影像，避免影响派车。"
            + (f"（联系电话登记：{phone}）" if phone else "")
        )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_daily_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "挂靠车管·每日到期扫描",
        "prompt": (
            "你是挂靠车管作业专家。读取 fleet-ledger.json，按 expiry-alerts 刷新到期与高风险清单，"
            "更新 .process；禁止编造证件与保险日期。"
        ),
        "schedule": {
            "mode": "interval",
            "day": "daily",
            "time": "09:00",
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
    vehicles = [v for v in ledger.get("vehicles", []) if isinstance(v, dict)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    proc = process_dir(args.output_dir)
    expiry_path = proc / "expiry-board.md"
    risk_path = proc / "high-risk.md"
    expiry_path.write_text(build_expiry_board(vehicles, as_of), encoding="utf-8")
    risk_path.write_text(build_high_risk(vehicles, as_of), encoding="utf-8")
    files = [str(expiry_path), str(risk_path)]

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        csv_path = args.output_dir / f"挂靠车台账_{stamp}.csv"
        scripts_path = args.output_dir / f"催办话术_{stamp}.md"
        proposal = args.output_dir / "automations" / "proposals" / "fleet-daily-scan.json"
        write_csv(csv_path, vehicles, as_of)
        write_chase_scripts(scripts_path, vehicles, as_of)
        write_daily_proposal(proposal)
        files.extend([str(csv_path), str(scripts_path), str(proposal)])

    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "vehicleCount": len(vehicles),
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
