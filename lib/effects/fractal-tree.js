/**
 * 分形树 (fractal-tree)
 *
 * 视觉机制：递归二叉树枝从 band 上方的天空带底部向上生长，每级两根枝、左右
 * 对称张开；档位越高递归越深、角度越开，树从 3 级小苗长成 6 级大树。
 *
 * 能量映射：深度 2 + floor(3e)（阶跃，2..5）；角度 0.35 + 0.45e；长度衰减 0.72；
 * 单棵树最多 63 段、32 个叶端。depth 变化（或角度被拖动超过阈值）时一次性重建
 * 整棵树，不在每帧重建；生长进度到 1 后停止，不循环。
 * 布局：70/bar/off —— 只在 70px 天空带作画，不占 band、不显示频谱。
 *
 * 树枝坐标、每段层级与叶端都在 createState 里预分配，step/paint 不建数组。
 * 递归用预分配的显式栈迭代实现，栈深 ≤ 6（递归深度上限 5 + 根）。
 */
const fractalTreeEffect = {
	id: 'fractal-tree',
	name: '分形树',
	summary: '递归二叉树枝随档位变深变开，从树苗一次长成大树后停住',
	category: 'geometry',
	layout: { sky: 70, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		// 63 段 = 深度 5 时的完整二叉树；32 个叶端。
		const segments = new Float64Array(63 * 4)
		const levels = new Float64Array(63)
		const tips = new Float64Array(32 * 2)
		const stackX = new Float64Array(64)
		const stackY = new Float64Array(64)
		const stackAngle = new Float64Array(64)
		const stackLength = new Float64Array(64)
		const stackLevel = new Float64Array(64)
		return {
			segments,
			levels,
			tips,
			stackX,
			stackY,
			stackAngle,
			stackLength,
			stackLevel,
			count: 0,
			tipCount: 0,
			builtDepth: -1,
			builtEnergy: -1,
			progress: 0,
			grown: false,
		}
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 70)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const depth = Math.min(5, 2 + Math.floor(3 * energy))
		const spread = 0.35 + 0.45 * energy

		// 深度变化必重建；角度是连续量，拖动时按 0.03 的可见阈值重建。
		if (depth !== state.builtDepth || Math.abs(energy - state.builtEnergy) > 0.03) {
			const depthChanged = depth !== state.builtDepth
			const segments = state.segments
			const levels = state.levels
			const tips = state.tips
			const stackX = state.stackX
			const stackY = state.stackY
			const stackAngle = state.stackAngle
			const stackLength = state.stackLength
			const stackLevel = state.stackLevel
			const baseLength = Math.max(4, (sky - 6) * 0.34)
			let top = 0
			stackX[0] = width * 0.5
			stackY[0] = sky - 4
			stackAngle[0] = -Math.PI / 2
			stackLength[0] = baseLength
			stackLevel[0] = 0
			top = 1
			let count = 0
			let tipCount = 0

			// 显式栈做深度优先展开；节点数由 depth 决定，最大 63 段。
			while (top > 0 && count < 63) {
				top -= 1
				const x = stackX[top]
				const y = stackY[top]
				const angle = stackAngle[top]
				const length = stackLength[top]
				const level = stackLevel[top]
				const endX = x + Math.cos(angle) * length
				const endY = y + Math.sin(angle) * length
				const slot = count * 4
				segments[slot] = x
				segments[slot + 1] = y
				segments[slot + 2] = endX
				segments[slot + 3] = endY
				levels[count] = level
				count += 1

				if (level >= depth) {
					if (tipCount < 32) {
						tips[tipCount * 2] = endX
						tips[tipCount * 2 + 1] = endY
						tipCount += 1
					}
				} else if (top + 2 <= 63) {
					const childLength = length * 0.72
					stackX[top] = endX
					stackY[top] = endY
					stackAngle[top] = angle - spread
					stackLength[top] = childLength
					stackLevel[top] = level + 1
					top += 1
					stackX[top] = endX
					stackY[top] = endY
					stackAngle[top] = angle + spread
					stackLength[top] = childLength
					stackLevel[top] = level + 1
					top += 1
				}
			}

			state.count = count
			state.tipCount = tipCount
			state.builtDepth = depth
			state.builtEnergy = energy
			// 换深度 = 换了一棵树：从树苗重新长。只改角度时保留生长进度。
			if (depthChanged) {
				state.progress = 0.4
				state.grown = false
			}
		}

		// 生长到顶后停止（不循环、不回绕）。
		if (!state.grown) {
			state.progress = Math.min(1, state.progress + dt * (0.35 + 0.55 * energy))
			if (state.progress >= 1) {
				state.progress = 1
				state.grown = true
			}
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const depth = Math.max(0, state.builtDepth)
		const segments = state.segments
		const levels = state.levels
		const tips = state.tips
		const count = state.count
		const levelsShown = state.progress * (depth + 1)

		context.save()
		context.lineCap = 'round'

		// 按层级描边：每一级同时长出来，线段按生长比例从起点延伸。
		for (let level = 0; level <= depth; level += 1) {
			const fraction = clamp01(levelsShown - level)
			if (fraction <= 0) break
			context.beginPath()
			context.lineWidth = Math.max(0.6, 1.7 - level * 0.22)
			context.strokeStyle = withAlpha(accent, 0.9 - level * 0.09)
			for (let index = 0; index < count; index += 1) {
				if (levels[index] !== level) continue
				const slot = index * 4
				const x = segments[slot]
				const y = segments[slot + 1]
				context.moveTo(x, y)
				context.lineTo(
					x + (segments[slot + 2] - x) * fraction,
					y + (segments[slot + 3] - y) * fraction
				)
			}
			context.stroke()
		}

		// 长满后点亮叶端：小圆点，一次 fill 画完。
		if (state.grown && state.tipCount > 0) {
			context.fillStyle = accent
			context.globalAlpha = 0.75
			context.beginPath()
			const radius = 1 + 0.5 * energy
			for (let index = 0; index < state.tipCount; index += 1) {
				const x = tips[index * 2]
				const y = tips[index * 2 + 1]
				context.moveTo(x + radius, y)
				context.arc(x, y, radius, 0, Math.PI * 2)
			}
			context.fill()
			context.globalAlpha = 1
		}

		context.restore()
	},
}
