# 03 · DSH 落地规范：从 effect contract 到代码骨架

> ▎ 别急着画。先把坐标系、帧预算、可测边界钉死——否则 preview 好看、实机白干，返工两遍都算少的。

读者：插件作者本人。本文只写**可执行动作**，不写「建议优化」。所有行号以当前 `lib/client.js`（1878 行，包版本 1.7.0）为准；行号会漂，锚点字符串不会。

---

## 0. 现状核对（本文事实基线）

先跑一遍，确认你和本文看到的是同一个世界：

```sh
node --version                 # v20+ 即可
npm test                       # 期望 exit 0，四行 PASSED
node scripts/preview-effect.mjs kunpeng 0.66 /tmp/k.png.svg
sips -g pixelWidth -g pixelHeight docs/kunpeng-high.png
```

| 事实 | 值 | 证据 |
| --- | --- | --- |
| 包版本 | 1.7.0 | `package.json:3` |
| 客户端 bundle | 手写 ESM，无构建 | `lib/client.js`，改完重启 DSH 生效 |
| 测试基线 | 4 套全过：load / render / wheel / kunpeng | `npm test` 输出四行 `... PASSED` |
| 现有特效 | `particle-wave`、`kunpeng` | `lib/client.js:627` |
| 默认特效 | `kunpeng` | `lib/client.js:630` |
| preview 画布 | 284 × 164 | `scripts/preview-effect.mjs:24-25` |
| docs PNG | 682 × 394 | `sips` 实测现有 `docs/kunpeng-*.png` |
| 画布宿主 | DPR ≤ 2、ResizeObserver、rAF、单帧 reduced-motion | `lib/client.js:1088-1168` |
| 拖动时 energy | 小数 `previewFraction` | `lib/client.js:1195-1200` |

> **P0 前置问题（必须先修，否则新增特效一定错位）**
>
> 当前 `lib/client.js` 在 `1389` 与 `1398` 各挂了一个 `EffectCanvas`（行号按 HEAD `cf353fa`）；宿主给 `trackY = sky + 30 + 16`，而 `.mec-stage` 的高度只有 `sky + 30`（鲲鹏 = 106），缎带的 y=122 落在画布外。实机表现是「预览对、面板里缎带不见」。完整证据与修法见 §7.1。本文其余章节默认这个 P0 已修。

---

## 1. 从 0 加一个特效：精确步骤

目标：新增 `my-effect`，不改 `EffectCanvas`、不改面板布局、不碰 CSS。

### 1.1 改动地图

| # | 文件 | 锚点（直接搜索这串） | 动作 |
| --- | --- | --- | --- |
| 1 | `lib/client.js` | `/** Every effect the plugin knows. */` | 在它**前面**插入 helper + effect 对象 |
| 2 | `lib/client.js` | `const EFFECTS = [particleWaveEffect, kunpengEffect]` | 追加 `, myEffect` |
| 3 | `lib/client.js` | `const DEFAULT_EFFECT_ID = 'kunpeng'` | 只有决定让它当默认时才改 |
| 4 | `lib/client.js` | `exports.__internals = {` | 补 `myEffect` 与所有纯函数 |
| 5 | `package.json` | `"test": "node test/client-load.mjs &&` | 链尾加 `&& node test/effect-my-effect.mjs` |
| 6 | `package.json` | `"test:effect": "node test/effect-kunpeng.mjs"` | 加一条 `test:effect:my-effect` |
| 7 | `test/effect-my-effect.mjs` | 新文件 | 照 §4.3 骨架写 |
| 8 | `README.md` | `## 效果预览` | 加三张图（仅当值得展示 / 默认特效变化） |
| 9 | `README.md` | `## 特效` | 表格加一行；`### 新增一个特效` 补验收命令 |
| 10 | `docs/my-effect-*.png` | 新文件 | `off` / `high` / `max` 三张，682 × 394 |

不需要动的：`lib/index.js`（host 半边空实现）、`cordis.patch.yml`、`scripts/install.mjs`、CSS（除非你加设置 UI）。

### 1.2 先写纯函数，再写特效对象

插在 `drawKunpeng` 的收尾 `}` 之后、`/** Every effect the plugin knows. */` 之前。**必须**在 `const EFFECTS` 之前，否则 TDZ 直接抛 `ReferenceError`。

```js
		// --------------------------------------------------- 我的特效 helpers

		/** 0..1 -> 0..1：慢起步、末档爆发的指数曲线。 */
		function myIntensityFor(energy) {
			const t = clamp01(energy)
			return (Math.pow(4, t) - 1) / 3
		}

		/** 圆点数量：off 为 0，随后 6 / 11 / 15，供 O(n) 绘制。 */
		function myDotCountFor(energy, totalLevels = 4) {
			const levels = Math.max(1, totalLevels)
			const position = clamp01(energy) * (levels - 1)
			if (position <= 0.08) return 0
			return Math.min(18, Math.round(6 * Math.pow(position, 0.85)))
		}

		/**
		 * 我的特效 (my-effect) — 沿轨道升起的一排圆点。
		 *
		 * 视觉机制：圆点数量与亮度随 energy 指数增长；时间只负责呼吸相位。
		 * 能量映射：count = myDotCountFor(energy, totalLevels)；
		 *          alpha = 0.25 + 0.65 * myIntensityFor(energy)。
		 */
		const myEffect = {
			id: 'my-effect',
			name: '我的特效',
			summary: '一排随档位增多、变亮的圆点',
			layout: { sky: 0, track: 'bar', spectrum: true },

			createState: () => ({ time: 0 }),

			step(state, frame) {
				state.time += frame.dt
			},

			paint(context, state, frame) {
				const { energy, accent, width, height } = frame
				const trackY = frame.trackY ?? height - 42
				const level = clamp01(energy)
				const count = myDotCountFor(energy, frame.totalLevels ?? 4)
				context.save()
				context.fillStyle = accent
				context.globalAlpha = 0.25 + 0.65 * myIntensityFor(level)
				for (let index = 0; index < count; index += 1) {
					const x = (width / (count + 1)) * (index + 1)
					const y = trackY - 6 - 10 * level * Math.abs(Math.sin(state.time * 3 + index))
					context.beginPath()
					context.arc(x, y, 2, 0, Math.PI * 2)
					context.fill()
				}
				context.restore()
			},
		}
```

硬性规则：

- **对象必须模块级、引用稳定**。`EffectCanvas` 的 effect 依赖是 `[effect]`（`lib/client.js:1159`）；每次 render 新建对象 = 每帧拆掉 rAF 再重建。
- **`createState` 只放可变状态**，不要放 canvas / ctx / DOM 引用。宿主不提供 `destroy` 钩子，清理只能靠 effect 卸载时 GC。
- **`step` 不绘制，`paint` 不改状态**。`paint` 里改 `state` 会让 preview 的 12 帧暖机结果不可复现。
- **每个 frame 都可能缺字段**。测试与 preview 都不保证 `totalLevels` / `trackY` / `band` 存在；用 `??` 给默认值。
- **`energy` 进来先 `clamp01`**。拖动时理论上是 0..1，但别赌上游。

### 1.3 注册

```js
		/** Every effect the plugin knows. */
		const EFFECTS = [particleWaveEffect, kunpengEffect, myEffect]
```

- 默认追加到**末尾**。
- `EFFECTS[0]` 同时是「未知 id 的回退目标」，见 `resolveEffect`（`lib/client.js:633-635`）。除非你明确要改回退语义，否则不要往数组头部插。

### 1.4 默认特效

```js
		/** The effect currently painted in the effort panel. */
		const DEFAULT_EFFECT_ID = 'my-effect'
```

只在产品上决定「首次打开就用它」时改。约束：

- `DEFAULT_EFFECT_ID` 必须是 `EFFECTS` 里的 id，测试 `test/effect-kunpeng.mjs:125-128` 会断言这一点。
- 改默认值**不改变**未知 id 的回退目标；回退目标永远是 `EFFECTS[0]`。
- 已有用户如果做过设置（§5），存储值优先于 `DEFAULT_EFFECT_ID`。

### 1.5 `__internals` 要补什么

```js
		exports.__internals = {
			myEffect,
			myIntensityFor,
			myDotCountFor,
			// ...existing entries
```

判定标准：**测试里要断言的每一个标识符都必须从这里出**。原因：测试通过 `new Function` 加载 bundle，只能拿到 `module.__internals`；不导出的纯函数只能靠 `EFFECTS.find(...)` 拿特效对象，拿不到 helper。

现有导出在 `lib/client.js:1839-1875`，已包含 `EFFECTS`、`DEFAULT_EFFECT_ID`、`resolveEffect`、两个 effect 对象及其 helper。照这个密度补，不要只补 effect 对象。

### 1.6 测试接线与预期输出

`package.json:39-43`：

```json
    "test": "node test/client-load.mjs && node test/render.mjs && node test/wheel.mjs && node test/effect-kunpeng.mjs && node test/effect-my-effect.mjs",
    "test:effect:my-effect": "node test/effect-my-effect.mjs"
```

`npm test` 的期望输出（顺序固定）：

```text
CLIENT LOAD TEST PASSED
REAL-REACT RENDER TEST PASSED
WHEEL DOM TEST PASSED
KUNPENG EFFECT TEST PASSED
MY-EFFECT TEST PASSED
```

任何一行缺失或 exit != 0，都不算完成。

### 1.7 preview：先出 SVG

```sh
node scripts/preview-effect.mjs my-effect 0   /tmp/my-effect-off.svg
node scripts/preview-effect.mjs my-effect 0.66 /tmp/my-effect-high.svg
node scripts/preview-effect.mjs my-effect 1   /tmp/my-effect-max.svg
```

行为（`scripts/preview-effect.mjs`）：

| 项 | 值 | 位置 |
| --- | --- | --- |
| 画布 | 284 × 164 | `:24-25` |
| energy | 由命令行传入，不 clamp | `:21` |
| 暖机 | 12 帧，dt = 1/30 | `:235-239` |
| 摆位 | 若 `state.x` 是 number，强制放到 45% 宽 | `:241` |
| 绘制 | `paint` 调一次 | `:242-250` |
| 背景 | `#1a1d22` | `:263` |

**preview 不是完整 Canvas 2D**。它把 paint 调用重放成 SVG，只实现了下面这些：

| 支持 | 不支持（会 `TypeError` 或静默失真） |
| --- | --- |
| `save` / `restore` / `translate` / `scale` / `rotate` | `bezierCurveTo`、`arcTo`、`ellipse`、`rect`、`roundRect` |
| `beginPath` / `moveTo` / `lineTo` / `quadraticCurveTo` / `arc` / `closePath` | `clip`、`setLineDash`、`createRadialGradient`、`createPattern` |
| `fill` / `stroke` / `createLinearGradient` + `addColorStop` | `drawImage`、`fillText`、`strokeText`、`clearRect`（空实现） |
| `fillStyle` / `strokeStyle` / `globalAlpha` / `lineWidth` / `lineCap` / `lineJoin` | `globalCompositeOperation`、`filter`、`shadowBlur`（setter 是空实现） |

两条推论：

1. 新特效若用 `bezierCurveTo` 画曲线，preview 会直接抛错。要么改用 `quadraticCurveTo` / 多段 `lineTo`，要么先扩 preview 录制器。
2. `shadowBlur` 在 SVG 里**不会出现**。preview 只能验几何与配色，辉光必须开实机看。

### 1.8 SVG → PNG

现有 `docs/kunpeng-*.png` 是 682 × 394（= 284 × 164 的 2.4 倍）。两种出图方式：

**首选 qlmanage（矢量放大，清晰）**

```sh
qlmanage -t -s 682 -o /tmp /tmp/my-effect-max.svg
mv /tmp/my-effect-max.svg.png docs/my-effect-max.png
sips -g pixelWidth -g pixelHeight docs/my-effect-max.png   # 682 x 394
```

注意：qlmanage 在受限沙箱里会报 `sandbox initialization failed: Operation not permitted`（本文验证时实际遇到）。在 **Terminal.app** 里跑；若仍失败，用下面的 sips 兜底。

**兜底 sips（1× 光栅后放大，略软）**

```sh
sips -s format png /tmp/my-effect-max.svg --out docs/my-effect-max.png
sips -z 394 682 docs/my-effect-max.png
```

命名约定（跟现有 `kunpeng-*` 对齐）：

| 文件 | energy | 用途 |
| --- | --- | --- |
| `docs/<id>-off.png` | 0 | README 第一列，证明 off 真的安静 |
| `docs/<id>-high.png` | 0.66 | 4 档的 high / 5 档的 medium-high |
| `docs/<id>-max.png` | 1 | 证明末档质变 |
| `docs/<id>-medium.png` | 0.5 | 只有 5 档叙事需要时加 |

不要提交 `/tmp/*.svg`；`docs/` 只放 PNG。

### 1.9 README 补哪两节

**第一节：`## 效果预览`（`README.md:7`）**。若新特效值得展示或成为默认，加三列表：

```markdown
| off | high | max |
| --- | --- | --- |
| ![off](docs/my-effect-off.png) | ![high](docs/my-effect-high.png) | ![max](docs/my-effect-max.png) |
| 静止 | 半数点亮 | 全亮，节奏最快 |
```

**第二节：`## 特效`（`README.md:88`）**。两处：

1. 特效目录表加一行：

```markdown
| 我的特效 | `my-effect` | 一排随档位增多、变亮的圆点 |
```

2. `### 新增一个特效`（`README.md:110`）末尾补验收段：

````markdown
新增特效的验收：

```sh
npm run test:effect:my-effect
node scripts/preview-effect.mjs my-effect 1 /tmp/my-effect-max.svg
```
````

另外在 `## 开发与测试`（`README.md:165`）的命令列表里补一行 `npm run test:effect:my-effect`。

### 1.10 落地验收清单

| 检查 | 命令 / 动作 | 期望 |
| --- | --- | --- |
| 类型 | `node --check lib/client.js` | 无输出（ESM 语法合法） |
| 全量测试 | `npm test` | exit 0，五行 PASSED |
| 单测 | `npm run test:effect:my-effect` | `MY-EFFECT TEST PASSED` |
| 预览 | §1.7 三个 energy | 三个 SVG 非空；off 允许空 |
| PNG | `sips` 查尺寸 | 682 × 394 |
| canvas 数 | DevTools：`document.querySelectorAll('.mec-drops').length` | **1**（P0 修完后） |
| canvas 高 | `canvas.height / devicePixelRatio` | `layout.sky + 30 + 58` |
| 实机 | 硬刷新（⌘⇧R）→ 点开强度 chip | 动效可见，拖动连续 |
| 浅色主题 | 系统切浅色 | 不出现白底白线 |
| 窄画布 | 窗口压到 320px | 面板不溢出，动效仍可读 |
| reduced-motion | 系统开「减弱动态效果」 | 一帧静态图，不空 |
| 面板关闭 | Performance 录 2s | 无持续 rAF 绘制 |

---

## 2. 能量曲线工具箱

### 2.1 三条铁律

1. **先归一化，再接视觉参数**。任何曲线必须满足 `f(0)=0`、`f(1)=1`。带基线的公式（如 `0.5 + 0.85*e`）会把 33% 档抬到 39% 视觉量，低档不再「安静」。
2. **按真实档位采样验收**。4 档只采样 `[0, 1/3, 2/3, 1]`，5 档采样 `[0, 0.25, 0.5, 0.75, 1]`。连续量相邻差 < 0.05 视为不可辨；计数类相邻差必须 ≥ 1。
3. **一个通道一条曲线**。数量、尺寸、速度、透明度不要共用同一条曲线；否则低档只是「缩小版 max」，不是另一种状态。

归一化工具（放 helper 区，供所有曲线复用）：

```js
		/** 把任意单调曲线压到 f(0)=0、f(1)=1。 */
		function normalizeCurve(curve) {
			const low = curve(0)
			const high = curve(1)
			const span = high - low
			return (energy) => {
				if (span === 0) return 0
				return clamp01((curve(clamp01(energy)) - low) / span)
			}
		}
```

只允许在模块初始化时调用 `normalizeCurve` 生成一次函数；不要在每帧里调用它生成新闭包。

### 2.2 六条可直接粘贴的曲线

#### 线性

```js
		/** 等速。适合时间相位、轨道位置；不适合「末档质变」。 */
		function linearCurve(energy) {
			return clamp01(energy)
		}
```

4 档值：`0 / 0.333 / 0.667 / 1`。相邻差恒为 0.333。

#### easeOutCubic

```js
		/** 快起步、慢收尾：适合出场、回弹、余波衰减。 */
		function easeOutCubic(energy) {
			const t = clamp01(energy)
			return 1 - Math.pow(1 - t, 3)
		}
```

4 档值：`0 / 0.704 / 0.963 / 1`。**不要拿它做强度映射**：1/3 档就到 70%，high→max 只差 0.037，末档等于没变化。它适合「剩余量」或「衰减到静止」，以及 `1 - easeOutCubic(1 - t)` 这种反向用法（等价 `t^3`，4 档值 `0 / 0.037 / 0.296 / 1`，适合慢起步）。

#### 指数

```js
		/** 慢起步、末档爆发：适合数量、亮度、粒子密度。 */
		function exponentialCurve(energy, base = 4) {
			const t = clamp01(energy)
			return (Math.pow(base, t) - 1) / (base - 1)
		}
```

4 档值（base=4）：`0 / 0.196 / 0.507 / 1`。相邻最小差 0.196，末档跳 0.493。`base=6` 时 5 档首步会掉到 0.09 左右；想保低档可辨，`base` 控制在 3–4。

#### 逻辑斯蒂（阈值感）

```js
		/** S 曲线：midpoint 前压住，之后陡升。适合「最后一档才觉醒」。 */
		function logisticCurve(energy, midpoint = 0.55, steepness = 9) {
			const t = clamp01(energy)
			const low = 1 / (1 + Math.exp(steepness * midpoint))
			const high = 1 / (1 + Math.exp(-steepness * (1 - midpoint)))
			const raw = 1 / (1 + Math.exp(-steepness * (t - midpoint)))
			return (raw - low) / (high - low)
		}
```

4 档值：`0 / 0.120 / 0.752 / 1`。5 档值：`0 / 0.057 / 0.392 / 0.872 / 1`。

用途：雷暴、觉醒、Boss 二阶段、门槛出现。代价：5 档第一跳只有 0.057，低档几乎不可见；如果产品要求「每档都明显」，把 `midpoint` 降到 0.5、`steepness` 降到 5，或直接换指数。

实现注意：一次调用算 3 个 `Math.exp`，只允许每帧算一次并缓存到局部变量；不要在每个粒子循环里调用。

#### 阶跃（分档跳变）

```js
		/** 把连续 energy 切成 steps 段，段内恒定。 */
		function stepCurve(energy, steps = 4) {
			const count = Math.max(1, Math.round(steps))
			if (count <= 1) return 1
			const t = clamp01(energy)
			const index = Math.min(count - 1, Math.floor(t * count + 1e-9))
			return index / (count - 1)
		}
```

**诚实结论：在 4 档模型上它是恒等映射**（`0 / 0.333 / 0.667 / 1`），因为档位值本身就落在段边界。它真正解决三件事：

1. 拖动中的小数 energy 要「吸附到段」，避免视觉抖动；
2. 5 档模型需要把连续量切成 5 段（`steps=5`）；
3. 一个参数要按自定义阶段表跳变——用下面这个更直接：

```js
		/** 按阶段表取值，例如 [0, 0.12, 0.45, 1]。 */
		function bandCurve(energy, values) {
			if (!Array.isArray(values) || values.length === 0) return 0
			if (values.length === 1) return values[0]
			const t = clamp01(energy)
			const index = Math.min(values.length - 1, Math.floor(t * values.length + 1e-9))
			return values[index]
		}
```

注意：`stepCurve(energy, 4)` 用在 5 档模型会得到 `0 / 0.333 / 0.667 / 1 / 1`，最后两档合并。要么传 `steps = totalLevels`，要么明确接受合并。

#### 脉动（时间 × 能量）

```js
		/** 呼吸/心跳：energy 决定幅度，time 决定相位。depth 建议 ≤ 0.6，避免高档瞬间归零。 */
		function pulseCurve(energy, time, rate = 6, depth = 0.55) {
			const t = clamp01(energy)
			const wave = 0.5 + 0.5 * Math.sin(time * rate)
			return t * (1 - depth + depth * wave)
		}
```

在 `time=0.5, rate=6` 时，4 档值约 `0 / 0.255 / 0.509 / 0.764`。

频率随档位上升时，**不要写 `sin(time * rate(energy))`**——rate 变化会瞬移相位，画面抽搐。把相位积分进 state：

```js
			step(state, frame) {
				const level = clamp01(frame.energy)
				state.phase += frame.dt * (3 + 4 * level)
			},

			paint(context, state, frame) {
				const wave = 0.5 + 0.5 * Math.sin(state.phase)
				const alpha = clamp01(frame.energy) * (0.45 + 0.55 * wave)
				context.globalAlpha = alpha
				context.fillStyle = frame.accent
				context.beginPath()
				context.arc(frame.width / 2, frame.trackY ?? frame.height - 42, 3, 0, Math.PI * 2)
				context.fill()
			},
```

### 2.3 采样对照（拿这张表选曲线）

| 曲线 | 4 档值（0, 1/3, 2/3, 1） | 4 档最小相邻差 | 5 档值（0, .25, .5, .75, 1） | 5 档最小相邻差 | 适合 |
| --- | --- | --- | --- | --- | --- |
| 线性 | 0 / .333 / .667 / 1 | .333 | 0 / .25 / .5 / .75 / 1 | .250 | 时间相位、位置 |
| easeOutCubic | 0 / .704 / .963 / 1 | **.037** | 0 / .578 / .875 / .984 / 1 | **.016** | 出场、衰减、剩余量 |
| 指数 base=4 | 0 / .196 / .507 / 1 | .196 | 0 / .138 / .333 / .609 / 1 | .138 | 数量、亮度、密度 |
| 逻辑斯蒂 m=.55 k=9 | 0 / .120 / .752 / 1 | .120 | 0 / .057 / .392 / .872 / 1 | **.057** | 阈值、觉醒、末档质变 |
| 阶跃 steps=4 | 0 / .333 / .667 / 1 | .333 | 0 / .333 / .667 / 1 / 1 | **0** | 吸附、分档跳变 |
| 脉动 depth=.55 | 0 / .255 / .509 / .764 | .254 | 相位相关 | 相位相关 | 呼吸、心跳、闪烁 |

### 2.4 为什么不能只用线性

1. **4 个采样点撑不起「末档质变」**。线性给的是 3 段等距变化；如果产品叙事是「max 才真正爆发」，等距分配把预算浪费在中档，max 只是「再高一格」。指数/逻辑斯蒂把变化压到后段，才能让末档成为事件。
2. **基线会偷走低档**。`kunpengScaleFor` 是 `0.5 + 0.85*e`（`lib/client.js:400-402`）：33% 档已经拿到 39% 的视觉尺寸，off 也不是 0。要么归一化，要么把基线算进设计。
3. **感知是非线性的**。亮度、面积、速度的主观强度近似幂律；线性物理量在末段看起来「涨不动」。尺寸/亮度用指数，速度用线性，是更稳的组合。
4. **多通道同曲线 = 低档只是缩小版**。数量、尺寸、速度全部线性时，4 档看起来像同一张图等比缩放，缺少「状态切换」。让数量走指数、速度走线性、透明度走逻辑斯蒂，每档才有独立性格。
5. **线性没有时间维度**。只做 `energy -> 参数` 是滑条，不是动效。呼吸/心跳/闪烁必须引入相位，而且相位要积分，不能乘 rate。
6. **计数类会饱和**。现有 `particleCountFor`（`lib/client.js:246-251`）在 4 档的 high 与 max 都返回 14（`6*2^1.25≈14.3`、`6*3^1.25≈23.7`，都撞 `Math.min(14, ...)`）；5 档的 medium/high/max 也全是 14。也就是说数量通道在 4 档只有 3 个不同值（0/6/14）。新增计数曲线必须用 §4.4 的相邻差断言，别让高档合并。

### 2.5 通道选型表

| 动效类型 | 数量 | 尺寸/幅度 | 速度/频率 | 亮度/透明度 | 主曲线 |
| --- | --- | --- | --- | --- | --- |
| 粒子/群集 | 指数 | 指数 | 线性 | 线性 | 指数 |
| 心跳/脉冲 | 阶跃 | 脉动 | 相位积分 | 脉动 | 脉动 |
| 阈值/觉醒 | 阶跃 | 逻辑斯蒂 | 指数 | 逻辑斯蒂 | 逻辑斯蒂 |
| 波形/频谱 | 线性 | easeOut | 线性 | 线性 | 线性 |
| 物理/重力 | 线性 | 线性 | 指数 | 线性 | 指数（速度） |
| 文字/数据 | 阶跃 | 线性 | 线性 | 逻辑斯蒂 | 阶跃 |
| 光/氛围 | 指数 | 指数 | 线性 | 指数 | 指数 |

---

## 3. 帧预算与性能规则

### 3.1 预算数字

| 项 | 上限 | 依据 |
| --- | --- | --- |
| 单帧总预算 | 16.6ms（60fps） | 浏览器 rAF |
| 特效 step + paint | ≤ 3ms | 给 React / 面板留余量 |
| 画布像素 | 284 × 164 × DPR²，DPR≤2 ≈ 186k px | `lib/client.js:1113` |
| 每帧新分配 | 0 个对象 / 数组 / 闭包 | 避免 GC 抖动 |
| O(n²) 粒子 | n ≤ 16（120 对） | 每对约 2–5µs |
| O(n) 粒子 | n ≤ 48 | 单次 arc+fill 约 10–30µs |
| 路径采样点 | ≤ `ceil(width / 6) + 4`（284px → 52） | 现有缎带 `step=6` |
| 每帧 draw call | ≤ 120 | 超过就开始掉帧 |
| shadowBlur | 0 或 1 次，blur ≤ 12 | 每次 blur 一次离屏 |
| save/restore 嵌套 | ≤ 2 层 | 状态栈 + 样式 flush |

### 3.2 禁用 / 慎用 API

| API | 判定 | 原因 | 替代 |
| --- | --- | --- | --- |
| `step`/`paint` 里 `new`、`[]`、`{}`、箭头函数 | 禁止 | 每帧 GC | `createState` 预分配，循环复用 |
| 每帧 `createLinearGradient` | 禁止 | 新对象 + 着色器重建 | state 缓存，key = `width&#124;accent` |
| 每粒子 `createRadialGradient` | 禁止 | 同上，成本 × n | 预渲染一次到 offscreen，或纯色圆 |
| 每形状 `shadowBlur` | 慎用，≤1 pass | 每个 shadow 一次 blur | 三层半透明描边做假辉光 |
| `filter = 'blur()'` | 禁止 | 比 shadowBlur 更慢 | 同上 |
| 嵌套 `save/restore` > 2 | 慎用 | 样式状态切换开销 | 按样式分组绘制 |
| `getImageData` / `putImageData` | 禁止 | GPU readback 卡顿 | 不用 |
| 每帧 `fillText` / `measureText` | 禁止 | 文字排版极慢 | DOM 文本或 offscreen 缓存 |
| 每帧 `setLineDash` | 慎用 | dash pattern 重建 | 静态 path / 预计算 |
| 每帧 `drawImage` 大图 | 慎用 | fill rate | 只在 resize 时重建 |
| 特效里写 `canvas.width/height` | 禁止 | 清空位图 + 重分配 | 宿主 `resize()` 独占 |
| 特效里读 `devicePixelRatio` | 禁止 | 宿主已做 DPR | 用 CSS px |
| 特效里 `requestAnimationFrame` / `setInterval` | 禁止 | 双循环、卸载泄漏 | 宿主独占循环 |
| 特效里 `matchMedia('prefers-reduced-motion')` | 禁止 | 宿主已处理 | 画好单帧 |
| 每帧 `getBoundingClientRect` | 禁止 | 强制 layout | 用 `frame.width/height` |
| 每帧 `Math.random()` | 慎用 | 不可复现、测试抖动 | state 里放 seeded PRNG |
| 每帧 `console.log` | 禁止 | 同步 I/O | 删掉 |

### 3.3 粒子 / 路径上限公式

```js
		/** O(n^2) 碰撞预算：按画布面积给，4..16。 */
		function pairParticleBudgetFor(width, height) {
			const area = Math.max(1, width * height)
			return Math.max(4, Math.min(16, Math.round(area / 2600)))
		}

		/** O(n) 粒子预算：按画布面积给，8..48。 */
		function looseParticleBudgetFor(width, height) {
			const area = Math.max(1, width * height)
			return Math.max(8, Math.min(48, Math.round(area / 900)))
		}
```

| 画布 | O(n²) | O(n) | 路径点 |
| --- | --- | --- | --- |
| 284 × 164 | 16 | 48 | 52 |
| 284 × 106（sky=76） | 16 | 33 | 52 |
| 200 × 88 | 7 | 20 | 38 |
| 400 × 164 | 16 | 48 | 71 |

`particleCountFor` 的 14 落在 O(n²) 16 以内，安全；新增特效不要超过这张表。

### 3.4 dt / DPR / reduced-motion / rAF

| 机制 | 宿主行为 | 特效必须做什么 |
| --- | --- | --- |
| dt | `Math.min(0.05, (now-previous)/1000)`，再在 draw 里 clamp 到 `.001..0.033` | 只用 `frame.dt`；不要 `Date.now()` |
| 物理积分 | — | 半隐式欧拉：先 `v += g*dt`，再 `x += v*dt`；不要按固定 16ms 写死 |
| 切后台 | rAF 暂停，回来 delta 被 clamp | 不会瞬移；但别用累计墙钟做相位 |
| DPR | `min(2, devicePixelRatio)`，`setTransform` 只在 resize | 不读 DPR、不写 canvas 尺寸 |
| resize | ResizeObserver 重算 width/height | 每帧读 `frame.width/height`，不要缓存在 state |
| reduced-motion | 只调一次 `draw(0.016)`，不启动 rAF | `createState` + 首次 `step` 必须产出非空静态构图；不要依赖 `time>0` 才出现 |
| 面板关闭 | 条件渲染卸载，cleanup `cancelAnimationFrame` | 不自建 rAF/定时器/全局监听；没有 destroy 钩子，别申请需要手动释放的资源 |

### 3.5 性能自查清单（逐项勾）

- [ ] `step` / `paint` 里没有 `new`、`[]`、`{}`、内联箭头函数
- [ ] 渐变对象缓存在 state，按 `width|accent` 失效
- [ ] `shadowBlur` 为 0 或全程只有 1 次，且 ≤ 12
- [ ] `save/restore` 嵌套 ≤ 2
- [ ] 每帧 draw call ≤ 120
- [ ] O(n²) 粒子 ≤ 16；O(n) 粒子 ≤ 48
- [ ] 路径采样点 ≤ `ceil(width/6)+4`
- [ ] 没有 `fillText` / `getImageData` / `filter`
- [ ] 没有 `requestAnimationFrame` / `setInterval` / 事件监听
- [ ] 没有写 `canvas.width/height`
- [ ] 没有 `getBoundingClientRect`
- [ ] 每帧读 `frame.width/height`，没有缓存尺寸
- [ ] 所有 `energy` 入口先 `clamp01`
- [ ] `width===0 || height===0` 时安全返回
- [ ] reduced-motion 单帧非空
- [ ] effect 对象是模块级常量，引用稳定
- [ ] 随机数来自 state 里的 seeded PRNG，不是每帧 `Math.random`
- [ ] preview 三个 energy 都能跑通（只用了 §1.7 支持的 API 子集）

### 3.6 怎么验证

1. **DevTools Performance**：开面板，录 5 秒并拖动滑条；看 `Task` 是否出现 > 16ms 的长任务，`Paint` 单帧是否 ≤ 3ms。
2. **canvas 数**：`document.querySelectorAll('.mec-drops').length` 必须是 1（P0 修完后）。
3. **canvas 尺寸**：`const c=document.querySelector('.mec-drops'); [c.width/c.devicePixelRatio, c.height/c.devicePixelRatio]`，应为 CSS 尺寸。
4. **关闭面板**：Performance 录 2 秒，确认没有持续的 rAF 绘制；`EffectCanvas` cleanup 在 `lib/client.js:1155-1158`。
5. **低性能模拟**：DevTools → Performance → CPU 4× slowdown，再拖一次；掉帧就砍粒子或 shadow。

---

## 4. 可测试性规范

### 4.1 必须抽成纯函数的量

| 量 | 建议签名 | 必须断言 |
| --- | --- | --- |
| 强度曲线 | `xxxIntensityFor(energy)` | 有限、`f(0)=0`、`f(1)=1`、单调 |
| 数量 | `xxxCountFor(energy, totalLevels)` | 有限、非降、off=0、相邻档差 ≥1 |
| 尺寸/尺度 | `xxxScaleFor(energy)` | 有限、非降、max > off |
| 抬升/位移 | `xxxLiftFor(energy)` | 有限、非降、max 有可见差 |
| 角度/相位 | `xxxAngleFor(energy, time)` | 有限、时间变化有响应 |
| 几何路径 | `xxxYFor(x, energy, time, trackY)` | 有限；energy 越大振幅越大 |
| 阈值判定 | `xxxStageFor(energy)` | 单调；阈值点前后不同 |
| 透明度 | `xxxAlphaFor(energy)` | 0..1，clamp |

纯函数边界（违反就不算纯）：

- 不碰 `canvas` / `context` / `document` / `window` / `performance` / `localStorage`
- 不用 `Math.random` / `Date.now`；需要随机就接收 `rng` 或 seeded PRNG
- 不读全局配置；参数全部显式传入
- 输入先 clamp，输出保证有限（`Number.isFinite`）
- 一个函数只回答一个问题，方便一个断言打一个点

### 4.2 `__internals` 清单

新增时必须补：

```js
		exports.__internals = {
			myEffect,
			myIntensityFor,
			myDotCountFor,
			myScaleFor,
			myLiftFor,
			myPathYFor,
			// 现有条目...
```

凡是测试里出现名字的，都必须能从 `__internals` 取到。不要用「测试里再算一遍公式」代替导出——那是复制 bug，不是测试。

### 4.3 测试骨架（可直接粘贴）

说明：`lib/client.js` 用 **tab**；现有 `test/*.mjs` 用 **2 空格**。下面跟测试文件保持一致（2 空格），不要混。

```js
#!/usr/bin/env node
/**
 * my-effect test — no DSH required.
 *
 * Run: node test/effect-my-effect.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// --- stub host: the browser module loader + a minimal React ------------------

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState() {}
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useRef(value) {
    return { current: value ?? null }
  },
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

const reactDom = { createPortal: (node) => node }
const fakeRequire = (id) => {
  if (id === 'react') return react
  if (id === 'react-dom') return reactDom
  throw new Error(`unexpected require("${id}")`)
}

const sandbox = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      sandbox.loaded = { id, module: factory(fakeRequire) }
    },
  },
}
new Function('window', 'console', source)(sandbox, console)

const { module } = sandbox.loaded
const internals = module.__internals
const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

// --- 1. registry + identity --------------------------------------------------

const { EFFECTS, DEFAULT_EFFECT_ID, resolveEffect, myEffect } = internals
const effect = EFFECTS.find((entry) => entry.id === 'my-effect')

check(effect !== undefined, 'my-effect is registered')
check(effect === myEffect, '__internals exposes the effect object')
check(typeof effect.name === 'string' && effect.name.length > 0, 'the effect has a name')
check(typeof effect.summary === 'string' && effect.summary.length > 0, 'the effect has a summary')
check(effect.layout !== undefined && effect.layout !== null, 'the effect declares a layout')
check(typeof effect.layout.sky === 'number' && Number.isFinite(effect.layout.sky), 'layout.sky is a number')
check(effect.layout.track === 'bar' || effect.layout.track === 'wave', 'layout.track is bar or wave')
check(typeof effect.layout.spectrum === 'boolean', 'layout.spectrum is a boolean')
check(resolveEffect('my-effect') === effect, 'resolveEffect finds my-effect')
check(resolveEffect('does-not-exist') === EFFECTS[0], 'an unknown id still falls back to the first effect')
check(EFFECTS.some((entry) => entry.id === DEFAULT_EFFECT_ID), 'the default id names a registered effect')

// --- 2. state + 120 frames at four energies, for 4 and 5 levels -------------

const numericLeaves = (value, out = []) => {
  if (typeof value === 'number') out.push(value)
  else if (Array.isArray(value)) for (const item of value) numericLeaves(item, out)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) numericLeaves(item, out)
  return out
}

const stepFrame = (energy, totalLevels) => ({
  energy,
  totalLevels,
  width: 284,
  height: 164,
  dt: 1 / 60,
  band: { top: 0, height: 30 },
  trackY: 46,
  sky: 0,
})

for (const totalLevels of [4, 5]) {
  for (const energy of [0, 0.5, 1]) {
    const label = `${totalLevels} levels @ energy ${energy}`
    const state = effect.createState()
    check(typeof state === 'object' && state !== null, `${label}: createState returns an object`)
    let error = null
    try {
      for (let frame = 0; frame < 120; frame += 1) effect.step(state, stepFrame(energy, totalLevels))
    } catch (caught) {
      error = caught
    }
    check(error === null, `${label}: 120 steps do not throw`)
    check(numericLeaves(state).every(Number.isFinite), `${label}: the state never turns NaN/Infinity`)
  }
}

// A zero-sized canvas / zero dt frame must not throw or poison the state.
{
  const state = effect.createState()
  let error = null
  try {
    for (let frame = 0; frame < 60; frame += 1) {
      effect.step(state, { energy: 0, totalLevels: 1, width: 0, height: 0, dt: 0 })
    }
  } catch (caught) {
    error = caught
  }
  check(error === null, 'a zero-sized canvas / zero dt frame does not throw')
  check(numericLeaves(state).every(Number.isFinite), 'a degenerate frame keeps the state finite')
}

// --- 3. pure functions: finite, monotonic, every level visibly different ----

const samples = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]
const counts = samples.map((energy) => internals.myDotCountFor(energy, 4))
check(counts.every(Number.isFinite), 'myDotCountFor is finite across the range')
check(counts.every((value, index) => index === 0 || value >= counts[index - 1]), 'a higher level never lowers the count')
check(counts[0] === 0, 'off draws nothing')
check(counts[counts.length - 1] > counts[0], 'max draws more than off')

const intensity = samples.map(internals.myIntensityFor)
check(intensity.every(Number.isFinite), 'myIntensityFor is finite across the range')
check(intensity.every((value, index) => index === 0 || value >= intensity[index - 1] - 1e-9), 'intensity never decreases')
check(intensity[0] === 0 && intensity[intensity.length - 1] === 1, 'intensity spans 0..1 exactly')

for (const totalLevels of [4, 5]) {
  const values = Array.from({ length: totalLevels }, (_value, index) =>
    internals.myDotCountFor(index / (totalLevels - 1), totalLevels)
  )
  const deltas = values.slice(1).map((value, index) => value - values[index])
  check(deltas.every((delta) => delta >= 0), `${totalLevels}: every adjacent level is non-decreasing`)
  check(deltas.every((delta) => delta > 0), `${totalLevels}: every adjacent level is visibly different`)
}

// --- 4. paint survives the host frame shape (no trackY, no dt) ---------------

function makeRecordingContext() {
  const calls = []
  const gradient = { addColorStop() {} }
  const target = {}
  return new Proxy(target, {
    get(object, prop) {
      if (prop === 'calls') return calls
      if (typeof prop !== 'string') return undefined
      if (prop.startsWith('create')) {
        return (...args) => {
          calls.push([prop, ...args])
          return gradient
        }
      }
      if (prop in object) return object[prop]
      return (...args) => {
        calls.push([prop, ...args])
      }
    },
    set(object, prop, value) {
      object[prop] = value
      return true
    },
  })
}

function paintOnce(energy, extra = {}) {
  const context = makeRecordingContext()
  const state = effect.createState()
  for (let frame = 0; frame < 30; frame += 1) effect.step(state, stepFrame(energy, 4))
  effect.paint(context, state, { energy, accent: 'rgb(232, 121, 249)', width: 284, height: 164, ...extra })
  return { context, state }
}

let painted = null
let paintError = null
try {
  painted = paintOnce(1)
} catch (caught) {
  paintError = caught
}
check(paintError === null, 'paint accepts the host frame shape (no trackY)')
check(painted !== null, 'paint returns after drawing')
check(painted.context.calls.length > 0, 'paint emits drawing calls')
const numbers = painted.context.calls.flatMap(([, ...args]) => args.filter((value) => typeof value === 'number'))
check(numbers.length > 0, 'paint emits numeric coordinates')
check(numbers.every(Number.isFinite), 'every painted coordinate is finite')

// --- report -----------------------------------------------------------------

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log('\nMY-EFFECT TEST PASSED')
```

这份骨架已在临时副本里跑通（`MY-EFFECT TEST PASSED`），不是伪代码。落地时只改 `my-effect` / `myDotCountFor` / `myIntensityFor` 三处标识符，断言结构照抄。

### 4.4 断言矩阵

| 断言 | 参考现有写法 | 阈值 / 期望 |
| --- | --- | --- |
| registry 里有它，身份字段齐全 | `test/effect-kunpeng.mjs:93-118` | id/name/summary/layout 全有 |
| `resolveEffect(id)` 命中 | `test/effect-kunpeng.mjs:122-124` | 返回同一个对象 |
| 未知 id 回退第一个 | 同上 | `=== EFFECTS[0]` |
| `DEFAULT_EFFECT_ID` 已注册 | `test/effect-kunpeng.mjs:125-128` | `some(id === default)` |
| 120 帧 × 0/0.5/1 × 4/5 档 | `test/effect-kunpeng.mjs:144-163` | 不抛错、state 数值全有限 |
| 零尺寸 / 零 dt | `test/effect-kunpeng.mjs:180-190` | 不抛错、状态仍有限 |
| 纯函数单调 | `test/effect-kunpeng.mjs:194-229` | 非降 + max > off |
| 相邻档可辨 | 本文 §2.3 | 连续量 ≥ 0.05；计数 ≥ 1 |
| paint 接受真实 host frame | `test/effect-kunpeng.mjs:260-304` | 无 trackY 也能画，数值全有限 |
| 边界 | `test/effect-kunpeng.mjs:136-137` | 允许出场/回场，禁止无限远/NaN |
| 长跑不泄漏 | `test/effect-kunpeng.mjs:166-177` | 2000 帧仍有限，循环能回场 |

### 4.5 现有测试写法索引

| 用途 | 位置 |
| --- | --- |
| 加载 bundle / stub host | `test/effect-kunpeng.mjs:26-81` |
| 断言器 `check` | `test/effect-kunpeng.mjs:83-87` |
| registry / fallback | `test/effect-kunpeng.mjs:89-128` |
| 120 帧扫描 | `test/effect-kunpeng.mjs:130-190` |
| 纯函数单调 | `test/effect-kunpeng.mjs:192-229` |
| 录制 context | `test/effect-kunpeng.mjs:231-266` |
| paint 验收 | `test/effect-kunpeng.mjs:268-304` |
| preview 加载方式 | `scripts/preview-effect.mjs:208-250` |
| SSR 取 `EffortSlider` | `test/render.mjs:113-121` |

---

## 5. 设置项设计建议（每个会话 / 用户选特效）

### 5.1 最小改动链路

| 层 | 现状 | 最小改法 |
| --- | --- | --- |
| 注册表 | `EFFECTS` 模块级数组 | 不动；新增特效照 §1.3 |
| 存储 | 无 | `localStorage`，key `dsh-model-effort-chips.effect.v1` |
| 读取 | `ACTIVE_EFFECT = resolveEffect(DEFAULT_EFFECT_ID)`（`lib/client.js:637`） | 改成每次 render `resolveEffect(chosenEffectId(sessionId))` |
| UI | 面板只有滑条 | `EffortSlider` 标题下加一个 `<select>` |
| Canvas | 吃模块级 `ACTIVE_EFFECT` | 吃 `props.effect`，仍然只认 effect 对象 |

关键约束：**不改 `resolveEffect` 的回退语义**。它现在是「未知 id → `EFFECTS[0]`」，测试 `test/effect-kunpeng.mjs:123-124` 在守这条线。存储损坏、旧版本残留 id、用户手改 localStorage，都会落到第一个特效；这是可预测的，不要改成回退 `DEFAULT_EFFECT_ID`。

### 5.2 存储与解析

```js
		const EFFECT_STORAGE_KEY = 'dsh-model-effort-chips.effect.v1'
		const EFFECT_SESSION_LIMIT = 20

		/** 读存储；损坏、禁用 localStorage、旧版本一律回退空配置。 */
		function readEffectStore() {
			const empty = { version: 1, defaultId: null, bySession: {} }
			try {
				const raw = window.localStorage.getItem(EFFECT_STORAGE_KEY)
				if (raw === null) return empty
				const parsed = JSON.parse(raw)
				if (parsed === null || typeof parsed !== 'object') return empty
				return {
					version: 1,
					defaultId: typeof parsed.defaultId === 'string' ? parsed.defaultId : null,
					bySession: parsed.bySession !== null && typeof parsed.bySession === 'object' ? parsed.bySession : {},
				}
			} catch {
				return empty
			}
		}

		/** 会话选择 > 用户默认 > DEFAULT_EFFECT_ID；未知 id 由 resolveEffect 兜底。 */
		function chosenEffectId(sessionId) {
			const store = readEffectStore()
			if (typeof sessionId === 'string' && typeof store.bySession[sessionId] === 'string') return store.bySession[sessionId]
			return typeof store.defaultId === 'string' ? store.defaultId : DEFAULT_EFFECT_ID
		}

		/** 写回；按插入顺序裁到 20 个会话，失败只影响持久化，不影响本次选择。 */
		function rememberEffectId(sessionId, effectId) {
			const store = readEffectStore()
			if (typeof sessionId === 'string') {
				store.bySession[sessionId] = effectId
				const keys = Object.keys(store.bySession)
				if (keys.length > EFFECT_SESSION_LIMIT) {
					for (const key of keys.slice(0, keys.length - EFFECT_SESSION_LIMIT)) delete store.bySession[key]
				}
			} else {
				store.defaultId = effectId
			}
			try {
				window.localStorage.setItem(EFFECT_STORAGE_KEY, JSON.stringify(store))
			} catch {
				// Safari 隐私模式 / 配额满：保留内存态，不阻塞交互
			}
		}
```

注意：`Object.keys` 的插入顺序不是严格 LRU（重复写同一个 session 不会移到末尾）。20 个会话的规模下够用；要严格 LRU 就存 `updatedAt` 并排序，但那是额外复杂度，先不做。

### 5.3 面板 UI 与 props 接线

在 `EffortSlider` 里：

```js
			const [effectId, setEffectId] = react.useState(() => chosenEffectId(props.sessionId))
			const activeEffect = resolveEffect(effectId)
```

`EffortSlider` 目前没有 `sessionId` prop；从 seat 传下来（seat 已有 `props.sessionId`）。如果 seat 可能换 session 而不卸载，补：

```js
			react.useEffect(() => {
				setEffectId(chosenEffectId(props.sessionId))
			}, [props.sessionId])
```

下拉放在标题下方（样式类 `.mec-effect-select`，见 §5.4）：

```js
			h('select', {
				key: 'effect',
				className: 'mec-effect-select',
				value: activeEffect.id,
				'aria-label': '动效',
				onChange: (event) => {
					const next = event.target.value
					setEffectId(next)
					rememberEffectId(props.sessionId, next)
				},
			}, EFFECTS.map((effect) => h('option', { key: effect.id, value: effect.id }, effect.name)))
```

把两处 `effect: ACTIVE_EFFECT`（P0 修完后只剩一处）改成 `effect: activeEffect`。删除或保留 `ACTIVE_EFFECT` 常量都可以；保留会给「默认值」一个显式读取点，但不要让 canvas 再依赖它。

### 5.4 CSS 与 `STYLE_VERSION`

- 只加内联样式：不用动版本号。
- 加 `.mec-effect-select` 类：必须把 `lib/client.js:63` 的 `STYLE_VERSION = '1.5.0'` 改成 `'1.6.0'`。注入逻辑在 `lib/client.js:653-658`：`dataset.version` 不一致才替换旧 `<style>`；不 bump 就会出现「新 DOM + 旧样式」。
- 设置 UI 增加的 ~28px 高度由 `.mec-panel` 的 `max-height: 60vh` 兜住；不要给面板写死高度。

### 5.5 切换特效时的生命周期

- `EffectCanvas` 的依赖是 `[effect]`（`lib/client.js:1159`）。切 effect 会：取消旧 rAF → 断开旧 ResizeObserver → `createState()` 重建 → 新循环。天然无泄漏。
- 前提是 effect 对象引用稳定。`resolveEffect` 返回 `EFFECTS` 里的成员，OK；不要把 effect 写成 render 内联对象。
- 存储只在切换 / 打开面板时读写，**不要每帧读 localStorage**。
- 不存 energy / 档位；那是模型状态，不是 UI 偏好。

---

## 6. 「动效 × 档位曲线 × 性能」三维评分矩阵

评分口径（1–5，越高越好）：

| 维度 | 5 分 | 1 分 |
| --- | --- | --- |
| 动效表现力 A | 第一眼有记忆点，off→max 有叙事 | 只是参数变化，没有状态切换 |
| 档位辨识度 L | 4 档两两可辨，曲线可控 | 中高档糊成一档 |
| 性能 P | 无 shadow、无渐变、≤48 draw call | shadow + 每帧渐变 + 高粒子 |
| 难度 D（参考列，不计入总分） | S，1 小时出原型 | C，需要 WebGL/重资产 |
| 合规 R（参考列） | 纯几何，无 IP 风险 | 需外部资产 |

综合 = `0.30*A + 0.40*L + 0.30*P`。L 权重最高，因为这是「档位控件」，不是屏保。

| # | 特效 | id 建议 | A | L | P | 综合 | D | 曲线主张 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 粒子波动（现有） | `particle-wave` | 4 | 4 | 5 | 4.30 | S | 数量指数 + 重力线性 |
| 2 | 鲲鹏（现有） | `kunpeng` | 5 | 5 | 3 | 4.40 | A | 尺度指数 + 翅膀 smoothstep + 抬升幂函数 |
| 3 | 心跳光环 | `pulse-ring` | 4 | 5 | 5 | **4.70** | S | 频率线性 + 幅度脉动 + 亮度逻辑斯蒂 |
| 4 | 磁场铁屑 | `field-lines` | 4 | 4 | 5 | 4.30 | A | 密度指数 + 对齐度逻辑斯蒂 |
| 5 | 雷暴电弧 | `storm` | 5 | 4 | 4 | 4.30 | A | 出现概率阶跃 + 亮度指数 |
| 6 | 引力井/轨道 | `gravity-well` | 4 | 3 | 4 | 3.60 | B | 速度指数 + 轨迹线性 |
| 7 | 电台频谱 | `equalizer` | 3 | 5 | 5 | 4.40 | S | 柱高指数 + 相位线性 |
| 8 | 代码雨 | `code-rain` | 3 | 4 | 4 | 3.40 | A | 密度阶跃 + 速度线性 |
| 9 | 雨滴涟漪 | `ripple` | 3 | 4 | 5 | 4.00 | S | 半径 easeOut + 透明度指数 |
| 10 | 阈值灯带 | `threshold-grid` | 3 | 5 | 5 | 4.40 | S | 点亮格数阶跃 + 亮度逻辑斯蒂 |
| 11 | 极光缎带 | `aurora` | 5 | 3 | 3 | 3.60 | B | 振幅指数 + 色相线性 |
| 12 | 星野视差 | `starfield` | 3 | 3 | 4 | 3.30 | A | 速度指数 + 密度线性 |

### 6.1 推荐先做的 3 个

| 顺序 | id | 为什么先做 | 落地要点 | 测试重点 |
| --- | --- | --- | --- | --- |
| 1 | `pulse-ring` | 综合最高；4 档靠「频率 + 幅度 + 亮度」三通道区分，天然不糊；纯圆弧，无 shadow 也能看 | `layout: { sky: 0, track: 'bar', spectrum: true }`；两个同心环 + 一个外扩波；相位积分 | 频率随 energy 单调；4/5 档相邻差；120 帧有限 |
| 2 | `threshold-grid` | 最便宜、最容易做对；阶跃 + 逻辑斯蒂天生适配 4 档，off 全灭、max 全亮有强叙事 | 5×3 或 7×4 小格；点亮数 = `stepCurve`；亮度 = `logisticCurve` | 点亮格数非降；每档至少多 1 格；max 全亮 |
| 3 | `field-lines` | 视觉密度高但不贵；铁屑沿场线对齐，energy 控制「从散乱到成束」，状态差异明显 | 预计算 N 条线段端点；每帧只改 alpha/长度；密度指数 | 线段数非降；端点有限；不超 48 条 |

不建议先做：`aurora`（缎带+多层渐变，容易踩 shadow/性能）、`gravity-well`（物理+轨迹，调参成本高）、`code-rain`（文字渲染，preview 不支持 `fillText`）。

---

## 7. 风险清单

### 7.1 P0：当前源码的 canvas 坐标系是坏的

这是本文写作时实际核对到的**现存 bug**，不修就新增特效，会得到「preview 对、面板错」的假象。

| 证据 | 位置 / 数值 |
| --- | --- |
| SSR 渲染出的 `.mec-drops` 数量 = 2 | `lib/client.js:1389` 与 `lib/client.js:1398` 各挂一个 `EffectCanvas`（写作时是 1320/1329；`cf353fa` 加了切换按钮后整体 +69） |
| `.mec-drops` 绝对定位填满父容器 | `lib/client.js:723`：`position:absolute; inset:0; width:100%; height:100%` |
| 宿主给的轨道 y | `lib/client.js:1167`：`trackY = layout.sky + 30 + 16`；鲲鹏 = 122 |
| 第一个 canvas 高度 | `.mec-stage` = `paddingTop 76 + band 30 + margin 2 ≈ 108` |
| 第二个 canvas 高度 | `.mec-wave` = 30；且 `band.top = 76`，所有绘制都在画布外 |
| 结果 | 缎带 y=122 被裁掉；第二个 canvas 什么都看不见；两个 rAF 空转 |

**修法（按顺序）**：

1. 删掉 `lib/client.js:1397-1406` 的第二个 `EffectCanvas`（`.mec-wave` 内那个），只保留一个。
2. 让唯一 canvas 的父容器覆盖 `sky + 30 + 58`（鲲鹏 = 164）：把 `rail` 移进同一个相对定位容器（`stage` 或新建 wrapper），canvas 用 `inset:0` 铺满；`band` 和 `rail` 作为 flow 子元素。
3. **不要**把 `trackY` 改成 `sky+30` 来迁就 106 高的画布——那会把缎带画到旋钮上方，视觉错位。
4. 验证：
   - SSR / DevTools：`.mec-drops` 恰好 1 个；
   - `canvas.height / devicePixelRatio === layout.sky + 30 + 58`；
   - preview 的 284×164 与实机同 energy 截图对齐。

### 7.2 其余风险

| 风险 | 触发 | 影响 | 处理 | 验证 |
| --- | --- | --- | --- | --- |
| HMR 样式版本残留 | 新增 `.mec-*` CSS 类但没 bump `STYLE_VERSION` | 新 DOM 用旧样式，设置下拉裸奔 | `lib/client.js:63` bump 到 `1.6.0` | DevTools 看 `<style data-version>` 与计算样式 |
| 浅色主题白线消失 | 特效用 `#ffffff` 描边/渐变核心 | 浅色底上缎带/高光不可见 | 只用 `accent` + 低透明度白（≤0.35）；或给 frame 加 `light` 字段（`EffortSlider` 已有 `isLight`，`lib/client.js:1183`，传给 `EffectCanvas` 即可） | 系统切浅色，截图对比 |
| `COMPACT_BELOW=360` | 窗口 < 360px | chip 变图标，面板仍 312px，可能溢出 | 动效一律用 `frame.width`，不写死 284；关键元素留 12px 边距 | 320 / 360 / 400px 三档截图 |
| 4 档 vs 5 档 | 曲线在 1/3 或 2/3 处斜率过低 | 4 档中档糊；5 档首档几乎不可见 | 按 §2.3 两套采样都验；阈值不要写死 0.5 | 单测跑 `[4,5]` 两组 |
| 拖动中 energy 是小数 | `previewFraction` 连续 | 特效跳变、阈值闪烁 | 所有映射连续；需要吸附用 `stepCurve`，但别在阈值上写 `===` | 拖 0→1，录屏看是否抽搐 |
| 磁吸导致 energy 回跳 | `magnetize` 在锚点附近拉回 | 视觉在小范围抖动 | 用 `state.energy += (target-state.energy)*k` 平滑；纯函数测试仍按目标值 | 拖到档位边界来回移动 |
| reduced-motion 只画一帧 | 宿主 `draw(0.016)` 一次 | 依赖 `time>0` 才出现的元素全空 | `createState` + 首帧必须非空；静态构图也要成立 | 系统开减弱动态，截图 |
| 面板关闭 rAF 未停 | 自己起 rAF / 定时器 / 全局监听 | 后台持续耗电 | 只用宿主循环；cleanup 在 `lib/client.js:1155-1158` | Performance 录 2s，关闭面板后无绘制 |
| 高 DPI 模糊 | 手动改 canvas 尺寸 / 不应用 DPR | Retina 上糊 | 不写 canvas 尺寸；宿主 `setTransform` 在 `:1116` | Retina 截图看 1px 线 |
| preview 录制器缺 API | 用 `bezierCurveTo` / `fillText` / `drawImage` | preview 抛错或静默缺元素 | 只用 §1.7 支持子集，或先扩 `scripts/preview-effect.mjs` | 三个 energy 都能出 SVG |
| 计数饱和 | `Math.min` 上限 + 幂曲线 | 高档数量相同，只剩速度差 | 按 §4.4 断言相邻档差 ≥1；必要时降上限或改公式 | 单测 4/5 档相邻值 |
| 随机不可复现 | 每帧 `Math.random()` | 测试抖动、preview 每次不同 | seeded PRNG 放 state；preview 可固定 seed | 连续跑两次测试结果一致 |
| effect 引用不稳定 | render 内联对象 | 每次 render 重启 rAF，拖动卡死 | 模块级常量 + `resolveEffect` | React DevTools / Performance |
| `resolveEffect` 语义被改 | 把 fallback 改成 `DEFAULT_EFFECT_ID` | 旧存储/脏数据行为变化，测试红 | 保持 `EFFECTS[0]`；测试 `:123-124` 守 | `npm test` |
| 面板关闭后状态残留 | 把状态放模块作用域 | 下次打开从上次相位继续，甚至串会话 | 状态只放 `createState()` | 开关面板两次对比 |

---

## 8. 参考

检索时间：2026-11-09。只吸收机制，未复制代码。

- MDN, *Optimizing canvas*：避免 `shadowBlur`、批量绘制、DPR 缩放、`requestAnimationFrame` — https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- web.dev, *Improving HTML5 canvas performance*：清除策略、浮点坐标、性能清单 — https://web.dev/articles/canvas-performance
- Easings.net：Robert Penner 缓动公式与曲线可视化 — https://easings.net/
- Robert Penner, *Easing Functions* — https://robertpenner.com/easing/
- Wikipedia, *Smoothstep*：sigmoid / Hermite 插值定义 — https://en.wikipedia.org/wiki/Smoothstep
- AG Grid, *Optimising HTML5 Canvas Rendering*：分层、缓存、绘制调用 — https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/
- MDN, *Window.requestAnimationFrame* — https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- MDN, *ResizeObserver* — https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
- MDN, *prefers-reduced-motion* — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

---

## 附：交付口径

- 本文只写规范；`lib/` 与 `test/` 未改，P0 修复由作者在代码任务里执行。
- 新增特效的「完成」定义：`npm test` 五行 PASSED + 三张 SVG + 三张 682×394 PNG + README 两节 + 实机浅色/窄屏/reduced-motion 三项截图或录屏。
- 如果只做了 `npm run test:effect:my-effect`，那叫「单测过」，不叫「特效完成」。
