/**
 * 蛇形骨链 (snake)
 *
 * 视觉机制：14 节骨链横在 band 里，每节都追一个沿链传播的正弦目标；指数平滑让
 * 关节带一点滞后，整条链像蛇一样左右游动。档位越高振幅越大、波长越短、相位
 * 越快，从懒洋洋的摆动变成快速扭动。
 *
 * 能量映射：振幅 6 + 16e（峰峰值，band 30 内取一半作为 ±）；波长 60 - 20e px；
 * 相位 2 + 4e rad/s；节距 6px。14 个节点，逐帧指数平滑跟随（不做整链 IK），
 * 相邻节点竖直差 clamp 在 2 个节距内。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 14 个节点的 y 在 createState 预分配；step/paint 不建数组/对象。
 */
const snakeEffect = {
	id: 'snake',
	name: '蛇形骨链',
	summary: '14 节骨链依次跟随正弦目标，指数平滑出滞后感，档位越高扭得越快越开',
	category: 'life',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({
		// 每节当前 y（绝对画布坐标），首帧直接吸附到目标，之后指数平滑。
		nodesY: new Float64Array(14),
		time: 0,
		ready: false,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const pitch = 6
		const nodes = state.nodesY
		const chainLength = (nodes.length - 1) * pitch
		const startX = (width - chainLength) * 0.5
		const centerY = bandTop + bandHeight * 0.5
		// 公式的振幅按峰峰值理解，band 只有 30px，取一半作为 ±A 才能不出界。
		const amplitude = 6 + 16 * energy
		const halfAmplitude = Math.min(amplitude * 0.5, bandHeight * 0.5 - 3)
		const wavelength = 60 - 20 * energy
		const phase = 2 + 4 * energy
		const minY = bandTop + 2
		const maxY = bandTop + bandHeight - 2
		// 指数平滑系数：一秒内收敛大半，但每帧都留一点滞后。
		const smooth = 1 - Math.exp(-6 * dt)

		state.time += dt
		for (let index = 0; index < nodes.length; index += 1) {
			const x = startX + index * pitch
			const target =
				centerY + Math.sin((x / wavelength) * TAU + state.time * phase) * halfAmplitude
			if (!state.ready) nodes[index] = target
			else nodes[index] += (target - nodes[index]) * smooth
			if (nodes[index] < minY) nodes[index] = minY
			else if (nodes[index] > maxY) nodes[index] = maxY
		}
		state.ready = true

		// 节点间距 clamp：竖直差不超过 2 个节距，链条不会被拉断或叠死。
		const maxGap = pitch * 2
		for (let index = 1; index < nodes.length; index += 1) {
			const difference = nodes[index] - nodes[index - 1]
			if (difference > maxGap) nodes[index] = nodes[index - 1] + maxGap
			else if (difference < -maxGap) nodes[index] = nodes[index - 1] - maxGap
			if (nodes[index] < minY) nodes[index] = minY
			else if (nodes[index] > maxY) nodes[index] = maxY
		}
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const pitch = 6
		const nodes = state.nodesY
		const count = nodes.length
		const chainLength = (count - 1) * pitch
		const startX = (width - chainLength) * 0.5

		context.save()
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// 脊柱：一条折线串起 14 个关节。
		context.strokeStyle = accent
		context.globalAlpha = 0.85
		context.lineWidth = 1.8
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const x = startX + index * pitch
			if (index === 0) context.moveTo(x, nodes[index])
			else context.lineTo(x, nodes[index])
		}
		context.stroke()

		// 关节圆点：头大尾小，一节节像骨链；一次 fill 画完。
		context.fillStyle = accent
		context.globalAlpha = 0.92
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const x = startX + index * pitch
			const radius = 1.3 + 1.3 * (1 - index / (count - 1)) * (0.6 + 0.4 * energy)
			context.moveTo(x + radius, nodes[index])
			context.arc(x, nodes[index], radius, 0, TAU)
		}
		context.fill()

		// 头节点加一圈淡光，让「蛇头」有方向感。
		context.globalAlpha = 0.18
		context.beginPath()
		context.arc(startX, nodes[0], 4 + 2 * energy, 0, TAU)
		context.fill()
		context.globalAlpha = 1

		context.restore()
	},
}
