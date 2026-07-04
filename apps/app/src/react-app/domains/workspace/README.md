# domains/workspace

Workspace 创建 / 重命名 / 分享 / 远程 workspace 连接编辑与诊断。

## 对外符号
`./index.ts` barrel：CreateWorkspaceModal / CreateRemoteWorkspaceModal / RenameWorkspaceModal / useShareWorkspaceState / useRemoteWorkspaceConnectionEditor / useRemoteAccessRestart + remote-workspace-diagnostics 全套函数。

## 横向依赖
允许：`domains/shared`、`app/lib`。
禁止：`domains/session`、`domains/settings`。
