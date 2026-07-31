#!/usr/bin/env python3
"""Deduplicate and sort shipment events into per-shipment timelines."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any


ALIASES = {
    "shipment_id": {"shipment_id", "waybill_no", "业务编号", "运单号"},
    "event_time": {"event_time", "timestamp", "发生时间", "更新时间"},
    "event": {"event", "milestone", "节点", "事件"},
    "location": {"location", "位置", "地点"},
    "source": {"source", "信息来源", "来源"},
    "eta": {"eta", "预计到达", "预计时间"},
    "note": {"note", "备注", "原始消息"},
}


def read_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
            raise ValueError("JSON input must be an array of objects")
        return payload
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def value_for(row: dict[str, Any], aliases: set[str]) -> str:
    return next(
        (str(value).strip() for key, value in row.items() if key.strip() in aliases and str(value).strip()),
        "",
    )


def time_key(text: str) -> tuple[int, str]:
    formats = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M", "%Y-%m-%d")
    for fmt in formats:
        try:
            return (0, datetime.strptime(text, fmt).isoformat())
        except ValueError:
            continue
    return (1, text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    unique: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for raw in read_rows(args.input):
        row = {field: value_for(raw, aliases) for field, aliases in ALIASES.items()}
        key = (row["shipment_id"], row["event_time"], row["event"], row["location"])
        unique.setdefault(key, row)
    rows = sorted(unique.values(), key=lambda row: (row["shipment_id"], time_key(row["event_time"])))
    latest: dict[str, int] = {}
    for index, row in enumerate(rows):
        latest[row["shipment_id"]] = index
    output_rows = [
        {**row, "_latest_for_shipment": "yes" if latest[row["shipment_id"]] == index else "no"}
        for index, row in enumerate(rows)
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fields = [*ALIASES, "_latest_for_shipment"]
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)
    print(json.dumps({"rows": len(output_rows), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
