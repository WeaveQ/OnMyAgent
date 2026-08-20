# Computer Use 后台交互对齐方案

日期：2026-08-20  
范围：`packages/handsfree`、桌面内置 Computer Use skill  
目标：在 macOS 上操作非前台窗口时，不切换用户前台应用、不抬升目标窗口、不移动用户光标，同时保留截图、语义元素、点击、输入、按键、滚动和拖拽能力。

## 1. 结论

采用“保留 OnMyAgent MCP/授权/AX/截图上层，替换底层输入路由”的适配方案，不重写整个 Computer Use，也不使用已废弃的 `computer-use-v2`。

原因：OnMyAgent 已具备应用授权、窗口发现、ScreenCaptureKit 截图、AX 语义树、稳定 ref、动作结果和 MCP 集成。实际差距集中在窗口激活与输入注入层；重写会重复已有能力并扩大权限、打包和回归范围。

## 2. 为什么旧实现占用用户窗口和光标

旧实现同时存在两条输入链：

1. Sky 风格工具走目标 PID，但后台会话为了“激活”目标，向窗口中心发送了一次合成点击。这个点击本身会修改目标 UI，并可能触发 AppKit 激活。
2. MCP 同时默认暴露 `cua_*` 兼容工具；模型可选择这条链。它通过全局 HID event tap 发送鼠标和键盘，因此必须让目标位于前台，并使用系统真实光标。

另外，旧的目标窗口发现和 ScreenCaptureKit 查询只包含 on-screen window，使后台、被遮挡窗口的观察能力不完整。

因此问题不是“模型一定会点错”，而是默认工具面和底层注入协议允许、甚至要求前台 HID 路径。

## 3. Codex 本机逆向证据

以下结论来自本机插件包、签名/entitlements、进程、Unix socket、Mach-O 导入表、二进制字符串，以及用隔离 AppKit 测试应用记录 Codex 实际输入事件。它们是直接证据，不是从产品表现反推：

- 插件的 MCP launcher 启动 `SkyComputerUseClient`；client 通过 app-group 目录内的 `computeruse.sock` 连接由 Codex/ChatGPT 托管的常驻 `SkyComputerUseService`。client 与 service 是同一 OpenAI Team 签名，service 自身为 `LSUIElement` 后台 agent。
- service 直接导入 ScreenCaptureKit、CoreGraphics、AppKit 和大量 Accessibility API，包括 AX tree 读取、`AXUIElementPerformAction`、`AXUIElementSetAttributeValue`。因此元素索引动作以 AX 为主，窗口截图走 ScreenCaptureKit。
- service 内存在 `VirtualCursor`、`ComputerUseCursor`、`AgentCursor`、`SoftwareCursorStyle`、`SyntheticAppFocusEnforcer`、`SystemFocusStealPreventer`、`FocusStealSuppression`、`SystemFrontmostApplicationTracker` 等实现类型。Codex 的 agent 光标是独立软件层，不是系统箭头。
- 对隔离测试窗口执行 Codex 点击时，目标进程依次收到定向 mouse-move、AppKit focus record、mouse-down/up；focus record 为 type 13/subtype 1，实测字段 59 为 `786432`。目标进程内部变为 active/key，但 `NSWorkspace.frontmostApplication` 始终仍是 Codex。
- 同一时刻，目标事件的 `CGEvent.location` 是目标点，而另行读取的硬件光标仍停在用户位置。两者不是同一个状态。Codex 没有通过把事件全局坐标伪装成硬件光标位置来实现后台点击。
- `type_text` 逐字符发送真实 virtual keycode 的 down/up；drag 为 down、两段 dragged、up；scroll 为 continuous pixel scroll。事件都带目标 PID 和目标 CGWindowID。
- service 静态导入表未出现 `CGEventPost*`、`CGWarpMouseCursorPosition` 或 `CGAssociateMouseAndMouseCursorPosition`，但存在 `WindowServerSPI`/`WindowServerEvent` 字符串。可确认它没有把公开全局 HID 注入或硬件光标 warp 当主路径。

仍不能从 hardened/stripped 二进制直接证明的部分：Codex 坐标事件最终调用的私有函数名、`SystemFocusStealPreventer` 的完整状态机，以及所有受保护应用的专用处理。本文不会把这些未解出的内部细节写成既定事实。

## 4. OnMyAgent 实现

### 4.1 默认工具面

- 默认只暴露 10 个 Sky 兼容工具。
- `cua_*`、Skysight 和录制工具移到显式兼容 profile，需设置 `ONMYAGENT_COMPUTER_USE_COMPAT_TOOLS=1`。
- MCP 执行入口再次校验当前 profile，不能通过手写工具名绕过默认隔离。

### 4.2 观察与目标绑定

- CGWindow 枚举不再限于 on-screen window。
- ScreenCaptureKit shareable content 使用 `onScreenWindowsOnly: false`。
- 严格动作绑定 snapshot 的 PID + CGWindowID；窗口或用户前台变化后拒绝复用旧 snapshot。

### 4.3 无抬升焦点

`BackgroundInteractionSession` 对每个动作执行：

1. 记录真实前台 PID 与用户光标。
2. 在动作的短窗口内，对用户前台 PID 启用 per-process focus-message guard；用真实 `CGEvent` 生成 WindowServer event record，只向目标 PID/CGWindowID 发送带实测字段的合成 focus。不调用 `NSRunningApplication.activate`，不 raise/order window。
3. 等待目标内部 key-window 状态稳定。
4. 执行 PID/window 定向事件。
5. 向目标发送合成 defocus，关闭 guard；用户前台应用保持 active，原 key window 恢复。
6. 验证真实前台 PID 和用户光标未变化；变化即严格失败。任何异常路径也会关闭 guard，并尽力清理目标合成 focus。

### 4.4 定向输入

OnMyAgent 复现的是上述可观察协议与用户侧不变量，不声称与 Codex 私有 service 字节级相同：

- 点击：目标 window mouse-move primer + down/up。后台 mouse-down 使用测试确认的 public-then-private 定向顺序；反向顺序会重复投递，单一路由在真实后台 AppKit 窗口会被丢弃。
- 输入：逐字符真实 virtual keycode + Unicode 的 down/up，并清空继承的物理 modifier；组合键使用目标 PID/window 的 virtual-key down/up。
- 滚动：continuous pixel scroll，距离按截图 viewport 的 page 比例计算；事件同时带目标屏幕点、窗口内点、PID 与 CGWindowID。
- 拖拽：down → midpoint dragged → endpoint dragged → up，并保留每段 delta；Electron 可能在 renderer 层合并连续 move，但 native 事件链完整。
- 严格路径不使用 `.cghidEventTap`、不调用光标 warp/解绑 API。事件本身使用目标点，系统硬件光标由独立读取与动作前后 invariant 验证。
- 所需 WindowServer 符号缺失、窗口/PID 变化、用户切换前台或硬件光标异常变化时 fail closed，不静默降级到前台 HID。

### 4.5 用户接管

物理输入监视器只把无 userspace source PID 的硬件事件计为用户输入；OnMyAgent/WindowServer 合成事件不会误判为真人输入。更重要的是，默认严格模式的 PID/window 定向虚拟输入与用户硬件 HID 是两条独立通道：用户移动真实鼠标、打字或操作触控板不会暂停后台 Computer Use。

quiet window 只约束显式启用的前台兼容模式。该模式仍通过共享系统 HID 投递事件，用户真实输入时必须暂停，避免 agent 与用户争抢同一个光标或键盘焦点。

## 5. 验收矩阵

| 场景 | 目标状态变化 | 前台 PID | 用户光标 |
|---|---:|---:|---:|
| 原生 AppKit 后台窗口：单击一次 | 精确增加 1 次 | 不变 | 误差 ≤ 0.5 px |
| 原生 AppKit 后台窗口：Unicode 输入 | 是 | 不变 | 不变 |
| 原生 AppKit 后台窗口：按键 | 是 | 不变 | 不变 |
| 原生 AppKit 后台窗口：滚动 | 是 | 不变 | 不变 |
| 原生 AppKit 后台窗口：拖拽 | 两段 dragged | 不变 | 误差 ≤ 0.5 px |
| Electron 后台窗口：点击/输入/滚动/拖拽 | 实际 DOM 状态改变 | 不变 | 误差 ≤ 0.5 px |
| 严格后台控制期间用户产生物理输入 | Computer Use 不暂停 | 用户可继续操作 | 与虚拟光标独立 |
| 默认 MCP 工具集合 | 仅 Sky 10 tools | 不适用 | 不适用 |
| 直接调用默认隐藏的 `cua_*` | 拒绝 | 不适用 | 不适用 |

真实 UI E2E 为显式测试，使用 `ONMYAGENT_COMPUTER_USE_NATIVE_E2E=1` 开启，避免普通 CI 在无 WindowServer/权限环境下假失败。

## 6. 边界与维护要求

- SkyLight/CPS 是 macOS 私有接口，系统升级可能改变符号或事件布局；实现使用运行时解析，并在能力不完整时严格拒绝，不静默切换前台 HID。
- 该能力适合直接分发/公证的桌面应用，不应假设满足 Mac App Store 私有 API 审核规则。
- Codex 完整的专有 focus-preventer 状态机无法从 hardened 二进制恢复为源码；OnMyAgent 以动态事件指纹和真实行为 E2E 为兼容边界。后续若事件指纹或行为测试不再成立，应当停止支持该 macOS 版本，而不是宣称仍与 Codex 等价。
- 密码管理器、loginwindow、SecurityAgent 等受保护目标继续由授权策略阻止。
- 目标应用在其他 Space、最小化或完全无可捕获 surface 时，观察层应返回明确错误，不能通过切换 Space/抬升窗口“修复”。
- 每次 macOS 大版本升级至少重跑 AppKit 与 Electron 两个真实后台 E2E。
