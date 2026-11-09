# 鲲鹏像素动效 · 素材生成说明

这份说明写给**图像模型 / 像素工具 / 美术**：按它产出的素材可以直接接进插件，不需要二次加工。

## 一、要生成什么

一张 **PNG sprite sheet**，透明背景，**每格 32×32**，**4 行 × 4 列 = 16 帧**。

| 行 | 档位 | 形态 | 4 帧循环 |
| --- | --- | --- | --- |
| 0 | off | 小鲸鱼（体长约占格子 55%） | 摆尾游动 |
| 1 | low | 稍大鲸鱼，背鳍出现 | 摆尾 + 轻微上浮 |
| 2 | high | 长出翅膀（约占格宽 80%） | 振翅 + 身体上扬 |
| 3 | max | 翼展最大，身体接近竖直 | 振翅 + 尾部拖尾/气泡 |

## 二、硬性要求

- **真像素**：每格 32×32，禁止抗锯齿、禁止模糊、禁止渐变阴影；边缘必须是整像素
- **透明背景**，不要地板、不要光晕底
- **调色板 ≤ 12 色**，主色跟随档位：off 青绿 → low 青 → high 蓝紫 → max 品红
- 每行 4 帧必须**循环无缝**（第 4 帧接回第 1 帧不跳）
- 角色朝向：**朝右**
- 元素不要超出 32×32 格子（拖尾可以贴边，但不能压到相邻格）

## 三、交付格式

1. `kunpeng-pixel-sheet.png`：32×4 列横排 → 宽 128、高 128（4 行 × 4 列）
2. 可选 `kunpeng-pixel-sheet.json`：

```json
{
  "frameSize": 32,
  "columns": 4,
  "rows": [
    { "form": "off",  "row": 0, "fps": 6 },
    { "form": "low",  "row": 1, "fps": 7 },
    { "form": "high", "row": 2, "fps": 9 },
    { "form": "max",  "row": 3, "fps": 11 }
  ],
  "pivot": { "x": 16, "y": 20 }
}
```

## 四、可以直接贴进工具的描述

> Pixel art sprite sheet, 4 rows × 4 columns, each frame exactly 32×32 pixels, transparent background, no anti-aliasing, no gradients, max 12 colors, character faces right and loops seamlessly across the 4 frames.
> Row 1: a tiny whale swimming, tail flap.
> Row 2: the same whale slightly bigger with a dorsal fin, gliding up.
> Row 3: the whale grows bird-like wings, flapping.
> Row 4: largest wingspan, body nearly vertical, climbing with a short bubble trail.
> Palette shifts per row: teal-green, cyan, blue-violet, magenta.

## 五、接进插件时我会做什么

- canvas 设 `imageSmoothingEnabled = false`，整数倍缩放（32 → 2× = 64px）
- 按当前档位选行，按 `fps` 选列，x 位置沿横线匀速循环
- 新增特效 id `kunpeng-pixel`，与现有 `kunpeng` 并存，面板按钮可切换
- 面板尺寸仍是 **324 × 141**、canvas **284 × 92**，动画不得超框
