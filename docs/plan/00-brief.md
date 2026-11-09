# 00 · 共享简报：动效 × 著名 IP × 档位映射（供团队写作）

> 本文件是团队唯一事实来源。所有产出必须与这里的接口事实一致，不得自创 API。

## 任务目标

为插件 `dsh-model-effort-chips`（DeepSeek Harness 的「模型 / 思考强度」分体 chip）设计一套**可插拔动效目录**：

1. **广泛穷举 + 分类**：有哪些动效思路可以做成「档位越高越强」的可视化。
2. **著名 IP 分类**：哪些 IP（电影 / 动画 / 游戏 / 漫画 / 神话 / 艺术流派）的视觉母题可以用来表达「推理强度 off → max」。
3. **每一条都要能落地**：给出在 DSH 里怎么实现（落到下面的 effect contract）、怎么把动效强度挂到 `energy` 0..1、以及分档叙事。

产出面向「作者本人挑方案」，不是面向终端用户的营销文案。要求密度高、可执行、去水。

## 插件技术事实（已核对源码，禁止臆造）

文件：`lib/client.js`（手写 ESM，**无构建步骤**，重启 DSH 即生效）、`lib/index.js`（host 半边，空实现）。

### 1. 特效契约（唯一扩展点）

```js
const myEffect = {
  id: 'my-effect',
  name: '我的特效',
  summary: '一句话说明它在做什么',
  layout: { sky: 0, track: 'bar', spectrum: true },
  createState: () => ({}),        // 本特效的可变状态
  step(state, frame) {},          // 每帧推进
  paint(context, state, frame) {},// 每帧绘制（CanvasRenderingContext2D）
}
EFFECTS.push(myEffect)            // 注册；DEFAULT_EFFECT_ID 决定默认显示
```

`layout` 三个字段（面板据此摆 DOM，不改画布逻辑）：

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `sky` | px 数值 | 轨道上方额外留出的「天空」高度（鲲鹏用 76） |
| `track` | `'bar'` \| `'wave'` | `'bar'` 用 DOM 直条；`'wave'` 隐藏 DOM 直条，由 canvas 画波浪缎带 |
| `spectrum` | 布尔 | 是否显示 DOM 频谱柱 |

### 2. 每帧 frame（step 与 paint 收到同一个对象）

| 字段 | 含义 |
| --- | --- |
| `energy` | **核心驱动量**，0..1 连续。= `index / (count - 1)`；拖拽时是小数 previewFraction（所以特效天然支持「拖动中连续渐变」，不只是跳档） |
| `accent` | 当前档位强调色（`rgb(...)` 字符串），浅色主题会自动加深 20% |
| `totalLevels` | 当前模型声明的档位数（4 档 / 5 档模型不同） |
| `width` / `height` | CSS 像素画布尺寸 |
| `dt` | 帧间隔秒，已 clamp 到 0.001..0.033 |
| `band` | `{ top, height }`，`BAND_HEIGHT = 30`，特效主活动区 |
| `trackY` | 轨道水平线 y 坐标 |
| `sky` | `= layout.sky` |
| `rail` | `RAIL_HEIGHT = 58` |

画布由宿主统一管理：DPR ≤ 2、ResizeObserver、`requestAnimationFrame` 循环、每帧 `clearRect`、卸载时 `cancelAnimationFrame`。**特效不得自己起 rAF、不得自己 resize、不得持有 canvas 引用。**

`prefers-reduced-motion: reduce` 时只画一帧（`draw(0.016)`）。

### 3. 颜色与主题

- 档位调色板 `PALETTE = ['#22c55e','#22d3ee','#6366f1','#a855f7','#e879f9']`（绿→青→靛→紫→品红），按 0..1 位置线性插值：`colorAtFraction` / `colorAt` / `accentFor`。
- 浅色主题判定：读 `getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-2')` 算相对亮度，失败回退 `prefers-color-scheme`。
- 现有工具函数（`exports.__internals` 已导出，测试可见）：`clamp01`、`withAlpha`、`shade`、`colorAtFraction`、`energyFor`、`spectrumBarHeightFor`、`particleCountFor`。

### 4. 性能与约束

- 面板打开时才跑；一帧预算按 60fps ≈ 16ms，建议实际绘制 ≤ 3ms。
- 只用 Canvas 2D（无 Three.js / 无 WebGL / 无第三方依赖 / 无 wasm）；不得联网加载贴图。
- 推荐**零分配或极少分配**：`step` 里复用数组/对象，别每帧 `new` 上百个对象、别每帧 `createLinearGradient`。
- 建议特效逻辑 ≤ 200 行，纯函数抽出来单测。
- 画布实际可视高度约 88–164px（`sky + 30 + 58`），宽度约 200–400px。**设计必须在这个尺寸下可读**，细节不能依赖大画布。
- 禁止依赖外部字体、图片、Lottie/GIF/WebM 资产。

### 5. 验证回路（每条动效建议都应能这样验收）

```sh
node scripts/preview-effect.mjs <effectId> <energy> <out.svg>   # 无头渲染 SVG，可 qlmanage 转 PNG
npm run test:effect                                              # 契约/边界/单调性测试
```

新增特效至少配一条纯函数测试，覆盖：(a) 档位越高强度越大（单调性），(b) 120 帧各 energy 不抛错、不出 NaN/Infinity，(c) 关键几何不出画布边界（允许出场/回场）。

## 写作规范

- 中文，GFM 管道表；每个单元格信息密度优先，别写「可以更好」这种空话。
- 每条动效/IP 必须给：**视觉机制 → `energy` 映射（给公式或阶段表）→ DSH 落地要点（contract 哪个成员、layout 取值、关键技术）→ 难度/风险**。
- 难度用 S/A/B/C 四级：S=纯数学 1 小时可出原型；A=需要状态机或粒子系统，半天；B=需要物理/噪声/多图层，1–2 天；C=需要 WebGL 或重资产，不建议（如实标注「不建议」）。
- 合规红线：**只做程序化致敬（几何、配色、构图、节奏），不使用任何受版权保护的角色形象、logo、剧照、音效**；涉及 IP 的条目必须写一句合规提示。
- 不要修改 `lib/client.js`。本轮只产出设计文档。
