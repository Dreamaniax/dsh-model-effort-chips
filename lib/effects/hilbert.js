/**
 * 希尔伯特曲线 (hilbert)
 *
 * 视觉机制：空间填充曲线按阶数把 band 铺成一条连续折叠的路径，一颗光点沿路径
 * 从头走到尾再回绕；档位越高阶数越高、折得越密、光点走得越快。
 *
 * 能量映射：阶数 1 + floor(3e)（阶跃，1..4）；路径点 4^order（4/16/64/256）；
 * 行进 0.02 + 0.12e 路径比例/秒。只在阶数变化时重建路径（基准点存归一化坐标，
 * 画布尺寸变化不需要重建）；最大阶 4 → 256 点。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 路径点、阶数与行进进度都在 createState 里预分配/保存，step/paint 不建数组；
 * 光点头优先用 frame.sprite，缺图时回退 arc 假辉光。
 */
const hilbertEffect = {
	id: 'hilbert',
	name: '希尔伯特曲线',
	summary: '空间填充曲线随档位越折越密，一颗光点沿路径走完全程再回绕',
	category: 'geometry',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({
		// 最大 256 点，每点 x/y 归一化到 0..1。
		points: new Float64Array(256 * 2),
		count: 0,
		builtOrder: -1,
		travel: 0,
	}),

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const order = Math.min(4, 1 + Math.floor(3 * energy))

		// 只在阶数变化时重建路径；d2xy 把行进序号映射成网格坐标。
		if (order !== state.builtOrder) {
			const side = 1 << order
			const count = side * side
			const points = state.points
			for (let visit = 0; visit < count; visit += 1) {
				let x = 0
				let y = 0
				let index = visit
				for (let size = 1; size < side; size *= 2) {
					const rx = 1 & Math.floor(index / 2)
					const ry = 1 & (index ^ rx)
					if (ry === 0) {
						if (rx === 1) {
							x = size - 1 - x
							y = size - 1 - y
						}
						const swap = x
						x = y
						y = swap
					}
					x += size * rx
					y += size * ry
					index = Math.floor(index / 4)
				}
				points[visit * 2] = (x + 0.5) / side
				points[visit * 2 + 1] = (y + 0.5) / side
			}
			state.count = count
			state.builtOrder = order
		}

		// 行进是按路径比例推进的，走满一圈回绕到 0。
		state.travel = (state.travel + (0.02 + 0.12 * energy) * dt) % 1
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const points = state.points
		const count = state.count
		if (count < 2) return

		const left = 6
		const right = Math.max(left + 2, width - 6)
		const top = bandTop + 4
		const bottom = Math.max(top + 2, bandTop + bandHeight - 4)
		const spanX = right - left
		const spanY = bottom - top

		context.save()

		// 完整路径：一条淡折线，阶数越高线越密。
		context.lineWidth = 1
		context.lineCap = 'round'
		context.lineJoin = 'round'
		context.strokeStyle = withAlpha(accent, 0.18 + 0.12 * energy)
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const x = left + points[index * 2] * spanX
			const y = top + points[index * 2 + 1] * spanY
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.stroke()

		// 光点当前位置：在相邻两点之间线性插值。
		const position = state.travel * (count - 1)
		const slot = Math.min(count - 2, Math.floor(position))
		const fraction = position - slot
		const headX =
			left + (points[slot * 2] + (points[slot * 2 + 2] - points[slot * 2]) * fraction) * spanX
		const headY =
			top + (points[slot * 2 + 1] + (points[slot * 2 + 3] - points[slot * 2 + 1]) * fraction) * spanY

		// 短尾迹：沿路径往前取 12 个点，越旧越淡（靠索引回看，不建数组）。
		context.fillStyle = accent
		for (let back = 1; back <= 12; back += 1) {
			const index = slot - back
			if (index < 0) break
			context.globalAlpha = 0.38 * (1 - back / 13) * (0.6 + 0.4 * energy)
			context.beginPath()
			context.arc(
				left + points[index * 2] * spanX,
				top + points[index * 2 + 1] * spanY,
				1,
				0,
				Math.PI * 2
			)
			context.fill()
		}

		// 光点头：有精灵用 drawImage，没有就画两层假辉光。
		if (sprite !== null) {
			const size = 6 + 5 * energy
			context.globalAlpha = 0.9
			context.drawImage(sprite, headX - size / 2, headY - size / 2, size, size)
		} else {
			context.globalAlpha = 0.22
			context.beginPath()
			context.arc(headX, headY, 3 + 2 * energy, 0, Math.PI * 2)
			context.fill()
			context.globalAlpha = 0.85
			context.beginPath()
			context.arc(headX, headY, 1.1 + 0.7 * energy, 0, Math.PI * 2)
			context.fill()
		}

		// 精灵是白光的，再点一颗 accent 小核把颜色找回来。
		context.globalAlpha = 0.95
		context.fillStyle = accent
		context.beginPath()
		context.arc(headX, headY, 0.9 + 0.4 * energy, 0, Math.PI * 2)
		context.fill()
		context.globalAlpha = 1

		context.restore()
	},
}
