/**
 * 黑体余烬 (embers)
 *
 * 视觉机制：火星从天空带底部缓慢上升，底部靠近火口处偏白/亮，升得越高越冷却、
 * 颜色混向暗色；每颗按 sin(8t + i) 闪烁，像余烬里的忽明忽暗。
 *
 * 能量映射：火星 20 + 50e（≤70）；上升 10 + 40e px/s；闪烁 sin(8t + i)；
 * 颜色 shade(A, -0.3 + 0.5·(1 - y/H))，H 是天空带高度。粒子池在 createState
 * 预分配，升到顶后从底部重生；按 1–2px 方点绘制。
 * 布局：56/bar/off —— 只在 56px 天空带作画，不占 band、不显示频谱。
 *
 * 70 个粒子与 24 级色板都在 createState 预分配；色板只在 accent 变化时重建，
 * step/paint 不建数组/对象。frame.sprite 存在时叠一层柔光，缺图只画方点。
 */
const embersEffect = {
	id: 'embers',
	name: '黑体余烬',
	summary: '火星从底部升起，底部偏白越高越暗，按 sin(8t+i) 闪烁，颜色在强调色与白黑间过渡',
	category: 'light',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 70
		// 固定种子 LCG：初始散布、速度与摆动相位可复现。
		let seed = 0x1f123bb5
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const pool = []
		for (let index = 0; index < MAX; index += 1) {
			pool.push({
				x: 0,
				y: 0,
				nx: random(),
				ny: random(),
				speedFactor: 0.7 + 0.6 * random(),
				phase: random() * Math.PI * 2,
			})
		}
		return {
			pool,
			active: 0,
			time: 0,
			seed: 0x2545f491,
			palette: new Array(24),
			accentSource: '',
			baseR: 120,
			baseG: 200,
			baseB: 255,
			ready: false,
		}
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 56)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const target = Math.max(4, Math.min(70, Math.round(20 + 50 * energy)))
		const rise = 10 + 40 * energy
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const pool = state.pool

		// 只在 accent 变化时重建 24 级色板：从 accent 混向黑再混向白。
		if (accent !== state.accentSource) {
			const open = accent.indexOf('(')
			const close = accent.indexOf(')', open + 1)
			let r = 120
			let g = 200
			let b = 255
			if (open > 0 && close > open) {
				const parts = accent.slice(open + 1, close).split(',')
				const parsedR = Number(parts[0])
				const parsedG = Number(parts[1])
				const parsedB = Number(parts[2])
				if (Number.isFinite(parsedR) && Number.isFinite(parsedG) && Number.isFinite(parsedB)) {
					r = parsedR
					g = parsedG
					b = parsedB
				}
			}
			state.baseR = r
			state.baseG = g
			state.baseB = b
			state.accentSource = accent
			for (let index = 0; index < 24; index += 1) {
				const amount = -0.35 + (0.6 * index) / 23
				const shadeTarget = amount < 0 ? 0 : 255
				const mix = Math.min(1, Math.abs(amount))
				const rr = Math.round(r + (shadeTarget - r) * mix)
				const gg = Math.round(g + (shadeTarget - g) * mix)
				const bb = Math.round(b + (shadeTarget - b) * mix)
				state.palette[index] = `rgb(${rr}, ${gg}, ${bb})`
			}
		}

		if (!state.ready) {
			for (let index = 0; index < pool.length; index += 1) {
				const ember = pool[index]
				ember.x = ember.nx * width
				ember.y = ember.ny * sky
			}
			state.ready = true
		}

		state.time += dt
		for (let index = 0; index < target; index += 1) {
			const ember = pool[index]
			ember.y -= rise * ember.speedFactor * dt
			ember.x += Math.sin(state.time * 1.6 + ember.phase) * (4 + 6 * energy) * dt
			if (ember.x < 0) ember.x += width
			else if (ember.x > width) ember.x -= width
			// 升到顶：从底部重生，换一个横向位置与速度。
			if (ember.y < 0) {
				state.seed = (state.seed * 1664525 + 1013904223) >>> 0
				const nextX = (state.seed / 4294967296) * width
				state.seed = (state.seed * 1664525 + 1013904223) >>> 0
				ember.speedFactor = 0.7 + 0.6 * (state.seed / 4294967296)
				ember.x = nextX
				ember.y = sky - 0.5
			}
			// 兜底：无论 dt 多大都不让火星爬出天空带。
			if (ember.y > sky) ember.y = sky - 0.5
		}
		state.active = target
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const sprite = frame.sprite ?? null
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 56)
		const pool = state.pool
		const palette = state.palette
		const active = state.active

		context.save()
		for (let index = 0; index < active; index += 1) {
			const ember = pool[index]
			const flicker = 0.5 + 0.5 * Math.sin(8 * state.time + index)
			const brightness = 0.25 + 0.75 * flicker
			// shade(A, -0.3 + 0.5·(1 - y/H))：y 是「离底部的高度」，换成 canvas
			// 坐标即 -0.3 + 0.5·(canvasY/H)。底部 0.2（靠近火口、偏白），
			// 顶部 -0.3（冷却、混向暗色）。
			const heightFraction = clamp01(ember.y / sky)
			const amount = -0.3 + 0.5 * heightFraction
			let colorIndex = Math.round(((amount + 0.35) / 0.6) * 23)
			if (colorIndex < 0) colorIndex = 0
			else if (colorIndex > 23) colorIndex = 23

			const size = flicker > 0.7 ? 2 : 1
			const py = Math.max(0, Math.min(sky - size, ember.y))
			if (sprite !== null) {
				const glowY = Math.max(0, Math.min(sky - 4, py - 2))
				context.globalAlpha = 0.06 + 0.12 * flicker
				context.drawImage(sprite, ember.x - 2, glowY, 4, 4)
			}
			context.globalAlpha = brightness
			context.fillStyle = palette[colorIndex]
			context.fillRect(ember.x, py, size, size)
		}
		context.globalAlpha = 1
		context.restore()
	},
}
