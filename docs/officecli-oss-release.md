# OfficeCLI OSS 发布约定

OfficeCLI 是“市场 → 插件”中的可选增强。桌面端安装包不内置二进制；用户点击安装后，桌面端从 OSS 下载当前平台的二进制和 `SKILL.md`，写入用户目录，并让后续普通会话与专家会话共用同一份已安装能力。

## OSS 目录

固定版本的推荐目录如下：

```text
officecli/
  manifest.json
  releases/
    1.0.102/
      manifest.json
      SKILL.md
      officecli-mac-arm64
      officecli-mac-x64
      officecli-win-arm64.exe
      officecli-win-x64.exe
```

当前不发布 Linux 二进制；受支持的平台键只有：

- `officecli-mac-arm64`
- `officecli-mac-x64`
- `officecli-win-arm64`
- `officecli-win-x64`

根 `manifest.json` 是更新检查入口。它的 `latestVersion` 指向当前版本，`releaseManifest` 指向对应版本的 release manifest。版本切换时先上传完整的新版本目录，再更新根 manifest，避免客户端看到“更新”后下载到不完整目录。

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

临时测试阶段可以使用签名 URL，但不要把签名参数提交到仓库。桌面端提供以下本地覆盖入口：

- `ONMYAGENT_OFFICECLI_MANIFEST_URL`
- `ONMYAGENT_OFFICECLI_RELEASE_MANIFEST_URL`
- `ONMYAGENT_OFFICECLI_SKILL_URL`
- `ONMYAGENT_OFFICECLI_ASSET_URL_MAC_ARM64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_MAC_X64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_WIN_ARM64`
- `ONMYAGENT_OFFICECLI_ASSET_URL_WIN_X64`

临时签名 URL 必须覆盖根 manifest、release manifest、SKILL 和当前平台资产；它们过期后需要重新设置。切换到公共读 URL 后，移除这些覆盖变量并重新启动桌面端即可恢复默认路径。

## 版本更新顺序

例如从 `1.0.102` 发布 `1.0.103`：

1. 上传 `releases/1.0.103/` 下的完整文件。
2. 对该目录运行严格校验，并在 macOS arm64/x64、Windows arm64/x64 分别确认二进制版本。
3. 更新根 `manifest.json` 的 `latestVersion` 和 `releaseManifest`。
4. 用户端下次检查根 manifest 后，市场卡片显示“更新”；用户点击一次即可下载并原子切换版本。

不要覆盖旧版本目录。旧目录用于已安装旧版本的回滚，也便于新版本发布异常时恢复根 manifest 指针。
