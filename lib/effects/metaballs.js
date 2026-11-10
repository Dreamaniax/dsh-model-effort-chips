/**
 * 液态金属 (metaballs)
 *
 * 视觉机制：3–5 个圆各自产生一个紧支撑的二次衰减隐式场，场值相加后取等值线：
 * 圆靠近时等值线连成一片、远离时裂开，像缓慢流动的液态金属。
 *
 * 能量映射：圆数 3 + round(2e)（3–5）、半径 6 + 8e、阈值 0.55 - 0.25e；
 * 圆心各自以不同速度/相位绕天空中心慢速环绕，横向铺开约 28 + 12e px。
 * 布局：46/bar/off —— 只用 46px 天空区，不占 band。
 *
 * 场用预分配的 Float32Array 存（4px 网格，284px 宽约 71×11 格，左上对齐后
 * 垂直居中）；step 逐点重算场值，paint 用 marching squares 描等值线，一条
 * path 一次描两遍（宽淡光晕 + 细亮线）。全程不 new 数组、不做全分辨率采样。
 */
const metaballsEffect = {
	id: 'metaballs',
	name: '液态金属',
	summary: '几个圆的隐式场等值线随距离融合/分裂，像缓慢流动的液态金属',
	category: 'morph',
	layout: { sky: 46, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		const MAX_COLS = 128
		const MAX_ROWS = 12
		return {
			// 网格点场值，按 STRIDE = MAX_COLS + 1 行优先存放，预分配复用。
			field: new Float32Array((MAX_COLS + 1) * (MAX_ROWS + 1)),
			cx: new Float32Array(5),
			cy: new Float32Array(5),
			time: 0,
			cols: 0,
			rows: 0,
			top: 0,
			threshold: 0.55,
			count: 3,
		}
	},

	step(state, frame) {
		const MAX_COLS = 128
		const MAX_ROWS = 12
		const STRIDE = MAX_COLS + 1
		const CELL = 4
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(8, frame.artBox?.height ?? 46)
		const cols = Math.min(MAX_COLS, Math.max(1, Math.floor(width / CELL)))
		const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(artHeight / CELL)))
		// 网格比天空区矮一点：垂直居中，两边各留 remainder/2 的边。
		const top = artTop + (artHeight - rows * CELL) * 0.5

		state.cols = cols
		state.rows = rows
		state.top = top
		state.time += dt

		const count = 3 + Math.round(2 * level)
		const radius = 6 + 8 * level
		const threshold = 0.55 - 0.25 * level
		const spacing = 28 + 12 * level
		const centerX = width * 0.5
		const centerY = top + rows * CELL * 0.5
		state.threshold = threshold
		state.count = count

		// 圆心慢速环绕：每个圆不同速度/相位，偶尔靠近就融合、远离就分裂。
		for (let index = 0; index < 5; index += 1) {
			const phase = index * 2.399963
			const speed = 0.22 + 0.06 * index
			state.cx[index] = centerX + Math.cos(state.time * speed + phase) * spacing * (0.7 + 0.3 * Math.cos(phase * 1.7))
			state.cy[index] = centerY + Math.sin(state.time * speed * 0.73 + phase * 1.3) * spacing * 0.18
		}

		// 4px 网格逐点求场：Σ 2·(1 - d²/r²)（d < r 才有贡献，紧支撑）。
		// 紧支撑保证等值线一定落在某个圆的支撑半径内，46px 天空区不会被裁边；
		// 低档小圆、高档阈值变低 -> 圆之间叠加更多，等值线自然融合。
		const radiusSquared = radius * radius
		const field = state.field
		for (let row = 0; row <= rows; row += 1) {
			const y = top + row * CELL
			const base = row * STRIDE
			for (let col = 0; col <= cols; col += 1) {
				const x = col * CELL
				let sum = 0
				for (let index = 0; index < count; index += 1) {
					const dx = x - state.cx[index]
					const dy = y - state.cy[index]
					const distanceSquared = dx * dx + dy * dy
					if (distanceSquared < radiusSquared) sum += 2 * (1 - distanceSquared / radiusSquared)
				}
				field[base + col] = sum
			}
		}
	},

	paint(context, state, frame) {
		const MAX_COLS = 128
		const STRIDE = MAX_COLS + 1
		const CELL = 4
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const cols = state.cols
		const rows = state.rows
		const top = state.top
		const threshold = state.threshold
		const radius = 6 + 8 * level
		if (cols === 0 || rows === 0) return

		const field = state.field
		context.save()
		context.beginPath()

		// marching squares：每个 4px 格子按四角是否过阈值查 16 种连接。
		for (let row = 0; row < rows; row += 1) {
			const y0 = top + row * CELL
			const y1 = y0 + CELL
			const base = row * STRIDE
			const next = base + STRIDE
			for (let col = 0; col < cols; col += 1) {
				const a = field[base + col]
				const b = field[base + col + 1]
				const c = field[next + col]
				const d = field[next + col + 1]
				const mask = (a > threshold ? 1 : 0) | (b > threshold ? 2 : 0) | (d > threshold ? 4 : 0) | (c > threshold ? 8 : 0)
				if (mask === 0 || mask === 15) continue

				const x0 = col * CELL
				const x1 = x0 + CELL
				const onTop = ((mask & 1) !== 0) !== ((mask & 2) !== 0)
				const onRight = ((mask & 2) !== 0) !== ((mask & 4) !== 0)
				const onBottom = ((mask & 4) !== 0) !== ((mask & 8) !== 0)
				const onLeft = ((mask & 8) !== 0) !== ((mask & 1) !== 0)
				// 只在真正被穿过的边上插值，避免除以 0。
				const topX = onTop ? x0 + (CELL * (threshold - a)) / (b - a) : x0
				const rightY = onRight ? y0 + (CELL * (threshold - b)) / (d - b) : y0
				const bottomX = onBottom ? x0 + (CELL * (threshold - c)) / (d - c) : x0
				const leftY = onLeft ? y0 + (CELL * (threshold - a)) / (c - a) : y0

				// 每个 case 是一到两条线段；5/10 是鞍点，固定配对。
				switch (mask) {
					case 1:
					case 14:
						context.moveTo(x0, leftY)
						context.lineTo(topX, y0)
						break
					case 2:
					case 13:
						context.moveTo(topX, y0)
						context.lineTo(x1, rightY)
						break
					case 3:
					case 12:
						context.moveTo(x0, leftY)
						context.lineTo(x1, rightY)
						break
					case 4:
					case 11:
						context.moveTo(x1, rightY)
						context.lineTo(bottomX, y1)
						break
					case 6:
					case 9:
						context.moveTo(topX, y0)
						context.lineTo(bottomX, y1)
						break
					case 7:
					case 8:
						context.moveTo(x0, leftY)
						context.lineTo(bottomX, y1)
						break
					case 5:
						context.moveTo(x0, leftY)
						context.lineTo(topX, y0)
						context.moveTo(x1, rightY)
						context.lineTo(bottomX, y1)
						break
					case 10:
						context.moveTo(topX, y0)
						context.lineTo(x1, rightY)
						context.moveTo(x0, leftY)
						context.lineTo(bottomX, y1)
						break
					default:
						break
				}
			}
		}

		// 宽淡光晕 + 细亮等值线，两遍 stroke 同一条 path。
		context.strokeStyle = withAlpha(accent, 0.16 + 0.1 * level)
		context.lineWidth = 4
		context.lineJoin = 'round'
		context.stroke()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.2
		context.stroke()

		// 每个圆芯再铺一点半透明底色：等值线是「壳」，芯让液滴有体积感。
		context.beginPath()
		for (let index = 0; index < state.count; index += 1) {
			const core = radius * 0.45
			context.moveTo(state.cx[index] + core, state.cy[index])
			context.arc(state.cx[index], state.cy[index], core, 0, Math.PI * 2)
		}
		context.fillStyle = withAlpha(accent, 0.1 + 0.1 * level)
		context.fill()

		context.restore()
	},
}
