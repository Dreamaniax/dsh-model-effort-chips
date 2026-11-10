/**
 * 布料波动 (cloth)
 *
 * 视觉机制：8 行 × 20 列的顶点网格按正弦波上下位移，8 条横向折线像一面被风
 * 吹动的旗；档位越高振幅越大、波长越短、波跑得越快。
 *
 * 能量映射：振幅 1 + 9e、频率 0.08 + 0.12e、波速 1 + 3e rad/s。
 * 布局：40/bar/off —— 只用 40px 天空区，不占 band。
 *
 * 40px 天空区放不下 10px 的原始振幅，统一乘 0.6（最大 ±6px）并把 8 行压进
 * [amp, height-amp]，波峰正好贴住上下边、不会溢出天空区。
 *
 * 相位积分（phase += ω·dt）而不是 time·ω：换档时频率变，乘同一个 t 会跳相。
 * paint 只建一条 path、一次 stroke，save/restore 包住整个绘制；160 个顶点
 * 逐点算 sin，不建数组、不逐点 save/restore。
 */
const clothEffect = {
	id: 'cloth',
	name: '布料波动',
	summary: '8×20 顶点网格被正弦波推着起伏，像一面被风吹动的旗',
	category: 'morph',
	layout: { sky: 40, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.phase += (1 + 3 * level) * dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 40)
		const rows = 8
		const cols = 20
		const amplitude = (1 + 9 * level) * 0.6
		const frequency = 0.08 + 0.12 * level
		// 再留 0.5px 给 1px 描边的抗锯齿，线不会压到天空区边缘。
		const topY = boxTop + amplitude + 0.5
		const bottomY = boxTop + boxHeight - amplitude - 0.5

		context.save()
		context.beginPath()
		// 8 条横线；行与行之间加一点相位差，整个网格才像布面而不是一块平移的板。
		// 20 个顶点之间再插 4 个采样点：高档波长只有 ~31px，20 点直接连线会锯成折角。
		const SUB = 4
		const samples = (cols - 1) * SUB + 1
		for (let row = 0; row < rows; row += 1) {
			const baseY = topY + ((bottomY - topY) * row) / (rows - 1)
			const rowPhase = row * 0.55
			for (let sample = 0; sample < samples; sample += 1) {
				const x = (width * sample) / (samples - 1)
				const y = baseY + Math.sin(x * frequency + state.phase + rowPhase) * amplitude
				if (sample === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
		}
		context.strokeStyle = withAlpha(accent, 0.5 + 0.35 * level)
		context.lineWidth = 1
		context.lineJoin = 'round'
		context.stroke()
		context.restore()
	},
}
