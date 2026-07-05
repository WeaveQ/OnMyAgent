# domains/session

会话主域：pages、sidebar、chat、artifacts、control、sync、runtime。是 app 里最大的域，内部分 10+ 子目录。

## 对外符号
只走 `./index.ts` barrel。当前额外 re-export 了 `components/shared-pages/{automation-session-groups,agent-management-providers}` 里被 shell 用到的符号（历史债，等 `shared-pages` 完成拆域后可移除）。

## 内部约定
- `sync/` 是唯一的持久化 / 跨会话状态入口
- `components/shared-pages/*` 是历史 P0 债：混住 automation / agents-mgmt / messaging 3 类页面，计划逐步拆到 `domains/{automation,agents,messaging}/`
- 子模块之间可以深链（`sidebar/utils` ↔ `pages/*` ↔ `sync/*`），不必通过 barrel

## 横向依赖
允许：`domains/{shared,agents,workspace,connections,cloud,settings,shell-feedback}`、`app/lib`。
禁止：反向依赖 `shell/*`。
