/**
 * 双摆混沌 (double-pendulum)
 *
 * 视觉机制：两根连杆串起两颗摆锤，第二颗摆锤拖一条 12 点定长尾迹。档位越高
 * 连杆越长、重力越大，两条摆的相位差迅速发酵成混沌轨迹。
 *
 * 能量映射：L1 = 10 + 8e、L2 = 8 + 6e（按 48px 天空区缩放 0.7）、
 *          g = 600 + 900e；每根连杆各按 α = -(g/L)sinθ - 0.02ω 积分
 *          （半隐式欧拉），两个角度每帧 wrap 到 ±π。
 * 布局：48/bar/off —— 只在天空区作画，不占 band、不显示频谱。
 *
 * 阻尼 0.02 很轻，摆动能持续数分钟；为了常驻面板不出现「彻底停摆」，速度
 * 低于 2.4 rad/s 时叠加一个随档位增大的微驱动（和 spring-mesh 的周期泵浦
 * 同一目的：画面不会死掉），速度一高它就自动归零。
 *
 * 尾迹用 createState 里预分配的 Float64Array + 环形索引，step/paint 均不分配
 * 对象或数组；paint 只读 state。
 */
const doublePendulumEffect = {
	id: 'double-pendulum',
	name: '双摆混沌',
	summary: '两根连杆的双摆被重力甩出混沌轨迹，12 点尾迹随档位越摆越乱',
	layout: { sky: 48, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		angle1: 2.2,
		angle2: 2.55,
		velocity1: 0,
		velocity2: 0,
		// 12 个点、每点 x/y，定长复用；trailHead 是下一个写入槽位。
		trail: new Float64Array(24),
		trailHead: 0,
		trailCount: 0,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		// 48px 天空区放不下 32px 全展开双摆，按 0.7 缩放，最长摆仍在框内。
		const scale = 0.7
		const length1 = (10 + 8 * level) * scale
		const length2 = (8 + 6 * level) * scale
		const gravity = 600 + 900 * level
		const damping = 0.02
		const substeps = 2
		const h = dt / substeps

		// 两根连杆各自按文档的单摆公式积分（半隐式欧拉）：
		// α = -(g/L)sinθ - 0.02ω。两个 L 不同 => 相位差持续漂移，轨迹越走越乱。
		for (let sub = 0; sub < substeps; sub += 1) {
			const speed = Math.abs(state.velocity1) + Math.abs(state.velocity2)
			const sustain = speed < 2.4 ? (2.4 - speed) * (0.5 + 0.5 * level) : 0
			const alpha1 =
				-(gravity / length1) * Math.sin(state.angle1) -
				damping * state.velocity1 +
				sustain
			const alpha2 =
				-(gravity / length2) * Math.sin(state.angle2) -
				damping * state.velocity2 -
				sustain * 0.8

			// 边界：角速度钳到 ±60 rad/s，避免数值爆炸。
			state.velocity1 = Math.max(-60, Math.min(60, state.velocity1 + alpha1 * h))
			state.velocity2 = Math.max(-60, Math.min(60, state.velocity2 + alpha2 * h))
			state.angle1 += state.velocity1 * h
			state.angle2 += state.velocity2 * h

			// 角度 wrap 到 ±π；不 wrap 会让 sin/cos 精度逐步漂掉。
			let wrapped1 = (state.angle1 + Math.PI) % TAU
			if (wrapped1 < 0) wrapped1 += TAU
			state.angle1 = wrapped1 - Math.PI
			let wrapped2 = (state.angle2 + Math.PI) % TAU
			if (wrapped2 < 0) wrapped2 += TAU
			state.angle2 = wrapped2 - Math.PI
		}

		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 48)
		const pivotX = width * 0.5
		const pivotY = boxTop + boxHeight * 0.5
		const tipX =
			pivotX + length1 * Math.sin(state.angle1) + length2 * Math.sin(state.angle2)
		const tipY =
			pivotY + length1 * Math.cos(state.angle1) + length2 * Math.cos(state.angle2)

		// 定长环形缓冲：只覆写槽位，不 push / shift / new。
		const slot = state.trailHead * 2
		state.trail[slot] = tipX
		state.trail[slot + 1] = tipY
		state.trailHead = (state.trailHead + 1) % 12
		if (state.trailCount < 12) state.trailCount += 1
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 48)
		const scale = 0.7
		const length1 = (10 + 8 * level) * scale
		const length2 = (8 + 6 * level) * scale
		const pivotX = width * 0.5
		const pivotY = boxTop + boxHeight * 0.5
		const jointX = pivotX + length1 * Math.sin(state.angle1)
		const jointY = pivotY + length1 * Math.cos(state.angle1)
		const tipX = jointX + length2 * Math.sin(state.angle2)
		const tipY = jointY + length2 * Math.cos(state.angle2)

		context.save()

		// 尾迹：从最旧的点画到最新的点，越新越亮。
		const count = state.trailCount
		context.fillStyle = accent
		for (let k = 0; k < count; k += 1) {
			const index = (state.trailHead - count + k + 24) % 12
			const px = state.trail[index * 2]
			const py = state.trail[index * 2 + 1]
			context.globalAlpha = 0.06 + 0.5 * ((k + 1) / count) * (0.6 + 0.4 * level)
			context.beginPath()
			context.arc(px, py, 0.9, 0, TAU)
			context.fill()
		}

		// 两段连杆。
		context.globalAlpha = 1
		context.strokeStyle = accent
		context.lineWidth = 1.3
		context.beginPath()
		context.moveTo(pivotX, pivotY)
		context.lineTo(jointX, jointY)
		context.lineTo(tipX, tipY)
		context.stroke()

		// 两颗摆锤 + 支点。
		context.fillStyle = accent
		context.globalAlpha = 0.95
		context.beginPath()
		context.arc(jointX, jointY, 2.2, 0, TAU)
		context.fill()
		context.beginPath()
		context.arc(tipX, tipY, 1.7, 0, TAU)
		context.fill()
		context.globalAlpha = 0.5
		context.beginPath()
		context.arc(pivotX, pivotY, 1.2, 0, TAU)
		context.fill()

		context.restore()
	},
}
