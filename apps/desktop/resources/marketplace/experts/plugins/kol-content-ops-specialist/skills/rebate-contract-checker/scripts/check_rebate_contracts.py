#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebate Contract Checker - Core reconciliation script
Usage:
    python check_rebate_contracts.py \
        --invoice-folder /path/to/invoices/ \
        --contract-folder /path/to/contracts/ \
        --plan-folder /path/to/plans/ \
        --output /path/to/output.xlsx

Or as a module:
    from check_rebate_contracts import RebateContractChecker
    checker = RebateContractChecker()
    results = checker.batch_check(invoice_folder, contract_folder, plan_folder)
    checker.save_results(results, output_path)
"""
import pandas as pd
import pdfplumber
import re
import os
import glob
import argparse
from pathlib import Path
from collections import defaultdict


class RebateContractChecker:
    """
    Cross-checks invoice applications, rebate contracts, and project plans.
    """

    # Default column mapping for invoice Excel
    DEFAULT_COLUMN_MAP = {
        '店铺名称（必填）': '项目',
        '服务项目名称（必填）': '服务项目名称',
        '发票抬头': '发票抬头',
        '税号': '税号',
        '开票金额': '开票金额',
        '发票类型': '发票类型',
        '开票内容': '开票内容',
        '地址电话': '地址电话',
        '开户行及账号': '开户行及账号',
    }

    # Default plan sheet name
    DEFAULT_PLAN_SHEET = '推广计划单-立项及结案PM更新'

    def __init__(self, column_map=None, plan_sheet=None):
        self.column_map = column_map or self.DEFAULT_COLUMN_MAP.copy()
        self.plan_sheet = plan_sheet or self.DEFAULT_PLAN_SHEET

    def parse_invoice_excel(self, filepath):
        """Parse invoice application Excel and extract records."""
        df = pd.read_excel(filepath, sheet_name=0)
        records = []
        for _, row in df.iterrows():
            if pd.isna(row.get('发票抬头')):
                continue
            invoice_title = str(row.get('发票抬头', '')).replace('\n', ' ').strip()
            invoice_title = re.sub(r'\s*税\s*号\s*[:：].*$', '', invoice_title).strip()
            tax_id = str(row.get('税号', '')).replace('\n', ' ').strip() if pd.notna(row.get('税号')) else ''
            records.append({
                '来源文件': os.path.basename(filepath),
                '项目': str(row.get('店铺名称（必填）', '')).strip(),
                '服务项目名称': str(row.get('服务项目名称（必填）', '')).strip(),
                '发票抬头': invoice_title,
                '税号': tax_id,
                '开票金额': float(row.get('开票金额', 0)) if pd.notna(row.get('开票金额')) else 0,
                '发票类型': str(row.get('发票类型', '')).strip(),
                '开票内容': str(row.get('开票内容', '')).strip(),
                '地址电话': str(row.get('地址电话', '')).replace('\n', ' ').strip() if pd.notna(row.get('地址电话')) else '',
                '开户行及账号': str(row.get('开户行及账号', '')).replace('\n', ' ').strip() if pd.notna(row.get('开户行及账号')) else '',
            })
        return records

    def parse_pdf_contract(self, filepath):
        """Parse rebate contract PDF and extract key info."""
        data = {
            '来源文件': os.path.basename(filepath),
            '甲方名称': '', '税号': '', '地址': '', '开户行': '', '银行账号': '',
            '渠道服务费金额': 0, '发票类型': '', '开票内容': '', '博主列表': []
        }
        with pdfplumber.open(filepath) as pdf:
            full_text = ''
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + '\n'

        match = re.search(r'甲方[：:]\s*([^\n]+)', full_text)
        if match:
            data['甲方名称'] = match.group(1).strip()

        match = re.search(r'税\s*号[：:]\s*([A-Z0-9]+)', full_text)
        if not match:
            match = re.search(r'纳税人识别号[：:]\s*([A-Z0-9]+)', full_text)
        if match:
            data['税号'] = match.group(1).strip()

        match = re.search(r'联系地址[：:]\s*([^\n]+)', full_text)
        if match:
            data['地址'] = match.group(1).strip()

        match = re.search(r'支付全款[：:]?\s*¥\s*([\d,]+\.?\d*)', full_text)
        if not match:
            match = re.search(r'渠道服务费金额.*?¥\s*([\d,]+\.?\d*)', full_text)
        if match:
            data['渠道服务费金额'] = float(match.group(1).replace(',', ''))

        if '增值税普通发票' in full_text or '普通发票' in full_text:
            data['发票类型'] = '普通发票'
        elif '增值税专用发票' in full_text or '专用发票' in full_text:
            data['发票类型'] = '专用发票'

        match = re.search(r'开票内容[：:]\s*【([^】]+)】', full_text)
        if not match:
            match = re.search(r'开票内容[：:]\s*([^\n]+)', full_text)
        if match:
            content = match.group(1).strip()
            content = content.replace('生产生\n1/2\n活服务', '生产生活服务').replace('\n', ' ')
            data['开票内容'] = content

        match = re.search(r'开户银行[：:]\s*([^\n]+)', full_text)
        if match:
            data['开户行'] = match.group(1).strip()

        match = re.search(r'银行账号[：:]\s*([\d\s]+)', full_text)
        if match:
            data['银行账号'] = match.group(1).strip().replace(' ', '').replace('\n', '')

        with pdfplumber.open(filepath) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    header = [str(c).strip() if c else '' for c in table[0]]
                    header_str = ' '.join(header)
                    if '账号' in header_str and ('渠道服务费' in header_str or '合作金额' in header_str):
                        for row in table[1:]:
                            if len(row) >= 2 and row[1] and str(row[1]).strip():
                                blogger_name = str(row[1]).strip()
                                coop_amount = 0
                                fee_amount = 0
                                for cell in row:
                                    if cell and '¥' in str(cell):
                                        amounts = re.findall(r'¥\s*([\d,]+\.?\d*)', str(cell))
                                        for amt in amounts:
                                            val = float(amt.replace(',', ''))
                                            if coop_amount == 0:
                                                coop_amount = val
                                            elif fee_amount == 0:
                                                fee_amount = val
                                data['博主列表'].append({
                                    '博主名称': blogger_name,
                                    '合作金额': coop_amount,
                                    '渠道服务费': fee_amount
                                })
        return data

    def parse_plan_settlement(self, filepath):
        """
        Parse the bottom-right settlement area of a project plan Excel.
        Extracts blogger names and rebate amounts from the area after "支出小计".
        """
        xl = pd.ExcelFile(filepath)
        sheet_name = self.plan_sheet
        if sheet_name not in xl.sheet_names:
            return []

        df = pd.read_excel(filepath, sheet_name=sheet_name, header=None)

        start_row = None
        for i in range(len(df)):
            for j in range(min(15, len(df.columns))):
                val = df.iloc[i, j]
                if val and isinstance(val, str) and '支出小计' in val:
                    start_row = i + 1
                    break
            if start_row is not None:
                break

        if start_row is None:
            return []

        end_row = len(df)
        for i in range(start_row, len(df)):
            for j in range(min(15, len(df.columns))):
                val = df.iloc[i, j]
                if val and isinstance(val, str) and ('返点小计' in val or '支出合计' in val or '最终结算收入' in val):
                    end_row = i
                    break
            if end_row < len(df):
                break

        bloggers = []
        for i in range(start_row, end_row):
            blogger_name = df.iloc[i, 15] if len(df.columns) > 15 else None
            rebate_amount = df.iloc[i, 16] if len(df.columns) > 16 else None
            payment_type = df.iloc[i, 14] if len(df.columns) > 14 else None
            date_val = df.iloc[i, 13] if len(df.columns) > 13 else None
            rebate_amount_2 = df.iloc[i, 18] if len(df.columns) > 18 else None

            if blogger_name and pd.notna(blogger_name) and str(blogger_name).strip():
                name = str(blogger_name).strip()
                if '小计' in name or '合计' in name or '最终' in name or '支出' in name:
                    continue

                amount = 0
                if rebate_amount and pd.notna(rebate_amount):
                    try:
                        amount = float(rebate_amount)
                    except (ValueError, TypeError):
                        amount = 0
                if amount == 0 and rebate_amount_2 and pd.notna(rebate_amount_2):
                    try:
                        amount = float(rebate_amount_2)
                    except (ValueError, TypeError):
                        amount = 0

                bloggers.append({
                    '博主名称': name,
                    '计划单返点金额': round(amount, 2),
                    '付款方式': str(payment_type).strip() if payment_type and pd.notna(payment_type) else '',
                    '日期': str(date_val).strip() if date_val and pd.notna(date_val) else '',
                    '来源文件': os.path.basename(filepath),
                })
        return bloggers

    def match_invoice_to_contract(self, invoice_records, contracts):
        """Match invoice records to contracts and prepare result rows."""
        results = []
        for inv in invoice_records:
            matched = False
            for contract_name, contract in contracts.items():
                if inv['发票抬头'] == contract['甲方名称']:
                    amount_match = abs(inv['开票金额'] - contract['渠道服务费金额']) < 1
                    type_match = inv['发票类型'] == contract['发票类型']
                    tax_match = inv['税号'] == contract['税号']

                    if contract['博主列表']:
                        for blogger in contract['博主列表']:
                            results.append(self._create_result_row(inv, contract, blogger, amount_match, type_match, tax_match))
                    else:
                        results.append(self._create_result_row(inv, contract, None, amount_match, type_match, tax_match))
                    matched = True
                    break

            if not matched:
                results.append(self._create_unmatched_row(inv))
        return results

    def _create_result_row(self, inv, contract, blogger, amount_match, type_match, tax_match):
        """Create a single result row for a matched invoice-contract pair."""
        return {
            '开票来源文件': inv['来源文件'],
            '所属项目': inv['项目'],
            '服务项目名称': inv['服务项目名称'],
            '发票抬头': inv['发票抬头'],
            '税号': inv['税号'],
            '开票金额': inv['开票金额'],
            '发票类型': inv['发票类型'],
            '开票内容': inv['开票内容'],
            '博主名称': blogger['博主名称'] if blogger else 'N/A',
            '返点协议合作金额': blogger['合作金额'] if blogger else 0,
            '返点协议渠道服务费': blogger['渠道服务费'] if blogger else 0,
            '对应返点协议': contract['来源文件'],
            '协议甲方名称': contract['甲方名称'],
            '协议税号': contract['税号'],
            '协议金额': contract['渠道服务费金额'],
            '协议发票类型': contract['发票类型'],
            '协议开票内容': contract['开票内容'],
            '金额是否一致': '是' if amount_match else '否',
            '发票类型是否一致': '是' if type_match else '否',
            '税号是否一致': '是' if tax_match else '否',
            '开票内容是否一致': '是' if inv['开票内容'] == contract['开票内容'] else '否',
            '计划单返点金额': 0,
            '计划单来源文件': '',
            '计划单付款方式': '',
            '计划单日期': '',
            '博主金额是否一致': 'N/A',
            '重复博主标记': '',
            '核对结果': '待核对',
        }

    def _create_unmatched_row(self, inv):
        """Create a result row for an invoice with no matching contract."""
        return {
            '开票来源文件': inv['来源文件'],
            '所属项目': inv['项目'],
            '服务项目名称': inv['服务项目名称'],
            '发票抬头': inv['发票抬头'],
            '税号': inv['税号'],
            '开票金额': inv['开票金额'],
            '发票类型': inv['发票类型'],
            '开票内容': inv['开票内容'],
            '博主名称': 'N/A',
            '返点协议合作金额': 0,
            '返点协议渠道服务费': 0,
            '对应返点协议': '未找到',
            '协议甲方名称': 'N/A',
            '协议税号': 'N/A',
            '协议金额': 0,
            '协议发票类型': 'N/A',
            '协议开票内容': 'N/A',
            '金额是否一致': 'N/A',
            '发票类型是否一致': 'N/A',
            '税号是否一致': 'N/A',
            '开票内容是否一致': 'N/A',
            '计划单返点金额': 0,
            '计划单来源文件': '',
            '计划单付款方式': '',
            '计划单日期': '',
            '博主金额是否一致': 'N/A',
            '重复博主标记': '',
            '核对结果': '未找到对应返点协议',
        }

    def enrich_with_plan_data(self, results, plan_blogger_data):
        """Enrich results with plan settlement data and flag duplicate bloggers."""
        blogger_plan_count = defaultdict(list)
        for plan_file, bloggers in plan_blogger_data.items():
            for b in bloggers:
                blogger_plan_count[b['博主名称']].append((plan_file, b['计划单返点金额'], b['付款方式'], b['日期']))

        duplicate_bloggers = {name for name, entries in blogger_plan_count.items() if len(entries) > 1}

        for r in results:
            blogger_name = r['博主名称']
            if blogger_name == 'N/A':
                continue

            found = False
            for plan_file, bloggers in plan_blogger_data.items():
                for b in bloggers:
                    if b['博主名称'] == blogger_name:
                        r['计划单返点金额'] = b['计划单返点金额']
                        r['计划单来源文件'] = b['来源文件']
                        r['计划单付款方式'] = b['付款方式']
                        r['计划单日期'] = b['日期']

                        if r['返点协议渠道服务费'] > 0 and b['计划单返点金额'] > 0:
                            if abs(r['返点协议渠道服务费'] - b['计划单返点金额']) < 1:
                                r['博主金额是否一致'] = '是'
                            else:
                                diff = round(r['返点协议渠道服务费'] - b['计划单返点金额'], 2)
                                r['博主金额是否一致'] = f'否（差异{diff}）'
                        else:
                            r['博主金额是否一致'] = 'N/A（协议或计划单金额为空）'

                        if blogger_name in duplicate_bloggers:
                            plans = blogger_plan_count[blogger_name]
                            plan_names = [p[0] for p in plans]
                            amounts = [p[1] for p in plans]
                            r['重复博主标记'] = f'⚠️ 出现在{len(plans)}个计划单中: {plan_names} 金额: {amounts}'

                        found = True
                        break
                if found:
                    break

            if not found:
                r['博主金额是否一致'] = 'N/A（计划单中未找到该博主）'

        return results

    def determine_final_result(self, r):
        """Determine the final verification result for a row."""
        if r['对应返点协议'] == '未找到':
            return '⚠️ 未找到对应返点协议'

        checks = []
        if r['金额是否一致'] == '否':
            checks.append('开票金额不一致')
        if r['发票类型是否一致'] == '否':
            checks.append('发票类型不一致')
        if r['税号是否一致'] == '否':
            checks.append('税号不一致')
        if r['开票内容是否一致'] == '否':
            checks.append('开票内容不一致')
        if r['博主金额是否一致'] and r['博主金额是否一致'].startswith('否'):
            checks.append('博主返点金额与协议不一致')
        if r['博主金额是否一致'] and '未找到' in r['博主金额是否一致']:
            checks.append('计划单中未找到该博主')
        if r['博主金额是否一致'] and '为空' in r['博主金额是否一致']:
            checks.append('金额数据缺失')

        if not checks:
            return '✅ 核对通过'
        else:
            return '❌ ' + '；'.join(checks)

    def check(self, invoice_files=None, contract_files=None, plan_files=None):
        """
        Run the full reconciliation check on specified files.

        Args:
            invoice_files: List of paths to invoice Excel files
            contract_files: List of paths to contract PDF files
            plan_files: List of paths to plan Excel files

        Returns:
            List of result dictionaries
        """
        # Parse all documents
        all_invoice_records = []
        if invoice_files:
            for f in invoice_files:
                all_invoice_records.extend(self.parse_invoice_excel(f))

        all_contracts = {}
        if contract_files:
            for f in contract_files:
                contract = self.parse_pdf_contract(f)
                all_contracts[os.path.basename(f)] = contract

        all_plan_data = {}
        if plan_files:
            for f in plan_files:
                all_plan_data[os.path.basename(f)] = self.parse_plan_settlement(f)

        # Match and enrich
        results = self.match_invoice_to_contract(all_invoice_records, all_contracts)
        results = self.enrich_with_plan_data(results, all_plan_data)

        for r in results:
            r['核对结果'] = self.determine_final_result(r)

        return results

    def batch_check(self, invoice_folder=None, contract_folder=None, plan_folder=None):
        """
        Batch process all files in specified folders.

        Args:
            invoice_folder: Path to folder containing invoice Excel files
            contract_folder: Path to folder containing contract PDF files
            plan_folder: Path to folder containing plan Excel files

        Returns:
            List of result dictionaries
        """
        invoice_files = glob.glob(os.path.join(invoice_folder, '*.xlsx')) if invoice_folder else []
        contract_files = glob.glob(os.path.join(contract_folder, '*.pdf')) if contract_folder else []
        plan_files = glob.glob(os.path.join(plan_folder, '*.xlsx')) if plan_folder else []
        return self.check(invoice_files=invoice_files, contract_files=contract_files, plan_files=plan_files)

    def save_results(self, results, output_path):
        """
        Save results to an Excel file with two sheets: 核对清单 and 核对摘要.

        Args:
            results: List of result dictionaries from check() or batch_check()
            output_path: Path to output Excel file
        """
        df = pd.DataFrame(results)
        output_cols = [
            '开票来源文件', '所属项目', '服务项目名称', '发票抬头', '税号', '开票金额', '发票类型', '开票内容',
            '博主名称', '返点协议合作金额', '返点协议渠道服务费',
            '对应返点协议', '协议甲方名称', '协议税号', '协议金额', '协议发票类型', '协议开票内容',
            '金额是否一致', '发票类型是否一致', '税号是否一致', '开票内容是否一致',
            '计划单返点金额', '计划单来源文件', '计划单付款方式', '计划单日期',
            '博主金额是否一致', '重复博主标记', '核对结果'
        ]
        df_output = df[output_cols]

        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            df_output.to_excel(writer, index=False, sheet_name='核对清单')

            summary = {
                '指标': ['总记录数', '核对通过', '核对不通过', '未找到协议'],
                '数量': [
                    len(results),
                    sum(1 for r in results if r['核对结果'].startswith('✅')),
                    sum(1 for r in results if r['核对结果'].startswith('❌')),
                    sum(1 for r in results if r['核对结果'].startswith('⚠️'))
                ]
            }
            pd.DataFrame(summary).to_excel(writer, index=False, sheet_name='核对摘要')

        print(f"Results saved to: {output_path}")
        return output_path


def main():
    parser = argparse.ArgumentParser(description='Rebate Contract Checker')
    parser.add_argument('--invoice-folder', help='Folder containing invoice Excel files')
    parser.add_argument('--contract-folder', help='Folder containing contract PDF files')
    parser.add_argument('--plan-folder', help='Folder containing plan Excel files')
    parser.add_argument('--output', '-o', default='返点协议核对清单.xlsx', help='Output Excel file path')
    parser.add_argument('--plan-sheet', default='推广计划单-立项及结案PM更新', help='Name of the plan Excel sheet to parse')
    args = parser.parse_args()

    if not (args.invoice_folder and args.contract_folder and args.plan_folder):
        print("Usage: python check_rebate_contracts.py --invoice-folder <path> --contract-folder <path> --plan-folder <path> --output <path>")
        return

    checker = RebateContractChecker(plan_sheet=args.plan_sheet)
    results = checker.batch_check(
        invoice_folder=args.invoice_folder,
        contract_folder=args.contract_folder,
        plan_folder=args.plan_folder
    )
    checker.save_results(results, args.output)

    print(f"\nVerification Summary:")
    print(f"  Total: {len(results)}")
    print(f"  Passed: {sum(1 for r in results if r['核对结果'].startswith('✅'))}")
    print(f"  Failed: {sum(1 for r in results if r['核对结果'].startswith('❌'))}")
    print(f"  Not Found: {sum(1 for r in results if r['核对结果'].startswith('⚠️'))}")


if __name__ == '__main__':
    main()
