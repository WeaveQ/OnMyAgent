# 腾讯会议 MCP 工具调用示例

本文件提供各工具的调用示例。参数说明已集成到 MCP 工具 Schema 中，可通过 `tools/list` 查看。

---

## 目录

- [会议管理](#会议管理)
  - [创建会议](#1-schedule_meeting--创建会议)
  - [修改会议](#2-update_meeting--修改会议)
  - [取消会议](#3-cancel_meeting--取消会议)
  - [查询会议详情](#4-get_meeting--查询会议详情)
  - [通过会议号查询](#5-get_meeting_by_code--通过会议号查询)
- [成员管理](#成员管理)
  - [获取参会成员明细](#6-get_meeting_participants--获取参会成员明细)
  - [获取受邀成员列表](#7-get_meeting_invitees--获取受邀成员列表)
  - [查询等候室成员](#8-get_waiting_room--查询等候室成员)
  - [查询用户会议列表](#9-get_user_meetings--查询用户会议列表)
  - [查询已结束会议](#10-get_user_ended_meetings--查询已结束会议)
- [录制与转写](#录制与转写)
  - [查询录制列表](#11-get_records_list--查询录制列表)
  - [获取录制下载地址](#12-get_record_addresses--获取录制下载地址)
  - [查询转写详情](#13-get_transcripts_details--查询转写详情)
  - [查询转写段落](#14-get_transcripts_paragraphs--查询转写段落)
  - [搜索转写内容](#15-search_transcripts--搜索转写内容)
  - [获取智能纪要](#16-get_smart_minutes--获取智能纪要)

---

## 会议管理

### 1. `schedule_meeting` — 创建会议

#### 调用示例

```bash
# 普通会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "schedule_meeting",
  "arguments": {
    "subject": "产品周会",
    "start_time": "2026-03-25T15:00:00+08:00",
    "end_time": "2026-03-25T16:00:00+08:00"
  }
}'

# 周期性会议（每周开会，共重复5次）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "schedule_meeting",
  "arguments": {
    "subject": "每周例会",
    "start_time": "2026-03-25T15:00:00+08:00",
    "end_time": "2026-03-25T16:00:00+08:00",
    "meeting_type": 1,
    "recurring_rule": {
      "recurring_type": 2,
      "until_type": 1,
      "until_count": 5
    }
  }
}'
```

---

### 2. `update_meeting` — 修改会议

#### 调用示例

```bash
# 修改非周期性会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "update_meeting",
  "arguments": {
    "meeting_id": "xxx",
    "subject": "新主题",
    "start_time": "2026-03-25T16:00:00+08:00",
    "end_time": "2026-03-25T17:00:00+08:00"
  }
}'

# 修改周期性会议其中一场子会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "update_meeting",
  "arguments": {
    "meeting_id": "xxx",
    "start_time": "2026-03-26T10:00:00+08:00",
    "end_time": "2026-03-26T11:00:00+08:00",
    "meeting_type": 1,
    "recurring_rule": {
      "sub_meeting_id": "yyy"
    }
  }
}'
```

---

### 3. `cancel_meeting` — 取消会议

#### 调用示例

```bash
# 取消普通会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "cancel_meeting",
  "arguments": {
    "meeting_id": "xxx"
  }
}'

# 取消周期性会议的某个子会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "cancel_meeting",
  "arguments": {
    "meeting_id": "xxx",
    "sub_meeting_id": "yyy"
  }
}'

# 取消整场周期性会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "cancel_meeting",
  "arguments": {
    "meeting_id": "xxx",
    "meeting_type": 1
  }
}'
```

---

### 4. `get_meeting` — 查询会议详情

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting",
  "arguments": {
    "meeting_id": "xxx"
  }
}'
```

---

### 5. `get_meeting_by_code` — 通过会议号查询

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting_by_code",
  "arguments": {
    "meeting_code": "904854736"
  }
}'
```

---

## 成员管理

### 6. `get_meeting_participants` — 获取参会成员明细

#### 调用示例

```bash
# 基础查询（首页）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting_participants",
  "arguments": {
    "meeting_id": "xxx",
    "page_size": 20
  }
}'

# 翻页查询（使用上次返回的 next_page_token）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting_participants",
  "arguments": {
    "meeting_id": "xxx",
    "page_size": 20,
    "page_token": "上一次响应中的next_page_token"
  }
}'

# 按参会时间过滤
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting_participants",
  "arguments": {
    "meeting_id": "xxx",
    "start_time": "2026-03-01T00:00:00+08:00",
    "end_time": "2026-03-25T23:59:59+08:00"
  }
}'
```

---

### 7. `get_meeting_invitees` — 获取受邀成员列表

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_meeting_invitees",
  "arguments": {
    "meeting_id": "xxx"
  }
}'
```

---

### 8. `get_waiting_room` — 查询等候室成员

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_waiting_room",
  "arguments": {
    "meeting_id": "xxx",
    "page_size": 20
  }
}'
```

---

### 9. `get_user_meetings` — 查询用户会议列表

#### 调用示例

```bash
# 查询即将开始/进行中的会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_user_meetings",
  "arguments": {
    "is_show_all_sub_meetings": 0
  }
}'

# 翻页查询（has_more 为 true 时，使用返回的 next_page_token）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_user_meetings",
  "arguments": {
    "page_token": "上一次响应中的next_page_token",
    "is_show_all_sub_meetings": 0
  }
}'
```

---

### 10. `get_user_ended_meetings` — 查询已结束会议

#### 调用示例

```bash
# 查询指定日期已结束的会议
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_user_ended_meetings",
  "arguments": {
    "start_time": "2026-03-25T00:00:00+08:00",
    "end_time": "2026-03-25T23:59:59+08:00",
    "page_size": 10
  }
}'

# 翻页查询
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_user_ended_meetings",
  "arguments": {
    "start_time": "2026-03-25T00:00:00+08:00",
    "end_time": "2026-03-25T23:59:59+08:00",
    "page_size": 10,
    "page_token": "上一次响应中的next_page_token"
  }
}'
```

---

## 录制与转写

### 11. `get_records_list` — 查询录制列表

#### 调用示例

```bash
# 按时间范围查询
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_records_list",
  "arguments": {
    "start_time": "2026-03-25T00:00:00+08:00",
    "end_time": "2026-03-25T23:59:59+08:00",
    "page_size": 10
  }
}'

# 按会议ID查询（无需传时间）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_records_list",
  "arguments": {
    "meeting_id": "xxx"
  }
}'

# 按会议号查询（无需传时间）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_records_list",
  "arguments": {
    "meeting_code": "904854736"
  }
}'

# 翻页查询
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_records_list",
  "arguments": {
    "start_time": "2026-03-25T00:00:00+08:00",
    "end_time": "2026-03-25T23:59:59+08:00",
    "page_size": 10,
    "page_token": "上一次响应中的next_page_token"
  }
}'
```

---

### 12. `get_record_addresses` — 获取录制下载地址

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_record_addresses",
  "arguments": {
    "meeting_record_id": "xxx"
  }
}'
```

---

### 13. `get_transcripts_details` — 查询转写详情

#### 调用示例

```bash
# 查询转写内容（从第0段开始）
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_transcripts_details",
  "arguments": {
    "record_file_id": "xxx",
    "pid": "0"
  }
}'

# 从指定段落开始查询
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_transcripts_details",
  "arguments": {
    "record_file_id": "xxx",
    "pid": "100"
  }
}'

# 限制查询段落数
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_transcripts_details",
  "arguments": {
    "record_file_id": "xxx",
    "pid": "0",
    "limit": "10"
  }
}'
```

---

### 14. `get_transcripts_paragraphs` — 查询转写段落

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_transcripts_paragraphs",
  "arguments": {
    "record_file_id": "xxx"
  }
}'
```

---

### 15. `search_transcripts` — 搜索转写内容

#### 调用示例

```bash
python3 scripts/tencent_meeting.py tools/call '{
  "name": "search_transcripts",
  "arguments": {
    "record_file_id": "xxx",
    "text": "产品需求"
  }
}'
```

---

### 16. `get_smart_minutes` — 获取智能纪要

#### 调用示例

```bash
# 获取原文智能纪要
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_smart_minutes",
  "arguments": {
    "record_file_id": "xxx"
  }
}'

# 获取英文版智能纪要
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_smart_minutes",
  "arguments": {
    "record_file_id": "xxx",
    "lang": "en"
  }
}'

# 录制文件有密码时
python3 scripts/tencent_meeting.py tools/call '{
  "name": "get_smart_minutes",
  "arguments": {
    "record_file_id": "xxx",
    "pwd": "123456"
  }
}'
```

---

## 相关文档

- **SKILL.md** — 完整的业务规范与触发场景（时间处理、敏感操作、错误处理等通用规则以 SKILL.md 为准）
- **error_dictionary.md** — 错误处理指引
- **version_management.md** — 版本管理指引
