/**
 * 水母 (jellyfish)
 *
 * 视觉机制：半透明的伞盖随呼吸节律收缩/舒展，6 条触手各用 3 段贝塞尔从伞缘
 * 垂下、随脉动轻轻摆动；整只水母缓慢向上浮，升出天空区顶部后从底部重新入场。
 *
 * 能量映射：脉动 0.5 + 0.5·sin(2π(0.5 + 1.3e)t)、伞半径 9 + 6e、
 *          触手 10 + 22e、上浮 4 + 18e px/s。
 * 布局：50/bar/off —— 只用 50px 天空区，不占 band。
 *
 * 天空区只有 50px，而最高档伞 15px + 触手 32px 已有 47px，所以到顶后整只从
 * 画布上方消失时立刻从底部回场，并做 0.3s 淡入；触手长度按剩余空间 clamp，
 * 换档把触手拉长也不会垂到 band/轨道上。paint 只读 state，按位置算一切。
 */
const jellyfishEffect = {
	id: 'jellyfish',
	name: '水母',
	summary: '半透明伞盖一收一放，6 条贝塞尔触手随脉动摆动，整只缓缓上浮',
	category: 'life',
	layout: { sky: 50, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, pulse: 0, y: 0, appear: 1, ready: false }),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(12, frame.artBox?.height ?? 50)
		const tentacle = 10 + 22 * level

		if (!state.ready) {
			// 从底部「整只可见」的位置入场：触手尖贴着天空区底边。
			state.y = artTop + artHeight - 2 - tentacle
			state.ready = true
		} else {
			state.appear = Math.min(1, state.appear + dt / 0.3)
		}

		state.time += dt
		// 相位积分：换档时频率变，直接乘 t 会跳相。
		state.pulse = (state.pulse + TAU * (0.5 + 1.3 * level) * dt) % TAU
		state.y -= (4 + 18 * level) * dt

		// 整只已经升出画布上方 -> 从底部回场，并淡入 0.3s。
		if (state.y + tentacle < artTop) {
			state.y = artTop + artHeight - 2 - tentacle
			state.appear = 0
		}
		state.y = Math.min(state.y, artTop + artHeight - 2)
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(12, frame.artBox?.height ?? 50)
		const artBottom = artTop + artHeight
		const appear = clamp01(state.appear)
		const pulse = 0.5 + 0.5 * Math.sin(state.pulse)
		const bellRadius = 9 + 6 * level
		const radiusX = bellRadius * (0.95 + 0.1 * pulse)
		const radiusY = bellRadius * (0.78 - 0.14 * pulse)
		const centerX = width * 0.5 + Math.sin(state.time * 0.25 + 0.6) * (3 + 2 * level)
		const centerY = state.y

		context.save()

		// 6 条触手：各 3 段贝塞尔，先画（在伞盖后面）。
		const tentacle = 10 + 22 * level
		const spaceLeft = Math.max(4, artBottom - 1 - (centerY + 1))
		const length = Math.min(tentacle * (0.82 + 0.18 * (0.8 + 0.2 * (1 - pulse))), spaceLeft)
		context.beginPath()
		for (let index = 0; index < 6; index += 1) {
			const spread = (index / 5 - 0.5) * 2
			const startX = centerX + spread * radiusX * 0.78
			const startY = centerY + 1
			let x = startX
			let y = startY
			context.moveTo(x, y)
			for (let segment = 1; segment <= 3; segment += 1) {
				const segmentLength = length / 3
				const bend = Math.sin(state.pulse * 0.8 + index * 1.05 + segment * 0.9) * (1.6 + 2.4 * level)
				const nextX = x + bend * 0.7
				const nextY = y + segmentLength
				context.bezierCurveTo(
					x + bend * 0.4,
					y + segmentLength * 0.35,
					x + bend * 0.9,
					y + segmentLength * 0.7,
					nextX,
					nextY
				)
				x = nextX
				y = nextY
			}
		}
		context.strokeStyle = withAlpha(accent, (0.4 + 0.25 * level) * appear)
		context.lineWidth = 1
		context.lineCap = 'round'
		context.stroke()

		// 伞盖：上半椭圆 + 波浪下缘，脉动改变宽高比。
		context.beginPath()
		context.ellipse(centerX, centerY, radiusX, radiusY, 0, Math.PI, TAU)
		const rimY = centerY + 1.5
		let edgeX = centerX + radiusX
		for (let scallop = 0; scallop < 3; scallop += 1) {
			const nextX = edgeX - (2 * radiusX) / 3
			context.quadraticCurveTo(
				(edgeX + nextX) * 0.5,
				rimY + 2 + 1.5 * level,
				nextX,
				rimY
			)
			edgeX = nextX
		}
		context.closePath()
		context.fillStyle = withAlpha(accent, (0.1 + 0.12 * level) * appear)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.85 * appear)
		context.lineWidth = 1.2
		context.stroke()

		// 伞盖内圈：让半透明伞面有层次，不另开新色。
		context.beginPath()
		context.ellipse(centerX, centerY, radiusX * 0.52, radiusY * 0.52, 0, Math.PI, TAU)
		context.strokeStyle = withAlpha(accent, (0.22 + 0.15 * level) * appear)
		context.lineWidth = 1
		context.stroke()

		context.restore()
	},
}
