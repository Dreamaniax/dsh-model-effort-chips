/**
 * 激光扫描 (laser-scan)
 *
 * 视觉机制：一条竖直亮线从左向右扫过 30px band，身后拖 8 段渐隐余辉，线上
 * 挂一个亮点头部，像示波器/激光扫描仪在扫一行。
 *
 * 能量映射：扫描速度 60 + 260e px/s；余辉固定 8 段，第 k 段 alpha
 * 0.6·(1 - k/8)；头部光点半径 1 + 2e。扫到右边缘后从左侧重置，重置时把
 * 8 段历史一起拉回左侧，避免一条残影横穿画布。
 * 布局：0/bar/off —— 只用 30px band，不显示频谱。
 *
 * createState 里预分配 8 点历史（Float64Array 环形缓冲）；paint 用 fillRect
 * 画线段（不用每帧建渐变），头部光点在 frame.sprite 可用时 drawImage，
 * 否则退回 arc + fill。
 */
const laserScanEffect = {
	id: 'laser-scan',
	name: '激光扫描',
	summary: '一条亮线横向扫过面板，身后拖着 8 段渐隐余辉和光点头部',
	category: 'light',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({
		x: -1,
		// 8 个扫描位置，环形复用；head 指向下一个写入槽位。
		trail: new Float64Array(8),
		head: 0,
		ready: false,
	}),

	step(state, frame) {
		const SEGMENTS = 8
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const speed = 60 + 260 * level

		// 首帧把 8 段历史都放在起点，避免第一帧就从 0 拉一条长线。
		if (!state.ready) {
			state.x = -1
			for (let index = 0; index < SEGMENTS; index += 1) state.trail[index] = state.x
			state.head = 0
			state.ready = true
		}

		state.x += speed * dt
		if (state.x > width + 1) {
			// 扫到右边缘：从左侧重来，历史一起归位。
			state.x = -1
			for (let index = 0; index < SEGMENTS; index += 1) state.trail[index] = state.x
		}

		state.trail[state.head] = state.x
		state.head = (state.head + 1) % SEGMENTS
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const SEGMENTS = 8
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const centerY = bandTop + bandHeight * 0.5
		const top = bandTop + 0.5
		const bottom = bandTop + bandHeight - 0.5

		context.save()
		context.fillStyle = accent

		// 8 段渐隐余辉：k=0 是紧贴头部的最新一段，越旧越淡。
		for (let k = 0; k < SEGMENTS; k += 1) {
			const index = (state.head - 1 - k + SEGMENTS * 2) % SEGMENTS
			const x = state.trail[index]
			if (x < 0 || x > width) continue
			context.globalAlpha = 0.6 * (1 - k / SEGMENTS)
			context.fillRect(x - 0.5, top, 1, bandHeight - 1)
		}

		// 头部亮线 + 光点。
		if (state.x >= 0 && state.x <= width) {
			context.globalAlpha = 0.95
			context.fillRect(state.x - 0.75, top, 1.5, bandHeight - 1)
			const radius = 1 + 2 * level
			const sprite = frame.sprite ?? null
			if (sprite !== null) {
				context.drawImage(sprite, state.x - radius, centerY - radius, radius * 2, radius * 2)
			} else {
				context.beginPath()
				context.arc(state.x, centerY, radius, 0, TAU)
				context.fill()
			}
		}

		context.globalAlpha = 1
		context.restore()
	},
}
