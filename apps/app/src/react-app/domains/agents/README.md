# domains/agents

Agent registry + agent management surface（自定义 agent、专家包、agent card 展示）。

## 对外符号
通过 `./index.ts` barrel 导出。Shell / 其他域只能 `import { X } from "../domains/agents"`，禁止深链。

## 横向依赖
允许：`domains/shared`（agent-registry 类型 / session state）、`app/lib`、`packages/types`。
禁止：`domains/session`、`domains/settings`、`domains/cloud`（反向依赖会造成环）。
