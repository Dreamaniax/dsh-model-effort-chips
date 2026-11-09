# 04 · 业界参照：别人怎么表达「推理强度」

> 本节只解决一个问题：**「档位」这种离散语义，业界用什么视觉语汇表达**。用于给 01（动效）和 02（IP）两个目录定约束，不重复它们的内容。

## 1. 档位命名谱系（决定了动效要有几个「可辨台阶」）

| 来源 | 参数名 | 取值 | 设计含义 |
| --- | --- | --- | --- |
| OpenAI | `reasoning.effort` | `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`（随模型而异） | 档位是**能力表动态下发**的，不是固定 5 档；`none` 是显式的「零」，不是「最弱」 |
| Anthropic | `thinking.budget_tokens` → 新版 `output_config.effort` | token 预算连续，新版为档位 | 早期是**连续预算**，现在是**离散档位**，说明产品语义在向「少而可辨」收敛 |
| Google Gemini | `thinking_level` | `minimal` / `low` / `medium` / `high` + 默认动态 | 用「level」而非「effort」，强调台阶感 |
| 网关/客户端类产品（如 jiuwenswarm 的 `reasoning_level`） | `reasoning_level` | `off` / `low` / `medium` / `high`，或 `off` / `on` | 档位集合**完全由模型能力表决定**，同一 UI 要能画 2 档也能画 7 档 |

对本插件的直接推论（`energy = index / (count - 1)`）：

1. **画 2 档到 7 档都要成立**：动效不能假设「一定 5 档」，也不能把「第 3 档」写死成某个形态。
2. **`off` 必须是「静止/休眠」语义**，不是「最弱的动」——`energy = 0` 时动效应给出明确的「关」信号（无粒子、无呼吸、灰阶）。
3. **最后一档应该换「质」而不是继续加「量」**：加数量线性堆到 max 会显得廉价；业界惯例是 max 出现**新形态**（起飞、过载、锁相、展开）。

## 2. 六种既有视觉语汇，哪些可借

| 语汇 | 业界出处 | 它表达什么 | 借到档位动效上的改法 |
| --- | --- | --- | --- |
| 呼吸/脉动（breathing） | 各家「思考中」指示器 | 系统还活着 | 可借，但**只能当底色**；呼吸幅度要随档位变深（本插件频谱柱已经用了：深度 0.35→0.9） |
| 微光扫过（shimmer） | ChatGPT / Claude 的流式文字 | 正在产出 | 可借到 chip 本体，不适合画布；扫过**速度**随档位变快，是低成本的高档位信号 |
| 能量条/仪表（meter） | 各家 effort 选择器 | 量的多少 | 可借，但必须是**台阶式**而非平滑进度，否则会被误读成「下载进度」 |
| 人格化身（orb / blob / persona） | 各类 AI 助手头像与状态球 | 是谁在思考 | **最适合本插件**——鲲鹏已经走这条路；化身随档位**换形态**，信息量远高于数字 |
| 速率隐喻（粒子速度/打字速度） | 各家 loading | 快慢 | 可借，但要小心：档位高不等于更快出结果，别让用户以为 max 会更快 |
| 环境异变（天气/地形/光照） | 游戏 HUD 与氛围设计 | 局势变化 | 高级手法：把画布当「场景」，档位改变场景而非物体，适合 IP 类动效 |

## 3. 三条反模式（不要做）

| 反模式 | 为什么错 | 替代 |
| --- | --- | --- |
| 假进度条 | 推理强度不是可测进度，max 也可能秒回，进度条会撒谎 | 台阶式档位 + 连续驱动量（`energy`）分开表达 |
| 无信息 spinner | 转了但没告诉你「多用力」，和官方控件没差别 | 旋转速度/拖尾长度挂到 `energy`，至少可辨 |
| 只靠文案 | 「思考中…」在大画布上等于没画 | 至少给一个随档位变化的几何量（振幅/数量/色相/尺度） |

## 4. 由此推出的四条硬约束

1. **分档可辨**：4 档模型下 `energy ∈ {0, .33, .67, 1}`，相邻两档的视觉差异必须一眼看出。线性映射常常做不到——需要非线性曲线（见 03 的曲线工具箱）。
2. **跨档连续**：拖动滑条时 `energy` 是小数，动效要能平滑过渡，不能只在整数档跳变。这是本插件已有的天然优势，别浪费。
3. **零帧可读**：`prefers-reduced-motion` 时只画一帧，这一帧也要能看出当前档位（所以「用运动表达强度」的动效必须有静态等价物）。
4. **画布很小**：约 88–164px 高。任何依赖「整体构图」的动效都会糊；靠**单体形态 + 数量 + 颜色**三件事表达强度最稳。

## 参考

- [Reasoning models vs standard LLMs: when thinking actually helps](https://intelligibberish.com/articles/2026-09-29-reasoning-models-vs-standard-models-when-thinking-actually-helps) — 四大厂商 effort 参数取值与默认值
- [The Shape of AI — UX Patterns for AI](https://www.shapeof.ai/) — AI 视觉语汇（avatar / color / 状态表达）索引
- [AI isn't human, it's math（UX Collective 转载）](https://mygraphicsstore.com/index.php/2024/05/09/ai-isnt-human-its-math/) — 微光/徽章/配色等既定 AI 视觉惯例的批评
- [jiuwenswarm #4245：对话内切换思考档位](https://gitcode.com/openJiuwen/jiuwenswarm/issues/4245) — 真实产品里 `reasoning_level` 的档位集合、能力表下发与「无档位模型不显示控件」的处理
