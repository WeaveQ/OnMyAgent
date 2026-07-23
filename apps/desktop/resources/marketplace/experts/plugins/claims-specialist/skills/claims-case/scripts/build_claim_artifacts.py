#!/usr/bin/env python3
"""Build evidence, liability, scripts, and progress artifacts for logistics claims."""

from __future__ import annotations

import argparse
import csv
import json
import re
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
    evidence_path = process / "evidence-checklist.md"
    liability_path = process / "liability-draft.md"
    progress_path = process / "claim-progress.md"
    evidence_path.write_text(evidence_markdown(data, rows), encoding="utf-8")
    liability_path.write_text(liability_markdown(data, rows), encoding="utf-8")
    progress_path.write_text(progress_markdown(data), encoding="utf-8")
    files = [str(evidence_path), str(liability_path), str(progress_path)]
    if args.mode == "export":
        case_id = safe_name(text(data.get("caseId")))
        pack_path = args.output_dir / f"理赔材料包_{case_id}.md"
        customer_path = args.output_dir / f"客户沟通话术_{case_id}.md"
        insurer_path = args.output_dir / f"保司报案提纲_{case_id}.md"
        csv_path = args.output_dir / f"理赔进度_{case_id}.csv"
        pack_path.write_text(case_pack(data, rows), encoding="utf-8")
        customer_path.write_text(customer_script(data), encoding="utf-8")
        insurer_path.write_text(insurer_outline(data, rows), encoding="utf-8")
        write_progress_csv(csv_path, data)
        files.extend([str(pack_path), str(customer_path), str(insurer_path), str(csv_path)])
    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "caseId": text(data.get("caseId")),
        "evidence": rows,
        "missing": [row["type"] for row in rows if row["status"] != "available"],
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
