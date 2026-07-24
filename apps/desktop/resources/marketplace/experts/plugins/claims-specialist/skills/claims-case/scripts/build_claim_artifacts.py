#!/usr/bin/env python3
"""Build evidence, liability, scripts, and progress artifacts for logistics claims."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import zipfile
from html import escape
from pathlib import Path
from typing import Any


COMMON_EVIDENCE = {
    "waybill": "运单/运输合同",
    "timeline": "完整时间线与节点记录",
    "customer_demand": "客户索赔主张与金额依据",
}
TYPE_EVIDENCE = {
    "damage": {
        "loading_photos": "装车前货物与包装照片",
        "delivery_photos": "卸货/签收现场照片",
        "handover_record": "装卸与交接记录",
        "driver_statement": "司机情况说明",
        "value_proof": "货值与维修/损失证明",
    },
    "wet": {
        "loading_photos": "装车前货物与包装照片",
        "delivery_photos": "水湿现场与车辆照片",
        "weather_record": "天气与路线记录",
        "vehicle_inspection": "车厢/篷布检查记录",
        "value_proof": "货值与损失证明",
    },
    "delay": {
        "promised_sla": "合同/运单约定时效",
        "tracking_log": "完整运输轨迹与节点时间",
        "delay_reason": "延误原因与各方说明",
        "loss_causation": "客户损失与延误因果材料",
    },
    "loss": {
        "loading_record": "装车清单与交接签字",
        "tracking_log": "运输轨迹与扫描记录",
        "cctv": "关键节点监控",
        "driver_statement": "司机情况说明",
        "inventory_check": "网点/车辆盘点记录",
        "value_proof": "货值证明",
    },
}


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "claim"


def load_case(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("claim-case.json must be an object")
    return data


def evidence_index(data: dict[str, Any]) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    rows = data.get("evidence") if isinstance(data.get("evidence"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = text(row.get("type"))
        if not key:
            continue
        status = text(row.get("status"))
        result[key] = {
            "status": status if status in {"available", "weak", "missing"} else "missing",
            "description": text(row.get("description")),
        }
    return result


def required_evidence(data: dict[str, Any]) -> dict[str, str]:
    incident_type = text(data.get("incidentType"))
    return {**COMMON_EVIDENCE, **TYPE_EVIDENCE.get(incident_type, {})}


def evidence_rows(data: dict[str, Any]) -> list[dict[str, str]]:
    index = evidence_index(data)
    rows: list[dict[str, str]] = []
    for key, label in required_evidence(data).items():
        item = index.get(key, {"status": "missing", "description": "未提供"})
        rows.append({
            "type": key,
            "label": label,
            "status": item["status"],
            "description": item["description"] or "未说明",
        })
    return rows


def evidence_markdown(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    available = sum(1 for row in rows if row["status"] == "available")
    score = round(available / len(rows) * 100) if rows else 0
    lines = [
        f"# 证据完备度 · {text(data.get('caseId')) or '未编号'}",
        "",
        f"完整证据覆盖率：**{score}%**（弱证据不计完整）",
        "",
        "| 证据项 | 状态 | 说明 | 补证动作 |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        action = "归档原件并核对时间" if row["status"] == "available" else f"补充：{row['label']}"
        lines.append(f"| {row['label']} | {row['status']} | {row['description']} | {action} |")
    lines.append("")
    return "\n".join(lines)


def liability_markdown(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    incident_type = text(data.get("incidentType"))
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    missing = [row["label"] for row in rows if row["status"] != "available"]
    directions: list[str] = []
    if incident_type in {"damage", "wet"}:
        directions.append("若装车前货物/包装完好且卸货时首次发现异常，则运输或装卸环节是重点核查方向。")
        directions.append("若包装不符合约定或已有隐蔽损伤，可能存在托运方包装责任或共同原因。")
    elif incident_type == "delay":
        directions.append("若承诺时效、实际节点和可控延误原因形成完整证据链，承运履约责任是重点核查方向。")
        directions.append("天气、交通管制、客户等候等是否属于合同免责，须以合同条款和证据核验。")
    elif incident_type == "loss":
        directions.append("须先用装车、交接、轨迹、监控和盘点定位货物最后可证实节点，再讨论保管责任。")
    else:
        directions.append("异常类型未明确，暂不能形成责任方向。")
    lines = [
        f"# 责任初判草稿 · {text(data.get('caseId')) or '未编号'}",
        "",
        f"- 已知初步原因：{text(facts.get('initialCause')) or '待查证'}",
        *[f"- 条件方向：{item}" for item in directions],
        "",
        "## 当前缺口",
        *[f"- {item}" for item in missing],
    ]
    if not missing:
        lines.append("- 固定清单已齐；仍须核对真实性、时间与合同条款。")
    lines.extend([
        "",
        "> 本草稿不是法律结论，不确认唯一责任方，也不得直接作为对外认责文本。",
        "",
    ])
    return "\n".join(lines)


def progress_markdown(data: dict[str, Any]) -> str:
    rows = data.get("progress") if isinstance(data.get("progress"), list) else []
    lines = [
        f"# 理赔进度 · {text(data.get('caseId')) or '未编号'}",
        "",
        "| 节点 | 状态 | 负责人 | 下次跟进日 | 卡点/备注 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        if not isinstance(row, dict):
            continue
        lines.append(
            f"| {text(row.get('node')) or '-'} | {text(row.get('status')) or '-'} | "
            f"{text(row.get('owner')) or '-'} | {text(row.get('nextDate')) or '-'} | {text(row.get('notes')) or '-'} |"
        )
    if not rows:
        lines.append("| 立案 | pending | 待指定 | 待确认 | 尚未建立进度 |")
    lines.append("")
    return "\n".join(lines)


def case_pack(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    return "\n".join([
        f"# 理赔材料包 · {text(data.get('caseId')) or '未编号'}",
        "",
        f"- 运单：{text(data.get('waybillNo')) or '待确认'}",
        f"- 线路：{text(data.get('route')) or '待确认'}",
        f"- 异常：{text(data.get('incidentType')) or '待确认'} / {text(data.get('incidentTime')) or '时间待确认'}",
        f"- 客户诉求金额：{text(data.get('customerDemandAmount')) or '待确认'}",
        f"- 装车/提货状态：{text(facts.get('packagingAtPickup')) or '待确认'}",
        f"- 到货状态：{text(facts.get('deliveryCondition')) or '待确认'}",
        "",
        "## 材料目录",
        *[f"- [{row['status']}] {row['label']}：{row['description']}" for row in rows],
        "",
        "> 对外提交前须人工核对原件、保单条款、金额依据与隐私信息。",
        "",
    ])


def customer_script(data: dict[str, Any]) -> str:
    return "\n".join([
        f"# 客户沟通话术 · {text(data.get('caseId')) or '未编号'}",
        "",
        "您好，我们已登记本次运输异常并启动材料核查。当前正在固定运单、现场、交接和损失依据；在事实与责任边界确认前，我们不会草率下结论。我们会按进度表反馈下一节点。如您方便，请协助提供货值、损失或维修依据。",
        "",
        "> 发送前须人工确认；本话术不承认全责、不承诺赔付金额。",
        "",
    ])


def insurer_outline(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    missing = [row["label"] for row in rows if row["status"] != "available"]
    return "\n".join([
        f"# 保司报案提纲 · {text(data.get('caseId')) or '未编号'}",
        "",
        f"- 保单/险种：{text(data.get('policyNo')) or '待确认'}",
        f"- 运单/线路：{text(data.get('waybillNo')) or '待确认'} / {text(data.get('route')) or '待确认'}",
        f"- 出险类型/时间：{text(data.get('incidentType')) or '待确认'} / {text(data.get('incidentTime')) or '待确认'}",
        f"- 诉求金额：{text(data.get('customerDemandAmount')) or '待确认'}（以证明材料为准）",
        "",
        "## 待补材料",
        *([f"- {item}" for item in missing] or ["- 固定清单已齐，待保司按条款复核。"]),
        "",
        "> 仅为报案提纲，不自动向保司提交。",
        "",
    ])


def write_progress_csv(path: Path, data: dict[str, Any]) -> None:
    fields = ("node", "status", "owner", "nextDate", "notes")
    rows = data.get("progress") if isinstance(data.get("progress"), list) else []
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            if isinstance(row, dict):
                writer.writerow({field: text(row.get(field)) for field in fields})


PREVIEW_STYLE = """
.claim-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.claim-preview *{box-sizing:border-box}
.claim-preview .cp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#7f1d1d,#b91c1c);color:#fff;border-radius:12px 12px 0 0}
.claim-preview .cp-top .title{font-size:17px;font-weight:600}
.claim-preview .cp-top .sub{font-size:12px;color:#fecaca;margin-top:4px}
.claim-preview .cp-top .meta{text-align:right;font-size:11px;color:#fca5a5;line-height:1.6}
.claim-preview .cp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.claim-preview .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.claim-preview .stat{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc}
.claim-preview .stat .k{font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase}
.claim-preview .stat .v{font-size:18px;font-weight:700;color:#0f172a;margin-top:2px}
.claim-preview .stat.danger .v{color:#dc2626}
.claim-preview .stat.ok .v{color:#059669}
.claim-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.claim-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.claim-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.claim-preview tr.miss td{background:#fef2f2}
.claim-preview tr.miss td:first-child{border-left:3px solid #dc2626}
.claim-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.claim-preview .tag.available{background:#dcfce7;color:#15803d}
.claim-preview .tag.weak{background:#fef3c7;color:#b45309}
.claim-preview .tag.missing{background:#fee2e2;color:#b91c1c}
.claim-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.claim-preview .dir-item{font-size:12px;color:#1e293b;padding:4px 0;border-bottom:1px dashed #e2e8f0}
.claim-preview .gap-item{font-size:12px;color:#b91c1c;padding:4px 0}
.claim-preview .cp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


def _evidence_tag(status: str) -> str:
    return f'<span class="tag {escape(status)}">{escape({"available":"已提供","weak":"弱证据","missing":"缺失"}.get(status, status))}</span>'


def claims_preview_html(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    available = sum(1 for r in rows if r["status"] == "available")
    score = round(available / len(rows) * 100) if rows else 0
    missing = [r for r in rows if r["status"] != "available"]
    facts = data.get("facts") if isinstance(data.get("facts"), dict) else {}
    progress = data.get("progress") if isinstance(data.get("progress"), list) else []
    # evidence table
    ev_rows = "".join(
        f'<tr class="{"miss" if r["status"]!="available" else ""}"><td>{escape(r["label"])}</td><td>{_evidence_tag(r["status"])}</td><td>{escape(r["description"])}</td></tr>'
        for r in rows
    )
    ev_table = f'<table><thead><tr><th>证据项</th><th>状态</th><th>说明</th></tr></thead><tbody>{ev_rows}</tbody></table>'
    # liability directions
    incident_type = text(data.get("incidentType"))
    dirs = []
    if incident_type in {"damage", "wet"}:
        dirs = ["装车前完好+卸货首现异常 -> 运输/装卸环节重点核查", "包装不符/隐蔽损伤 -> 可能托运方包装责任或共同原因"]
    elif incident_type == "delay":
        dirs = ["承诺时效+节点+可控延误 -> 承运履约责任重点", "天气/管制/等候 -> 须以合同条款核验免责"]
    elif incident_type == "loss":
        dirs = ["装车/交接/轨迹/监控/盘点 -> 定位最后可证实节点再讨论保管责任"]
    else:
        dirs = ["异常类型未明确，暂不能形成责任方向"]
    dir_html = "".join(f'<div class="dir-item">{escape(d)}</div>' for d in dirs)
    gap_html = "".join(f'<div class="gap-item">- {escape(r["label"])}</div>' for r in missing) or '<div class="dir-item">固定清单已齐</div>'
    # progress
    prog_rows = ""
    for p in progress:
        if not isinstance(p, dict):
            continue
        prog_rows += f'<tr><td>{escape(text(p.get("node")) or "-")}</td><td>{escape(text(p.get("status")) or "-")}</td><td>{escape(text(p.get("owner")) or "-")}</td><td>{escape(text(p.get("nextDate")) or "-")}</td><td>{escape(text(p.get("notes")) or "-")}</td></tr>'
    prog_table = f'<table><thead><tr><th>节点</th><th>状态</th><th>负责人</th><th>下次跟进</th><th>备注</th></tr></thead><tbody>{prog_rows or "<tr><td>立案</td><td>pending</td><td>待指定</td><td>待确认</td><td>尚未建立进度</td></tr>"}</tbody></table>'
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="claim-preview">'
        f'<div class="cp-top"><div><div class="title">理赔案件 · {escape(text(data.get("caseId")) or "未编号")}</div>'
        f'<div class="sub">运单 {escape(text(data.get("waybillNo")) or "-")} · {escape(text(data.get("route")) or "-")} · {escape(incident_type or "异常")}</div></div>'
        f'<div class="meta">诉求金额<br><b style="font-size:15px">{escape(text(data.get("customerDemandAmount")) or "待确认")}</b></div></div>'
        f'<div class="cp-body"><div class="stats">'
        f'<div class="stat ok"><div class="k">证据覆盖率</div><div class="v">{score}%</div></div>'
        f'<div class="stat danger"><div class="k">缺失证据</div><div class="v">{len(missing)}</div></div>'
        f'<div class="stat"><div class="k">责任方向</div><div class="v">{len(dirs)}</div></div>'
        f'<div class="stat"><div class="k">进度节点</div><div class="v">{len(progress)}</div></div>'
        f'</div><div class="section-title">证据完备度</div>{ev_table}'
        f'<div class="section-title">责任初判方向</div>{dir_html}'
        f'<div class="section-title">当前缺口</div>{gap_html}'
        f'<div class="section-title">理赔进度</div>{prog_table}'
        '<div class="cp-foot">责任初判为草稿，非法律结论。本预览为过程产物，确认后导出 Excel / PDF。</div></div></section>'
    )


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
    with tempfile.TemporaryDirectory(prefix="claim-chrome-") as profile:
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


def _report_html(data: dict[str, Any], rows: list[dict[str, str]]) -> str:
    body = claims_preview_html(data, rows)
    return ('<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>理赔材料 · {escape(text(data.get("caseId")) or "未编号")}</title>'
        f'<body style="margin:0;padding:20px;background:#fff">{body}</body></html>')


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


def write_xlsx(path: Path, data: dict[str, Any], rows: list[dict[str, str]]) -> None:
    """Sheet1 证据完备度(缺失标红); Sheet2 进度."""
    s1_headers = ["证据项", "状态", "说明", "补证动作"]
    s1_rows: list[list[Any]] = []
    risk_idx: set[int] = set()
    for i, r in enumerate(rows):
        if r["status"] != "available":
            risk_idx.add(i)
        s1_rows.append([r["label"], r["status"], r["description"], "归档核对" if r["status"] == "available" else f"补充:{r['label']}"])
    s2_headers = ["节点", "状态", "负责人", "下次跟进日", "备注"]
    progress = data.get("progress") if isinstance(data.get("progress"), list) else []
    s2_rows = [[text(p.get("node")), text(p.get("status")), text(p.get("owner")), text(p.get("nextDate")), text(p.get("notes"))] for p in progress if isinstance(p, dict)]
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
        '<sheets><sheet name="证据完备度" sheetId="1" r:id="rId1"/><sheet name="进度" sheetId="2" r:id="rId2"/></sheets></workbook>')
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()
    data = load_case(args.input)
    rows = evidence_rows(data)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)
    preview_html = claims_preview_html(data, rows)
    preview_path = process / "claim-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "caseId": text(data.get("caseId")),
        "evidence": rows,
        "missing": [r["type"] for r in rows if r["status"] != "available"],
        "files": files,
        "inlineWidget": {"title": "理赔案件预览", "widget_code": preview_html},
    }

    if args.mode == "export":
        case_id = safe_name(text(data.get("caseId")))
        xlsx_path = args.output_dir / f"理赔材料_{case_id}.xlsx"
        pdf_path = args.output_dir / f"理赔材料_{case_id}.pdf"
        write_xlsx(xlsx_path, data, rows)
        files.append(str(xlsx_path))
        report_html = _report_html(data, rows)
        html_tmp = process / f"report_{case_id}.html"
        html_tmp.write_text(report_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
