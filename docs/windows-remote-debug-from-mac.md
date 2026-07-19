# Mac 远程调试 Windows（同 Wi‑Fi）

在 Mac 上改 OnMyAgent，在 Windows 上跑桌面端、看真机 UI（字体 / DPI / 标题栏 / 路径）。  
两边在同一局域网时用下面步骤即可。

> 平台兼容与 preflight 见 [`windows-compat.md`](windows-compat.md)。  
> 本页只记 **Mac → Windows 协作调试** 流程。

## 原则

| 要做的事 | 推荐 |
| --- | --- |
| 改代码 + 在 Windows 上看桌面端 | Windows 上跑 `pnpm dev:windows`；Mac 用 Git 或 **Remote SSH** 编辑 |
| 只当第二块屏点 UI | RDP / Parsec / Sunshine 等远程桌面 |
| 只调部分 Web UI | Vite 绑 `0.0.0.0`（仅限可信局域网，见下） |

Electron 与本地 API 绑在 **Windows 进程** 上，不能只靠「Mac 起 dev、Windows 浏览器猜效果」。  
**代码最终要在 Windows 上跑起来。**

安全：本地服务默认应绑 `127.0.0.1`（见 `SECURITY.md`）。不要把无鉴权 dev server 长期暴露在公共 Wi‑Fi。

---

## 方案 A（推荐）：Windows 本机 dev + Mac Remote SSH

### 1. Windows：仓库与依赖

```powershell
# 已 clone 仓库后
cd path\to\onmyagent
pnpm install
node scripts/dev/windows-preflight.mjs   # 首次建议跑
pnpm dev:windows                         # 或 pnpm dev:windows:x64
```

根 `package.json` 脚本：

- `pnpm dev:windows`
- `pnpm dev:windows:x64`
- `pnpm test:windows-runtime`

### 2. Windows：开启 OpenSSH Server

1. 设置 → 应用 → 可选功能 → **OpenSSH 服务器**（安装）
2. **管理员** PowerShell：

```powershell
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

3. 防火墙放行 TCP **22**（或你改的端口）
4. 查本机局域网 IP：

```powershell
ipconfig
# 记下 IPv4，例如 192.168.1.23
```

5. （可选）开发者选项：设置 → 隐私和安全性 → 开发者选项 → **开发人员模式**（利于 symlink，见 `windows-compat.md`）

### 3. Mac：连通性

```bash
ping 192.168.x.x
ssh 你的Windows用户名@192.168.x.x
```

可选 `~/.ssh/config`：

```sshconfig
Host onmyagent-win
  HostName 192.168.1.23
  User 你的Windows用户名
  # IdentityFile ~/.ssh/id_ed25519
```

之后：`ssh onmyagent-win`。

### 4. Mac：Cursor / VS Code Remote SSH

1. 安装扩展 **Remote - SSH**
2. 连接 `user@192.168.x.x` 或 `onmyagent-win`
3. 打开 Windows 上的 `onmyagent` 目录
4. 在 **远程终端** 中执行：

```bash
pnpm install
pnpm dev:windows
```

此时编辑、终端、Node 都在 Windows 上，和坐在 Windows 前开发等价。

### 5. 仅 Git 同步（不装 SSH 时）

```text
# Mac
git push

# Windows
git pull
pnpm install   # 依赖有变时
pnpm dev:windows
```

---

## 方案 B：远程桌面（只看画面、点 UI）

Windows 本机已 `pnpm dev:windows` 后，Mac 用：

| 工具 | 说明 |
| --- | --- |
| Windows 远程桌面 (RDP) | 专业版自带；家庭版需另寻方案 |
| Parsec / Moonlight + Sunshine | 低延迟，适合看动画、滚动 |
| RustDesk / ToDesk | 配置简单，同网直连 |

代码仍用 **方案 A 的 SSH 或 Git**，不要只靠远程桌面在 Mac 本地跑 Electron。

---

## 方案 C：仅 Vite 前端（覆盖有限）

```bash
# 在 Windows 上
pnpm --filter @onmyagent/app dev -- --host 0.0.0.0
```

Mac 浏览器访问 `http://192.168.x.x:<vite-port>`。

注意：

- 只覆盖部分 UI，不覆盖完整 Electron 壳、本地 OpenCode、文件权限
- 仅在可信局域网临时使用；用完改回本机绑定

---

## 同网排障

1. **Ping / SSH 不通**  
   - 路由器是否开启 **AP/客户端隔离**（访客 Wi‑Fi 常见）→ 关掉或改用主网/有线  
   - Windows 防火墙是否放行 SSH / RDP / 临时 Vite 端口  

2. **Node / pnpm 版本**  
   两边尽量对齐，减少「Mac 能装 Windows 不能」  

3. **路径与 DPI**  
   Windows：盘符、`\`、长路径、大小写不敏感；缩放 125%/150% 时观感与 Mac 不同，**UI 以 Windows 实机为准**  

4. **首次跑不通**  
   再跑一遍 `node scripts/dev/windows-preflight.mjs`，对照 [`windows-compat.md`](windows-compat.md)  

---

## UI 优化时的推荐节奏

1. Mac 或 Remote SSH 改代码（例如聊天字号、`index.css`）  
2. Windows 上 `pnpm dev:windows` 看真机  
3. 截图回 Mac 继续改  
4. 确认后再 push  

---

## 不推荐

- 只在 Mac 上跑桌面端，用感觉猜 Windows 字体/DPI  
- 无鉴权 dev server 长期绑 `0.0.0.0` 挂在公共网络  
- 两边各改各的、不同步 Git / 不用 Remote SSH  

---

## 相关文档

- [`windows-compat.md`](windows-compat.md) — 兼容性、preflight、已知坑  
- [`../BUILD.md`](../BUILD.md) — 打包（当前公开发布线以 macOS 为主）  
- [`../SECURITY.md`](../SECURITY.md) — 本地服务绑定与暴露约束  
- 根 `package.json` — `dev:windows` / `dev:windows:x64` / `test:windows-runtime`
