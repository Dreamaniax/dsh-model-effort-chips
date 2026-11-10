/**
 * 余晖拖尾 (afterglow)
 *
 * 视觉机制：一颗光点在天空带里缓慢转向、撞边反弹，身后拖一条长曝光似的余晖。
 * 越旧的轨迹越淡，档位越高点速越快、拖尾越长、衰减越慢。
 *
 * 能量映射：拖尾 4 + 14e 段（16 帧环形缓冲封顶）；衰减 0.82 + 0.12e / 段；
 * 点速 40 + 140e px/s。位置写入定长环形缓冲、用索引取模回看，禁止 shift()。
 * 布局：34/bar/off —— 只在 34px 天空带作画，不占 band、不显示频谱。
 *
 * 轨迹坐标、角度、时间都在 createState 里预分配；step/paint 不建数组/对象。
 * 光点头优先用 frame.sprite，缺图时回退 arc 假辉光。
 */
const afterglowEffect = {
	id: 'afterglow',
	name: '余晖拖尾',
	summary: '光点在天空里转向反弹，16 帧环形缓冲拖出越旧越淡的长曝光余晖',
	category: 'light',
	layout: { sky: 34, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		// 16 帧定长环形缓冲，每帧写一个点；x/y 各一条。
		trailX: new Float64Array(16),
		trailY: new Float64Array(16),
		head: 0,
		filled: 0,
		x: 0,
		y: 0,
		angle: 0,
		time: 0,
		ready: false,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 34)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const speed = 40 + 140 * energy

		if (!state.ready) {
			state.x = width * 0.5
			state.y = sky * 0.5
			state.angle = 0.35
			state.head = 0
			state.filled = 0
			state.ready = true
		}

		state.time += dt
		// 缓慢转向：角度随 sin 漂移，光点自己转弯，轨迹不会是一条直线。
		state.angle += Math.sin(state.time * 0.9 + 0.7) * (0.9 + 0.6 * energy) * dt
		let angle = state.angle % TAU
		if (angle > Math.PI) angle -= TAU
		else if (angle < -Math.PI) angle += TAU
		state.angle = angle

		state.x += Math.cos(angle) * speed * dt
		state.y += Math.sin(angle) * speed * dt

		// 撞边反弹：把方向角沿墙翻折，位置再 clamp 一次防 dt 抖动越界。
		const margin = 3
		const left = margin
		const right = Math.max(left + 1, width - margin)
		const top = margin
		const bottom = Math.max(top + 1, sky - margin)
		if (state.x < left) {
			state.x = left
			state.angle = Math.PI - state.angle
		} else if (state.x > right) {
			state.x = right
			state.angle = Math.PI - state.angle
		}
		if (state.y < top) {
			state.y = top
			state.angle = -state.angle
		} else if (state.y > bottom) {
			state.y = bottom
			state.angle = -state.angle
		}
		state.x = Math.max(left, Math.min(right, state.x))
		state.y = Math.max(top, Math.min(bottom, state.y))

		// 环形缓冲：覆写 head 槽位，head 自增取模，不 push / shift。
		state.trailX[state.head] = state.x
		state.trailY[state.head] = state.y
		state.head = (state.head + 1) % 16
		if (state.filled < 16) state.filled += 1
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const trailX = state.trailX
		const trailY = state.trailY
		// 4 + 14e 段；16 槽缓冲封顶（e=1 时公式是 18，按缓冲长度截断）。
		const active = Math.min(16, Math.max(2, Math.round(4 + 14 * energy)))
		const decay = 0.82 + 0.12 * energy
		const head = state.head
		const filled = state.filled

		context.save()
		context.lineCap = 'round'
		context.lineJoin = 'round'
		context.strokeStyle = accent
		context.fillStyle = accent

		// 从最新一段往旧画：每退一段乘一次衰减，越旧越淡。
		let alpha = 0.9
		for (let age = 0; age < active - 1; age += 1) {
			if (age > filled - 2) break
			const newer = (head - 1 - age + 16) % 16
			const older = (head - 2 - age + 16) % 16
			alpha *= decay
			context.globalAlpha = alpha
			context.lineWidth = Math.max(0.5, 1.8 - age * 0.06)
			context.beginPath()
			context.moveTo(trailX[older], trailY[older])
			context.lineTo(trailX[newer], trailY[newer])
			context.stroke()
		}

		// 光点头：外圈假辉光 + 亮核；有精灵时再叠一层柔光点。
		const headX = head === 0 ? trailX[15] : trailX[head - 1]
		const headY = head === 0 ? trailY[15] : trailY[head - 1]
		context.globalAlpha = 0.16 + 0.1 * energy
		context.beginPath()
		context.arc(headX, headY, 3 + 1.5 * energy, 0, TAU)
		context.fill()
		context.globalAlpha = 0.95
		context.beginPath()
		context.arc(headX, headY, 1.6 + 0.8 * energy, 0, TAU)
		context.fill()
		if (sprite !== null) {
			const size = 5 + 3 * energy
			context.globalAlpha = 0.6
			context.drawImage(sprite, headX - size / 2, headY - size / 2, size, size)
		}
		context.globalAlpha = 1

		context.restore()
	},
}
