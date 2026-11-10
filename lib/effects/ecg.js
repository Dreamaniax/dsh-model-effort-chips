/**
 * 心电 (ecg)
 *
 * 一条合成 PQRST 心电波形从左向右卷动，像监护仪：
 * BPM = 48 + 72e，振幅 4 + 10e，每拍由 5 个高斯凸起拼成（P/Q/R/S/T）。
 * 画面上的每个采样点取当前滚动相位对应的心搏电平，因此整条波形是连续的，
 * 不会因为重绘起点而跳变。
 */
/** P, Q, R, S, T as (centre, width, height) in beat-phase units. */
const ECG_BEATS = [
	[0.16, 0.028, 0.16],
	[0.3, 0.012, -0.12],
	[0.34, 0.009, 1],
	[0.385, 0.013, -0.28],
	[0.58, 0.045, 0.24],
]

/** Level of the synthetic beat at a 0..1 phase, PQRST included. */
function beatAt(phase) {
	let value = 0
	for (let index = 0; index < ECG_BEATS.length; index += 1) {
		const [centre, spread, height] = ECG_BEATS[index]
		let delta = phase - centre
		if (delta > 0.5) delta -= 1
		if (delta < -0.5) delta += 1
		value += height * Math.exp(-(delta * delta) / (2 * spread * spread))
	}
	return value
}

const ecgEffect = {
	id: 'ecg',
	name: '心电',
	summary: '合成 PQRST 波形卷动，档位越高心率越快、振幅越大',
	category: 'wave',
	layout: { sky: 20, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time = (state.time + dt * (48 + 72 * level) / 60) % 1024
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.artBox?.top ?? frame.band?.top ?? frame.sky ?? 0
		const boxHeight = Math.max(10, frame.artBox?.height ?? frame.band?.height ?? 30)
		const mid = bandTop + boxHeight * 0.62
		const amplitude = Math.min(boxHeight * 0.5, 4 + 10 * level)

		context.save()
		context.strokeStyle = withAlpha(accent, 0.92)
		context.lineWidth = 1.3
		context.lineJoin = 'round'
		context.beginPath()
		const visibleBeats = 2.4
		for (let x = 0; x <= width; x += 2) {
			const phase = (((x / width) * visibleBeats + state.time) % 1 + 1) % 1
			const y = mid - beatAt(phase) * amplitude
			if (x === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.stroke()

		// baseline + a faint grid, the way a monitor draws it
		context.globalAlpha = 0.16
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, mid)
		context.lineTo(width, mid)
		context.stroke()
		context.restore()
	},
}
