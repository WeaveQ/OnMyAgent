# Capability shelf matrix

| Field | Value |
| --- | --- |
| Status | **SoT** for recommended vs built-in placement |
| Code | `apps/app/src/react-app/domains/plugins/capability-shelf.ts` |
| Pointer | `docs/Architecture.md` Session / Expert / cold-path table |

## Surfaces

| Surface | Meaning |
| --- | --- |
| `settings` | Settings pages (models, system) |
| `plugins` | Connectors / plugins market (recommended grid) |
| `composer` | Composer tool menu connected recommended connectors |
| `session` | In-session tools / artifacts |
| `marketplace` | Skills marketplace cards |

## Matrix (summary)

| id | kind | recommended | plugins | composer | marketplace | session | settings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| builtin-documents | builtin-docs | no | | | | ✓ | ✓ |
| knowledge-search | connector | no | ✓ | ✓ | | ✓ | |
| officecli | officecli | yes | ✓ | ✓ | ✓ | ✓ | |
| lark-cli | managed-cli | yes | ✓ | ✓ | | | |
| tencent-docs / baidu-drive / kdocs / dingtalk / wecom / tencent-meeting | connector | yes | ✓ | ✓ | | | |
| skill (generic) | skill | no | ✓ | | ✓ | ✓ | |

Canonical rows live in `CAPABILITY_SHELF` — **edit the code registry**, then update this table.

## Rules

1. New managed CLI / connector: add to `CAPABILITY_SHELF` first, then catalog entry.
2. Do not hard-code “recommended” only in JSX; call `recommendedManagedConnectorIds()` / `isRecommendedOnSurface`.
3. Built-in document tools stay **non-recommended** so OfficeCLI can own the recommended document story.
