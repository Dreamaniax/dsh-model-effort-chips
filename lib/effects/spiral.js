/**
 * 阿基米德螺线 (spiral)
 *
 * 视觉机制：一条阿基米德螺线从中心一圈圈长出来，亮点头部沿螺线向外跑；
 * 头部跑到最大 θ 后回到中心重画，画完的旧螺线在 0.35s 内淡出。
 *
 * 能量映射：圈数 1 + 4e、螺距 2 + 3e px、头部角速度 2 + 6e rad/s。
 * 螺线半径 r = 螺距·θ/(2π)；θ 上限 = 2π·圈数，所以最大半径 = 螺距·圈数。
 * 螺线原始最大半径 25px，按天空带高度自适应缩放（半径 ≈ 天空带 44%）。
 *
 * 200 个采样点只算、不存数组；一帧最多两次 beginPath（旧线淡出 + 当前螺线），
 * 头部亮点用 fillRect 画，不额外开路径。回卷时 α 从 1 衰减到 0，新旧线不会跳。
 */
const spiralEffect = {
	id: 'spiral',
	name: '阿基米德螺线',
	summary: '螺线从中心一圈圈长出，亮点头部沿螺线跑，跑满后淡出重画',
	category: 'geometry',
	layout: { sky: 76, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		theta: 0,
		turns: 1,
		pitch: 2,
		thetaMax: Math.PI * 2,
		// 上一轮完成时的快照，用于 0.35s 的淡出。
		fade: 0,
		fadeTurns: 1,
		fadePitch: 2,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const turns = 1 + 4 * level
		const pitch = 2 + 3 * level
		const thetaMax = TAU * turns
		const speed = 2 + 6 * level

		if (state.fade > 0) state.fade = Math.max(0, state.fade - dt / 0.35)

		state.theta += speed * dt
		if (state.theta >= thetaMax) {
			// θ 超上限：从 0 重来，旧线进入淡出（用上一帧的参数快照）。
			// 用取模而不是减一次，拖档把圈数从 5 拉回 1 时也不会卡在端点。
			state.theta -= thetaMax * Math.floor(state.theta / thetaMax)
			state.fade = 1
			state.fadeTurns = state.turns
			state.fadePitch = state.pitch
		}
		state.turns = turns
		state.pitch = pitch
		state.thetaMax = thetaMax
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const POINTS = 200
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.artBox?.top ?? frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const scale = bandHeight * 0.028

		context.save()

		// 旧线淡出：完成时的那一轮参数，0.35s 线性衰减。
		if (state.fade > 0) {
			const fadeTheta = TAU * state.fadeTurns
			context.beginPath()
			for (let index = 0; index <= POINTS; index += 1) {
				const t = (index / POINTS) * fadeTheta
				const r = (state.fadePitch * scale * t) / TAU
				const x = centerX + r * Math.cos(t)
				const y = centerY + r * Math.sin(t)
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.strokeStyle = withAlpha(accent, 0.45 * state.fade)
			context.lineWidth = 1
			context.stroke()
		}

		// 当前正在长出来的螺线：只画到头部 θ，采样点数按进度缩放。
		const theta = Math.min(state.theta, state.thetaMax)
		const steps = Math.max(2, Math.ceil((POINTS * theta) / state.thetaMax))
		context.beginPath()
		for (let index = 0; index <= steps; index += 1) {
			const t = (theta * index) / steps
			const r = (state.pitch * scale * t) / TAU
			const x = centerX + r * Math.cos(t)
			const y = centerY + r * Math.sin(t)
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.strokeStyle = withAlpha(accent, 0.55 + 0.25 * level)
		context.lineWidth = 1.1
		context.stroke()

		// 头部亮点：fillRect 不占 beginPath 预算。
		const headR = (state.pitch * scale * theta) / TAU
		const headX = centerX + headR * Math.cos(theta)
		const headY = centerY + headR * Math.sin(theta)
		context.fillStyle = accent
		context.globalAlpha = 0.95
		context.fillRect(headX - 1.2, headY - 1.2, 2.4, 2.4)
		context.globalAlpha = 1

		context.restore()
	},
}
