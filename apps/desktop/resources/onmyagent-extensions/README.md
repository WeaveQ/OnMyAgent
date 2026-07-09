# OnMyAgent Bundled Extensions

Each subdirectory here contains an `onmyagent-extension.json` manifest that
contributes to the Personal Local Agent runtime.

Manifest schema (excerpt):

```json
{
  "name": "unique.extension.id",
  "displayName": "Human name",
  "version": "1.0.0",
  "contributes": {
    "acpAdapters": [
      {
        "id": "adapter-id",
        "name": "Adapter display name",
        "connectionType": "cli",
        "cliCommand": "codebuddy",
        "defaultCliPath": "npx @tencent-ai/codebuddy-code",
        "acpArgs": ["--acp"],
        "authRequired": true,
        "supportsStreaming": true
      }
    ]
  }
}
```

Users can also drop extensions into
`~/.onmyagent/runtime-state/extensions/<name>/` (or the equivalent
`userData/onmyagent/runtime-state/extensions/<name>/` inside the packaged
app) and toggle them via the Personal Local Agent management tab.
