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
- 光标并非全局 floating overlay。Swift 符号直接公开 `targetWindowID`、`correspondingWindowID`、`correspondingApplicationPID`、`AppMonitor.cursorWindow/appIsActive/menusOpen`，以及 `move(to:aboveWindowID:relativeToWindow:nextInteractionTiming:animated:fadeIn:isDelegate:)`。反汇编确认显示路径读取目标 CGWindow layer，调用 `setLevel:` 后执行 `orderWindow:relativeTo:`，以 `.above` 相对目标 window number 排序；窗口遮挡、屏幕与 Space 改变均有回调。
- 位移动画由 `DisplayLinkAnimationDriver` 与 `DynamicPropertyAnimator` 驱动，不是一次 AppKit animator proxy。`MotionConfiguration` 包含路径候选、边界 margin、起终点 handle、arc size/flow、短距离直线阈值、spring response/damping，以及 scoot 位置、旋转、拉伸参数；窗口保存 `currentInterpolatedOrigin`，所以每帧都有明确插值位置。
- 当前视觉样式存在 `FogCursorStyle`、`FogCursorViewModel`、SwiftUI `AgentCursor`/`CursorView`。运行光标不是 `Assets.car` 里的 `SoftwareCursor` 图片（该资源是带软盘角标的旧图标），而是 `AgentCursor.path(in:)` 通过 7 段归一化 line/Bezier 路径实时绘制的灰蓝三角箭头；OnMyAgent 在独立的 `AgentCursorArtwork.swift` 中按二进制常量还原了这条路径。
- `FogCursorStyle.hotSpot` 的机器码返回 view fitting size 的中心，实际 `Software Cursor` 窗口为 `126 × 126 pt`。`CursorView` 使用 21 pt `fogRadius` 的蓝色径向柔焦蒙层，窗口为约三倍 blur radius 的尾部留出空间，而不是绘制一条硬边圆环；view model 还维护 velocity、pressed、activity state、attached、angle、stretch/tilt。
- Swift reflection 直接给出 `ActivityState` 的 `idle/loading/paused` 三态。反汇编给出 fog loading gain `0.16 → 0.24`、paused 整体视觉 `0.5`，半周期约 `0.6849315s`、完整周期约 `1.369863s`。逐帧抓取实际 `Software Cursor` 窗口确认 loading 时外围 fog 像素持续变化、箭头本体保持稳定，idle 时停止；呼吸作用在径向蒙层而不是箭头或额外硬圆圈。
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
6. 验证真实前台 PID 未变化；没有物理输入时继续要求用户光标误差不超过 0.5 px，以捕获合成路径误动硬件光标的回归。若 event tap 同期确认真人移动了鼠标，则允许用户光标自然变化，不把它归因于 Computer Use。任何异常路径也会关闭 guard，并尽力清理目标合成 focus。

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

动作前后硬件光标 invariant 同样区分来源：没有真人输入时，系统光标位移仍会使严格动作失败；检测到真人输入时不再要求动作前后绝对坐标相同。这样既保留“Computer Use 自己不能移动用户光标”的回归保护，也不会因为用户正常移动鼠标而中断虚拟光标。

quiet window 只约束显式启用的前台兼容模式。该模式仍通过共享系统 HID 投递事件，用户真实输入时必须暂停，避免 agent 与用户争抢同一个光标或键盘焦点。

### 4.6 虚拟光标呈现

- 每个动作把当前 snapshot 的 PID、CGWindowID 和窗口 bounds 一并交给虚拟光标。透明非激活窗口同步目标 CGWindow layer，并用 `.above` 相对目标 window number 排序；不会调用 `orderFrontRegardless`。因此用户的其他应用窗口仍位于它之上，目标窗口最小化、离开当前 Space、关闭或热点跑出目标 bounds 时光标自动隐藏。
- 虚拟光标保留 Codex 的 126 pt 承载面、21 pt fog radius 和 21 × 22 pt 箭头作为逆向基准，但按用户视觉验收整体缩小 1/3 展示：透明承载面为 84 pt，等效 fog radius 为 14 pt，箭头约为 14 × 14.7 pt。三者统一使用 2/3 比例，热点仍位于承载面正中心，不修改系统硬件光标。热点按 Codex 的 view-center 模型实现，并在 CG 顶左坐标与 AppKit 底左坐标之间双向验证；多屏坐标不重复叠加屏幕原点。
- 首次动作直接在目标热点出现；后续位置变化由主线程 60 fps timer 显式推进 180–480 ms 的受边界约束二次曲线路径。模型动作会等待光标运动到位再投递，避免只更新一次 animator 目标但窗口看起来固定。系统开启“减少动态效果”时取消位移动画。
- 与 Codex 一样区分 `idle/loading/paused`。动作执行时进入 idle/动作态，动作完成和模型继续工作时进入 loading；只有外围 fog 蒙层以约 1.37 秒 opacity/scale 周期呼吸，箭头素材保持稳定，paused 整体降为半透明。移动方向仍给箭头轻微倾斜反馈；系统开启“减少动态效果”时保留静态 fog 而不播放 transform 动画。
- 光标首次出现后保持显示，直到 MCP Computer Use 会话结束；不再按固定计时自动消失。
- 临时的右下角截图面板已移除。Codex 风格的实时 Mac 画中画属于后续独立工作，不在本次实现中用静态截图窗口替代。

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
| 虚拟光标跨目标移动 | 180–480 ms 可见曲线动画 | 不变 | 热点与动作坐标一致 |
| 前台窗口覆盖被控后台窗口 | 光标位于目标窗口正上方、前台窗口下方 | 不变 | 不适用 |
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
