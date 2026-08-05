#!/usr/bin/env python3
"""
小红书账号涨粉榜数据查询脚本
通过API接口获取榜单数据（使用原生socket + SSL，不发送SNI）
"""

import argparse
import json
import sys
import socket
import ssl
from urllib.parse import urlparse, urlencode, quote
from typing import List, Dict, Optional
from datetime import datetime, timedelta


class HTTPSClient:
    """原生HTTPS客户端（不发送SNI）"""
    
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
    
    def get(self, url: str, params: Optional[Dict] = None, headers: Optional[Dict] = None) -> Dict:
        """
        发送GET请求（不发送SNI）
        
        Args:
            url: 请求URL
            params: URL参数
            headers: 请求头
            
        Returns:
            解析后的JSON响应
        """
        # 构建完整URL
        if params:
            url = f"{url}?{urlencode(params)}"
        
        # 解析URL
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or 443
        path = parsed.path or '/'
        if parsed.query:
            path = f"{path}?{parsed.query}"
        
        # 创建socket连接
        sock = socket.create_connection((host, port), timeout=self.timeout)
        
        # 包装SSL上下文（不发送SNI）
        # 注意：这是数据源接口的要求，必须使用此方式才能正常访问
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        
        # 不传递server_hostname，这样就不会发送SNI（数据源接口要求）
        ssock = context.wrap_socket(sock, server_hostname=None)
        
        try:
            # 构建HTTP请求
            default_headers = {
                'Host': host,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.0 Edg/120.0.0.0',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Connection': 'close'
            }
            
            if headers:
                default_headers.update(headers)
            
            header_lines = '\r\n'.join([f"{k}: {v}" for k, v in default_headers.items()])
            request = f"GET {path} HTTP/1.1\r\n{header_lines}\r\n\r\n"
            
            # 发送请求
            ssock.send(request.encode('utf-8'))
            
            # 接收响应
            response = b''
            while True:
                chunk = ssock.recv(4096)
                if not chunk:
                    break
                response += chunk
            
            # 解析响应
            return self._parse_response(response)
            
        finally:
            ssock.close()
    
    def _parse_response(self, response: bytes) -> Dict:
        """解析HTTP响应"""
        # 分离头部和主体
        header_end = response.find(b'\r\n\r\n')
        if header_end == -1:
            raise ValueError("Invalid HTTP response")
        
        headers = response[:header_end].decode('utf-8', errors='ignore')
        body = response[header_end + 4:]
        
        # 检查是否分块传输
        if 'Transfer-Encoding: chunked' in headers:
            body = self._decode_chunked(body)
        
        # 尝试解析JSON
        try:
            return json.loads(body.decode('utf-8'))
        except json.JSONDecodeError:
            return {'raw': body.decode('utf-8', errors='ignore')}
    
    def _decode_chunked(self, data: bytes) -> bytes:
        """解码分块传输编码"""
        result = b''
        while data:
            line_end = data.find(b'\r\n')
            if line_end == -1:
                break
            
            chunk_size_hex = data[:line_end].decode('ascii').split(';')[0].strip()
            chunk_size = int(chunk_size_hex, 16)
            
            if chunk_size == 0:
                break
            
            chunk_start = line_end + 2
            chunk_end = chunk_start + chunk_size
            result += data[chunk_start:chunk_end]
            
            data = data[chunk_end + 2:]
        
        return result


class RankingAPIClient:
    """涨粉榜API客户端"""
    
    BASE_URL = "https://onetotenvip.com/story/hotSpot/getXhsRiseFansRank"
    
    # 日期类型映射
    DATE_TYPE_MAP = {
        'daily': 1,      # 日榜
        'weekly': 2,     # 周榜
        'monthly': 3     # 月榜
    }
    
    # 支持的类目列表（25个固定类目）
    VALID_CATEGORIES = [
        '综合全部',
        '出行代步',
        '医疗保健',
        '休闲爱好',
        '综合杂项',
        '婚庆婚礼',
        '居家装修',
        '影视娱乐',
        '星座情感',
        '拍摄记录',
        '学习教育',
        '旅行度假',
        '亲子育儿',
        '日常生活',
        '科学探索',
        '数码科技',
        '时尚穿搭',
        '化妆美容',
        '个人护理',
        '美味佳肴',
        '职业发展',
        '宠物天地',
        '新闻资讯',
        '体育锻炼',
        '潮流鞋包'
    ]
    
    # 单个类目数据上限
    MAX_LIMIT = 100
    
    # 数据查询范围限制
    QUERY_RANGE_LIMITS = {
        'daily': 30,      # 日榜最多查前30天
        'weekly': 8,      # 周榜最多查前8周
        'monthly': 3      # 月榜最多查前3个月
    }
    
    def __init__(self, source: str = "小红书飙升涨粉榜"):
        """
        初始化API客户端
        
        Args:
            source: 数据来源标识（默认：小红书涨粉榜）
        """
        self.source = source
        self.http_client = HTTPSClient()
    
    def validate_category(self, category: Optional[str]) -> tuple[bool, str]:
        """
        校验类目是否有效
        
        Args:
            category: 类目名称
            
        Returns:
            (是否有效, 错误信息)
        """
        if category is None:
            return True, ""
        
        if category not in self.VALID_CATEGORIES:
            valid_list = "、".join(self.VALID_CATEGORIES)
            return False, f"无效的类目'{category}'。仅支持以下25个类目：{valid_list}"
        
        return True, ""
    
    def validate_limit(self, limit: int) -> int:
        """
        校验并限制返回条数
        
        Args:
            limit: 请求的条数
            
        Returns:
            限制后的条数（最大100）
        """
        if limit > self.MAX_LIMIT:
            print(f"⚠️  请求条数{limit}超过上限{self.MAX_LIMIT}，已自动调整为{self.MAX_LIMIT}", file=sys.stderr)
            return self.MAX_LIMIT
        return limit
    
    def query_rankings(
        self,
        category: Optional[str] = None,
        stat_type: str = 'daily',
        stat_date: Optional[str] = None,
        limit: int = 20
    ) -> List[Dict]:
        """
        查询涨粉排行榜
        
        Args:
            category: 账号类型（如：化妆美容、穿搭、美食等），默认"综合全部"
            stat_type: 统计类型（daily/weekly/monthly）
            stat_date: 统计日期（YYYY-MM-DD），None表示昨天
            limit: 返回条数（最大100）
            
        Returns:
            排名数据列表
        """
        # 默认使用"综合全部"
        if category is None:
            category = '综合全部'
        
        # 校验类目
        is_valid, error_msg = self.validate_category(category)
        if not is_valid:
            print(f"❌ {error_msg}", file=sys.stderr)
            return []
        
        # 校验并限制条数
        limit = self.validate_limit(limit)
        
        # 构建请求参数（必须传递category）
        params = {
            'dateType': self.DATE_TYPE_MAP.get(stat_type, 1),
            'source': self.source,
            'category': category
        }
        
        if stat_date:
            params['rankDate'] = stat_date
        else:
            # 默认使用前天日期（数据有1天延迟：4月20日10点只能获取4月18日数据）
            # 因为榜单每日7点发布，发布的是前一天的完整数据
            default_date = (datetime.now() - timedelta(days=2)).strftime('%Y-%m-%d')
            params['rankDate'] = default_date
        
        try:
            data = self.http_client.get(self.BASE_URL, params=params)
            
            # 解析返回数据
            if data.get('code') == 2000 and 'data' in data:
                rankings = self._parse_response(data, limit)
                return rankings
            else:
                print(f"API Error: {data.get('msg', 'Unknown error')}", file=sys.stderr)
                return []
                
        except Exception as e:
            print(f"Request failed: {e}", file=sys.stderr)
            return []
    
    def _parse_response(self, data: Dict, limit: int) -> List[Dict]:
        """
        解析API返回数据
        
        实际返回字段：
        - ranking: 排名
        - nickname: 账号名称
        - category: 账号类型
        - followers: 粉丝数
        - followersGrowth: 涨粉数
        - growthRate: 涨粉率
        - avatar: 头像URL
        - date: 统计日期
        - platformId: 平台ID
        - primaryCategory: 一级分类
        - secondaryCategory: 二级分类
        - verifyType: 认证类型
        """
        rankings = []
        items = data.get('data', [])
        
        if not items or not isinstance(items, list):
            return rankings
        
        for item in items[:limit]:
            if not isinstance(item, dict):
                continue
                
            ranking = {
                'ranking': item.get('ranking', 0),
                'account_id': item.get('platformId') or item.get('userId') or '',
                'account_name': item.get('nickname') or 'Unknown',
                'category': item.get('category') or item.get('primaryCategory') or '',
                'followers_count': self._parse_number(item.get('followers')),
                'growth_count': self._parse_number(item.get('followersGrowth')),
                'growth_rate': self._parse_float(item.get('growthRate')),
                'avatar_url': item.get('avatar') or '',
                'stat_date': item.get('date') or '',
                'stat_type': 'daily',
                'primary_category': item.get('primaryCategory') or '',
                'secondary_category': item.get('secondaryCategory') or '',
                'verify_type': item.get('verifyType') or '',
                'official_cert': item.get('officialCert') or ''
            }
            rankings.append(ranking)
        
        return rankings
    
    def _parse_number(self, value) -> int:
        """解析数字"""
        if value is None:
            return 0
        try:
            return int(float(str(value).replace(',', '')))
        except (ValueError, TypeError):
            return 0
    
    def _parse_float(self, value) -> float:
        """解析浮点数"""
        if value is None:
            return 0.0
        try:
            s = str(value).replace('%', '').replace(',', '')
            return float(s)
        except (ValueError, TypeError):
            return 0.0
    
    def get_categories(self) -> List[str]:
        """获取支持的账号类型列表"""
        default_categories = [
            '综合全部',
            '出行代步',
            '医疗保健',
            '休闲爱好',
            '综合杂项',
            '婚庆婚礼',
            '居家装修',
            '影视娱乐',
            '星座情感',
            '拍摄记录',
            '学习教育',
            '旅行度假',
            '亲子育儿',
            '日常生活',
            '科学探索',
            '数码科技',
            '时尚穿搭',
            '化妆美容',
            '个人护理',
            '美味佳肴',
            '职业发展',
            '宠物天地',
            '新闻资讯',
            '体育锻炼',
            '潮流鞋包'
        ]
        return default_categories
    
    def get_available_dates(self, stat_type: str = 'daily', days: int = 30) -> List[str]:
        """获取可用的统计日期列表"""
        dates = []
        today = datetime.now()
        
        for i in range(days):
            date = today - timedelta(days=i+1)
            dates.append(date.strftime('%Y-%m-%d'))
        
        return dates


def main():
    parser = argparse.ArgumentParser(description='小红书涨粉榜数据查询（API方式，无SNI）')
    parser.add_argument('--category', type=str, help='账号类型（如：化妆美容、穿搭、美食）')
    parser.add_argument('--type', type=str, default='daily', 
                       choices=['daily', 'weekly', 'monthly'],
                       help='统计类型')
    parser.add_argument('--date', type=str, help='统计日期(YYYY-MM-DD)，默认昨天')
    parser.add_argument('--limit', type=int, default=20, help='返回条数')
    parser.add_argument('--output', type=str, help='输出文件路径')
    parser.add_argument('--action', type=str, default='rankings',
                       choices=['rankings', 'categories', 'dates'],
                       help='操作类型')
    parser.add_argument('--source', type=str, default='小红书飙升涨粉榜', help='数据来源标识')
    
    args = parser.parse_args()
    
    client = RankingAPIClient(source=args.source)
    
    if args.action == 'rankings':
        results = client.query_rankings(
            category=args.category,
            stat_type=args.type,
            stat_date=args.date,
            limit=args.limit
        )
    elif args.action == 'categories':
        results = client.get_categories()
    elif args.action == 'dates':
        results = client.get_available_dates(stat_type=args.type)
    else:
        results = []
    
    output = json.dumps(results, ensure_ascii=False, indent=2)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"Results saved to {args.output}")
    else:
        print(output)


if __name__ == '__main__':
    main()
