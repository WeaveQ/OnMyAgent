# domains/shell-feedback

Shell 层的用户反馈组件：`ReloadWorkspaceToast`、`FloatingToastFrame` 等浮层。

## 对外符号
`./index.ts` barrel。

## 横向依赖
只依赖 `packages/ui`、`app/lib` 基础类型。业务域不应反向 import 这里。
