---
name: getworkbuddy
description: Import locally installed WorkBuddy experts and expert teams into OnMyAgent through the authenticated local server. Use when the user invokes /getworkbuddy, asks to list or inspect local WorkBuddy expert packages, or asks an assistant/expert to import a WorkBuddy expert or team by package ID, Chinese name, or English name.
display_name_zh: "Get WorkBuddy"
display_name_en: "Get WorkBuddy"
description_zh: "把本机已安装的 WorkBuddy 专家和专家团导入 OnMyAgent"
description_en: "Import locally installed WorkBuddy experts and teams into OnMyAgent"
---

# Get WorkBuddy

Use the deterministic script in `scripts/getworkbuddy.mjs`. Do not copy WorkBuddy files manually and do not read connector, token, session, project, or runtime-team directories.

## Commands

Run from this skill directory:

```bash
node scripts/getworkbuddy.mjs list
node scripts/getworkbuddy.mjs inspect "高级开发工程师"
node scripts/getworkbuddy.mjs import "高级开发工程师" --type agent
node scripts/getworkbuddy.mjs import "内容创作专家团" --type team
# Use the exact token returned by preview:
node scripts/getworkbuddy.mjs confirm "senior-developer" --token TOKEN --type agent
```

Chinese aliases are accepted:

```bash
node scripts/getworkbuddy.mjs 列表
node scripts/getworkbuddy.mjs 查看 "高级开发工程师"
node scripts/getworkbuddy.mjs 导入专家 "高级开发工程师"
node scripts/getworkbuddy.mjs 导入专家团 "内容创作专家团"
```

## Workflow

1. With no specific package, run `list` and show the candidates.
2. Before an ambiguous request, run `inspect`; exact package ID or localized name wins over fuzzy matches. Treat the API's `packageName` as canonical because marketplace source directories may use non-canonical aliases.
3. When the user asks to import, run `import` first. This is a no-write preview showing destinations, skills, conflicts, warnings, and a confirmation command.
4. Show the preview and wait for explicit confirmation. Then run the returned `confirm ... --token ...` command. Never invent or reuse a token from another preview.
5. Report package name, expert/team type, lead, member count, imported skills, destination, runtime refresh result, warnings, and whether the action added or updated the package.
6. Explain that WorkBuddy connectors, authorization tokens, sessions, task history, and runtime team scheduling are not migrated. A team preserves member definitions but currently enters OnMyAgent through its lead.

The script requires `ONMYAGENT_SERVER_URL` and `ONMYAGENT_SERVER_TOKEN`, which OnMyAgent supplies to assistant and expert sessions. If either is unavailable, report that the command must run inside an active OnMyAgent session; never fall back to unauthenticated writes.
