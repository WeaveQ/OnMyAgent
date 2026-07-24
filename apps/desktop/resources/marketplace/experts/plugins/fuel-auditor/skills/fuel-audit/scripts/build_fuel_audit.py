#!/usr/bin/env python3
"""Build deterministic fuel-audit boards, exports, and automation proposals."""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import zipfile
from datetime import date, datetime
from html import escape
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


PREVIEW_STYLE = """
.fuel-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.fuel-preview *{box-sizing:border-box}
.fuel-preview .fp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#7c2d12,#b91c1c);color:#fff;border-radius:12px 12px 0 0}
.fuel-preview .fp-top .title{font-size:17px;font-weight:600}
.fuel-preview .fp-top .sub{font-size:12px;color:#fecaca;margin-top:4px}
.fuel-preview .fp-top .meta{text-align:right;font-size:11px;color:#fca5a5;line-height:1.6}
.fuel-preview .fp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.fuel-preview .charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.fuel-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.fuel-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.fuel-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.fuel-preview tr.var td{background:#fef2f2}
.fuel-preview tr.var td:first-child{border-left:3px solid #dc2626}
.fuel-preview tr.late td{background:#fffbeb}
.fuel-preview .num{text-align:right;font-variant-numeric:tabular-nums}
.fuel-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.fuel-preview .tag.severe{background:#fee2e2;color:#b91c1c}
.fuel-preview .tag.warning{background:#fef3c7;color:#b45309}
.fuel-preview .tag.attention{background:#dbeafe;color:#1d4ed8}
.fuel-preview .tag.data-gap{background:#f1f5f9;color:#64748b}
.fuel-preview .tag.normal{background:#dcfce7;color:#15803d}
.fuel-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.fuel-preview .risk-card{border:1px solid #fecaca;border-radius:10px;padding:12px;margin-bottom:10px;background:#fef2f2}
.fuel-preview .rc-title{font-size:13px;font-weight:700;color:#991b1b;margin-bottom:6px}
.fuel-preview .anomaly{font-size:12px;color:#1e293b;padding:4px 0;border-bottom:1px dashed #fecaca}
.fuel-preview .anomaly:last-child{border-bottom:none}
.fuel-preview .action{font-size:11px;color:#b45309;margin-top:2px}
.fuel-preview .empty{padding:16px;text-align:center;color:#94a3b8;font-size:13px;background:#f8fafc;border-radius:8px}
.fuel-preview .fp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


def _money(value: Any) -> str:
    return f"¥{float(value or 0):,.2f}"


def _consumption_bar_svg(results: list[dict[str, Any]]) -> str:
    valid = [r for r in results if r["consumption"] is not None]
    if not valid:
        return '<div class="empty">无有效油耗数据</div>'
    mx = max((r["consumption"] for r in valid), default=1) or 1
    rows = ""
    for i, r in enumerate(valid):
        y = i * 36 + 10
        w = r["consumption"] / mx * 300
        color = "#dc2626" if r["baselineHigh"] and r["consumption"] > r["baselineHigh"] else (
            "#d97706" if r["baselineLow"] and r["consumption"] < r["baselineLow"] else "#10b981")
        rows += f'<rect x="120" y="{y}" width="{w:.0f}" height="26" fill="{color}" rx="3"/>'
        rows += f'<text x="10" y="{y+18}" font-size="12" fill="#475569">{escape(r["plate"])}</text>'
        rows += f'<text x="{120+w+6:.0f}" y="{y+18}" font-size="12" fill="#1e293b">{r["consumption"]:.1f}</text>'
    return f'<svg width="500" height="{len(valid)*36+10}" xmlns="http://www.w3.org/2000/svg">{rows}</svg>'


def _severity_svg(results: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = {"severe": 0, "warning": 0, "attention": 0, "data-gap": 0, "normal": 0}
    for r in results:
        counts[r["severity"]] = counts.get(r["severity"], 0) + 1
    colors = {"severe": "#dc2626", "warning": "#d97706", "attention": "#3b82f6", "data-gap": "#94a3b8", "normal": "#10b981"}
    labels = {"severe": "严重", "warning": "警告", "attention": "提示", "data-gap": "待补", "normal": "正常"}
    mx = max(counts.values()) or 1
    rows = ""
    for i, key in enumerate(["severe", "warning", "attention", "data-gap", "normal"]):
        c = counts[key]
        y = i * 32 + 10
        w = c / mx * 200
        rows += f'<rect x="60" y="{y}" width="{w:.0f}" height="22" fill="{colors[key]}" rx="3"/>'
        rows += f'<text x="6" y="{y+16}" font-size="12" fill="#475569">{labels[key]}</text>'
        rows += f'<text x="{60+w+6:.0f}" y="{y+16}" font-size="12" fill="#1e293b">{c}</text>'
    return f'<svg width="300" height="{5*32+10}" xmlns="http://www.w3.org/2000/svg">{rows}</svg>'


def fuel_preview_html(source: dict[str, Any], results: list[dict[str, Any]], as_of: date, period: str) -> str:
    total_amount = sum(r["amount"] for r in results)
    anomaly_count = sum(len(r["anomalies"]) for r in results)
    risk_vehicles = sum(1 for r in results if r["severity"] in {"severe", "warning"})
    table_rows = ""
    for r in results:
        sev = r["severity"]
        cls = "var" if sev in {"severe", "warning"} else ("late" if sev == "attention" else "")
        base = f'{r["baselineLow"]:.0f}-{r["baselineHigh"]:.0f}' if r["baselineLow"] is not None else "待补"
        table_rows += (
            f'<tr class="{cls}"><td>{escape(r["plate"])}</td><td>{escape(r["vehicleType"])}</td>'
            f'<td class="num">{r["distanceKm"] or 0:.0f}</td><td class="num">{r["liters"]:.0f}</td>'
            f'<td class="num">{r["consumption"]:.1f}</td><td>{escape(base)}</td>'
            f'<td><span class="tag {sev}">{escape(severity_label(sev))}</span></td></tr>'
        )
    table = f'<table><thead><tr><th>车牌</th><th>车型</th><th>里程km</th><th>加油L</th><th>L/100km</th><th>基准</th><th>结论</th></tr></thead><tbody>{table_rows}</tbody></table>'
    risk_html = ""
    for r in sorted(results, key=lambda x: severity_rank(x["severity"]), reverse=True):
        if not r["anomalies"]:
            continue
        risk_html += f'<div class="risk-card"><div class="rc-title">{escape(r["plate"])} · {escape(r["driver"])} · <span class="tag {r["severity"]}">{escape(severity_label(r["severity"]))}</span></div>'
        for a in sorted(r["anomalies"], key=lambda x: severity_rank(x["severity"]), reverse=True):
            risk_html += f'<div class="anomaly"><b>{escape(a["code"])}</b> {escape(a["summary"])}<div class="action">建议：{escape(a["action"])}</div></div>'
        risk_html += '</div>'
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="fuel-preview">'
        f'<div class="fp-top"><div><div class="title">油费稽核看板 · {escape(period or as_of.isoformat())}</div>'
        f'<div class="sub">{len(results)} 辆车 · 油费 {escape(_money(total_amount))} · 异常线索 {anomaly_count} 条</div></div>'
        f'<div class="meta">严重/警告<br><b style="font-size:15px;color:#fca5a5">{risk_vehicles} 辆</b></div></div>'
        f'<div class="fp-body"><div class="section-title">油耗对比（绿=正常 红=超基准 橙=偏低）</div>'
        f'{_consumption_bar_svg(results)}<div class="section-title">风险分布</div>{_severity_svg(results)}'
        f'<div class="section-title">车辆稽核</div>{table}'
        f'<div class="section-title">Top 风险与核查动作</div>{risk_html or "<div class=empty>本周期无异常线索</div>"}'
        '<div class="fp-foot">稽核结论为线索，需结合任务、轨迹、票据人工核实。本预览为过程产物，确认后导出 Excel / PDF。</div></div></section>'
    )


def _col_letter(n: int) -> str:
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_xml(headers: list[str], rows: list[list[Any]], risk_rows: set[int] | None = None) -> str:
    risk_rows = risk_rows or set()
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    head = "".join(f'<c r="{_col_letter(c)}1" t="inlineStr" s="1"><is><t>{escape(str(h))}</t></is></c>' for c, h in enumerate(headers))
    out.append(f'<row r="1">{head}</row>')
    for r_idx, row in enumerate(rows, start=2):
        style = "2" if (r_idx - 2) in risk_rows else "0"
        cells = "".join(f'<c r="{_col_letter(c)}{r_idx}" t="inlineStr" s="{style}"><is><t>{escape(str(v))}</t></is></c>' for c, v in enumerate(row))
        out.append(f'<row r="{r_idx}">{cells}</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


def write_xlsx(path: Path, results: list[dict[str, Any]]) -> None:
    """Sheet1 单车油耗汇总(异常标红); Sheet2 异常明细."""
    s1_headers = ["车牌", "司机", "车型", "线路", "里程km", "加油L", "金额", "L/100km", "基准下", "基准上", "基准源", "结论", "异常数"]
    s1_rows: list[list[Any]] = []
    risk_idx: set[int] = set()
    for i, r in enumerate(results):
        if r["severity"] in {"severe", "warning"}:
            risk_idx.add(i)
        s1_rows.append([r["plate"], r["driver"], r["vehicleType"], r["lane"], r["distanceKm"] or 0, r["liters"], r["amount"],
                        r["consumption"] if r["consumption"] is not None else "", r["baselineLow"] if r["baselineLow"] is not None else "",
                        r["baselineHigh"] if r["baselineHigh"] is not None else "", r["baselineSource"], severity_label(r["severity"]), len(r["anomalies"])])
    s2_headers = ["车牌", "司机", "风险等级", "规则码", "异常摘要", "建议动作"]
    s2_rows = [[r["plate"], r["driver"], severity_label(a["severity"]), a["code"], a["summary"], a["action"]] for r in results for a in r["anomalies"]]
    s1 = _sheet_xml(s1_headers, s1_rows, risk_idx)
    s2 = _sheet_xml(s2_headers, s2_rows)
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="单车油耗汇总" sheetId="1" r:id="rId1"/><sheet name="异常明细" sheetId="2" r:id="rId2"/></sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/worksheets/sheet1.xml", s1)
        z.writestr("xl/worksheets/sheet2.xml", s2)
        z.writestr("xl/styles.xml", styles)


def find_chrome() -> str | None:
    candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
    for command in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        located = shutil.which(command)
        if located:
            candidates.append(located)
    return next((c for c in candidates if Path(c).is_file()), None)


def write_pdfs(jobs: list[tuple[Path, Path]]) -> None:
    if not jobs:
        return
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("未找到 Chrome/Chromium/Edge，无法从 HTML 导出 PDF")
    with tempfile.TemporaryDirectory(prefix="fuel-chrome-") as profile:
        for html_path, pdf_path in jobs:
            if pdf_path.exists():
                pdf_path.unlink()
            command = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--hide-scrollbars",
                "--run-all-compositor-stages-before-draw", "--virtual-time-budget=5000", f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()]
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                command.insert(1, "--no-sandbox")
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != "nt")
            deadline = time.monotonic() + 45
            previous_size = -1
            stable = 0
            try:
                while time.monotonic() < deadline:
                    if pdf_path.is_file():
                        cur = pdf_path.stat().st_size
                        stable = stable + 1 if cur > 0 and cur == previous_size else 0
                        previous_size = cur
                        if stable >= 2:
                            break
                    if process.poll() is not None and not pdf_path.is_file():
                        raise RuntimeError(f"PDF 导出失败：浏览器退出码 {process.returncode}")
                    time.sleep(0.1)
                else:
                    raise RuntimeError("PDF 导出超时：浏览器未在 45 秒内生成稳定文件")
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        process.terminate()
                    else:
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        if os.name == "nt":
                            process.kill()
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=2)
            if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
                raise RuntimeError("PDF 导出失败：浏览器未生成文件")


def _report_html(source: dict[str, Any], results: list[dict[str, Any]], as_of: date, period: str) -> str:
    body = fuel_preview_html(source, results, as_of, period)
    return ('<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>油费稽查报告 · {escape(period or as_of.isoformat())}</title>'
        f'<body style="margin:0;padding:20px;background:#fff">{body}</body></html>')


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
    preview_html = fuel_preview_html(source, results, as_of, period)
    preview_path = process_dir / "fuel-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "vehicleCount": len(results),
        "anomalyCount": sum(len(item["anomalies"]) for item in results),
        "highRiskVehicles": [item["plate"] for item in results if item["severity"] in {"severe", "warning"}],
        "files": files,
        "inlineWidget": {"title": "油费稽核看板预览", "widget_code": preview_html},
    }

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        xlsx_path = args.output_dir / f"油费稽查报告_{stamp}.xlsx"
        pdf_path = args.output_dir / f"油费稽查报告_{stamp}.pdf"
        proposal_path = args.output_dir / "automations" / "proposals" / "fuel-weekly-scan.json"
        write_xlsx(xlsx_path, results)
        write_weekly_proposal(proposal_path)
        files.append(str(xlsx_path))
        report_html = _report_html(source, results, as_of, period)
        html_tmp = process_dir / f"report_{stamp}.html"
        html_tmp.write_text(report_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        files.append(str(proposal_path))
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
