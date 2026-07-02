#!/usr/bin/env python3
"""
Dashboard 分析脚本 - 调用 monitor-dashboard 接口
支持的 Action：
  - DescribeUnifyDashboards: 列出所有 Dashboard
  - DescribeUnifyDashboard: 获取单个 Dashboard 的完整面板配置
  - ExtractInstances: 提取 Dashboard 关联的实例列表（写到 instances.json，供用户选择）
  - DescribeDashboardMetricData: 批量查询指标数据
  - SplitResults: 将批量查询结果拆分为独立文件（供后续分析使用）
  - BulkAnalysis: 批量分析多个 Dashboard（拉配置+查指标+写到临时目录）
  - GenerateURLs: 根据 Dashboard 列表文件生成控制台跳转链接

接口地址：
  - 统一通过腾讯云公共 API: https://monitor.tencentcloudapi.com（TC3-HMAC-SHA256 签名）

实例解析策略：
  1. 用户指定了 --instance-filter → 直接用这些 ID 构造查询，不依赖 Selected
  2. 用户没指定 → 从 CUSTOM 副本的 Templating.Selected 中取实例，按 --max-instances 截断
  TODO: 后续支持通过模板自动创建面板并保存（无需用户提前在控制台选实例）。
"""

import argparse
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

try:
    import requests
except ImportError:
    print("错误：缺少 requests 库，请执行: pip3 install requests", file=sys.stderr)
    sys.exit(1)


# ─── 后端选择：tcproxycli 优先 ───

def _detect_backend():
    """
    检测当前环境应使用哪个后端调用云 API。
    优先使用 tcproxycli（沙箱环境），回退到 TC3 直连（本地 tccli 环境）。
    返回: "tcproxycli" 或 "tc3direct"
    """
    has_cmd = shutil.which("tcproxycli") is not None
    has_session = bool(os.environ.get("TCPROXYCLI_SESSION_KEY"))
    has_endpoint = bool(os.environ.get("TCPROXYCLI_PROXY_ENDPOINT"))
    if has_cmd and has_session and has_endpoint:
        return "tcproxycli"
    return "tc3direct"


_BACKEND = _detect_backend()


# ─── Dashboard 控制台 URL 生成 ───

def _title_to_slug(title):
    """
    将 Dashboard 标题转为 URL slug（拼音+小写英文，- 连接）。
    规则：中文逐字转拼音，连续英文/数字整体小写，特殊符号作为分隔符。
    示例：'云服务器 CVM' → 'yun-fu-wu-qi-cvm'
    """
    import re
    try:
        from pypinyin import pinyin, Style
    except ImportError:
        # pypinyin 不可用时，用 UUID 作为 fallback
        return None

    parts = []
    tokens = re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z0-9]+|[^a-zA-Z0-9\u4e00-\u9fff]+', title)
    for token in tokens:
        if re.match(r'[\u4e00-\u9fff]+', token):
            for char in token:
                py = pinyin(char, style=Style.NORMAL)[0][0]
                parts.append(py)
        elif re.match(r'[a-zA-Z0-9]+', token):
            parts.append(token.lower())
    return '-'.join(parts)


def generate_dashboard_url(dashboard_uuid, title):
    """
    生成 Dashboard 控制台跳转 URL。
    格式: https://console.cloud.tencent.com/monitor/dashboard/dashboards/d/{UUID}/{slug}
    """
    base = "https://console.cloud.tencent.com/monitor/dashboard/dashboards/d"
    slug = _title_to_slug(title)
    if slug:
        return f"{base}/{dashboard_uuid}/{slug}"
    return f"{base}/{dashboard_uuid}/{dashboard_uuid}"


def generate_urls_from_list(dashboard_list_path, uuid_list=None):
    """
    从 Dashboard 列表文件生成控制台 URL。
    uuid_list: 指定 UUID 列表（为空则生成全部非文件夹面板的 URL）。
    返回: [{uuid, title, type, url}, ...]
    """
    with open(dashboard_list_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    dashboards = data.get("Response", {}).get("Dashboards", [])

    results = []
    for d in dashboards:
        uid = d.get("UUID", "")
        title = d.get("Title", "")
        dtype = d.get("Type", "")
        if uid.startswith("f-"):
            continue
        if uuid_list and uid not in uuid_list:
            continue
        url = generate_dashboard_url(uid, title)
        results.append({
            "uuid": uid,
            "title": title,
            "type": dtype,
            "url": url,
        })
    return results




# ─── TC3 签名调用腾讯云公共 API ───

def _load_tccli_credentials():
    """从 tccli 配置文件读取 SecretId/SecretKey/Token（仅 tc3direct 后端使用）"""
    cred_path = os.path.expanduser("~/.tccli/default.credential")
    if not os.path.exists(cred_path):
        raise FileNotFoundError(f"tccli 凭证文件不存在: {cred_path}")
    with open(cred_path, "r") as f:
        cred = json.load(f)
    secret_id = cred.get("secretId", "")
    secret_key = cred.get("secretKey", "")
    token = cred.get("token", "")
    if not secret_id or not secret_key:
        raise ValueError("tccli 凭证不完整，请执行 tccli auth login 或 tccli configure")
    return secret_id, secret_key, token


def _tc3_sign(secret_key, date, service):
    """生成 TC3-HMAC-SHA256 签名密钥"""
    def _hmac_sha256(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, service)
    return _hmac_sha256(secret_service, "tc3_request")


def _call_via_tcproxycli(action, body_dict, region="ap-guangzhou", timeout=60):
    """
    通过 tcproxycli 调用腾讯云公共 API。
    将 body_dict 序列化为 JSON 后通过 --cli-input-json 传入，避免复杂参数的命令行转义问题。
    """
    body_json = json.dumps(body_dict)

    # 将复杂参数写到临时文件，用 --cli-input-json file:// 读取
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json",
                                     delete=False, encoding="utf-8") as tmp:
        tmp.write(body_json)
        tmp_path = tmp.name

    try:
        cmd = [
            "tcproxycli", "monitor", action,
            "--region", region,
            "--cli-input-json", f"file://{tmp_path}",
        ]
        print(f"  → 调用 {action} (tcproxycli) ...", end=" ", flush=True)
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            print(f"失败: {err[:100]}")
            raise RuntimeError(f"tcproxycli 调用失败 ({proc.returncode}): {err}")

        result = json.loads(proc.stdout)
        response = result.get("Response", result)
        if isinstance(response, dict) and "Error" in response:
            error = response["Error"]
            print(f"失败: {error.get('Code', 'Unknown')} - {error.get('Message', '')}")
            raise RuntimeError(f"API Error: {error.get('Code')}: {error.get('Message')}")

        print("成功")
        return result
    finally:
        os.unlink(tmp_path)


def _call_via_tc3direct(action, body_dict, region="ap-guangzhou", timeout=60):
    """
    通过 TC3-HMAC-SHA256 签名直接调用腾讯云公共 API（回退路径）。
    """
    service = "monitor"
    host = "monitor.tencentcloudapi.com"
    version = "2018-07-24"

    secret_id, secret_key, token = _load_tccli_credentials()
    body = json.dumps(body_dict)
    timestamp = int(time.time())
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")

    ct = "application/json; charset=utf-8"
    canonical_headers = f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(body.encode("utf-8")).hexdigest()
    canonical_request = (
        f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"
    )

    algorithm = "TC3-HMAC-SHA256"
    credential_scope = f"{date}/{service}/tc3_request"
    hashed_canonical_request = hashlib.sha256(
        canonical_request.encode("utf-8")
    ).hexdigest()
    string_to_sign = (
        f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_canonical_request}"
    )

    signing_key = _tc3_sign(secret_key, date, service)
    signature = hmac.new(
        signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    authorization = (
        f"{algorithm} "
        f"Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": ct,
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": version,
        "X-TC-Region": region,
    }
    if token:
        headers["X-TC-Token"] = token

    print(f"  → 调用 {action} (tc3direct) ...", end=" ", flush=True)
    resp = requests.post(f"https://{host}", headers=headers, data=body, timeout=timeout)
    resp.raise_for_status()
    result = resp.json()

    response = result.get("Response", result)
    if isinstance(response, dict) and "Error" in response:
        error = response["Error"]
        print(f"失败: {error.get('Code', 'Unknown')} - {error.get('Message', '')}")
        raise RuntimeError(f"API Error: {error.get('Code')}: {error.get('Message')}")

    print("成功")
    return result


def call_cloud_api(action, body_dict, region="ap-guangzhou", timeout=60):
    """
    统一入口：根据 _BACKEND 自动选择 tcproxycli 或 TC3 直连。
    - tcproxycli：沙箱环境，凭证由代理服务管理，通过临时文件传递复杂参数
    - tc3direct：本地环境，从 ~/.tccli/default.credential 读取凭证，直接 HTTPS 请求
    """
    if _BACKEND == "tcproxycli":
        return _call_via_tcproxycli(action, body_dict, region=region, timeout=timeout)
    return _call_via_tc3direct(action, body_dict, region=region, timeout=timeout)



# ─── DescribeUnifyDashboards ───

def describe_dashboards(region="ap-guangzhou"):
    """获取 Dashboard 列表（通过腾讯云公共 API）"""
    return call_cloud_api("DescribeUnifyDashboards", {}, region=region)


# ─── DescribeUnifyDashboard ───

def describe_dashboard(dashboard_uuid, region="ap-guangzhou"):
    """获取单个 Dashboard 完整配置（通过腾讯云公共 API）"""
    return call_cloud_api("DescribeUnifyDashboard", {"UUID": dashboard_uuid}, region=region)


def parse_dashboard_data(dashboard_response):
    """
    ① 解析 Dashboard API 响应中的 Data JSON。
    返回: (data_dict, panels_raw, templating_list)
    """
    response = dashboard_response.get("Response", dashboard_response)
    data = response.get("Data", "{}")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            print("  警告：Data 字段无法解析为 JSON", file=sys.stderr)
            return {}, [], []

    panels_raw = (
        data.get("panels", [])
        or data.get("Panels", [])
        or data.get("rows", [])
    )
    templating_list = data.get("Templating", [])
    return data, panels_raw, templating_list


def parse_templating(templating_list):
    """
    ② 解析 Templating[].Selected → 实例资源映射。
    返回: {
        tmpl_id: {
            "label": "CVM实例ID",
            "instances": [{"region": "ap-guangzhou", "fullInfo": {...}}, ...]
        }
    }
    """
    result = {}
    for tmpl in templating_list:
        tmpl_id_raw = tmpl.get("TemplatingId")
        if not isinstance(tmpl_id_raw, (int, float)):
            continue
        tmpl_id = int(tmpl_id_raw)
        label = tmpl.get("Label", tmpl.get("Name", str(tmpl_id)))

        selected_list = tmpl.get("Selected", [])
        if not selected_list:
            result[tmpl_id] = {"label": label, "instances": []}
            continue

        instances = []
        for sel_str in selected_list:
            if not isinstance(sel_str, str):
                continue
            try:
                sel = json.loads(sel_str)
            except json.JSONDecodeError:
                continue
            instances_str = sel.get("instances", "")
            if not instances_str:
                continue
            try:
                inst_list = json.loads(instances_str)
            except json.JSONDecodeError:
                continue
            for inst in inst_list:
                region = inst.get("Region", inst.get("_REGION_", "ap-guangzhou"))
                full_info = inst.get("fullInfo", {})
                if full_info:
                    instances.append({"region": region, "fullInfo": full_info})

        result[tmpl_id] = {"label": label, "instances": instances}
    return result


def resolve_instances(templating_map, instance_filter=None, max_instances=0):
    """
    ③ 确定每个模板变量最终使用哪些实例。

    三种模式：
    - instance_filter 有值: 用户直接指定了实例 ID，直接用这些 ID 构造 Conditions（不从 Selected 里找）
    - instance_filter 无值 + max_instances > 0: 从 Selected 取前 N 个
    - instance_filter 无值 + max_instances == 0: 使用 Selected 全部

    返回: {tmpl_id → [{"region": ..., "fullInfo": {...}}, ...]}（已确定的实例列表）
    """
    resolved = {}

    if instance_filter:
        # 用户直接指定了实例 ID → 为每个模板变量构造虚拟实例（不依赖 Selected）
        # 需要根据模板变量的 label 判断是 CVM/磁盘/GPU，分配对应的 ID
        for tmpl_id, info in templating_map.items():
            label = info["label"].lower()
            original = info["instances"]

            # 先尝试从 Selected 中精确匹配
            matched = []
            for inst in original:
                fi = inst.get("fullInfo", {})
                if any(str(v) in instance_filter for v in fi.values() if isinstance(v, str)):
                    matched.append(inst)

            if matched:
                print(f"  🎯 {info['label']}({tmpl_id}): {len(original)} 个实例 → 匹配到 {len(matched)} 个")
                resolved[tmpl_id] = matched
            else:
                # Selected 里没找到 → 直接用用户的 ID 构造虚拟实例
                # 根据 label 判断用什么 DimensionKey
                virtual_instances = []
                for inst_id in instance_filter:
                    # 判断 ID 类型和模板变量类型是否匹配
                    is_disk_id = inst_id.startswith("disk-")
                    is_ins_id = inst_id.startswith("ins-")
                    is_disk_tmpl = "磁盘" in info["label"] or "disk" in label or "存储" in info["label"]
                    is_gpu_tmpl = "gpu" in label
                    is_cvm_tmpl = "cvm" in label or "实例" in info["label"]

                    if is_disk_id and is_disk_tmpl:
                        virtual_instances.append({
                            "region": "ap-guangzhou",
                            "fullInfo": {"diskId": inst_id, "DiskId": inst_id},
                        })
                    elif is_ins_id and (is_cvm_tmpl or is_gpu_tmpl):
                        virtual_instances.append({
                            "region": "ap-guangzhou",
                            "fullInfo": {"InstanceId": inst_id},
                        })

                if virtual_instances:
                    print(f"  🎯 {info['label']}({tmpl_id}): 用户指定 {len(virtual_instances)} 个实例（直接构造）")
                    resolved[tmpl_id] = virtual_instances
                else:
                    # 用户指定的 ID 和这个模板变量类型不匹配，用默认前 3 个
                    fallback = original[:min(3, len(original))]
                    if fallback:
                        print(f"  📌 {info['label']}({tmpl_id}): 用户指定的 ID 不匹配此变量类型，使用默认前 {len(fallback)} 个")
                    resolved[tmpl_id] = fallback
    else:
        # 没有 instance_filter → 从 Selected 截断
        for tmpl_id, info in templating_map.items():
            original = info["instances"]
            if max_instances > 0 and len(original) > max_instances:
                print(f"  📌 {info['label']}({tmpl_id}): {len(original)} 个实例 → 截断为 {max_instances} 个")
                resolved[tmpl_id] = original[:max_instances]
            else:
                resolved[tmpl_id] = original

    return resolved


def build_panel_queries(panels_raw, resolved_instances):
    """
    ④ 遍历 Panels，构造每个面板的 query_params。

    resolved_instances: {tmpl_id → [实例列表]}，已确定要查哪些实例。
    返回: [{panel_info, query_params}, ...]
    """
    panels = []
    for panel in panels_raw:
        title = (
            panel.get("title", "")
            or panel.get("Title", "")
            or "未知面板"
        )
        targets = (
            panel.get("targets", [])
            or panel.get("Targets", [])
        )

        query_params = []
        for target in targets:
            # ── 提取 MetricName ──
            metric_name = target.get("MetricName", target.get("metricName", ""))
            if not metric_name:
                metric_names = target.get("MetricNames", target.get("metricNames", []))
                if metric_names and isinstance(metric_names, list) and len(metric_names) > 0:
                    metric_name = metric_names[0]

            # ── 提取 DataSource ──
            datasource = (
                target.get("DataSource", "")
                or target.get("Datasource", "")
                or target.get("datasource", "DS_QCEMetric")
            )

            # ── 提取 DimensionKey ──
            dimension_keys = target.get("DimensionKey", target.get("dimensionKey", []))
            if isinstance(dimension_keys, str):
                dimension_keys = [dimension_keys]

            # ── 检测模板面板 ──
            raw_conditions = (
                target.get("conditions", [])
                or target.get("Conditions", [])
            )
            is_templating = any(
                c.get("Type", c.get("type", "normal")) == "templating"
                for c in raw_conditions
            )
            if not is_templating:
                for c in raw_conditions:
                    dims = c.get("Dimension", c.get("dimension", []))
                    if dims and all(isinstance(d, (int, float)) for d in dims):
                        is_templating = True
                        break

            if is_templating:
                # ── 从 resolved_instances 中构造 Conditions ──
                # 按 region 分组，同一 region 的所有实例放入同一个 Condition 的 Dimension 数组
                region_dims = {}  # region → [dim_json_str, ...]
                for c in raw_conditions:
                    dims = c.get("Dimension", c.get("dimension", []))
                    for dim in dims:
                        if isinstance(dim, (int, float)):
                            tmpl_id = int(dim)
                            instances = resolved_instances.get(tmpl_id, [])
                            for inst in instances:
                                region = inst["region"]
                                full_info = inst["fullInfo"]
                                dim_obj = {}
                                if dimension_keys:
                                    for key in dimension_keys:
                                        val = full_info.get(key, "")
                                        if val:
                                            dim_obj[key] = val
                                else:
                                    for k, v in full_info.items():
                                        if not k.startswith("_") and k != "Region" and isinstance(v, str):
                                            dim_obj[k] = v
                                if dim_obj:
                                    region_dims.setdefault(region, []).append(json.dumps(dim_obj))
                resolved_conditions = []
                for region, dim_list in region_dims.items():
                    resolved_conditions.append({
                        "Region": region,
                        "Dimension": dim_list,
                    })

                if resolved_conditions:
                    group_by = dimension_keys if dimension_keys else []
                    query = {
                        "DataSource": datasource,
                        "Namespace": target.get("Namespace", target.get("namespace", "")),
                        "MetricName": metric_name,
                        "Period": int(target.get("Period", target.get("period", 0)) or 0),
                        "GroupBy": group_by,
                        "Aggregate": target.get("Aggregate", target.get("aggregate", "avg")),
                        "Conditions": resolved_conditions,
                        "StartTime": target.get("StartTime", target.get("startTime", "")),
                        "EndTime": target.get("EndTime", target.get("endTime", "")),
                        "SeriesId": target.get("SeriesId", target.get("seriesId", "")),
                        "ConfigId": target.get("ConfigId", target.get("configId", "")),
                        "ViewName": target.get("ViewName", target.get("viewName", "")),
                    }
                    query_params.append(query)
                else:
                    query_params.append({
                        "__is_templating__": True,
                        "Namespace": target.get("Namespace", target.get("namespace", "")),
                        "MetricName": metric_name,
                        "DataSource": datasource,
                        "Aggregate": target.get("Aggregate", target.get("aggregate", "avg")),
                        "ViewName": target.get("ViewName", target.get("viewName", "")),
                        "panel_title": title,
                    })
                continue

            # ── 正常面板（非模板） ──
            conditions = []
            for cond in raw_conditions:
                conditions.append({
                    "Region": cond.get("Region", cond.get("region", "ap-guangzhou")),
                    "Dimension": cond.get("Dimension", cond.get("dimension", [])),
                    "Type": cond.get("Type", cond.get("type", "normal")),
                })

            query = {
                "DataSource": datasource,
                "Namespace": target.get("Namespace", target.get("namespace", "")),
                "MetricName": metric_name,
                "Period": int(target.get("Period", target.get("period", 0)) or 0),
                "GroupBy": target.get("GroupBy", target.get("groupBy", [])),
                "Aggregate": target.get("Aggregate", target.get("aggregate", "avg")),
                "Conditions": conditions,
                "StartTime": target.get("StartTime", target.get("startTime", "")),
                "EndTime": target.get("EndTime", target.get("endTime", "")),
                "SeriesId": target.get("SeriesId", target.get("seriesId", "")),
                "ConfigId": target.get("ConfigId", target.get("configId", "")),
                "ViewName": target.get("ViewName", target.get("viewName", "")),
            }
            query_params.append(query)

        if query_params:
            panels.append({
                "panel_info": title,
                "query_params": query_params,
            })

    return panels


def extract_instances_info(templating_map):
    """
    从 templating_map 中提取人类可读的实例列表（用于写 instances.json 给 AI/用户看）。
    """
    variables = []
    for tmpl_id, info in templating_map.items():
        instances = []
        for inst in info["instances"]:
            fi = inst.get("fullInfo", {})
            # 提取关键 ID 和名称字段
            entry = {"region": inst.get("region", "")}
            for key in ["InstanceId", "instanceId", "DiskId", "diskId", "InstanceName", "DiskName"]:
                if key in fi and isinstance(fi[key], str) and fi[key]:
                    entry[key] = fi[key]
            instances.append(entry)
        variables.append({
            "tmpl_id": tmpl_id,
            "label": info["label"],
            "count": len(instances),
            "instances": instances,
        })
    return {"templating_variables": variables}


def extract_queries_from_dashboard(dashboard_response, max_instances=0, instance_filter=None):
    """
    便捷函数：组合调用 parse → resolve → build，保持向后兼容。
    """
    data, panels_raw, templating_list = parse_dashboard_data(dashboard_response)
    if not data:
        return []
    templating_map = parse_templating(templating_list)
    resolved = resolve_instances(templating_map, instance_filter=instance_filter, max_instances=max_instances)
    return build_panel_queries(panels_raw, resolved)


# ─── DescribeDashboardMetricData ───

def query_metric_data(panels,
                      start_time=None, end_time=None, region="ap-guangzhou",
                      **kwargs):
    """
    批量查询所有 Panel 的指标数据。
    将所有 Panel 的 query_params 合并为一个 Query 数组发送。
    所有接口统一走腾讯云公共 API（TC3 签名）。

    只处理已解析出实例的正常面板（CUSTOM 副本的 Selected 已在 extract 阶段解析）。
    模板面板（Selected 为空）会被跳过并打印警告。
    """
    # ── 过滤：只保留正常面板，跳过未解析的模板面板 ──
    valid_panels = []
    skipped_count = 0

    for panel in panels:
        valid_qp = [q for q in panel["query_params"] if not q.get("__is_templating__")]
        tmpl_qp = [q for q in panel["query_params"] if q.get("__is_templating__")]
        skipped_count += len(tmpl_qp)
        if valid_qp:
            valid_panels.append({**panel, "query_params": valid_qp})

    if skipped_count > 0:
        print(f"  ⚠️  跳过 {skipped_count} 个未解析的模板面板（Dashboard 未配置实例，请先在控制台选择实例并保存）")

    all_panels = valid_panels

    # 默认时间范围：最近 3 小时
    now = datetime.now(timezone(timedelta(hours=8)))
    if not start_time:
        start_time = (now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    if not end_time:
        end_time = now.strftime("%Y-%m-%dT%H:%M:%S+08:00")

    # ── 构造 Query 数组（去重：相同指标+维度+聚合方式只查一次） ──
    queries = []
    series_id_map = {}  # SeriesId → (panel_idx, target_idx)
    dedup_map = {}      # dedup_key → SeriesId（已发送的查询）
    dedup_refs = {}     # SeriesId → [(pi, ti), ...]（所有引用该查询的面板）

    for pi, panel in enumerate(all_panels):
        for ti, qp in enumerate(panel["query_params"]):
            # 构造去重 key：Namespace + MetricName + Aggregate + Conditions(排序)
            conds = qp.get("Conditions", [])
            conds_key = json.dumps(conds, sort_keys=True)
            dedup_key = f"{qp.get('Namespace','')}|{qp.get('MetricName','')}|{qp.get('Aggregate','')}|{conds_key}"

            if dedup_key in dedup_map:
                # 已有相同查询，复用结果
                existing_sid = dedup_map[dedup_key]
                dedup_refs[existing_sid].append((pi, ti))
                continue

            series_id = f"p{pi}_t{ti}"
            query = {
                "DataSource": qp.get("DataSource", "DS_QCEMetric"),
                "Namespace": qp.get("Namespace", ""),
                "MetricName": qp.get("MetricName", ""),
                "Aggregate": qp.get("Aggregate", "avg"),
                "Conditions": conds,
                "SeriesId": series_id,
                "ConfigId": qp.get("ConfigId", ""),
                "ViewName": qp.get("ViewName", ""),
            }
            period_val = qp.get("Period", 0)
            if period_val and period_val != "" and period_val != 0:
                query["Period"] = int(period_val)
            if qp.get("GroupBy"):
                query["GroupBy"] = qp["GroupBy"]
            query["StartTime"] = qp.get("StartTime") or start_time
            query["EndTime"] = qp.get("EndTime") or end_time

            queries.append(query)
            series_id_map[series_id] = (pi, ti)
            dedup_map[dedup_key] = series_id
            dedup_refs[series_id] = [(pi, ti)]

    deduped_count = sum(len(refs) - 1 for refs in dedup_refs.values() if len(refs) > 1)
    if deduped_count > 0:
        print(f"  📌 去重: 原始 {sum(len(p['query_params']) for p in all_panels)} 个查询 → 实际 {len(queries)} 个（去重 {deduped_count} 个）")

    if not queries:
        print("  警告：没有有效的查询参数（请确认 Dashboard 已配置实例）")
        return {"panels": [], "dashboard_query_time": now.isoformat(),
                "instance_names": {}, "skipped_templating": skipped_count}

    # ── 分批查询（每批最多 20 个 Query） ──
    batch_size = 20
    total_batches = (len(queries) + batch_size - 1) // batch_size
    print(f"  共 {len(all_panels)} 个面板, {len(queries)} 个查询, 分 {total_batches} 批")

    all_results = []  # 所有返回的结果（可能多于 queries 数量）

    for batch_start in range(0, len(queries), batch_size):
        batch_queries = queries[batch_start:batch_start + batch_size]
        body = {
            "Module": "monitor",
            "SpaceUUID": "space_default",
            "Query": batch_queries,
        }
        try:
            result = call_cloud_api(
                "DescribeDashboardMetricData", body, region=region,
            )
            response = result.get("Response", result)
            batch_data = response.get("Data", [])
            if isinstance(batch_data, list):
                all_results.extend(batch_data)
        except Exception as e:
            error_msg = str(e)[:200]
            batch_end = batch_start + len(batch_queries)
            print(f"  ⚠️  批次 (query {batch_start}-{batch_end-1}) 失败: {error_msg[:100]}")
            # 为该批次每个 query 生成错误标记
            for q in batch_queries:
                all_results.append({
                    "Code": "BatchError",
                    "Error": error_msg,
                    "MetricName": q.get("MetricName", ""),
                    "Namespace": q.get("Namespace", ""),
                    "SeriesId": q.get("SeriesId", ""),
                    "Value": "[]",
                })
            continue

    # ── 靠 SeriesId 把结果匹配回面板（含去重复用） ──
    panel_metrics = {pi: [] for pi in range(len(all_panels))}
    matched_series = set()

    total_ok = 0
    total_fail = 0

    for r in all_results:
        sid = r.get("SeriesId", "")
        is_fail = bool(r.get("Code") or r.get("Error"))
        if is_fail:
            total_fail += 1
        else:
            total_ok += 1

        if sid in dedup_refs:
            matched_series.add(sid)
            # 将结果分发到所有引用该 SeriesId 的面板
            for (pi, ti) in dedup_refs[sid]:
                panel_metrics[pi].append({
                    "query_param": all_panels[pi]["query_params"][ti],
                    "result": r,
                })
        else:
            print(f"  ⚠️  未知 SeriesId: {sid}, MetricName={r.get('MetricName','')}")

    # 补充没有返回结果的 Query
    for sid, (pi, ti) in series_id_map.items():
        if sid not in matched_series:
            total_fail += 1
            qp = all_panels[pi]["query_params"][ti]
            panel_metrics[pi].append({
                "query_param": qp,
                "result": {
                    "Code": "NoResult",
                    "Error": "接口未返回该指标结果",
                    "MetricName": qp.get("MetricName", ""),
                    "Namespace": qp.get("Namespace", ""),
                    "SeriesId": sid,
                    "Value": "[]",
                },
            })

    # 构造输出
    panel_results = []
    for pi, panel in enumerate(all_panels):
        panel_results.append({
            "panel_info": panel["panel_info"],
            "metrics": panel_metrics.get(pi, []),
        })

    output = {
        "dashboard_query_time": now.isoformat(),
        "total_queries": len(queries),
        "total_results": total_ok + total_fail,
        "success_results": total_ok,
        "failed_results": total_fail,
        "skipped_templating": skipped_count,
        "instance_names": {},
        "panels": panel_results,
    }
    return output



# ─── SplitResults ───

def _downsample(values, target_points=18):
    """
    将时序数据降采样到 target_points 个点（取每段的均值）。
    用于生成 sparkline，让 AI 能看到趋势但不被大量数据淹没。
    """
    n = len(values)
    if n <= target_points:
        return [round(v, 3) for v in values]
    step = n / target_points
    result = []
    for i in range(target_points):
        start = int(i * step)
        end = int((i + 1) * step)
        segment = [v for v in values[start:end] if v is not None]
        if segment:
            result.append(round(sum(segment) / len(segment), 3))
        else:
            result.append(None)
    return result


def _detect_anomaly_simple(values, avg_val, std_val):
    """
    简单异常检测：找出 σ > 2 的最大点，返回 anomaly 描述或 None。
    """
    if std_val <= 0 or len(values) < 10:
        return None
    max_sigma = 0
    max_idx = 0
    max_val = 0
    for i, v in enumerate(values):
        sigma = abs(v - avg_val) / std_val
        if sigma > max_sigma:
            max_sigma = sigma
            max_idx = i
            max_val = v
    if max_sigma < 2:
        return None
    # 判断 spike vs sustained
    n = len(values)
    if max_idx > 0 and max_idx < n - 1:
        prev_sigma = abs(values[max_idx - 1] - avg_val) / std_val
        next_sigma = abs(values[max_idx + 1] - avg_val) / std_val
        atype = "spike" if (prev_sigma < 1.5 and next_sigma < 1.5) else "sustained"
    else:
        atype = "spike"
    return {
        "type": atype,
        "peak_idx": max_idx,
        "peak": round(max_val, 3),
        "sigma": round(max_sigma, 1),
        "ratio": round(max_val / avg_val, 1) if avg_val > 0 else 0,
    }


def split_results(metric_results, output_dir):
    """
    将批量查询结果拆分为 AI 友好型 JSON 文件（V2 格式）。
    
    核心优化：
    - 无数据实例只记 ID 列表（不展开 181 个 null）
    - 有数据实例输出 stats + sparkline（降采样到 18 个点） + anomaly
    - 公共字段（metric_name, namespace, time_range, period）提到面板级别
    - 按面板一个文件，内含所有实例的精简数据
    """
    import math

    os.makedirs(output_dir, exist_ok=True)

    files = []
    metric_summary = {}  # namespace/metric → 出现次数
    metric_idx = 0

    for pi, panel in enumerate(metric_results.get("panels", [])):
        panel_info = panel.get("panel_info", f"panel_{pi}")
        
        # 按 metric_name 分组（同一面板内可能有多个指标）
        metric_groups = {}  # metric_name → {instances: [...], no_data: [...], ...}
        
        for metric in panel.get("metrics", []):
            result = metric.get("result", {})
            qp = metric.get("query_param", {})
            
            metric_name = result.get("MetricName", qp.get("MetricName", ""))
            namespace = result.get("Namespace", qp.get("Namespace", ""))
            aggregate = result.get("Aggregate", qp.get("Aggregate", ""))
            period = result.get("Period", qp.get("Period", 60) or 60)
            start_time = result.get("StartTime", qp.get("StartTime", ""))
            end_time = result.get("EndTime", qp.get("EndTime", ""))
            
            # 提取实例 ID
            dims = result.get("Dimensions", [])
            instance_id = ""
            for d in dims:
                if d.get("Name") in ("InstanceId", "diskId", "instanceid"):
                    instance_id = d.get("Value", "")
                    break

            # 统计 metric_summary
            key = f"{namespace}/{metric_name}"
            metric_summary[key] = metric_summary.get(key, 0) + 1
            metric_idx += 1

            # 分组 key
            group_key = f"{namespace}|{metric_name}|{aggregate}"
            if group_key not in metric_groups:
                metric_groups[group_key] = {
                    "metric_name": metric_name,
                    "namespace": namespace,
                    "aggregate": aggregate,
                    "period": period,
                    "start_time": start_time,
                    "end_time": end_time,
                    "instances": [],
                    "no_data_instances": [],
                    "error_instances": [],
                }

            group = metric_groups[group_key]

            # 检查错误
            code = result.get("Code", "")
            error = result.get("Error", "")
            if code or error:
                group["error_instances"].append({
                    "id": instance_id or "unknown",
                    "error": error[:60] if error else code,
                })
                continue

            # 解析数据
            value_str = result.get("Value", "")
            if not value_str or value_str == "[]":
                group["no_data_instances"].append(instance_id or "unknown")
                continue

            try:
                raw_values = json.loads(value_str)
            except json.JSONDecodeError:
                group["no_data_instances"].append(instance_id or "unknown")
                continue

            # 提取有效值
            values = []
            if raw_values and isinstance(raw_values[0], list):
                for item in raw_values:
                    if item is not None and len(item) >= 2:
                        values.append(item[1])  # 保留 None
            else:
                values = raw_values

            # 过滤 null
            valid_values = [v for v in values if v is not None]
            
            if not valid_values:
                group["no_data_instances"].append(instance_id or "unknown")
                continue

            # 全零数据 → 归入无意义数据列表
            if max(valid_values) == 0:
                group.setdefault("zero_data_instances", []).append(instance_id or "unknown")
                continue

            # 计算统计值
            n = len(valid_values)
            avg_val = sum(valid_values) / n
            max_val = max(valid_values)
            min_val = min(valid_values)
            sorted_vals = sorted(valid_values)
            p95_val = sorted_vals[int(n * 0.95)] if n > 1 else avg_val
            variance = sum((x - avg_val) ** 2 for x in valid_values) / n
            std_val = math.sqrt(variance)

            # 趋势判断
            if n >= 4:
                q1 = valid_values[:n // 4]
                q4 = valid_values[-(n // 4):]
                avg_q1 = sum(q1) / len(q1) if q1 else 0
                avg_q4 = sum(q4) / len(q4) if q4 else 0
                if avg_q1 > 0:
                    change_pct = (avg_q4 - avg_q1) / avg_q1 * 100
                else:
                    change_pct = 0
                if change_pct > 15:
                    trend = "上升"
                elif change_pct < -15:
                    trend = "下降"
                else:
                    trend = "平稳"
            else:
                trend = "平稳"

            # 异常检测
            anomaly = _detect_anomaly_simple(valid_values, avg_val, std_val)

            # 生成 sparkline（降采样）
            sparkline = _downsample(valid_values)

            instance_data = {
                "id": instance_id or "unknown",
                "stats": {
                    "avg": round(avg_val, 3),
                    "max": round(max_val, 3),
                    "min": round(min_val, 3),
                    "p95": round(p95_val, 3),
                },
                "trend": trend,
                "sparkline": sparkline,
            }
            if anomaly:
                instance_data["anomaly"] = anomaly

            group["instances"].append(instance_data)

        # 生成面板文件
        if metric_groups:
            safe_name = panel_info.replace("/", "_").replace(":", "_").replace(" ", "_")[:40]
            filename = f"panel_{pi}_{safe_name}.json"
            filepath = os.path.join(output_dir, filename)

            # 构造输出：每个 metric_group 作为一个条目
            metrics_output = []
            for group_key, group in metric_groups.items():
                zero_list = group.get("zero_data_instances", [])
                entry = {
                    "metric_name": group["metric_name"],
                    "namespace": group["namespace"],
                    "aggregate": group["aggregate"],
                    "period": group["period"],
                    "time_range": f"{group['start_time']} ~ {group['end_time']}",
                    "total_instances": len(group["instances"]) + len(group["no_data_instances"]) + len(group["error_instances"]) + len(zero_list),
                    "has_data_count": len(group["instances"]),
                    "no_data_count": len(group["no_data_instances"]),
                    "zero_data_count": len(zero_list),
                    "error_count": len(group["error_instances"]),
                    "instances": group["instances"],
                }
                # 无数据实例只记 ID 列表
                if group["no_data_instances"]:
                    entry["no_data_instances"] = group["no_data_instances"]
                # 全零实例只记 ID 列表
                if zero_list:
                    entry["zero_data_instances"] = zero_list
                # 错误实例简要记录
                if group["error_instances"]:
                    entry["error_instances"] = group["error_instances"]
                metrics_output.append(entry)

            output_data = {
                "panel_info": panel_info,
                "panel_index": pi,
                "metrics": metrics_output,
            }
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(output_data, f, ensure_ascii=False, indent=2)
            files.append(filepath)

    # 如果有实例名映射，也保存一份
    instance_names = metric_results.get("instance_names", {})
    if instance_names:
        names_path = os.path.join(output_dir, "instance_names.json")
        with open(names_path, "w", encoding="utf-8") as f:
            json.dump(instance_names, f, ensure_ascii=False, indent=2)

    return files, metric_summary


# ─── AnalyzeResults: 统计分析 ───

def analyze_results(metric_results, split_dir):
    """
    对 metric_results 进行统计分析，生成 analysis.json。
    优化：panels 中只展开 warning 指标，正常指标只保留计数。
    新增 top_anomalies（按 sigma 排序 TOP 20）和 instance_health（实例维度健康评分）。
    """
    import math

    dashboard_time = metric_results.get("dashboard_query_time", "")
    total_queries = metric_results.get("total_queries", 0)
    success_results = metric_results.get("success_results", 0)
    failed_results = metric_results.get("failed_results", 0)

    failed_summary = {}
    all_panel_analyses = []
    metric_idx = 0
    key_findings = []
    all_anomalies = []       # 收集所有异常用于 top_anomalies
    instance_health = {}     # instance_id → {warning_count, max_sigma, metrics set}

    for panel in metric_results.get("panels", []):
        panel_info = panel.get("panel_info", "未知面板")
        panel_warning_metrics = []   # 只保留 warning 的
        panel_ok_count = 0
        panel_failed = []

        for m in panel.get("metrics", []):
            result = m.get("result", {})
            qp = m.get("query_param", {})
            metric_name = result.get("MetricName", qp.get("MetricName", ""))
            namespace = result.get("Namespace", qp.get("Namespace", ""))
            code = result.get("Code", "")
            error = result.get("Error", "")
            raw_file = f"metrics/panel_{metric_results.get('panels', []).index(panel)}_{panel_info.replace('/', '_').replace(':', '_').replace(' ', '_')[:40]}.json"
            metric_idx += 1

            # 提取实例 ID
            dims = result.get("Dimensions", [])
            instance_id = ""
            for d in dims:
                if d.get("Name") in ("InstanceId", "diskId", "instanceid"):
                    instance_id = d.get("Value", "")
                    break

            # 失败指标
            if code or error:
                if "dimensionlist is empty" in error:
                    category = "GPU指标(非GPU机型)"
                elif "Partition" in error or "is not set" in error:
                    category = "指标不存在"
                elif "无效的参数值" in error or "InvalidParameterValue" in code:
                    category = "参数值无效"
                elif "FailedOperation" in code:
                    category = "查询失败"
                elif "BatchError" in code:
                    category = "批次请求失败"
                else:
                    category = error[:30] if error else code
                failed_summary[category] = failed_summary.get(category, 0) + 1
                panel_failed.append({
                    "metric_name": metric_name,
                    "namespace": namespace,
                    "instance_id": instance_id,
                    "error_category": category,
                })
                continue

            # ── 解析数据点 ──
            value_str = result.get("Value", "")
            if not value_str or value_str == "[]":
                panel_failed.append({
                    "metric_name": metric_name,
                    "namespace": namespace,
                    "instance_id": instance_id,
                    "error_category": "无数据",
                })
                failed_summary["无数据"] = failed_summary.get("无数据", 0) + 1
                continue

            try:
                raw_values = json.loads(value_str)
            except json.JSONDecodeError:
                continue

            timestamps = []
            values = []
            if raw_values and isinstance(raw_values[0], list):
                for item in raw_values:
                    if item is not None and len(item) >= 2 and item[1] is not None:
                        timestamps.append(item[0])
                        values.append(item[1])
            else:
                for i, v in enumerate(raw_values):
                    if v is not None:
                        values.append(v)

            if not values:
                continue

            # ── 统计值 ──
            n = len(values)
            avg_val = sum(values) / n
            max_val = max(values)
            min_val = min(values)
            sorted_vals = sorted(values)
            p95_val = sorted_vals[int(n * 0.95)] if n > 1 else avg_val
            variance = sum((x - avg_val) ** 2 for x in values) / n
            std_val = math.sqrt(variance)
            cv = (std_val / avg_val) if avg_val > 0 else 0

            # ── 趋势判断 ──
            if n >= 4:
                q1 = values[:n // 4]
                q4 = values[-(n // 4):]
                avg_q1 = sum(q1) / len(q1) if q1 else 0
                avg_q4 = sum(q4) / len(q4) if q4 else 0
                if avg_q1 > 0:
                    change_pct = (avg_q4 - avg_q1) / avg_q1 * 100
                else:
                    change_pct = 0
                if change_pct > 15:
                    trend = "上升"
                elif change_pct < -15:
                    trend = "下降"
                elif cv > 0.5:
                    trend = "周期性波动"
                else:
                    trend = "平稳"
                trend_detail = f"前1/4均值{avg_q1:.2f}，后1/4均值{avg_q4:.2f}，变化{change_pct:+.1f}%"
            else:
                trend = "数据不足"
                trend_detail = f"仅{n}个数据点"

            # ── 异常检测 ──
            anomalies = []
            if std_val > 0 and n >= 10:
                for i, v in enumerate(values):
                    sigma = abs(v - avg_val) / std_val
                    if sigma > 2:
                        ts_str = ""
                        if timestamps and i < len(timestamps):
                            try:
                                dt = datetime.fromtimestamp(timestamps[i] / 1000, tz=timezone(timedelta(hours=8)))
                                ts_str = dt.strftime("%H:%M")
                            except Exception:
                                ts_str = str(timestamps[i])

                        if i > 0 and i < n - 1:
                            prev_sigma = abs(values[i - 1] - avg_val) / std_val
                            next_sigma = abs(values[i + 1] - avg_val) / std_val
                            if prev_sigma < 1.5 and next_sigma < 1.5:
                                atype = "spike"
                                desc = f"单点毛刺，偏离均值{sigma:.1f}σ，值={v:.3f}（均值{avg_val:.3f}）"
                            else:
                                atype = "sustained"
                                desc = f"持续偏高，偏离均值{sigma:.1f}σ，值={v:.3f}"
                        else:
                            atype = "spike"
                            desc = f"偏离均值{sigma:.1f}σ，值={v:.3f}"

                        anomalies.append({
                            "time": ts_str,
                            "value": round(v, 3),
                            "type": atype,
                            "sigma": round(sigma, 1),
                            "desc": desc,
                        })

            if len(anomalies) > 5:
                anomalies = sorted(anomalies, key=lambda a: -a["sigma"])[:5]

            # ── 状态判断 ──
            if any(a["sigma"] > 3 for a in anomalies):
                status = "warning"
            elif len(anomalies) > 3:
                status = "warning"
            else:
                status = "ok"

            # ── 收集关键发现 ──
            if anomalies:
                top_anomaly = max(anomalies, key=lambda a: a["sigma"])
                key_findings.append(
                    f"{panel_info}/{metric_name}: {top_anomaly['time']} 出现{top_anomaly['type']}，"
                    f"值={top_anomaly['value']}（均值{avg_val:.2f}，偏离{top_anomaly['sigma']}σ）"
                )
                # 收集到全局异常列表
                all_anomalies.append({
                    "panel": panel_info,
                    "metric": metric_name,
                    "instance": instance_id,
                    "sigma": top_anomaly["sigma"],
                    "value": top_anomaly["value"],
                    "avg": round(avg_val, 3),
                    "type": top_anomaly["type"],
                    "time": top_anomaly["time"],
                })

            # 最大值时间
            max_time = ""
            if timestamps:
                max_idx = values.index(max_val)
                if max_idx < len(timestamps):
                    try:
                        dt = datetime.fromtimestamp(timestamps[max_idx] / 1000, tz=timezone(timedelta(hours=8)))
                        max_time = dt.strftime("%H:%M")
                    except Exception:
                        pass

            # ── 更新实例健康 ──
            if instance_id:
                if instance_id not in instance_health:
                    instance_health[instance_id] = {"warning_count": 0, "max_sigma": 0, "metrics": set()}
                if status == "warning":
                    instance_health[instance_id]["warning_count"] += 1
                    if anomalies:
                        max_s = max(a["sigma"] for a in anomalies)
                        if max_s > instance_health[instance_id]["max_sigma"]:
                            instance_health[instance_id]["max_sigma"] = max_s
                    instance_health[instance_id]["metrics"].add(metric_name)

            # ── 只保留 warning 指标到面板，ok 只计数 ──
            if status == "warning":
                panel_warning_metrics.append({
                    "metric_name": metric_name,
                    "namespace": namespace,
                    "instance_id": instance_id,
                    "stats": {
                        "avg": round(avg_val, 3),
                        "max": round(max_val, 3),
                        "min": round(min_val, 3),
                        "p95": round(p95_val, 3),
                        "std": round(std_val, 3),
                        "cv": round(cv, 3),
                    },
                    "max_time": max_time,
                    "trend": trend,
                    "trend_detail": trend_detail,
                    "anomalies": anomalies,
                    "status": status,
                    "data_points": n,
                    "raw_file": raw_file,
                })
            else:
                panel_ok_count += 1

        all_panel_analyses.append({
            "panel_info": panel_info,
            "ok_count": panel_ok_count,
            "warning_count": len(panel_warning_metrics),
            "failed_count": len(panel_failed),
            "metrics": panel_warning_metrics,
            "failed_metrics": panel_failed,
        })

    # ── 整体健康评级 ──
    warning_count = sum(p["warning_count"] for p in all_panel_analyses)
    if warning_count >= 3:
        health = "warning"
    elif warning_count >= 1:
        health = "normal_with_notes"
    else:
        health = "normal"

    # ── top_anomalies: 按 sigma 排序 TOP 20，并加入 business_impact ──
    def _estimate_business_impact(metric_name, peak_value, avg_value):
        """基于指标名称 + 绝对值量级判断业务影响"""
        mn = metric_name.lower()
        # 利用率类（0-100%）：> 20% 才算高影响
        if any(k in mn for k in ['usage', 'util', 'ratio']):
            return 'high' if peak_value > 20 else 'low'
        # 带宽类（Mbps）
        if 'traffic' in mn or 'bandwidth' in mn:
            if 'lan' in mn:  # 内网
                return 'high' if peak_value > 10 else 'low'
            return 'high' if peak_value > 1 else 'low'  # 外网
        # 包量（个/s）
        if 'pkg' in mn or 'packet' in mn:
            return 'high' if peak_value > 100 else 'low'
        # 连接数
        if 'conn' in mn or 'tcp' in mn:
            return 'high' if peak_value > 1000 else 'low'
        # 磁盘 IO
        if 'io' in mn or 'iops' in mn:
            return 'high' if peak_value > 50 else 'low'
        # 负载
        if 'load' in mn:
            return 'high' if peak_value > 2 else 'low'
        # 默认：突增比例 > 5 倍且绝对值 > 1
        change_ratio = peak_value / avg_value if avg_value > 0 else 0
        return 'high' if (change_ratio > 5 and peak_value > 1) else 'low'

    top_anomalies = sorted(all_anomalies, key=lambda a: -a["sigma"])[:20]
    for anomaly in top_anomalies:
        anomaly["business_impact"] = _estimate_business_impact(
            anomaly.get("metric", ""),
            anomaly.get("value", 0),
            anomaly.get("avg", 0),
        )

    # ── instance_health: 转为可序列化格式，按 warning_count 排序 ──
    instance_health_list = {}
    for inst_id, info in sorted(instance_health.items(), key=lambda x: -x[1]["warning_count"]):
        if info["warning_count"] > 0:
            instance_health_list[inst_id] = {
                "warning_count": info["warning_count"],
                "max_sigma": info["max_sigma"],
                "metrics": sorted(list(info["metrics"])),
            }

    # ── 跨指标关联检测 ──
    anomaly_times = {}
    for p in all_panel_analyses:
        for m in p["metrics"]:
            for a in m.get("anomalies", []):
                t = a.get("time", "")
                if t:
                    if t not in anomaly_times:
                        anomaly_times[t] = []
                    anomaly_times[t].append(f"{p['panel_info']}/{m['metric_name']}")

    correlated = []
    for t, metrics_at_t in anomaly_times.items():
        if len(metrics_at_t) >= 2:
            correlated.append({
                "time": t,
                "metrics": metrics_at_t,
                "desc": f"{t} 有 {len(metrics_at_t)} 个指标同时异常: {', '.join(metrics_at_t[:5])}",
            })

    analysis = {
        "overview": {
            "dashboard_time": dashboard_time,
            "total_metrics": total_queries,
            "success": success_results,
            "failed": failed_results,
            "failed_summary": failed_summary,
            "health": health,
            "warning_count": warning_count,
            "key_findings": key_findings[:10],
            "top_anomalies": top_anomalies,
            "instance_health": instance_health_list,
            "correlated_anomalies": correlated[:5],
        },
        "panels": all_panel_analyses,
    }
    return analysis


# ─── Main ───

def main():
    parser = argparse.ArgumentParser(
        description="Dashboard 分析脚本 - 调用 monitor-dashboard 接口",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--action", required=True,
        choices=[
            "DescribeUnifyDashboards",
            "DescribeUnifyDashboard",
            "ExtractInstances",
            "DescribeDashboardMetricData",
            "SplitResults",
            "BulkAnalysis",
            "GenerateURLs",
        ],
        help="调用的接口 Action",
    )
    parser.add_argument("--uuid", help="Dashboard UUID（DescribeUnifyDashboard 时必填）")
    parser.add_argument("--uuid-list", help="多个 Dashboard UUID，逗号分隔（BulkAnalysis 时使用）")
    parser.add_argument("--query-file", help="Dashboard 配置/结果文件路径")
    parser.add_argument("--start-time", help="查询开始时间（ISO 8601），默认最近 3 小时")
    parser.add_argument("--end-time", help="查询结束时间（ISO 8601），默认当前时间")
    parser.add_argument("--region", default="ap-guangzhou", help="地域（默认: ap-guangzhou）")
    parser.add_argument("--dashboard-list", help="Dashboard 列表文件路径（BulkAnalysis 时用于查找 CUSTOM 副本）")
    parser.add_argument("--max-instances", type=int, default=3,
                        help="每个模板变量最多取多少个实例（默认 3，传 0 表示全部）")
    parser.add_argument("--instance-filter",
                        help="只查指定实例（逗号分隔的实例 ID，如 ins-xxx,disk-yyy），优先于 --max-instances")
    parser.add_argument("--output", required=True, help="输出文件/目录路径")
    args = parser.parse_args()

    # ── DescribeUnifyDashboards ──
    if args.action == "DescribeUnifyDashboards":
        print("正在获取 Dashboard 列表 ...")
        response = describe_dashboards(region=args.region)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(response, f, ensure_ascii=False, indent=2)
        # 展示列表
        resp_data = response.get("Response", response)
        dashboards = resp_data.get("Dashboards", [])
        print(f"✅ 共找到 {len(dashboards)} 个 Dashboard")
        for d in dashboards:
            title = d.get("Title", d.get("title", "未知"))
            uid = d.get("UUID", d.get("uuid", ""))
            print(f"   - [{uid}] {title}")
        print(f"   结果已保存到: {args.output}")

    # ── DescribeUnifyDashboard ──
    elif args.action == "DescribeUnifyDashboard":
        if not args.uuid:
            print("错误：DescribeUnifyDashboard 需要 --uuid 参数", file=sys.stderr)
            sys.exit(1)
        print(f"正在获取 Dashboard 配置: {args.uuid} ...")
        response = describe_dashboard(args.uuid, region=args.region)
        inst_filter = set(args.instance_filter.split(",")) if args.instance_filter else None
        panels = extract_queries_from_dashboard(response, max_instances=args.max_instances, instance_filter=inst_filter)
        result = {
            "dashboard_uuid": args.uuid,
            "raw_response": response,
            "panels": panels,
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"✅ Dashboard 配置已保存到: {args.output}")
        print(f"   共找到 {len(panels)} 个面板")
        tmpl_count = 0
        normal_count = 0
        for p in panels:
            t = sum(1 for q in p["query_params"] if q.get("__is_templating__"))
            n = len(p["query_params"]) - t
            tmpl_count += t
            normal_count += n
            tag = " [模板]" if t > 0 else ""
            print(f"   - {p['panel_info']}: {len(p['query_params'])} 个指标{tag}")
        if tmpl_count > 0:
            print(f"\n   📋 模板面板: {tmpl_count} 个, 普通面板: {normal_count} 个")
            print(f"   💡 模板面板需要 CUSTOM 副本（Templating.Selected 有值）才能查询")

    # ── ExtractInstances: 提取实例列表写到文件 ──
    elif args.action == "ExtractInstances":
        if not args.uuid:
            print("错误：ExtractInstances 需要 --uuid 参数", file=sys.stderr)
            sys.exit(1)
        print(f"正在提取 Dashboard 实例列表: {args.uuid} ...")
        response = describe_dashboard(args.uuid, region=args.region)
        data, panels_raw, templating_list = parse_dashboard_data(response)
        templating_map = parse_templating(templating_list)
        instances_info = extract_instances_info(templating_map)

        # 写文件
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(instances_info, f, ensure_ascii=False, indent=2)

        print(f"✅ 实例列表已保存到: {args.output}")
        for var in instances_info["templating_variables"]:
            print(f"   - {var['label']}: {var['count']} 个实例")
            for inst in var["instances"][:3]:
                inst_id = inst.get("InstanceId", inst.get("DiskId", inst.get("diskId", "?")))
                inst_name = inst.get("InstanceName", inst.get("DiskName", ""))
                name_str = f" ({inst_name})" if inst_name else ""
                print(f"     {inst_id}{name_str}")
            if var["count"] > 3:
                print(f"     ... 共 {var['count']} 个")

    # ── DescribeDashboardMetricData ──
    elif args.action == "DescribeDashboardMetricData":
        if not args.query_file:
            print("错误：需要 --query-file 参数（Dashboard 配置文件）", file=sys.stderr)
            sys.exit(1)
        with open(args.query_file, "r", encoding="utf-8") as f:
            config_data = json.load(f)
        panels = config_data.get("panels", [])
        total_queries = sum(len(p.get("query_params", [])) for p in panels)
        print(f"正在批量查询 {len(panels)} 个面板共 {total_queries} 个指标 ...")
        result = query_metric_data(
            panels, args.start_time, args.end_time,
            region=args.region,
        )
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"✅ 指标数据已保存到: {args.output}")
        print(f"   查询时间: {result.get('dashboard_query_time', '')}")
        print(f"   总查询数: {result.get('total_queries', 0)}")
        print(f"   返回结果数: {result.get('total_results', 0)}")
        if result.get("skipped_templating", 0) > 0:
            print(f"   跳过模板面板: {result['skipped_templating']} 个")

    # ── SplitResults ──
    elif args.action == "SplitResults":
        if not args.query_file:
            print("错误：需要 --query-file 参数（指标结果文件）", file=sys.stderr)
            sys.exit(1)
        with open(args.query_file, "r", encoding="utf-8") as f:
            metric_results = json.load(f)
        print("正在拆分指标数据（V2 格式）...")
        files, metric_summary = split_results(metric_results, args.output)
        print(f"✅ 已拆分 {len(files)} 个指标文件到: {args.output}")
        for filepath in files:
            print(f"   - {os.path.basename(filepath)}")
        # 输出文件信息供后续使用
        if files:
            print(f"\n拆分结果文件:")
            print(f"  文件列表: {' '.join(files)}")
            print(f"  指标摘要: {json.dumps(metric_summary, ensure_ascii=False)}")
            # 如果有实例名映射
            instance_names = metric_results.get("instance_names", {})
            if instance_names:
                print(f"  实例映射: '{json.dumps(instance_names, ensure_ascii=False)}'")

    # ── BulkAnalysis: 批量多 Dashboard 拉配置+查指标+写到临时目录 ──
    elif args.action == "BulkAnalysis":
        # 支持两种输入方式：--uuid-list 或 --uuid（单个也兼容）
        uuid_list = []
        if args.uuid_list:
            uuid_list = [u.strip() for u in args.uuid_list.split(",") if u.strip()]
        elif args.uuid:
            uuid_list = [args.uuid.strip()]
        else:
            print("错误：BulkAnalysis 需要 --uuid-list 或 --uuid 参数", file=sys.stderr)
            sys.exit(1)

        # 输出到 <output>/latest/ 子目录，运行前清空
        output_dir = os.path.join(args.output, "latest")
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)

        print(f"========================================")
        print(f"批量 Dashboard 分析")
        print(f"  Dashboard 数量: {len(uuid_list)}")
        print(f"  UUID 列表: {', '.join(uuid_list)}")
        print(f"  输出目录: {output_dir}")
        print(f"  Region: {args.region}")
        print(f"========================================\n")

        # ── Phase 0: 对 PRESET 面板自动查找 CUSTOM 副本（有 Selected 实例） ──
        dashboard_list_data = None
        if args.dashboard_list and os.path.exists(args.dashboard_list):
            with open(args.dashboard_list, "r", encoding="utf-8") as f:
                dashboard_list_data = json.load(f)

        if dashboard_list_data:
            all_dashboards = dashboard_list_data.get("Response", {}).get("Dashboards", [])
            # 建立 UUID → Dashboard 索引
            uuid_to_dash = {d["UUID"]: d for d in all_dashboards}
            # 建立 Title(小写) → [CUSTOM Dashboard] 索引
            title_to_customs = {}
            for d in all_dashboards:
                if d.get("Type") == "CUSTOM" and not d.get("IsFolder"):
                    key = d.get("Title", "").strip().lower()
                    if key not in title_to_customs:
                        title_to_customs[key] = []
                    title_to_customs[key].append(d)

            resolved_uuids = []
            for uid in uuid_list:
                dash = uuid_to_dash.get(uid, {})
                if dash.get("Type") == "PRESET":
                    preset_title = dash.get("Title", "").strip().lower()
                    # 标准化：去空格用于模糊比较
                    preset_title_norm = preset_title.replace(" ", "").replace("　", "")
                    # 查找同名或近似名的 CUSTOM 副本
                    custom_match = None
                    # 精确匹配
                    if preset_title in title_to_customs:
                        custom_match = title_to_customs[preset_title][0]
                    # 标准化匹配（去空格、统一大小写）
                    if not custom_match:
                        for ctitle, clist in title_to_customs.items():
                            ctitle_norm = ctitle.replace(" ", "").replace("　", "")
                            if ctitle_norm == preset_title_norm:
                                custom_match = clist[0]
                                break
                    # 模糊匹配：CUSTOM 标题去掉"（复制）"后匹配
                    if not custom_match:
                        for ctitle, clist in title_to_customs.items():
                            clean = ctitle.replace("（复制）", "").replace("（复制1）", "").strip()
                            clean_norm = clean.replace(" ", "").replace("　", "")
                            if clean_norm == preset_title_norm:
                                custom_match = clist[0]
                                break

                    if custom_match:
                        old_uid = uid
                        new_uid = custom_match["UUID"]
                        print(f"  🔄 PRESET [{old_uid}] → CUSTOM [{new_uid}] \"{custom_match['Title']}\"")
                        resolved_uuids.append(new_uid)
                    else:
                        resolved_uuids.append(uid)
                        print(f"  ℹ️  PRESET [{uid}] \"{dash.get('Title', '')}\" 无 CUSTOM 副本，模板面板将被跳过")
                else:
                    resolved_uuids.append(uid)

            uuid_list = resolved_uuids

        # ── Phase 1: 并行拉取所有 Dashboard 配置 ──
        print("Phase 1: 拉取 Dashboard 配置 ...")
        dashboard_configs = {}  # uuid → {config, panels, title}
        failed_uuids = []

        inst_filter = set(args.instance_filter.split(",")) if args.instance_filter else None

        def fetch_one_dashboard(uid):
            """拉取单个 Dashboard 配置"""
            resp = describe_dashboard(uid, region=args.region)
            data, panels_raw, templating_list = parse_dashboard_data(resp)
            templating_map = parse_templating(templating_list)
            instances_info = extract_instances_info(templating_map)
            resolved = resolve_instances(templating_map, instance_filter=inst_filter, max_instances=args.max_instances)
            panels = build_panel_queries(panels_raw, resolved)
            title = data.get("title", data.get("Title", uid)) if data else uid
            return uid, resp, panels, title, instances_info

        with ThreadPoolExecutor(max_workers=3) as executor:
            future_to_uuid = {
                executor.submit(fetch_one_dashboard, uid): uid
                for uid in uuid_list
            }
            for future in as_completed(future_to_uuid):
                uid = future_to_uuid[future]
                try:
                    uid, resp, panels, title, instances_info = future.result()
                    dashboard_configs[uid] = {
                        "raw_response": resp,
                        "panels": panels,
                        "title": title,
                        "instances_info": instances_info,
                    }
                    panel_count = len(panels)
                    query_count = sum(len(p.get("query_params", [])) for p in panels)
                    print(f"  ✅ [{uid}] {title} - {panel_count} 个面板, {query_count} 个指标")
                except Exception as e:
                    failed_uuids.append(uid)
                    print(f"  ❌ [{uid}] 拉取失败: {e}")

        if failed_uuids:
            print(f"\n  ⚠️  {len(failed_uuids)} 个 Dashboard 拉取失败: {', '.join(failed_uuids)}")

        if not dashboard_configs:
            print("错误：所有 Dashboard 拉取失败，无法继续", file=sys.stderr)
            sys.exit(1)

        print(f"\nPhase 1 完成: 成功 {len(dashboard_configs)}/{len(uuid_list)} 个\n")

        # ── Phase 2: 逐个 Dashboard 查询指标数据并写到目录 ──
        print("Phase 2: 逐个 Dashboard 查询指标数据 ...")
        summary = {
            "total_dashboards": len(uuid_list),
            "success_dashboards": 0,
            "failed_dashboards": len(failed_uuids),
            "dashboards": [],
        }

        for idx, (uid, config) in enumerate(dashboard_configs.items()):
            title = config["title"]
            panels = config["panels"]
            dash_dir = os.path.join(output_dir, uid)
            os.makedirs(dash_dir, exist_ok=True)

            print(f"\n--- [{idx+1}/{len(dashboard_configs)}] {title} ({uid}) ---")

            # 保存 Dashboard 配置
            config_path = os.path.join(dash_dir, "dashboard_config.json")
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump({
                    "dashboard_uuid": uid,
                    "dashboard_title": title,
                    "raw_response": config["raw_response"],
                    "panels": panels,
                }, f, ensure_ascii=False, indent=2)

            # 保存实例列表（供 AI 展示给用户选择）
            instances_path = os.path.join(dash_dir, "instances.json")
            with open(instances_path, "w", encoding="utf-8") as f:
                json.dump(config.get("instances_info", {}), f, ensure_ascii=False, indent=2)

            # 查询指标数据
            total_queries = sum(len(p.get("query_params", [])) for p in panels)
            if total_queries == 0:
                print(f"  跳过：无有效指标查询")
                summary["dashboards"].append({
                    "uuid": uid,
                    "title": title,
                    "console_url": generate_dashboard_url(uid, title),
                    "dir": dash_dir,
                    "status": "skipped",
                    "reason": "无有效指标查询",
                    "panel_count": 0,
                    "query_count": 0,
                })
                continue

            try:
                metric_result = query_metric_data(
                    panels, args.start_time, args.end_time,
                    region=args.region,
                )

                # 保存指标数据（完整结果）
                metric_path = os.path.join(dash_dir, "metric_results.json")
                with open(metric_path, "w", encoding="utf-8") as f:
                    json.dump(metric_result, f, ensure_ascii=False, indent=2)

                # 同时拆分为独立文件，方便 AI 逐个读取（V2 格式：压缩 + sparkline）
                split_dir = os.path.join(dash_dir, "metrics")
                files, metric_summary = split_results(metric_result, split_dir)

                # 生成分析摘要
                analysis = analyze_results(metric_result, split_dir)
                analysis_path = os.path.join(dash_dir, "analysis.json")
                with open(analysis_path, "w", encoding="utf-8") as f:
                    json.dump(analysis, f, ensure_ascii=False, indent=2)

                # 数据规模判断
                result_count = metric_result.get("total_results", 0)
                if result_count < 100:
                    data_scale = "small"
                elif result_count < 500:
                    data_scale = "medium"
                else:
                    data_scale = "large"

                # 保存该 Dashboard 的摘要信息
                dash_summary = {
                    "uuid": uid,
                    "title": title,
                    "console_url": generate_dashboard_url(uid, title),
                    "dir": dash_dir,
                    "status": "success",
                    "panel_count": len(panels),
                    "query_count": total_queries,
                    "result_count": result_count,
                    "data_scale": data_scale,
                    "skipped_templating": metric_result.get("skipped_templating", 0),
                    "metric_files": [os.path.basename(f) for f in files],
                    "metric_summary": metric_summary,
                    "instance_names": metric_result.get("instance_names", {}),
                    "query_time": metric_result.get("dashboard_query_time", ""),
                }
                summary["dashboards"].append(dash_summary)
                summary["success_dashboards"] += 1

                # 保存该 Dashboard 的独立摘要
                dash_summary_path = os.path.join(dash_dir, "summary.json")
                with open(dash_summary_path, "w", encoding="utf-8") as f:
                    json.dump(dash_summary, f, ensure_ascii=False, indent=2)

                print(f"  ✅ 查询完成: {metric_result.get('total_results', 0)} 条结果, "
                      f"{len(files)} 个指标文件")

            except Exception as e:
                print(f"  ❌ 查询失败: {e}")
                summary["dashboards"].append({
                    "uuid": uid,
                    "title": title,
                    "console_url": generate_dashboard_url(uid, title),
                    "dir": dash_dir,
                    "status": "failed",
                    "reason": str(e),
                    "panel_count": len(panels),
                    "query_count": total_queries,
                })

        # ── Phase 3: 写入总摘要 ──
        summary_path = os.path.join(output_dir, "bulk_summary.json")
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)

        print(f"\n========================================")
        print(f"✅ 批量分析完成")
        print(f"  成功: {summary['success_dashboards']}/{len(uuid_list)}")
        print(f"  输出目录: {output_dir}")
        print(f"  总摘要: {summary_path}")
        print(f"========================================")
        print(f"\n目录结构:")
        print(f"  {output_dir}/")
        print(f"  ├── bulk_summary.json          # 总摘要（AI 应先读这个文件）")
        for dash in summary["dashboards"]:
            d = os.path.basename(dash.get("dir", ""))
            status = "✅" if dash.get("status") == "success" else "❌"
            print(f"  ├── {d}/")
            print(f"  │   ├── summary.json           # {status} Dashboard 摘要")
            print(f"  │   ├── dashboard_config.json   # 面板配置")
            print(f"  │   ├── metric_results.json     # 指标数据（完整）")
            print(f"  │   └── metrics/                # 拆分后的独立指标文件")

    # ── GenerateURLs: 根据 Dashboard 列表生成控制台跳转链接 ──
    elif args.action == "GenerateURLs":
        if not args.dashboard_list:
            print("错误：GenerateURLs 需要 --dashboard-list 参数", file=sys.stderr)
            sys.exit(1)

        uuid_list = None
        if args.uuid_list:
            uuid_list = [u.strip() for u in args.uuid_list.split(",") if u.strip()]
        elif args.uuid:
            uuid_list = [args.uuid.strip()]

        results = generate_urls_from_list(args.dashboard_list, uuid_list=uuid_list)

        # 输出到文件
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        print(f"✅ 已生成 {len(results)} 个 Dashboard 链接")
        for r in results:
            print(f"   - [{r['type']:7s}] {r['title']}")
            print(f"     {r['url']}")
        print(f"\n   结果已保存到: {args.output}")


if __name__ == "__main__":
    main()
