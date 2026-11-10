/**
 * 辉光呼吸 (glow-breath)
 *
 * 视觉机制：同一条横贯面板的缓波路径用三重描边叠出辉光——最外圈最宽最淡、
 * 中间一圈收窄、最内一条细亮线；三层 alpha 一起随呼吸曲线起伏，像一条发光的
 * 缎带在缓慢吸气/呼气。不用模糊阴影，颜色全部直接用 accent。
 *
 * 能量映射：呼吸频率 0.3 + 0.9e Hz（相位积分，拖档不跳）、外圈 alpha
 * 0.08 + 0.14e、外圈线宽 10 + 6e（clamp ≤16）；中圈取外圈一半宽，
 * 内圈固定 1.5px。
 * 布局：40/bar/off —— 40px 天空区给 16px 线宽留出上下呼吸空间，不占 band。
 *
 * step 只推进呼吸相位与波形漂移（都是纯数字）；paint 只建一条 path、连描三次，
 * 不新建数组、不建渐变。
 */
const glowBreathEffect = {
	id: 'glow-breath',
	name: '辉光呼吸',
	summary: '一条缓波路径三重描边的发光缎带，整体 alpha 随档位加快呼吸',
	category: 'light',
	layout: { sky: 40, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0, drift: 0 }),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		// 积分相位而不是直接算 sin(2πft)：档位一变频率就变，乘同一个 t 会跳相。
		state.phase = (state.phase + TAU * (0.3 + 0.9 * level) * dt) % TAU
		state.drift = (state.drift + (0.5 + 0.5 * level) * dt) % TAU
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 40)
		const centerY = boxTop + boxHeight * 0.5
		const breath = 0.5 + 0.5 * Math.sin(state.phase)
		const outerWidth = Math.min(16, 10 + 6 * level)

		context.save()
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// 一条缓波路径，后面三次 stroke 复用同一条 path。
		context.beginPath()
		for (let index = 0; index <= 48; index += 1) {
			const x = (width * index) / 48
			const y = centerY + Math.sin((x / width) * TAU * 2 + state.drift) * 4
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}

		// 外圈：宽、淡，负责「辉光」的体量。
		context.strokeStyle = withAlpha(accent, (0.08 + 0.14 * level) * breath)
		context.lineWidth = outerWidth
		context.stroke()

		// 中圈：一半宽，亮度抬起来，让外圈到内芯有过渡。
		context.strokeStyle = withAlpha(accent, (0.22 + 0.22 * level) * breath)
		context.lineWidth = outerWidth * 0.5
		context.stroke()

		// 内芯：细亮线，呼吸最浅时也保留可见的核心。
		context.strokeStyle = withAlpha(accent, (0.72 + 0.18 * level) * breath)
		context.lineWidth = 1.5
		context.stroke()

		context.restore()
	},
}
