/**
 * 粒子聚形 (particle-morph)
 *
 * 视觉机制：120 粒星尘从 band 内散乱的位置被吸到一条五角星轮廓的采样点上，
 * 近处抖动、远处平滑飞行；档位越高吸引越强、飞行越快，到达后抖动也越明显，
 * 像星尘在拼图案时还保持一点呼吸。
 *
 * 能量映射：目标采样 120 点（参数方程五角星，不加载图片）；吸引
 * 0.01 + 0.08e / 帧；抖动振幅 1 + 6e px（按到目标的距离衰减）；到达半径 2px。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 120 个粒子与目标单位坐标都在 createState 预生成；step/paint 不建数组。
 * frame.sprite 存在时用 drawImage 画星尘，否则退回 arc 圆点。
 */
const particleMorphEffect = {
	id: 'particle-morph',
	name: '粒子聚形',
	summary: '星尘从随机位置被吸到五角星采样点，档位越高吸得越快、抖得越活',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const COUNT = 120
		const TAU = Math.PI * 2
		const particles = []
		// 固定种子 LCG：初始散点、相位、抖动频率都可复现。
		let seed = 0x2545f491
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		// 五角星轮廓：10 个顶点交替外/内半径，120 个采样点沿 10 条边均分。
		const EDGES = 10
		const PER_EDGE = COUNT / EDGES
		for (let index = 0; index < COUNT; index += 1) {
			const edge = Math.floor(index / PER_EDGE)
			const along = (index % PER_EDGE) / PER_EDGE
			const fromAngle = Math.PI / 2 + edge * (Math.PI / 5)
			const toAngle = fromAngle + Math.PI / 5
			const fromRadius = edge % 2 === 0 ? 1 : 0.42
			const toRadius = edge % 2 === 0 ? 0.42 : 1
			const fromX = Math.cos(fromAngle) * fromRadius
			const fromY = Math.sin(fromAngle) * fromRadius
			const toX = Math.cos(toAngle) * toRadius
			const toY = Math.sin(toAngle) * toRadius
			particles.push({
				x: 0,
				y: 0,
				ux: fromX + (toX - fromX) * along,
				uy: fromY + (toY - fromY) * along,
				startX: random(),
				startY: random(),
				phase: random() * TAU,
				rate: 1.2 + random() * 1.6,
				glow: 0,
			})
		}
		return { particles, time: 0, ready: false }
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		// 目标星保持方形并收在 band 内（半径约 band 的 44%）。
		const halfHeight = bandHeight * 0.44
		const halfWidth = Math.min(width * 0.44, halfHeight)
		const attraction = 0.01 + 0.08 * energy
		const particles = state.particles
		state.time += dt

		if (!state.ready) {
			for (let index = 0; index < particles.length; index += 1) {
				const particle = particles[index]
				particle.x = particle.startX * width
				particle.y = bandTop + particle.startY * bandHeight
			}
			state.ready = true
		}

		for (let index = 0; index < particles.length; index += 1) {
			const particle = particles[index]
			const targetX = centerX + particle.ux * halfWidth
			const targetY = centerY + particle.uy * halfHeight
			const dx = targetX - particle.x
			const dy = targetY - particle.y
			const distance = Math.hypot(dx, dy)

			if (distance > 2) {
				// 弹簧趋近：按到目标的距离做指数收敛，不引入速度状态。
				particle.x += dx * attraction
				particle.y += dy * attraction
			} else {
				// 到达半径 2px：吸附到采样点，避免在目标附近来回过冲。
				particle.x = targetX
				particle.y = targetY
			}

			// 抖动只放在 paint 里：状态保持向目标收敛，画面才不会因为
			// 「弱吸引 × 慢抖动」被低通放大成十几像素的漂移。
			// 只在 band 内活动：clamp 到画布与 band 的交集。
			if (particle.x < 0) particle.x = 0
			else if (particle.x > width) particle.x = width
			if (particle.y < bandTop) particle.y = bandTop
			else if (particle.y > bandTop + bandHeight) particle.y = bandTop + bandHeight

			// 给 paint 用的亮度：越接近目标越亮。
			particle.glow = 1 - clamp01(distance / (bandHeight * 1.5))
		}
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const halfHeight = bandHeight * 0.44
		const halfWidth = Math.min(width * 0.44, halfHeight)
		const particles = state.particles
		const count = particles.length
		const time = state.time
		const jitterAmplitude = (1 + 6 * energy) * 0.28

		context.save()

		// 目标形状的淡轮廓：让「正在拼成什么」在聚拢前就可读。
		context.strokeStyle = withAlpha(accent, 0.08 + 0.06 * energy)
		context.lineWidth = 1
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const particle = particles[index]
			const px = centerX + particle.ux * halfWidth
			const py = centerY + particle.uy * halfHeight
			if (index === 0) context.moveTo(px, py)
			else context.lineTo(px, py)
		}
		context.closePath()
		context.stroke()

		if (sprite !== null) {
			// 精灵路径：低透明度柔光当辉光，再用一遍 accent 内核画出星尘颜色。
			for (let index = 0; index < count; index += 1) {
				const particle = particles[index]
				const size = 3 + 2 * particle.glow + 1.2 * energy
				const shake = jitterAmplitude * (0.35 + 0.65 * particle.glow)
				const px =
					particle.x + Math.sin(time * particle.rate + particle.phase) * shake
				const py =
					particle.y +
					Math.cos(time * particle.rate * 1.31 + particle.phase * 1.7) * shake
				context.globalAlpha = 0.1 + 0.32 * particle.glow + 0.08 * energy
				context.drawImage(sprite, px - size / 2, py - size / 2, size, size)
			}
			context.globalAlpha = 0.5 + 0.3 * energy
			context.fillStyle = accent
			context.beginPath()
			for (let index = 0; index < count; index += 1) {
				const particle = particles[index]
				const shake = jitterAmplitude * (0.35 + 0.65 * particle.glow)
				const px =
					particle.x + Math.sin(time * particle.rate + particle.phase) * shake
				const py =
					particle.y +
					Math.cos(time * particle.rate * 1.31 + particle.phase * 1.7) * shake
				const radius = 0.5 + 0.6 * particle.glow + 0.4 * energy
				context.moveTo(px + radius, py)
				context.arc(px, py, radius, 0, TAU)
			}
			context.fill()
			context.globalAlpha = 1
		} else {
			// 无精灵：一次 fill 画完所有星尘，亮度用半径表达。
			context.fillStyle = accent
			context.globalAlpha = 0.55 + 0.35 * energy
			context.beginPath()
			for (let index = 0; index < count; index += 1) {
				const particle = particles[index]
				const shake = jitterAmplitude * (0.35 + 0.65 * particle.glow)
				const px =
					particle.x + Math.sin(time * particle.rate + particle.phase) * shake
				const py =
					particle.y +
					Math.cos(time * particle.rate * 1.31 + particle.phase * 1.7) * shake
				const radius = 0.6 + 0.9 * particle.glow + 0.5 * energy
				context.moveTo(px + radius, py)
				context.arc(px, py, radius, 0, TAU)
			}
			context.fill()
			context.globalAlpha = 1
		}

		context.restore()
	},
}
