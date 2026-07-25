# domains/settings

设置面板、cloud onboarding、extension registry、settings shell、all pages。

## 对外符号
`./index.ts` barrel 汇总 pages / panels / shell / state / cloud / openai-image-extension 全部对外符号，并 side-effect import 5 个 extension config 注册（`openai-image-gen`、`ollama`、`computer-use`、`browser-extension`、`onmyagent-voice`）。

### AI / providers tab
- `state/ai-providers-controller.ts`（`useAiProvidersController`）— settings AI 页加载、合并、断开等 UI 控制器。
- 服务商列表合并用 `domains/connections` 的 `mergeConnectedProviders`（canonical inventory merge）。
- 列表首屏 skeleton：`pages/ai-providers-skeleton.tsx`；空态 CTA 在 `pages/ai-view.tsx`。

## 横向依赖
允许：`domains/{shared,connections,cloud,session}`、`app/lib`。
子模块 `state/` / `pages/` / `cloud/` / `shell/` 内部可自由深链。
设置宿主路由在 `shell/settings-route/`（不在本域内）；产品错误文案走 `kernel/user-error`。
