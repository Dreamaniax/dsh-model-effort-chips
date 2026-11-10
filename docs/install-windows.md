# Windows 安装指南

> 适用：Windows 10 / 11 x64 上的 DeepSeek Harness Desktop，DSH `>= 0.2.2-rc.1`。
> 插件是纯浏览器端 ESM，没有原生依赖；Windows 和 macOS 加载的是同一份客户端 bundle。

## 先选路线

| 你的情况 | 推荐方式 | 需要 Node.js | 需要 Git | 需要管理员 |
| --- | --- | --- | --- | --- |
| 已装 Desktop，想最省事 | 官方 `dsh plugin` 命令（方式 A） | 否 | `github:` 方式需要 | 否 |
| 不想开终端 | Plugins 页面（方式 B） | 否 | `github:` 方式需要 | 否 |
| 没有 Git、要离线 | 下载 Release zip + `install.cmd`（方式 C） | 否* | 否 | 否 |
| 自己在改插件源码 | `install.cmd` 或 `node scripts/install.mjs`（方式 C） | 是（或 DSH 自带运行时） | 否 | 否 |

\* `install.cmd` 会优先用 PATH 里的 `node`；找不到时自动调用 DSH Desktop 自带的
Electron 运行时（`ELECTRON_RUN_AS_NODE=1`），所以普通用户不需要单独装 Node.js。

---

## 方式 A：官方 CLI（推荐）

DSH Desktop 0.2.x 自带一个可以管理 `desktop` profile 的 `dsh` 命令。**npm 安装的 `dsh`
不行**，它会拒绝（`profile "desktop" is managed exclusively by the Electron application`）。

1. 打开一次 DSH Desktop，等主界面出现（初始化 `%USERPROFILE%\.dsh\profiles\desktop`）。
2. 应用菜单 → **Manage dsh Command… → Install**。安装器会把命令写进当前用户的 PATH。
3. **关掉这个窗口，重新开一个 PowerShell 或 CMD**（PATH 只在新的终端里生效），确认：

   ```powershell
   dsh --version
   ```

4. **完全退出 Desktop**：不要只点窗口的 ×（那只是隐藏到托盘），要右键托盘图标 → **Quit**。
   官方要求退出后再改 profile，否则会撞上 profile 锁。
5. 安装插件：

   ```powershell
   # 从 GitHub 拉一份完整包（需要 Git for Windows）
   dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips

   # 或者装本机目录（绝对路径，开发用；引号可防止空格被拆开）
   dsh plugin --profile desktop add "link:C:\Users\me\dsh-model-effort-chips"
   ```

6. 重新打开 DSH Desktop。输入区原来的「模型 · 强度」按钮会变成两枚 chip。

卸载（同样先完全退出 Desktop）：

```powershell
dsh plugin --profile desktop remove dsh-model-effort-chips
```

> 说明：`dsh plugin add` 会自动把 `link:` 依赖写进 profile 的 `package.json`、
> 把包名加进 `dsh.profile.bundles`，并用 pnpm 建好 junction。这正是本插件
> `install.cmd` 手工做的事，只是交给官方实现。

---

## 方式 B：Plugins 页面（GUI）

1. Desktop → 侧栏 **Plugins** → **Add plugin**。
2. 输入 `github:Dreamaniax/dsh-model-effort-chips`（或本机绝对路径）。
3. **Install** → **Enable**。
4. 完全退出并重开 Desktop（客户端 bundle 在启动时注入）。

如果 `github:` 报网络/认证失败，先确认 Git 可用，或改用方式 C 的本地路径。

---

## 方式 C：Release zip / 源码 + install.cmd

适合没有 Git、没有 Node、或需要离线的机器。

1. 到 [Releases](https://github.com/Dreamaniax/dsh-model-effort-chips/releases) 下载
   `dsh-model-effort-chips-<版本>.zip`，解压到一个**长期保留**的目录，例如
   `C:\Users\me\dsh-plugins\dsh-model-effort-chips`（删掉这个目录插件就失效）。
2. 如果 zip 是从浏览器下载的，右键 zip → **属性** → 勾选 **Unblock** 再解压，
   避免 SmartScreen/Mark-of-the-Web 拦截脚本。
3. 在该目录打开 CMD 或 PowerShell：

   ```bat
   install.cmd
   ```

   其它用法：

   ```bat
   install.cmd --dry-run              :: 只打印要改的 package.json，不落地
   install.cmd --profile web          :: 装进非 desktop profile
   install.cmd --home D:\dsh-home     :: DSH_HOME 不在默认位置
   ```

4. 脚本会打印 `[install] OK`。完全退出并重开 Desktop。

从源码 clone 的情况完全一样：

```bat
git clone https://github.com/Dreamaniax/dsh-model-effort-chips.git
cd dsh-model-effort-chips
install.cmd
```

### 它到底改了什么

| 位置 | 改动 |
| --- | --- |
| `%USERPROFILE%\.dsh\profiles\desktop\package.json` | `dependencies["dsh-model-effort-chips"] = "link:C:/…/dsh-model-effort-chips"`；`dsh.profile.bundles` 追加包名（去重） |
| `…\profiles\desktop\node_modules\dsh-model-effort-chips` | **junction**（目录联接）指向解压目录 |
| 同目录 `package.json.bak-model-effort-chips` | 首次安装前的原样备份 |

不会写入 DSH 安装目录（`C:\Users\me\AppData\Local\Programs\DeepSeek Harness` 之类），
也不会动别的插件的配置。junction 不需要管理员，也不需要开启 Developer Mode。

### Node 是怎么找到的

`install.cmd` → `install.ps1` → `scripts\win\node-runtime.ps1`，依次尝试：

1. PATH 上的 `node`
2. `%DSH_DESKTOP_NODE_EXECUTABLE%`（DSH 给子进程设置的环境变量）
3. 注册表卸载项里 DeepSeek Harness 的 `InstallLocation`
4. `%LOCALAPPDATA%\Programs\DeepSeek Harness`、`%ProgramFiles%\DeepSeek Harness` 等常见目录

找到 Desktop 的 `DeepSeek Harness.exe` 后，用 `ELECTRON_RUN_AS_NODE=1` 直接跑脚本，
这就是 DSH 自己运行 CLI 的方式。都不行时脚本会打印官方 CLI 的替代命令并退出。

---

## 验证

```bat
verify.cmd
```

Windows Desktop 的宿主端口是系统随机分配的，界面里看不到。`verify.cmd` 不传 `--port`
时会从本机监听端口（`netstat -ano -p tcp`）里自动找，挑出启动图里带本插件的那个，然后：

- 检查依赖记录、`dsh.profile.bundles`、junction 可读、junction 指向本 checkout
- 检查宿主启动图里确实注入了这个包
- 拉一次 `/plugins/<包>/…` 与本地 `lib/client.js` 逐字节比对

也可以显式指定：

```bat
verify.cmd --port 62608
verify.cmd --home D:\dsh-home
```

期望结尾是 `PLUGIN OK`。

## 卸载

```bat
uninstall.cmd
```

只删 `link:` 依赖、`dsh.profile.bundles` 里的包名和 junction，**解压目录原样保留**。
如果已经用官方 CLI 装过，用 `dsh plugin --profile desktop remove dsh-model-effort-chips`。

---

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `dsh : 无法将“dsh”项识别为 cmdlet…` | 新开的终端才行；或菜单 **Manage dsh Command… → Install** 没做。也可用 `install.cmd` |
| `profile "desktop" is managed exclusively by the Electron application` | 用的是 npm 安装的 dsh。改用 Desktop 菜单装的 `dsh`，或 `install.cmd` |
| `Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it` | 先打开一次 Desktop；改 profile 前必须完全退出（托盘 → Quit） |
| `install.cmd` 闪一下就没 | 在 CMD 里运行看输出；或 `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1` |
| `无法加载文件 …install.ps1，因为在此系统上禁止运行脚本` | `.cmd` 已带 `-ExecutionPolicy Bypass`；若是手动跑 `.ps1`，用 `powershell -ExecutionPolicy Bypass -File install.ps1` |
| `github:` 安装卡住或认证失败 | 没装 Git for Windows，或代理/公司网络限制。用 `install.cmd` 的本地目录方式 |
| 安装成功但界面没变化 | 没完全退出 Desktop（窗口 × 只是隐藏）。托盘 → Quit 后重开；或在页面上 Ctrl+Shift+R |
| 端口找不到 / `verify.cmd` 只跑完静态检查 | Desktop 没启动，或 host 端口被防火墙隔离。先启动 Desktop，再 `verify.cmd` |
| junction 创建失败 | 解压目录在 OneDrive/网络盘/非 NTFS 上。换到本地 NTFS 目录，或改用官方 `dsh plugin` |
| 升级 Desktop 后插件不见 | 确认 `dsh.profile.bundles` 仍有包名、junction 仍指向存在的目录；重跑 `install.cmd` |
| 插件加载但提示版本不兼容 | DSH 低于 `0.2.2-rc.1`。升级 Desktop（Windows 安装包与 macOS 同一发布线） |

### 端口手动确认

```bat
netstat -ano -p tcp | findstr LISTENING | findstr 127.0.0.1
```

逐个试 `verify.cmd --port <端口>`；带本插件启动图的那个会返回 `PLUGIN OK`。

---

## 回滚

1. `uninstall.cmd`（或 `dsh plugin --profile desktop remove dsh-model-effort-chips`）
2. 完全退出并重开 Desktop
3. 如果自定义过 profile，可把 `package.json.bak-model-effort-chips` 覆盖回去

插件只接管输入区的一个 UI 座位，最坏情况是回到 DSH 官方模型控件，不会影响会话数据。
