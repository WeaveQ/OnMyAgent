# domains/cloud

桌面资源限制提示、Den auth + org onboarding（云厂商同步由 provider-auth store 在 launch/sign-in/打开设置页时触发，无后台 interval）。

## 对外符号
通过 `./index.ts` barrel 导出。

## 横向依赖
允许：`domains/shared`、`app/cloud`、`packages/types`。
禁止：`domains/session`、`domains/settings`、`domains/agents`。
