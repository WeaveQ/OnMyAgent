#!/usr/bin/env python3
"""Match settlement rows and calculate customer/carrier amount variance."""

from __future__ import annotations

import argparse
import csv
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ALIASES = {
    "shipment_id": {"shipment_id", "waybill_no", "业务编号", "运单号"},
    "customer_order_id": {"customer_order_id", "客户单号"},
    "plate_number": {"plate_number", "车牌", "车牌号"},
    "ship_date": {"ship_date", "发车日期", "日期"},
    "route": {"route", "线路"},
    "source_type": {"source_type", "数据来源", "来源类型"},
    "quoted_amount": {"quoted_amount", "报价金额", "合同金额"},
    "customer_amount": {"customer_amount", "客户账单金额", "应收金额"},
    "carrier_amount": {"carrier_amount", "承运账单金额", "应付金额"},
    "pod_status": {"pod_status", "回单状态"},
}


def read_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
            raise ValueError("JSON input must be an array of objects")
        return payload
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def canonicalize(row: dict[str, Any]) -> dict[str, str]:
    return {
        field: next(
            (str(value).strip() for key, value in row.items() if key.strip() in aliases and str(value).strip()),
            "",
        )
        for field, aliases in ALIASES.items()
    }


def match_key(row: dict[str, str]) -> tuple[str, str]:
    if row["shipment_id"]:
        return f"shipment:{row['shipment_id']}", "exact"
    if row["customer_order_id"]:
        return f"customer:{row['customer_order_id']}", "exact"
    fallback = "|".join((row["plate_number"], row["ship_date"], row["route"]))
    return (f"fallback:{fallback}", "fuzzy") if fallback.strip("|") else ("unmatched", "unmatched")


def decimal_or_none(value: str) -> Decimal | None:
    try:
        return Decimal(value.replace(",", "")) if value else None
    except InvalidOperation:
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    groups: dict[str, dict[str, Any]] = {}
    for path in args.inputs:
        for raw in read_rows(path):
            row = canonicalize(raw)
            key, confidence = match_key(row)
            if key == "unmatched":
                key = f"unmatched:{path.name}:{len(groups) + 1}"
            group = groups.setdefault(key, {
                **{field: "" for field in ALIASES},
                "_match_key": key,
                "_match_confidence": confidence,
                "_source_files": [],
                "_conflicts": {},
            })
            group["_source_files"].append(path.name)
            for field, value in row.items():
                if not value:
                    continue
                if group[field] and group[field] != value:
                    group["_conflicts"].setdefault(field, [group[field]])
                    if value not in group["_conflicts"][field]:
                        group["_conflicts"][field].append(value)
                elif not group[field]:
                    group[field] = value

    output_rows = []
    for group in groups.values():
        quoted = decimal_or_none(group["quoted_amount"])
        customer = decimal_or_none(group["customer_amount"])
        carrier = decimal_or_none(group["carrier_amount"])
        output_rows.append({
            **{field: group[field] for field in ALIASES},
            "_match_key": group["_match_key"],
            "_match_confidence": group["_match_confidence"],
            "_customer_vs_quote": str(customer - quoted) if customer is not None and quoted is not None else "",
            "_gross_spread": str(customer - carrier) if customer is not None and carrier is not None else "",
            "_source_files": "|".join(dict.fromkeys(group["_source_files"])),
            "_conflicts": json.dumps(group["_conflicts"], ensure_ascii=False),
        })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        *ALIASES,
        "_match_key",
        "_match_confidence",
        "_customer_vs_quote",
        "_gross_spread",
        "_source_files",
        "_conflicts",
    ]
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)
    print(json.dumps({"rows": len(output_rows), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
