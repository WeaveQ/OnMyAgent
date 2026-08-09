---
title: "Practice 9: Cloud Document Collaboration (Optional)"
---

# Practice 9: Cloud Document Collaboration (Optional)

With authorization in place, use a Skill to create, read, or organize cloud documents. **This guide does not apply if the matching Skill is not installed or you are not signed in**—use the [local document practice](/en/scenarios/practice/docs) instead.

This page does not include a cloud-service-specific screenshot because the interface changes with authorization state and product version. The installation entry point is the same as for other Skills.


## 1. Prerequisites

1. From Market or the Skills list, install and authorize **tencent-docs**, or the Tencent Docs Skill name shown in your version
2. Complete the account or token setup flow
3. Test read access on a small set of documents before using it in bulk

See the bundled Skills table in [Skills](/en/guide/skills).

## 2. Example requests

```text
Create a Tencent Docs document named “Project Weekly Report” with this week's
three progress items and two risks. Give me the link, and also save a Markdown
backup to notes/weekly/tencent-docs-backup.md in the workspace.
```

```text
Read the Tencent Docs link I provide. Extract action items and owners,
then write them as a table to notes/todos-from-docs.md.
```

## 3. Local-first alternative

If you do not use a cloud document service, complete the work with [workspace files](/en/guide/files) and the [document practice](/en/scenarios/practice/docs). You can then paste the collaborative draft into Tencent Docs manually.

## 4. Security

- Enterprise document permissions are governed by Tencent Docs
- Do not paste long-lived credentials into a prompt
- Always confirm before deleting or moving cloud files in bulk

## Related

- [Skills](/en/guide/skills) · [MCP / Connections](/en/guide/mcp) · [Practice 2 · Documents](/en/scenarios/practice/docs)
