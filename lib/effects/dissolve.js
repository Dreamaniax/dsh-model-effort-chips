/**
 * 噪声溶解 (dissolve)
 *
 * 视觉机制：一颗五角星被 3px 沙粒网格覆盖，每格用整数 hash 抽一个 0..1 的阈值，
 * 只有 hash 超过阈值的格子才可见；档位越高阈值越低，形状从一盘散沙重新聚成
 * 实心星，像被噪声侵蚀 / 重组。frame.noise 是 64×64 灰度噪声图，只作为可见
 * 格子的纹理（createPattern 缓存），不参与阈值判定；缺图时退回纯色方块。
 *
 * 能量映射：阈值 0.85 - 0.7e（0.85..0.15）；网格 3px；可见条件 hash > 阈值。
 * 布局：44/bar/off —— 只在 44px 天空带作画，不占 band、不显示频谱。
 *
 * 星形顶点、pattern 缓存都在 createState 建立；step/paint 不建数组/对象，
 * 也不 new canvas（按要求只用 createPattern 给可见格子上纹理）。
 */
const dissolveEffect = {
	id: 'dissolve',
	name: '噪声溶解',
	summary: '五角星被 3px 沙粒网格按 hash 阈值侵蚀或重组，档位越高越接近实心',
	category: 'morph',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		// 10 个顶点交替外/内半径，单位五角星坐标（尖朝上）。
		const starX = new Float64Array(10)
		const starY = new Float64Array(10)
		for (let index = 0; index < 10; index += 1) {
			const angle = -Math.PI / 2 + (index * Math.PI) / 5
			const radius = index % 2 === 0 ? 1 : 0.42
			starX[index] = Math.cos(angle) * radius
			starY[index] = Math.sin(angle) * radius
		}
		return { starX, starY, noiseSource: null, pattern: null }
	},

	step() {
		// 形状只由 frame.energy 决定，没有需要逐帧积分的状态。
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 44)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const noise = frame.noise ?? null
		const starX = state.starX
		const starY = state.starY
		const radius = Math.min(sky * 0.44, width * 0.44)
		const centerX = width * 0.5
		const centerY = sky * 0.5
		const threshold = 0.85 - 0.7 * energy

		// 噪声图换了一张才重建 pattern：纹理只给可见格子上色，不参与阈值。
		if (noise !== state.noiseSource) {
			state.noiseSource = noise
			state.pattern = null
			if (noise !== null && typeof context.createPattern === 'function') {
				state.pattern = context.createPattern(noise, 'repeat')
			}
		}
		const pattern = state.pattern

		context.save()

		// 星形路径；clip 之后所有格子都被裁进形状里。
		context.beginPath()
		for (let index = 0; index < 10; index += 1) {
			const x = centerX + starX[index] * radius
			const y = centerY + starY[index] * radius
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.clip()

		// 形状底影：完全溶解的档位也能看出星的轮廓。
		context.fillStyle = accent
		context.globalAlpha = 0.07 + 0.05 * energy
		context.fill()

		// 3px 网格逐格判定：整数 hash > 阈值才可见。
		const startX = Math.floor((centerX - radius) / 3) * 3
		const startY = Math.floor((centerY - radius) / 3) * 3
		const endX = Math.ceil((centerX + radius) / 3) * 3
		const endY = Math.ceil((centerY + radius) / 3) * 3
		context.beginPath()
		for (let cellY = startY; cellY < endY; cellY += 3) {
			for (let cellX = startX; cellX < endX; cellX += 3) {
				// 32 位整数 hash（Math.imul 防溢出），把格坐标映射到 0..1。
				let hash = Math.imul(cellX, 374761393) ^ Math.imul(cellY, 668265263)
				hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
				hash = (hash ^ (hash >>> 16)) >>> 0
				const value = hash / 4294967296
				if (value <= threshold) continue
				// 高阈值格用满 3px，边缘格缩到 2px，沙化时更碎。
				const size = value > threshold + 0.12 ? 3 : 2
				context.rect(cellX, cellY, size, size)
			}
		}
		context.globalAlpha = 0.55 + 0.35 * energy
		context.fillStyle = accent
		context.fill()
		// 有噪声图时把纹理叠在可见格子上（只影响颜色，不改变可见性）。
		if (pattern !== null) {
			context.globalAlpha = 0.26 + 0.12 * energy
			context.fillStyle = pattern
			context.fill()
		}

		context.restore()

		// 星的细轮廓：给「正在溶解的形状」一个可读的边界。
		context.lineWidth = 1
		context.strokeStyle = accent
		context.globalAlpha = 0.14 + 0.08 * energy
		context.beginPath()
		for (let index = 0; index < 10; index += 1) {
			const x = centerX + starX[index] * radius
			const y = centerY + starY[index] * radius
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.stroke()
		context.globalAlpha = 1
	},
}
