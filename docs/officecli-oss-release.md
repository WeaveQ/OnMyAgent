# OfficeCLI CDN 发布约定

OfficeCLI 是连接器「推荐安装」中的可下载 CLI。桌面端 **只内置一个永久 root `manifestUrl`**（`officecli-download-config.json`）。客户端定期/安装时拉取该 JSON，比较 `latestVersion` 与本地安装版本；有更新则按 manifest 内绝对 URL 下载 skill 与平台 zip。

## 热更新模型

| 层 | 是否可变 | 说明 |
|----|----------|------|
| 客户端 `manifestUrl` | 固定（写死在包内） | 永久 CDN 链接，不随版本改代码 |
| root `manifest.json` 内容 | 可变 | 发布新版本时更新该文件（或同 URL 指向新对象） |
| 版本化资源 URL | 不可覆盖 | 每版独立路径，如 `…/release/1_0_144/…` |

示例文件：`apps/desktop/electron/managed-tools/officecli-root-manifest.example.json`。

zip 解压 `entry` 后，用 manifest 中的 **sha256/size 校验解压后的二进制**（不是 zip 包本身）。

平台键：`officecli-mac-arm64` / `officecli-mac-x64` / `officecli-win-arm64` / `officecli-win-x64`（无 Linux）。

## 可复用能力

`apps/desktop/electron/managed-tools/managed-cli/`：download-config 加载、zip 解压，供飞书 CLI 等复用。

## Manifest 格式

桌面端兼容当前已经上传的格式。根 manifest 可以是：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "latestVersion": "1.0.102",
  "releaseManifest": "releases/1.0.102/manifest.json"
}
```

release manifest 可以使用 `skillPath`，资产使用带 `path`、`sha256`、`size` 的描述对象：

```json
{
  "schemaVersion": 1,
  "version": "1.0.102",
  "officecliVersion": "1.0.102",
  "skillPath": "SKILL.md",
  "assets": {
    "officecli-mac-arm64": {
      "path": "officecli-mac-arm64",
      "sha256": "<64 位十六进制 SHA-256>",
      "size": 0
    }
  }
}
```

推荐后续升级为严格格式：根 manifest 的 `releaseManifest` 也使用带 `path`、`sha256`、`size` 的描述对象；release manifest 的 `skill` 使用同样的完整描述，并补齐 `pluginId: "officecli"` 和 `officecliVersion`。严格校验会要求四个平台资产全部存在，不会要求 Linux。

## 发布前校验

校验器复用 `packages/types/src/officecli.ts` 的 schema，并检查：

- 根版本与 release 版本一致；`officecliVersion`（如提供）与 release 版本一致；
- 资产键、相对路径和重复路径合法；路径不能逃出 release 目录；
- 传入 release 目录后，逐个检查 `SKILL.md` 和四个平台资产的文件大小与 SHA-256；
- `--strict` 模式下，要求完整发布元数据与四个平台资产。

在 OSS 本地镜像目录中执行：

```bash
node scripts/officecli/validate-manifest.mjs \
  --latest ./manifest.json \
  --release ./releases/1.0.102/manifest.json \
  --release-dir ./releases/1.0.102 \
  --strict
```

当前使用 `skillPath` 和根相对 `releaseManifest` 时，可先不加 `--strict` 做兼容校验；发布方补齐严格格式后再启用严格校验。

此外，必须在对应系统上执行每个二进制的 `--version`，并确认输出与 manifest 版本完全相同。校验器无法在 macOS 主机上替代 Windows 二进制的实际启动检查；桌面端安装时也会再次拒绝版本不一致的二进制。

## 公网与临时签名 URL

最终面向国内用户时，推荐将 `officecli/manifest.json`、release manifest、`SKILL.md` 和四个平台文件设置为 OSS 公共读，并保持稳定的 HTTPS 路径。这样客户端只需要内置根 manifest 地址，用户点击市场卡片的安装或更新即可完成整个流程。

临时测试 / 内测打包阶段可以使用签名 URL。推荐直接改本地配置文件（会打进 electron asar，无需 `source .env`）：

**配置文件路径：** `apps/desktop/electron/managed-tools/officecli-download-config.json`

```json
{
  "manifestUrl": "https://…/officecli/manifest.json?…",
  "releaseManifestUrl": "https://…/officecli/releases/1.0.143/manifest.json?…",
  "skillUrl": "https://…/officecli/releases/1.0.143/SKILL.md?…",
  "assets": {
    "officecli-mac-arm64": "https://…/officecli-mac-arm64?…",
    "officecli-mac-x64": "https://…/officecli-mac-x64?…",
    "officecli-win-arm64": "https://…/officecli-win-arm64.exe?…",
    "officecli-win-x64": "https://…/officecli-win-x64.exe?…"
  }
}
```

更新链接后：`pnpm dev` 直接生效；给内测用户则重新打包即可。签名过期后只改该文件里的 URL。

可选：`ONMYAGENT_OFFICECLI_DOWNLOAD_CONFIG=/abs/path.json` 指向其它配置文件。

优先级：`createOfficeCliManager` 入参 > 环境变量 > 配置文件 > 内置公共读默认 URL。

环境变量覆盖（测试 / 一次性调试仍可用）：

- `ONMYAGENT_OFFICECLI_MANIFEST_URL`
- `ONMYAGENT_OFFICECLI_RELEASE_MANIFEST_URL`
- `ONMYAGENT_OFFICECLI_SKILL_URL`
- `ONMYAGENT_OFFICECLI_ASSET_URL_MAC_ARM64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_MAC_X64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_WIN_ARM64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_WIN_X64`

临时签名 URL 必须覆盖根 manifest、release manifest、SKILL 和当前平台资产。切换到公共读 URL 后，把配置文件字段清空或删掉对应键，重启桌面端即可恢复默认路径。

## 会话产物卡

桌面端 managed launcher（`profiles/local/tools/officecli/launcher.mjs`）在 `create` / `save` / `set` / `add` 等写文件类命令成功后，会追加一行：

```text
ONMYAGENT_DELIVERABLE: <path>
```

与 `artifact-runtime` 的交付标记相同，会话底部产物卡靠此注册文件。已安装用户在下次 status 检查时会自动刷新 launcher，无需重装。

## 版本更新顺序

例如从 `1.0.102` 发布 `1.0.103`：

1. 上传 `releases/1.0.103/` 下的完整文件。
2. 对该目录运行严格校验，并在 macOS arm64/x64、Windows arm64/x64 分别确认二进制版本。
3. 更新根 `manifest.json` 的 `latestVersion` 和 `releaseManifest`。
4. 用户端下次检查根 manifest 后，市场卡片显示“更新”；用户点击一次即可下载并原子切换版本。

不要覆盖旧版本目录。旧目录用于已安装旧版本的回滚，也便于新版本发布异常时恢复根 manifest 指针。
