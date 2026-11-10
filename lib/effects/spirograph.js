/**
 * 万花尺 (spirograph)
 *
 * 视觉机制：小圆（半径 r=7）在大圆（半径 R=18+16e）内滚动，笔尖距小圆中心
 * d=8+16e，画出内摆线花瓣；档位越高 R/d 越大、花瓣越密。笔尖拖着一条 240 点
 * 定长尾迹，最近 4 秒的轨迹整条留在 band 里，像一支笔一直在画。
 *
 * 能量映射：R = 18 + 16e、r = 7、d = 8 + 16e、头部角速度 0.8 + 3.2e rad/s。
 * R/r = (18+16e)/7 始终非整数，所以轨迹首尾不闭合；这里用环形缓冲按时间顺序
 * 取点画折线，θ 连续累加、不重置，所以「回卷接缝」根本不存在（比保留 1 帧
 * 重叠更稳），折线也无需 closePath 去硬接首尾。
 *
 * 曲线原始半径 51px，按天空带高度自适应缩放（半径 ≈ 天空带 42%），不会缩成中间一个小点。
 * 尾迹在 createState 里一次性分配 Float64Array(240*2)，step/paint 只写槽位。
 */
const spirographEffect = {
	id: 'spirograph',
	name: '万花尺',
	summary: '内摆线笔尖拖着 240 点尾迹不停画花瓣，档位越高花瓣越密',
	category: 'geometry',
	layout: { sky: 84, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		theta: 0,
		// 240 个点、每点 x/y，定长复用；head 指向下一个写入槽位。
		trail: new Float64Array(240 * 2),
		head: 0,
		count: 0,
	}),

	step(state, frame) {
		const TRAIL = 240
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const rolling = 7
		const outer = 18 + 16 * level - rolling
		const pen = 8 + 16 * level
		const ratio = outer / rolling
		// Unit space: paint() multiplies by the sky-band height, so a taller panel
		// simply draws a bigger figure instead of a dot in the middle.
		const scale = 0.0098

		// θ 连续累加：不回卷，所以不存在参数接缝；精度足够跑满整个会话。
		state.theta += (0.8 + 3.2 * level) * dt
		const t = state.theta
		const x = (outer * Math.cos(t) + pen * Math.cos(ratio * t)) * scale
		const y = (outer * Math.sin(t) - pen * Math.sin(ratio * t)) * scale

		// 定长环形缓冲：只覆写槽位，不 push / shift / new。
		state.trail[state.head * 2] = x
		state.trail[state.head * 2 + 1] = y
		state.head = (state.head + 1) % TRAIL
		if (state.count < TRAIL) state.count += 1
	},

	paint(context, state, frame) {
		const TRAIL = 240
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.artBox?.top ?? frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		// The trail is stored in unit space; the sky-band height is the scale, so
		// the same curve fills a 30px band or a 64px one.
		const unit = bandHeight

		context.save()

		// 240 点尾迹：从最旧到最新画一条折线，一条 path 一次 stroke。
		const count = state.count
		if (count >= 2) {
			let cursor = (state.head - count + TRAIL) % TRAIL
			context.beginPath()
			context.moveTo(centerX + state.trail[cursor * 2] * unit, centerY + state.trail[cursor * 2 + 1] * unit)
			for (let index = 1; index < count; index += 1) {
				cursor = (cursor + 1) % TRAIL
				context.lineTo(centerX + state.trail[cursor * 2] * unit, centerY + state.trail[cursor * 2 + 1] * unit)
			}
			context.strokeStyle = withAlpha(accent, 0.34 + 0.36 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 笔尖亮点（最新的点）。
		if (count > 0) {
			const tip = (state.head - 1 + TRAIL) % TRAIL
			context.fillStyle = accent
			context.globalAlpha = 0.95
			context.fillRect(
				centerX + state.trail[tip * 2] * unit - 1.2,
				centerY + state.trail[tip * 2 + 1] * unit - 1.2,
				2.4,
				2.4
			)
			context.globalAlpha = 1
		}

		context.restore()
	},
}
