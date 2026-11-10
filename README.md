# dsh-model-effort-chips

> DeepSeek Harness 的模型 / 思考强度分体控件：把输入区那颗合并的「模型 · 强度」按钮拆成两枚独立 chip。

[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![release](https://img.shields.io/github/v/release/Dreamaniax/dsh-model-effort-chips)](https://github.com/Dreamaniax/dsh-model-effort-chips/releases)
[![tests](https://github.com/Dreamaniax/dsh-model-effort-chips/actions/workflows/ci.yml/badge.svg)](https://github.com/Dreamaniax/dsh-model-effort-chips/actions/workflows/ci.yml)

> 平台：macOS 与 Windows x64 的 DSH Desktop，要求 DSH `>= 0.2.2-rc.1`。纯浏览器端 ESM，无编译、无原生依赖；安装器在 ubuntu / macOS / Windows 三平台 CI 上跑往返测试。

## 效果预览

![动效演示：粒子波动特效](docs/demo.gif)

*上面的 GIF 是 **粒子波动特效**：点开强度 chip → 滑条浮层，档位越高小球撞得越凶、频谱呼吸越深。*

默认特效是 **鲲鹏动效**：四档各一条**6 帧像素动画条**，从左向右横穿面板——off 是小鲸鱼慢游（约 9 秒一趟），max 是鲲鹏快速飞掠（约 3.5 秒一趟）；帧率与速度都随档位提高；缺图时自动回退：

![逐帧动画](docs/kunpeng-cycle.gif)

| off | high | max |
| --- | --- | --- |
| ![off](docs/kunpeng-off.png) | ![high](docs/kunpeng-high.png) | ![max](docs/kunpeng-max.png) |
| 像素鲸鱼沉睡（Z 气泡） | 生翼离水 | 像素鲲鹏展翼腾云 |

![改前改后](docs/before-after.png)

| 控件 | 长什么样 | 点开 |
| --- | --- | --- |
| 模型 chip | `[DeepSeek V4 Flash ⌄]` | 当前会话的模型目录，一步切换 |
| 强度 chip | `[high ⌄]` | 渐变轨道滑条：可点击、可拖拽、可滚轮，档位越高频谱呼吸越深、小球撞得越凶 |

- 档位按模型**动态**读取（`reasoning.efforts`）：4 档模型画 4 个停靠点，5 档模型自动变 5 个
- 换模型时档位按**序号**迁移（第 3 档 → 第 3 档），目标档位不够时夹到最近一档
- 支持浅色 / 深色主题（读宿主表面色算亮度，自动加深强调色）
- 键盘可用：←/→ 逐档，Esc 关闭，焦点回到打开它的 chip

---

## 安装

四种方式，按你的情况选一种。**Windows 用户请先看 [docs/install-windows.md](docs/install-windows.md)**（端口、Git、执行策略、排错都在那里）。

### 1. 官方 CLI（推荐，macOS / Windows，无需 Node.js、无需管理员权限）

DSH Desktop 0.2.x 自带的 `dsh` 命令可以管理 `desktop` profile 的插件。先用应用菜单
**Manage dsh Command… → Install** 装好命令，然后再操作：

```sh
# 1. 先打开一次 DSH Desktop，让它初始化 desktop profile
# 2. 菜单 Manage dsh Command… → Install，打开一个新终端确认
dsh --version

# 3. 完全退出 DSH Desktop（Windows：托盘图标 → Quit；macOS：⌘Q）

# 4. 从 GitHub 安装（会拉取一份完整包到 profile，不需要 clone）
dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips

# 或安装本机 checkout（开发用，必须是绝对路径）
dsh plugin --profile desktop add link:/Users/me/dsh-model-effort-chips
dsh plugin --profile desktop add "link:C:\Users\me\dsh-model-effort-chips"

# 5. 重新打开 DSH Desktop
```

卸载同样要先完全退出 Desktop：

```sh
dsh plugin --profile desktop remove dsh-model-effort-chips
```

> ⚠️ Windows 上如果没装 Git for Windows，`github:` 会失败——改用第 2 或第 3 种方式。
> npm 安装的 `dsh` CLI 不能管理 `desktop` profile（会报
> `profile "desktop" is managed exclusively by the Electron application`）；
> 必须用 Desktop 菜单里安装的那一个。

### 2. Plugins 页面（GUI，macOS / Windows）

DSH Desktop → 侧栏 **Plugins** → **Add plugin** → 粘贴
`github:Dreamaniax/dsh-model-effort-chips`（或本机绝对路径）→ **Install** → **Enable**，
然后完全退出并重开 Desktop。

### 3. 本地 checkout + 脚本（开发 / 离线，已验证）

```sh
git clone https://github.com/Dreamaniax/dsh-model-effort-chips.git
cd dsh-model-effort-chips
node scripts/install.mjs          # macOS / Linux；四项校验，幂等
```

Windows（不需要管理员权限，也不需要 Developer Mode；脚本优先用 PATH 里的 Node，
找不到时自动调用 DSH Desktop 自带的 Electron 运行时）：

```bat
install.cmd                       :: desktop profile
install.cmd --profile web         :: 其它 profile
install.cmd --home D:\dsh-home    :: 非默认 DSH_HOME
install.cmd --dry-run             :: 只打印要写什么
```

脚本做的正是官方 CLI 会做的事：备份 profile 的 `package.json` → 写 `link:` 依赖 →
把包名追加进 `dsh.profile.bundles` → 在 profile 的 `node_modules` 下建投影
（macOS/Linux 软链，**Windows junction**），最后四项校验。重复执行幂等；
不会修改 DSH 安装目录，也不碰其它插件。

> 为什么还保留脚本：旧版 DSH、没有 Desktop `dsh` 命令、没有 Git、需要离线安装、
> 或者正在改这个插件源码时，脚本都能装。Windows junction 不需要管理员权限。

### 4. 手动（看清楚再动）

在 `~/.dsh/profiles/<profile>/package.json` 里加两处：

```jsonc
{
  "dependencies": { "dsh-model-effort-chips": "link:/absolute/path/to/dsh-model-effort-chips" },
  "dsh": { "profile": { "bundles": [ "...", "dsh-model-effort-chips" ] } }
}
```

再建投影：macOS/Linux 用软链；Windows 用 junction（不需要管理员）：

```bat
mkdir "%USERPROFILE%\.dsh\profiles\desktop\node_modules" 2>nul
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-model-effort-chips" "C:\path\to\dsh-model-effort-chips"
```

然后完全退出并重开 DSH Desktop。

---

## 自检 / 卸载

```sh
node scripts/verify.mjs              # 自动探测本机正在运行的 DSH
node scripts/verify.mjs --port 62608 # 或显式指定端口
node scripts/verify.mjs --home /path/to/dsh-home
node scripts/uninstall.mjs           # 只删依赖记录、bundle 条目和投影，代码留着
```

Windows 直接运行根目录的 `verify.cmd` / `uninstall.cmd` 即可（会自动找 Node，
找不到就用 DSH Desktop 的 Electron 运行时；报错信息里也会给出官方 CLI 的替代命令）。

`verify.mjs` 检查五件事：依赖记录、`dsh.profile.bundles`、`node_modules` 投影可读、
投影确实指向本 checkout、宿主启动图里注入了这个包且服务端字节与本机一致。
Windows Desktop 的端口由系统随机分配、界面里看不到，不传 `--port` 时脚本会从本机
监听端口里自动找（`netstat` / `lsof`），找到带本插件的启动图为止。

---

## 特效

强度面板底部的 canvas 由一个**可插拔的特效**负责。目前有 **32 个**，菜单里按大类分组：物理仿真（5）/ 粒子场（5）/ **材质与氛围（3，像素纹理）**/ 数据与文字（3）/ 生命角色（4，像素精灵）/ 形变与过渡（3）/ 光与色（3）/ 几何线条（2）/ 波形信号（3）/ 角色演出（1）。

| 特效 | id | 天空 | 机制 |
| --- | --- | --- | --- |
| 鲲鹏动效（默认） | `kunpeng` | 84 | 四档各一条 6 帧像素动画条，从左向右横穿；帧率 3.5→10 fps、横穿 9→3.5s |
| 粒子波动特效 | `particle-wave` | 0 | 小球在 30px 鼓面弹跳碰撞；档位越高越密、重力越大、弹性越强 |
| 双摆混沌 | `double-pendulum` | 48 | 两根连杆各挂摆锤 + 12 点尾迹；L/g 随档位变，高档相位差拉大、轨迹乱 |
| 弹簧网格 | `spring-mesh` | 0 | 8×3 节点被冲量激起后回弹、波沿邻接边扩散；k=0.15+0.85e（无频谱背景） |
| 陀螺进动 | `gyroscope` | 72 | 椭圆陀螺沿铺满画板的虚线环进动；环半径/陀螺大小恒定，只有自旋 3+15e 与公转 0.2+1.4e 随档位变 |
| 多米诺 | `dominoes` | 12 | 8→32 张骨牌依次倒下、末牌回弹；**骨牌尺寸恒定**（按 32 张的最大密度定），只有数量与倒下速度变（间隔 0.18-0.1e 秒） |
| 流场 | `flow-field` | 0 | 80→240 个粒子沿 hash 噪声向量场漂移，拖短尾迹 |
| Boids 群集 | `boids` | 0 | 24→80 只个体，分离/对齐/聚合三力，边缘反弹 |
| 吸积盘 | `accretion-disk` | 0 | 差速旋转粒子盘 + 两条旋臂密度波，ω∝1/r^1.5 |
| 风沙 | `sandstorm` | 0 | 120→240 粒沙被横风与湍流扫过，粒子池复用 |
| 萤火虫同步 | `fireflies` | 0 | 24 个相位振子耦合，档位越高越同步地闪 |
| 胶片颗粒 | `film-grain` | 0 | 透明底颗粒纹平铺，档位越高越密、漂移越快 |
| FBM 云雾 | `nebula` | 0 | 透明底云带分层漂移 |
| 火焰 | `flames` | 34 | 透明底火舌纹理向上滚动，档位越高烧得越旺 |
| 七段数码管 | `seven-segment` | 0 | 三位定宽读数，未亮段保留暗影，刷新按档位节流 |
| 分段进度 | `segments` | 0 | 方块 6×12 恒定，数量从 0 增加到铺满整条滑条 |
| 仪表盘 | `gauge` | 44 | 半圆刻度 + 弹簧指针 + 三位读数 |
| 水母 | `jellyfish` | 54 | 六帧像素精灵：从左往右游，档位越高越快，同时上下浮沉 |
| 藤蔓 | `vine` | 60 | 六帧像素精灵：芽→叶→枝→花苞→开花，锚在面板底部 |
| 微生物 | `microbe` | 0 | 六帧像素精灵：游速随档位提升，六帧是**变态阶段**，档位高就越进化 |
| 花开 | `bloom` | 58 | 六帧像素精灵：花苞到盛开逐档展开 |
| 液态金属 | `metaballs` | 46 | 3–5 个圆的隐式场取等值线，靠近融合、远离分裂 |
| 挤压拉伸 | `squash` | 44 | 圆按节拍压扁/拉长、面积守恒，像果冻 |
| 极坐标变形 | `polar` | 48 | 圆→星→多边形，k 阶跃时 0.2s 交叉淡化 |
| 极光幕 | `aurora` | 76 | 2→4 条垂直渐变帘幕缓慢摆动，渐变按尺寸缓存 |
| 余晖拖尾 | `afterglow` | 34 | 16 槽环形缓冲，越旧越淡，像长曝光 |
| 黑体余烬 | `embers` | 56 | 20→70 颗火星上升，颜色从强调色混向白/暗 |
| 万花尺 | `spirograph` | 84 | 内摆线尾迹，R/r 恒为非整数，档位越高花瓣越密 |
| 傅里叶本轮 | `fourier-epicycles` | 0 | 1→7 个旋转圆首尾相连，笔尖描出曲线 |
| 谐波叠加 | `harmonics` | 0 | 1→8 条谐波叠成尖脊；分量 1/k^0.75，基频 0.5+2.5e |
| Chirp 扫频 | `chirp` | 0 | 频率 2+20e Hz 线性上扫，1.5s 一轮，相位取模保持连续 |
| 驻波 | `standing-wave` | 0 | 两端固定弦的驻波，模态 1→4 阶跃，节点固定、0.15s 淡化 |

所有动效都是 **Canvas 2D + 无第三方库**（粒子场可选使用一张 32×32 光点精灵，溶解动效可选使用一张 64×64 噪声蒙版）：`step` 只积分、`paint` 只画，
状态在 `createState` 一次建好，不启动自己的 rAF，不每帧 `new` 粒子。

**帧率无关**：弹簧网格用 1/60 固定子步 + 累加器（30/60/120Hz 下 4 秒后的状态逐位一致），
其余动效直接按 `frame.dt` 积分。实测单帧成本 0.001–0.035 ms（最慢是流场的 240 粒子 + 尾迹），相对 16.7ms 预算仍有三个数量级余量。

### 切换动效（两级菜单）

面板标题「思考强度」右边是当前特效名（默认「鲲鹏动效」）。**点一下先弹出动效大类**（物理仿真 / 粒子场 / 材质与氛围 / 数据与文字 / 生命角色 / 形变与过渡 / 光与色 / 几何线条 / 波形信号 / 角色演出），
点大类再看到该类的动效；当前生效的那一类带高亮圆点。选一项即切换，`‹ 返回` 回到大类。选择记在
`localStorage['dsh-model-effort-chips:effect']`，刷新、重启后保持。Esc 或点外部关闭菜单。

| 方式 | 怎么做 | 适合 |
| --- | --- | --- |
| 面板菜单 | 点标题右侧的特效名 → 选一项 | 日常切换 |
| 控制台 | `localStorage.setItem('dsh-model-effort-chips:effect','gyroscope')` 后刷新 | 直接跳到指定动效 |
| 改默认 | 把 `lib/client.js` 的 `DEFAULT_EFFECT_ID` 改成某个 id | 改新会话的默认值 |

### 材质的像素纹理

材质家族的六张图是 GPT Image 生成的 **128×128 无缝像素纹理**，放在 `lib/assets/texture/<id>.png`，
同样通过 `frame.art` 下发，但用法和帧条带不同：

- `createPattern(art, 'repeat')` 缓存进 state，只在换图时重建（`test/effect-texture.mjs` 断言每张图只建一次）
- 用 `save/translate/scale/fillRect/restore` 铺满自己的天空带，**不重置宿主变换**（`setTransform` 会丢掉面板的 DPR 缩放）
- 档位改的是缩放与漂移速度，不是纹素大小——像素块始终清晰
- 无图时画同构的程序化替身（点阵、条纹、正弦干涉）

### 生成素材的硬约定（GPT Image）

1. **背景必须透明**：画面里只留特效主体，其余区域是 alpha=0（低于 4% 不透明度的像素一律清零）。生成时用纯色抠像底（例如品红 `#FF00FF`），
   落地前用脚本抠掉；需要柔和边缘时按亮度转 alpha（暗底→透明，亮部→不透明），不要留整片不透明底色。
2. **方形 sprite sheet，格子均匀**：角色类是 3×2 共 6 帧（帧间留纯色空隙便于按格切分）；材质类例外，是单帧无缝平铺块。
3. **有限调色板**：主色 `#A78BFA`、暗部 `#6D3BD6`、高光 `#EDE9FE`、描边 `#2A1B4A`，不引入第二套色系。
4. **像素块要粗**：生成后按 8:1 最近邻下采样（1024→128），保住像素棱角；绘制时 `imageSmoothingEnabled = false`。
5. **尺寸契约**：生命角色 6 帧 × 48×48 条带；材质 128×128 无缝平铺块。

### 生命角色的像素精灵

五个生命角色不是程序化绘制的，而是 GPT Image 生成的像素图：每只一条 **6 帧 × 48×48** 的横向条带，
放在 `lib/assets/life/<id>.png`，由宿主加载后通过 `frame.art` 下发。

- 生成：一张 3×2 的 sprite sheet（纯品红底、有限调色板）；脚本抠掉品红、按格子切分、按统一包围盒缩放成 48×48、拼成 6×1 条带
- 播放：多数是 `state.frame = floor(t · fps(e)) % 6`；微生物是**阶段式**——`frame = floor(e·6)`，六帧即六种进化形态，换阶时 0.18s 交叉淡化
- 绘制：`imageSmoothingEnabled = false`，源矩形 `frame*48,0,48,48`，目标坐标取整，尺寸 `min(档位尺寸, 天空高 - 边距)`
- 降级：`frame.art` 为 null 时（图片未解码或 SSR 预览）画同构的矢量替身，不会出现空框
- 测试：`test/effect-art.mjs` 断言六帧都会播到、源矩形、整数像素、包围盒与降级路径

### 加一个物理动效

物理动效写成**独立文件**，并行开发互不冲突：

```sh
lib/effects/<id>.js        # 单个 const <name>Effect = { ... }
node scripts/effect-harness.mjs lib/effects/<id>.js   # 契约 + 600 帧 + 绘制坐标检查
node scripts/assemble-effects.mjs                    # 拼进 lib/client.js
```

`npm test` 会跑 `assemble-effects.mjs --check`，所以有人改了 snippet 却忘了拼装，测试会直接红。

### 鲲鹏素材

鲲鹏动效从 `lib/assets/kunpeng/{off,low,high,max}.png` 读取，宿主在 `/plugins/<包名>/assets/kunpeng/<档位>.png` 提供该路由。

- 一条横排动画，**每帧裁到主体**（如 off 6×270×168、max 6×197×168），**RGBA 透明背景**
- 帧率随档位：`3.5 + 6.5 × energy` fps
- 横穿速度也随档位：`9 - 5.5 × energy` 秒一趟，体形 `0.55 → 1.0` 倍天空带高度
- 只画主体本身和小粒子，不要底板；四张机位与配色连续；缺素材时借用任一已加载档位，全无则不画

### 面板尺寸

| 特效 | 面板 | canvas | 说明 |
| --- | --- | --- | --- |
| 粒子波动特效 | 324 × 141 | 284 × 92 | 基准尺寸，无额外高度 |
| 鲲鹏动效 | 324 × 195 | 284 × 146 | 轨道上方多出 84px 天空带，动画画在这里 |

特效用 `layout.sky` 申请天空高度，`effectiveSky()` 会把它夹到 `MAX_STAGE_SKY = 96`：
想加高度可以，但不能无限长。鲲鹏动效把动画放在天空带里，**滑条永远在它下方，不会横穿画面**。

### 轨道统一为横线

拖动条不再由特效决定样式，**所有特效共用粒子波动特效那根横线**（DOM 绘制，颜色是档位渐变色，后续可改）：

- 特效里的 `layout.track` 保留但恒为 `'bar'`；`'wave'` 已废弃
- 特效只负责 canvas 上的内容，不画轨道，也不隐藏轨道
- `layout.spectrum` 仍可控制频谱柱是否显示（鲲鹏关掉、粒子打开）

### 新增一个特效

特效是一个普通对象，注册进 `EFFECTS` 即可，不需要改 canvas、循环或面板：

```js
const myEffect = {
  id: 'my-effect',
  name: '我的特效',
  summary: '一句话说明它在做什么',
  // 轨道样式：天空高度 / 直条还是波浪 / 是否显示 DOM 频谱
  layout: { sky: 0, track: 'bar', spectrum: true },
  createState: () => ({ /* 这个特效自己的状态 */ }),
  // 每帧推进；frame = { energy, totalLevels, width, height, dt }
  step(state, frame) {},
  // 每帧绘制；frame = { energy, accent, width, height }
  paint(context, state, frame) {},
}

const EFFECTS = [particleWaveEffect, myEffect]
```

再把 `DEFAULT_EFFECT_ID` 指过去（后续会做成设置项，让每个会话/用户各选一个）。
新增特效请配一条纯函数测试，至少覆盖“档位越高强度越大”和“画布边界内”。

## 原理：为什么是插件而不是改 DSH

思考强度控件属于核心包 `@deepseek-ai/dsh-client-ui-model-selection`，打包在签名的
`app.asar` 里，只能读不能改。它对外的唯一扩展点是 `conversation.input.model.label`，
而那个槽官方注明「纯展示、不可交互」。

但输入区的座位是一个可接管的 **single 槽**：`conversation.input.model`，官方注册时没写
`priority`（= 0）。同优先级撞车会抛错，**换优先级就是遮蔽**——本插件用 `priority: -1`
接管它，全程只用公开面，不改 DSH 源码。

数据也只用公开面：

| 用途 | 接口 |
| --- | --- |
| 读目录 / 当前档位 | `ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot()` |
| 写档位 | `directory.select({ provider, model, reasoningEffort })` |
| 订阅 | `store.subscribe()` + `React.useSyncExternalStore` |

## 健壮性（踩过的坑都写进了测试）

| 风险 | 处理 |
| --- | --- |
| 服务未就绪导致 `apply` 永不执行 → 静默退回官方控件 | 插件级 `inject` 清空，服务全部惰性解析 |
| 渲染抛错 → 整个 slot 崩掉 | 渲染错误边界，降级成一颗 `⚠️ effort`（tooltip 带错误原文） |
| 选中 RPC 永不返回 → 控件永久禁用 | `busy` 不再禁用控件；4 秒看门狗重建目录实例 |
| 快速滚轮被节流吞掉 | 尾触发：窗口内保留最后一次方向 |
| 样式表热重载残留 | 样式表带版本号，版本不一致就替换 |
| 宿主全局样式压扁形状 | 几何全部内联，旋钮用 SVG 圆 |

---

## 开发与测试

```sh
npm install          # 只装测试依赖：react / react-dom / jsdom
npm test             # 客户端 + 动效 + 安装器全量
npm run test:load    # 桩宿主：数据、映射、磁吸、曲线（87 条）
npm run test:render  # 真 React SSR：席位与滑条渲染（19 条，含 1/4/5 档）
npm run test:wheel   # jsdom + 真 DOM：滚轮逐档、快拨、挂死、抛错（9 条）
npm run test:install # 假 HOME 里安装 → 重装 → 非 desktop profile → 卸载往返（42 条）
npm run test:effects # 16 个特效的契约 / 600 帧 / 边界
```

安装器测试在 `test/install.mjs`：它在系统临时目录里造一个假 `DSH_HOME`，
完整跑安装、幂等重装、`--dry-run`、换 profile、卸载和二次卸载，**不会碰真实的 `~/.dsh`**。
GitHub Actions 在 ubuntu / macOS / windows 三个平台跑同一套测试；Windows job 额外用
`install.cmd` / `uninstall.cmd` 真实验证 junction 创建和清除。

改动 `lib/client.js` 后**不需要构建**——这是手写的 ESM bundle，重启 DSH 即可加载；
如果只是想让浏览器重新取包，硬刷新就够：macOS 是 ⌘⇧R，Windows 是 Ctrl+Shift+R。

## 目录

```
lib/index.js           host 半边：空实现，只为让 client bundle 被 /plugins 提供
lib/client.js          浏览器半边：接管座位、两枚 chip、滑条、小球物理、滚轮
lib/effects/           可插拔特效的独立源文件（assemble 后拼进 client.js）
cordis.patch.yml       bundle patch：把本包插入 profile 的 plugin 名单
scripts/install.mjs    跨平台安装（macOS/Linux 软链，Windows junction）
scripts/uninstall.mjs  跨平台卸载（只删链接与两条 profile 记录）
scripts/verify.mjs     五项自检 + 自动探测运行中的 host
scripts/lib/           安装器共享的路径 / 链接 / 原子写逻辑
scripts/win/           Windows 启动器的 Node / DSH Electron 探测
install.cmd / .ps1     Windows 一键安装（无需管理员）
uninstall.cmd / .ps1   Windows 一键卸载
verify.cmd / .ps1      Windows 一键自检
test/                  client-load（桩）/ render / wheel / effects / install
.github/workflows/     ubuntu / macOS / Windows 测试矩阵
docs/install-windows.md  Windows 安装与排错
```

## 已知限制

- 依赖「single 槽 + priority 遮蔽」这一官方语义，DSH 大版本升级可能改变它；届时最差是回到官方控件
- 档位集合完全由模型自己声明，模型没声明档位时强度 chip 会整颗消失
- 官方 `/model` 弹窗未受影响，仍可正常使用
- 要求 DSH `>= 0.2.2-rc.1`；更早的 DSH（包括旧 Windows 安装包）没有本插件用的单人座位/模型目录 API，请先升级 Desktop
- Windows 的安装器、junction、客户端 bundle 测试都在 windows-latest CI 上真实跑过；桌面里的最终 UI 冒烟由 Windows 用户完成（同一份 web client，不存在平台分支）

## License

[MIT](LICENSE)
