/**
 * PWM 方波 (pwm)
 *
 * 高低电平的方波沿画布展开，占空比随档位变宽，像脉冲宽度调制：
 * duty = 0.08 + 0.84e，周期 0.6 - 0.35e 秒，振幅 4 + 12e。
 * 阶梯折线（每个采样点两次 lineTo），占空比 clamp 到 0.02..0.98，
 * 保证极端档位下仍有一段可见的高电平，而不是整屏一条直线。
 */
const pwmEffect = {
	id: 'pwm',
	name: 'PWM 方波',
	summary: '方波的占空比随档位变宽、周期变短，像脉冲宽度调制',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const period = Math.max(0.08, 0.6 - 0.35 * level)
		state.phase = (state.phase + dt / period) % 1
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const mid = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.36, 4 + 12 * level)
		const duty = Math.min(0.98, Math.max(0.02, 0.08 + 0.84 * level))
		// two cycles across the canvas, scrolling with phase
		const cycles = 2
		const stepX = 2

		context.save()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.4
		context.lineJoin = 'miter'
		context.beginPath()
		let previousHigh = null
		for (let x = 0; x <= width; x += stepX) {
			const local = (((x / width) * cycles - state.phase) % 1 + 1) % 1
			const high = local < duty
			const y = high ? mid - amplitude : mid + amplitude
			if (previousHigh === null) context.moveTo(x, y)
			else if (previousHigh !== high) {
				context.lineTo(x, high ? mid - amplitude : mid + amplitude)
			}
			context.lineTo(x, y)
			previousHigh = high
		}
		context.stroke()

		// faint centre line so the square wave reads as a signal, not a border
		context.globalAlpha = 0.18
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, mid)
		context.lineTo(width, mid)
		context.stroke()
		context.restore()
	},
}
