# domains/settings

设置面板、cloud onboarding、extension registry、settings shell、all pages。

## 对外符号
`./index.ts` barrel 汇总 pages / panels / shell / state / cloud / openai-image-extension 全部对外符号，并 side-effect import 5 个 extension config 注册（`openai-image-gen`、`ollama`、`computer-use`、`browser-extension`、`onmyagent-voice`）。

## 横向依赖
允许：`domains/{shared,connections,cloud,session}`、`app/lib`。
子模块 `state/` / `pages/` / `cloud/` / `shell/` 内部可自由深链。
