#!/usr/bin/env python3
"""Normalize AI-extracted shipment rows into a stable CSV or JSON schema."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


ALIASES = {
    "shipment_id": {"shipment_id", "waybill_no", "运单号", "业务编号"},
    "shipper": {"shipper", "sender", "发货方", "发货人"},
    "shipper_contact": {"shipper_contact", "发货联系人", "发货电话"},
    "pickup_address": {"pickup_address", "origin", "装货地址", "发货地址"},
    "consignee": {"consignee", "receiver", "收货方", "收货人"},
    "consignee_contact": {"consignee_contact", "收货联系人", "收货电话"},
    "delivery_address": {"delivery_address", "destination", "卸货地址", "收货地址"},
    "cargo": {"cargo", "goods", "货物", "品名"},
    "quantity": {"quantity", "pieces", "件数", "数量"},
    "weight_kg": {"weight_kg", "weight", "重量", "重量kg"},
    "volume_m3": {"volume_m3", "volume", "体积", "方数"},
    "pickup_time": {"pickup_time", "提货时间", "装货时间"},
    "delivery_requirement": {"delivery_requirement", "到达要求", "送达要求"},
    "vehicle_type": {"vehicle_type", "车型"},
    "special_requirements": {"special_requirements", "运输要求", "特殊要求"},
}


def read_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
            raise ValueError("JSON input must be an array of objects")
        return payload
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_row(row: dict[str, Any], source_row: int) -> dict[str, str]:
    normalized: dict[str, str] = {}
    conflicts: dict[str, list[str]] = {}
    for canonical, aliases in ALIASES.items():
        values = []
        for key, value in row.items():
            text = "" if value is None else str(value).strip()
            if key.strip() in aliases and text and text not in values:
                values.append(text)
        normalized[canonical] = values[0] if values else ""
        if len(values) > 1:
            conflicts[canonical] = values
    normalized["_source_row"] = str(source_row)
    normalized["_conflicts"] = json.dumps(conflicts, ensure_ascii=False) if conflicts else ""
    return normalized


def write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() == ".json":
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    fieldnames = [*ALIASES, "_source_row", "_conflicts"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    rows = [normalize_row(row, index) for index, row in enumerate(read_rows(args.input), 1)]
    write_rows(args.output, rows)
    print(json.dumps({"rows": len(rows), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
