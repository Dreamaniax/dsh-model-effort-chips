# Changelog

## 1.24.0 — 2026-11-10

首个明确支持 **Windows** 的版本。插件本身仍是同一份纯浏览器端 ESM；这一版把
「安装、自检、卸载」做成跨平台，并在 GitHub Actions 的 `windows-latest` 上真实验证。

### Windows 支持

- 新增官方安装路线：DSH Desktop 0.2.x 的 `dsh` 命令本来就能管理 `desktop` profile，
  `dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips` 不需要
  Node.js、不需要 clone、不需要管理员权限（`github:` 需要 Git for Windows）。
  修正了 README 里「desktop profile 一律拒绝 CLI」的过时说法——被拒绝的是 npm 安装的
  `dsh`，Desktop 菜单安装的命令可以。
- `scripts/install.mjs` 跨平台化：
  - Windows 上创建 **junction**（目录联接），不需要管理员或 Developer Mode
  - 支持 `--home <dir>` / `DSH_HOME`，不再硬编码 `~/.dsh`
  - `package.json` 原子写入，并对 Windows 的 `EACCES/EBUSY/EPERM` 重命名短暂失败做退避重试
  - 重复安装幂等（bundle 列表去重，链接可替换）
  - 已存在的真实目录不会被删除，而是改名备份；卸载只删投影，不碰源码
  - `link:` 依赖在 Windows 上写成正斜杠形式，pnpm / DSH 解析一致
- 新增 Windows 根目录启动器：`install.cmd` / `uninstall.cmd` / `verify.cmd`
  （及对应 `.ps1`）。它们依次探测 PATH 上的 `node`、`%DSH_DESKTOP_NODE_EXECUTABLE%`、
  Desktop 注册表安装项和常见安装目录；找不到 Node 时直接用 DSH 自带的 Electron
  以 `ELECTRON_RUN_AS_NODE=1` 运行，普通用户不需要另装 Node.js。
- `scripts/verify.mjs` 升级：
  - 不再要求手填端口：从本机监听端口（Windows `netstat`、macOS/Linux `lsof`）自动发现
    带本插件启动图的 host
  - 字节比对对象改为「宿主实际加载的那份 `lib/client.js`」，因此 `github:` 安装也能自检
  - 新增 `--url` / `--home`
- 新增 `test/install.mjs`：在系统临时目录造一个假 `DSH_HOME`，覆盖 dry-run、安装、
  幂等重装、非 desktop profile、卸载、二次卸载、缺 profile 报错等 33 项检查，不碰真实
  `~/.dsh`。
- 新增 GitHub Actions CI：ubuntu / macOS / windows × Node 20/22；Windows job 额外用
  `install.cmd` 验证 junction 创建与清除。

### 文档

- README 安装章节重写：官方 CLI（推荐）→ Plugins GUI → 本地脚本 → 手动，四条路线。
- 新增 [Windows 安装指南](docs/install-windows.md)：路线选择表、端口发现、PowerShell
  执行策略、Git/代理、OneDrive/网络盘 junction 失败、升级后排错、回滚。
- 修正硬刷新提示：macOS `⌘⇧R`，Windows `Ctrl+Shift+R`。

### 自 1.16.0 以来的功能

- 特效从 2 个扩展到 **16 个**，菜单按五类分组（物理仿真 5 / 粒子场 5 / 几何线条 2 /
  波形信号 3 / 角色演出 1），两级菜单切换，选择记在 localStorage。
- 新增：物理仿真（双摆、弹簧网格、陀螺进动、多米诺）、粒子场（流场、Boids、吸积盘、
  风沙、萤火虫同步）、几何线条（万花尺、傅里叶本轮）、波形信号（谐波叠加、Chirp 扫频、
  驻波）。
- 修复特效菜单在真实应用里无法点击、listbox 归属子节点、ARIA、画布越界等问题。
- 轨道统一为所有特效共用的横线；`layout.sky` 申请天空高度并夹到上限。

## 1.16.0 — 2026-11-09

- 合并为单一鲲鹏动效（6 帧像素动画条，四档不同帧率与横穿速度）。

## 1.15.0 及更早

- 模型 / 思考强度分体控件、可拖拽/滚轮滑条、浅深主题、错误降级、看门狗与键盘可达性。
- 可插拔特效框架与粒子波动特效。
