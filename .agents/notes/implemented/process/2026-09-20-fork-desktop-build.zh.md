# Agent Note: 打包不带签名与更新源的 fork 桌面构建

Status: implemented

[English](2026-09-20-fork-desktop-build.md) | 中文

## 问题

桌面打包强制绑定官方部署：macOS 要求 Developer ID 身份、一套完整公证策略和可读的 p12，所有平台都要求强制更新策略的 origin。fork 既没有 Apple 证书，也没有发布部署，因此无法产出任何 macOS 构件，而 `--unsigned` 在 `win-x64` 之外会被拒绝。若改用官方 origin 构建，发布的更新源会把 fork 的安装替换成官方版本。

## 决策

在目标 dotenv 文件中设置 `DSH_DESKTOP_FORK=1`，即选择一个不签名、不安装更新源、也不烘焙强制更新策略的构建。该开关属于共享发布设置：它被 dotenv 文件接受，并像其它发布设置一样从 ambient 环境中剥离，因此只有目标文件能选中它。

[desktop-package-environment.mjs](../../../../apps/desktop/scripts/desktop-package-environment.mjs) 导出 `isForkDesktopBuild`，并在校验完 application id 后返回，跳过策略 origin、更新 origin、Apple 签名与公证校验、`CSC_LINK`/`CSC_KEY_PASSWORD`，以及 Windows 证书与 SignTool 校验。[package-target.ts](../../../../apps/desktop/scripts/package-target.ts) 为 fork 强制 `unsigned`，macOS 因此跳过签名钥匙串，以及那两条分别对 App 副本与 DMG 做公证、装订和校验的产物通道。[electron-builder-config.mjs](../../../../apps/desktop/scripts/electron-builder-config.mjs) 仅在 fork 时接受非 Windows 的未签名目标，关闭 `mac.forceCodeSigning`、`mac.hardenedRuntime`、`mac.notarize` 与 `dmg.sign`，在钩子中跳过签名校验与磁盘映像公证，并从打包 manifest 中省去 `dshMandatoryUpdatePolicy`。[prepare-dsh.ts](../../../../apps/desktop/scripts/prepare-dsh.ts) 跳过对 dsh 与 primary-runtime 目录树的签名。

因此打包后的应用不带策略服务启动，因为 `resolveDesktopPolicyConfig(undefined)` 返回 `undefined`；也不带更新器，因为 `publish: null` 使 electron-builder 不写 `app-update.yml`，而运行期只在存在该文件时启用更新。产物写入 `apps/desktop/.desktop-build/targets/<target>/unsigned-artifacts/`。

[desktop-package.yml](../../../../.github/workflows/desktop-package.yml) 通过该开关构建全部三个目标，并把它们发布到本仓库自己的 release：`v*` tag 发布稳定版，手动触发刷新滚动的 `preview` 预发布。每个 job 从 workflow 环境写入目标 dotenv 文件，因此流水线不需要任何签名 secret。

## 考虑过的替代方案

- 把 `--unsigned` 扩展到 macOS，而不引入独立开关。否决：这会让一个发布形态的调用产出不合规构件，而且 fork 决策还必须关闭更新源与策略，仅靠"不签名"覆盖不到。
- 放开 origin 校验器，让 GitHub release 地址充当更新源。否决：校验器要求裸 HTTPS origin，而且未签名构建本身仍无法自更新。
- 在运行期而非构建期关闭更新器与策略。否决：不烘焙配置本身已经产生这两种行为，运行期分支只会引入第二个事实来源。

## 结果

未签名构件无法自更新：macOS Squirrel 要求更新已签名，且构建不携带更新源，因此升级只能替换安装。从互联网下载的应用会被 macOS 隔离，直到用户清理一次该属性。fork 构建不生成发布完成记录，因此无法使用 `upload:*` 命令。

完整 arm64 打包已在 fork 开关下运行：该目标产出 DMG 与 ZIP，日志中没有任何签名或公证步骤，打包 manifest 不含策略字段且没有 `app-update.yml`，打包后的应用连同其 Host 正常启动。

## Testing

`apps/desktop/tests/desktop-package-environment.spec.ts` 覆盖 fork 校验路径、非法开关值与环境剥离；`apps/desktop/tests/macos-signature.spec.ts` 覆盖 fork 的 electron-builder 配置，并继续拒绝非 fork 的未签名 macOS 构建。
