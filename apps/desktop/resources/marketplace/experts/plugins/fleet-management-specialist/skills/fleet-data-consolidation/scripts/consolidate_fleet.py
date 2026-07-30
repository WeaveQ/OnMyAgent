#!/usr/bin/env python3
"""Merge fleet CSV/JSON files by plate number and preserve conflicts."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


ALIASES = {
    "plate_number": {"plate_number", "plate", "车牌", "车牌号"},
    "driver_name": {"driver_name", "driver", "司机", "司机姓名"},
    "driver_phone": {"driver_phone", "司机电话", "手机号"},
    "vehicle_type": {"vehicle_type", "车型"},
    "capacity_ton": {"capacity_ton", "载重", "载重吨"},
    "capacity_m3": {"capacity_m3", "方数", "容积"},
    "current_location": {"current_location", "当前位置", "位置"},
    "available_time": {"available_time", "可用时间", "空闲时间"},
    "license_expiry": {"license_expiry", "营运证到期", "证照到期"},
    "insurance_expiry": {"insurance_expiry", "保险到期"},
    "current_task": {"current_task", "当前任务", "任务状态"},
    "updated_at": {"updated_at", "更新时间", "数据时间"},
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
    result: dict[str, str] = {}
    for canonical, aliases in ALIASES.items():
        result[canonical] = next(
            (str(value).strip() for key, value in row.items() if key.strip() in aliases and str(value).strip()),
            "",
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    merged: dict[str, dict[str, str]] = {}
    conflicts: dict[str, dict[str, list[str]]] = {}
    sources: dict[str, list[str]] = {}
    for input_path in args.inputs:
        for raw in read_rows(input_path):
            row = canonicalize(raw)
            key = row["plate_number"].replace(" ", "").upper()
            if not key:
                key = f"UNMATCHED-{input_path.name}-{len(merged) + 1}"
            current = merged.setdefault(key, {field: "" for field in ALIASES})
            sources.setdefault(key, []).append(input_path.name)
            for field, value in row.items():
                if not value:
                    continue
                if current[field] and current[field] != value:
                    bucket = conflicts.setdefault(key, {}).setdefault(field, [current[field]])
                    if value not in bucket:
                        bucket.append(value)
                elif not current[field]:
                    current[field] = value

    output_rows = []
    for key, row in sorted(merged.items()):
        output_rows.append({
            **row,
            "_match_key": key,
            "_source_files": "|".join(dict.fromkeys(sources[key])),
            "_conflicts": json.dumps(conflicts.get(key, {}), ensure_ascii=False),
        })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fields = [*ALIASES, "_match_key", "_source_files", "_conflicts"]
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)
    print(json.dumps({"rows": len(output_rows), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
