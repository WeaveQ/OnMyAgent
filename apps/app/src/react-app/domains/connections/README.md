# domains/connections

Provider connections store + provider auth 模态框 + connections modals。

## 对外符号
`./index.ts` barrel 导出 store / provider-auth store / ConnectionsModals。子模块 `provider-auth/` 内部可深链，域外禁止。

## 横向依赖
允许：`domains/shared`（provider-auth-modal 类型）、`app/lib`。
禁止：`domains/session`、`domains/settings`。
