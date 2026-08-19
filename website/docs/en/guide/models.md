---
title: Models and BYOK
---

# Models and BYOK

OnMyAgent is **not tied to one model vendor**. Connect your own key or compatible endpoint (Bring Your Own Key), or use a model running on your machine.

## 1. Configuration entry

1. Open [Settings](/en/guide/settings) through the bottom-left gear → **Settings**, or press **⌘ ,**.
2. Select **Workspace → Models** on the left, or select the Models card on Overview.
3. Select **Connect model provider** or **Custom model provider configuration**.
4. Enter the API Key and Base URL, or the address of a local model service.
5. Use **Remove** to disconnect or delete a connected provider (one action, not separate delete / disconnect labels).
6. Return to a session and choose the current model on the right side of the composer.


## 2. Edit a model provider

Open a saved provider to get **Edit model provider** (new providers use **Add model provider**). Connection is on the left; the catalog is on the right.

![Add or edit a model provider](/images/edit-model-provider.png)

<p class="oma-shot-caption">Connection on the left, catalog on the right, save at the bottom.</p>

| Area | Product labels | What it does |
|------|----------------|--------------|
| Connection | **Provider ID**, **Display name**, **API endpoint**, **API key** | The ID cannot change after save. Display name is menu-only. Endpoint is the OpenAI-compatible Base URL. The key stays on this machine and is masked after save |
| Fetch | **Fetch models** | Pulls the remote catalog using the current endpoint (and key, if entered). Requires an endpoint first |
| Catalog | **Model ID**, **Display name** | Rename, delete, or **Add model** by ID. Display names can fill in automatically |
| Save | **Save changes** | Writes the local provider config. Optional **Advanced JSON** |

A successful fetch only proves `/models` returned data. Use a connectivity test or a real chat to confirm completions. See “Accept real connectivity” below.

## 3. Global models and local-Agent models

| Configuration location | Purpose |
|------------------------|---------|
| Settings → Models | Providers, catalog, and default selection for OpenCode main sessions on Home |
| Agent management → an Agent → model providers | Writes Provider configuration recognized by that CLI/ACP Agent |
| Session composer | Selects the model and reasoning effort for the current main session |
| Agent chat composer | Can switch only when the target Agent supports model override |

These configurations do not necessarily synchronize. A Provider that connects successfully in Settings is not guaranteed to be read automatically by Codex, Claude Code, Hermes, or a custom Agent.

## 4. Switch within a session

The model selector on the right side of the composer can change vendor, model, or reasoning effort. A new session uses the most recently selected model or the configured default.

Models vary in context size, reasoning levels, tool use, image input, and cost. After switching, inspect the Provider/model actually shown for the current session; do not infer the endpoint from a display name alone.

**Context usage** in a session prefers the catalog window for that model (million-token windows show as **1M**), not a stale fixed table. Occupancy splits into system prompt, tools and sub-agents, messages, skills, and cache; **Reply** and **Reasoning** are last-turn generation and are not occupancy. See [Sessions](/en/guide/sessions).

## 5. Ollama and compatible endpoints

- Ollama requires its local service to be running, the address to be reachable, and the target model to be downloaded.
- A custom OpenAI-compatible endpoint may implement models, chat completions, or responses with different levels of compatibility.
- When a Base URL contains a product-specific version segment, Agent management may try compatible candidate endpoints. The real models request and a minimal chat request remain the final test.
- A local model does not make the whole task offline: websites, connectors, and messaging platforms may still use the network.

## 6. Recommendations

| Scenario | Recommendation |
|----------|----------------|
| Drafting and brainstorming | A faster, lower-cost model |
| Long documents and complex planning | A stronger reasoning model |
| Intranet or offline use | A local model such as Ollama, or a private endpoint |
| Automation or messaging channel | Run a real closed loop with a low-cost test model first, then set budgets and failure limits |
| Sensitive material | Verify the endpoint, data policy, and organization Gateway rather than relying on the model name |

## 7. Accept real connectivity

“Saved” or a visible model list does not prove real generation works. Run at least one minimal request with no sensitive information. Record a redacted target Provider/model identifier, start and completion times, real text output, and a Token/error summary; confirm that the request did not fall back to another model.

Model calls can consume API quota and incur cost. Limit the number of calls before a batch video demonstration or automation run.

## 8. Troubleshooting

| Symptom | Action |
|---------|--------|
| No response or authentication failure | Check the Key, Base URL, proxy, and quota |
| Model list is empty | Confirm that the provider is connected and enabled |
| Local model cannot connect | Confirm that the local service is running and its address/port are correct |
| Agent chat still uses the old model | Inspect that Agent's independent configuration and session-override support in Agent management |
| Models can be listed, but chat fails | Check the real chat/responses protocol, model permission, and endpoint version |
| Request goes to the wrong endpoint | Check the active Provider, Base URL, environment variables, and runtime reload |

## 9. Related

- [Settings](/en/guide/settings) · [Agent management](/en/guide/agent-management) · [Quick start](/en/quickstart)
- [Security and data](/en/security) · [Company connection](/en/guide/company)
