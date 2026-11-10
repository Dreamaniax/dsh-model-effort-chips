/**
 * 等值线 (contour)
 *
 * 视觉机制：天空带里放 3 个缓慢游走的高斯鼓包，把它们的叠加场画成地形图一样的
 * 等值线；档位越高等值线条数越多，地形图越密，鼓包还会跑得更快。
 *
 * 能量映射：等值线 2 + floor(5e) 条（2..7）；阈值从 0.2 起、间隔 0.12；场 = 3 个
 * 移动高斯；网格 6px（284px 宽约 47×7 格）；marching squares；线段数上限 80。
 * 布局：40/bar/off —— 只在 40px 天空带作画，不占 band、不显示频谱。
 *
 * 场值、交点缓冲都在 createState 预分配；step 只推进时间，paint 不建数组/对象。
 */
const contourEffect = {
	id: 'contour',
	name: '等值线',
	summary: '三个移动高斯叠成的标量场被画成地形等值线，档位越高线越密',
	category: 'data',
	layout: { sky: 40, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		time: 0,
		// 最多约 91×11 个格点；6px 网格在 400px 宽、40px 高内够用。
		values: new Float64Array(91 * 11),
		crossX: new Float64Array(4),
		crossY: new Float64Array(4),
	}),

	step(state, frame) {
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		state.time += dt
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 40)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const cols = Math.max(2, Math.min(90, Math.floor(width / 6)))
		const rows = Math.max(2, Math.min(10, Math.ceil(sky / 6)))
		const pointCols = cols + 1
		const pointRows = rows + 1
		const values = state.values
		const crossX = state.crossX
		const crossY = state.crossY
		if (pointCols * pointRows > values.length) return
		const levels = 2 + Math.floor(5 * energy)

		// 3 个高斯鼓包的中心随时间漂移；档位越高漂得越快。
		const t = state.time * (0.35 + 0.25 * energy)
		const sigmaX = Math.max(6, width * 0.07)
		const sigmaY = Math.max(4, sky * 0.18)
		const invX = 1 / (2 * sigmaX * sigmaX)
		const invY = 1 / (2 * sigmaY * sigmaY)
		const g0x = width * (0.5 + 0.3 * Math.sin(t))
		const g0y = sky * (0.5 + 0.24 * Math.cos(t * 0.8))
		const g1x = width * (0.5 + 0.3 * Math.sin(t * 1.27 + 2.1))
		const g1y = sky * (0.5 + 0.24 * Math.cos(t * 1.05 + 1.3))
		const g2x = width * (0.5 + 0.3 * Math.sin(t * 0.73 + 4.2))
		const g2y = sky * (0.5 + 0.24 * Math.cos(t * 1.4 + 2.6))

		// 采样标量场：sum of 3 Gaussians。
		for (let row = 0; row < pointRows; row += 1) {
			const y = Math.min(sky - 1, row * 6)
			for (let col = 0; col < pointCols; col += 1) {
				const x = col * 6
				const dx0 = x - g0x
				const dy0 = y - g0y
				const dx1 = x - g1x
				const dy1 = y - g1y
				const dx2 = x - g2x
				const dy2 = y - g2y
				values[row * pointCols + col] =
					Math.exp(-(dx0 * dx0 * invX + dy0 * dy0 * invY)) +
					0.85 * Math.exp(-(dx1 * dx1 * invX + dy1 * dy1 * invY)) +
					0.7 * Math.exp(-(dx2 * dx2 * invX + dy2 * dy2 * invY))
			}
		}

		context.save()
		// 网格最后一行可能落在天空带外 1-2px，裁掉。
		context.beginPath()
		context.rect(0, 0, width, sky)
		context.clip()
		context.lineWidth = 1
		context.strokeStyle = accent

		// 80 段总预算按条数均分，保证高档 7 条线都能露脸，不会前两条吃满预算。
		const perLevel = Math.max(6, Math.round(80 / levels))
		for (let levelIndex = 0; levelIndex < levels; levelIndex += 1) {
			// 从高点往低点画：内圈小环先画完整，80 段预算耗尽时只是外圈被截断。
			const level = 0.2 + (levels - 1 - levelIndex) * 0.12
			let segments = 0
			context.globalAlpha = 0.28 + 0.42 * (levelIndex / Math.max(1, levels - 1))
			context.beginPath()
			// 每层从网格的不同位置开始连续扫描：80 段预算被分成若干段光滑弧线，
			// 铺在画面不同高度，而不是全堆在左上角。
			const cellCount = rows * cols
			const startCell = Math.floor(((levels - 1 - levelIndex) * cellCount) / levels)
			for (let step = 0; step < cellCount && segments < perLevel; step += 1) {
				const cell = (startCell + step) % cellCount
				const row = Math.floor(cell / cols)
				const col = cell % cols
				const y0 = row * 6
				const y1 = Math.min(sky, y0 + 6)
				const base = row * pointCols
				{
					const x0 = col * 6
					const x1 = x0 + 6
					const v0 = values[base + col]
					const v1 = values[base + col + 1]
					const v2 = values[base + pointCols + col + 1]
					const v3 = values[base + pointCols + col]
					// 四条边各自判穿越，再按 2/4 个交点连线段（marching squares）。
					let crossings = 0
					if (v0 < level !== v1 < level) {
						crossX[crossings] = x0 + ((x1 - x0) * (level - v0)) / (v1 - v0)
						crossY[crossings] = y0
						crossings += 1
					}
					if (v1 < level !== v2 < level) {
						crossX[crossings] = x1
						crossY[crossings] = y0 + ((y1 - y0) * (level - v1)) / (v2 - v1)
						crossings += 1
					}
					if (v3 < level !== v2 < level) {
						crossX[crossings] = x0 + ((x1 - x0) * (level - v3)) / (v2 - v3)
						crossY[crossings] = y1
						crossings += 1
					}
					if (v0 < level !== v3 < level) {
						crossX[crossings] = x0
						crossY[crossings] = y0 + ((y1 - y0) * (level - v0)) / (v3 - v0)
						crossings += 1
					}
					if (crossings === 2) {
						context.moveTo(crossX[0], crossY[0])
						context.lineTo(crossX[1], crossY[1])
						segments += 1
					} else if (crossings === 4) {
						// 鞍点：两条交叉线都画出来，6px 网格下视觉上足够。
						context.moveTo(crossX[0], crossY[0])
						context.lineTo(crossX[1], crossY[1])
						context.moveTo(crossX[2], crossY[2])
						context.lineTo(crossX[3], crossY[3])
						segments += 2
					}
				}
			}
			context.stroke()
		}

		context.restore()
		context.globalAlpha = 1
	},
}
