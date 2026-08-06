# OfficeCLI CDN 发布约定

OfficeCLI 是连接器「推荐安装」中的可下载 CLI。桌面端内置 **统一 registry**：

`apps/desktop/electron/managed-tools/managed-cli-registry.json`

```json
{
  "schemaVersion": 1,
  "plugins": {
    "officecli": {
      "manifestUrl": "https://weaveq-plugs.oss-cn-hangzhou.aliyuncs.com/officecli/manifest.json"
    },
    "lark-cli": {
      "manifestUrl": "https://weaveq-plugs.oss-cn-hangzhou.aliyuncs.com/lark-cli/manifest.json"
    }
  }
}
```

客户端按 `pluginId` 取 `manifestUrl`，拉取远端 root catalog，比较 `latestVersion`；有更新则按 catalog 内绝对 URL 下载 skill、可选 skillsPack 与平台 zip。

## 热更新模型

| 层 | 是否可变 | 说明 |
|----|----------|------|
| 包内 `managed-cli-registry.json` | 少改 | 各 CLI 的永久 root URL；新增 CLI 时加一条 |
| 各 CLI root `manifest.json` | 可变 | 最新版本 + 下载链接 + 二进制 hash |
| 版本化资源 URL | 不可覆盖 | 每版独立路径 |

Root catalog 示例：`apps/desktop/electron/managed-tools/officecli-root-manifest.example.json`。

zip 解压 `entry` 后，用 catalog 中 **sha256 校验解压后的二进制**（不是 zip 包）。`size` 可选；若提供则额外校验解压后字节数。

### skillsPack（高级技能包）

Root catalog 可带可选字段：

```json
"skillsPack": {
  "url": "https://…/officecli-skills.zip",
  "archive": "zip",
  "sha256": "<optional 64-hex of zip>",
  "size": 0
}
```

安装时：

1. 入口 `skill.url` → `profiles/local/config/skills/officecli/SKILL.md`（目录型路由 skill）
2. `skillsPack` zip 解压后，扫描含 `SKILL.md` 的包，**扁平**写入 `profiles/local/config/skills/<name>/`
3. 跳过 pack 内的 `officecli` 入口目录（入口只来自 `skill.url`）
4. 每个 managed 目录写 `.onmyagent-managed.json`；卸载时按 marker / `managedSkillIds` 批量清理

pack 布局示例：`officecli-skills/officecli-docx/SKILL.md`、`morph-ppt/…`（可有 `reference/` 等附属文件）。

平台键：`officecli-mac-arm64` / `officecli-mac-x64` / `officecli-win-arm64` / `officecli-win-x64`（无 Linux）。

## 可复用能力

`apps/desktop/electron/managed-tools/managed-cli/`：

| 模块 | 能力 |
|------|------|
| `config.mjs` | registry / download-config 加载 |
| `archive.mjs` | zip 解压（单文件 entry / 整包） |
| `download.mjs` | `createManagedCliDownloader`：fetch 重试、stream 落盘、`hashFile` / `verifyDigest`（sha256 必校、size 可选） |
| `version.mjs` | `x.y.z` 版本比较 |
| `errors.mjs` | `codedError` |

产品 manager（`officecli-manager`、后续飞书/腾讯文档）只保留：platform keys、binary 名、skill 物化、launcher、state schema。

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

## 配置与覆盖

**Registry（包内）：** `apps/desktop/electron/managed-tools/managed-cli-registry.json`

可选环境变量：

- `ONMYAGENT_MANAGED_CLI_REGISTRY` — 指向其它 registry JSON
- `ONMYAGENT_OFFICECLI_MANIFEST_URL` — 覆盖 officecli 的 root catalog URL（调试用）

优先级：`createOfficeCliManager` 入参 > 环境变量 > registry。

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
