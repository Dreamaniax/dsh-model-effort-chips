/**
 * 仪表盘 (gauge) — 数据与文字, docs/plan/01-effects-taxonomy.md §8.
 *
 * A power-meter dial: a 240-degree arc scale, five ticks, a needle that springs
 * towards its level, and a hard-coded seven-segment percentage in the middle.
 *
 *   needle target   -120° + 240°e   (canvas angle -210° .. +30°)
 *   needle length   10 + 6e         px
 *   ticks           5               along the arc
 *   digits          round(e·100),   up to three, seven hard-coded segment rects
 *                                    each, lit + a 0.09 shadow for the off ones
 *
 * The needle is a spring (position + velocity) so a level change swings instead
 * of jumping; the angle is clamped to the dial's 240° sweep. The digits are
 * hard-coded rectangles (no font APIs) from a precomputed table, and the dial is
 * a plain `arc`. Everything is clipped to the 44px sky band.
 *
 * Layout sky 44 / band 0 / bar / off.
 */
const gaugeEffect = {
	id: 'gauge',
	name: '仪表盘',
	summary: '240° 刻度盘上指针弹簧式摆动，中间硬编码七段数字显示百分比',
	category: 'data',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

	createState() {
		// A 12 x 24 seven-segment digit, a b c d e f g order.
		const segments = new Float32Array([
			2, 0, 8, 2, // a top
			10, 2, 2, 9, // b upper right
			10, 13, 2, 9, // c lower right
			2, 22, 8, 2, // d bottom
			0, 13, 2, 9, // e lower left
			0, 2, 2, 9, // f upper left
			2, 11, 8, 2, // g middle
		])
		// 0-9 masks in the same a..g order.
		const digits = new Uint8Array([63, 6, 91, 79, 102, 109, 125, 7, 127, 111])
		return { needle: -Math.PI * 7 / 6, needleVel: 0, segments, digits }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const START = (-Math.PI * 7) / 6
		const SWEEP = (Math.PI * 4) / 3
		const target = START + SWEEP * energy
		// Damped spring towards the level; the drawn angle is clamped to the dial.
		state.needleVel += ((target - state.needle) * 110 - state.needleVel * 16) * dt
		state.needleVel = Math.max(-30, Math.min(30, state.needleVel))
		state.needle += state.needleVel * dt
		if (state.needle < START) {
			state.needle = START
			state.needleVel = 0
		} else if (state.needle > START + SWEEP) {
			state.needle = START + SWEEP
			state.needleVel = 0
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const START = (-Math.PI * 7) / 6
		const SWEEP = (Math.PI * 4) / 3
		const centerX = width * 0.5
		const radius = Math.max(10, Math.min(artHeight * 0.52, width * 0.3))
		const centerY = artTop + artHeight * 0.58
		const needle = Math.max(START, Math.min(START + SWEEP, state.needle))

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'

		// Dial arc: the full track, then the lit part up to the needle.
		context.strokeStyle = withAlpha(accent, 0.16)
		context.lineWidth = 2
		context.beginPath()
		context.arc(centerX, centerY, radius, START, START + SWEEP, false)
		context.stroke()
		context.strokeStyle = withAlpha(accent, 0.75)
		context.lineWidth = 2
		context.beginPath()
		context.arc(centerX, centerY, radius, START, needle, false)
		context.stroke()

		// Five ticks along the sweep.
		context.strokeStyle = withAlpha(accent, 0.6)
		context.lineWidth = 1
		context.beginPath()
		for (let index = 0; index < 5; index += 1) {
			const angle = START + (SWEEP * index) / 4
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			context.moveTo(centerX + cos * (radius - 3), centerY + sin * (radius - 3))
			context.lineTo(centerX + cos * radius, centerY + sin * radius)
		}
		context.stroke()

		// Needle: a bright blade plus a short counterweight.
		const needleLength = 10 + 6 * energy
		const cosNeedle = Math.cos(needle)
		const sinNeedle = Math.sin(needle)
		context.strokeStyle = withAlpha(accent, 0.95)
		context.lineWidth = 2
		context.beginPath()
		context.moveTo(centerX - cosNeedle * 3.5, centerY - sinNeedle * 3.5)
		context.lineTo(centerX + cosNeedle * needleLength, centerY + sinNeedle * needleLength)
		context.stroke()
		context.fillStyle = withAlpha(accent, 0.9)
		context.beginPath()
		context.arc(centerX, centerY, 2, 0, TAU)
		context.fill()

		// Seven-segment read-out: round(e·100), up to three digits. Leading zeros
		// keep only their 0.09 shadow so the number never jumps sideways.
		const value = Math.max(0, Math.min(100, Math.round(energy * 100)))
		const hundreds = Math.floor(value / 100)
		const tens = Math.floor(value / 10) % 10
		const units = value % 10
		const firstLit = value >= 100 ? 0 : value >= 10 ? 1 : 2
		const scale = 0.36
		const digitWidth = 12 * scale
		const gap = 1.6
		const totalWidth = digitWidth * 3 + gap * 2
		const startX = centerX - totalWidth * 0.5
		const baseY = artTop + artHeight * 0.72
		const litStyle = withAlpha(accent, 0.85)
		const offStyle = withAlpha(accent, 0.09)
		const segments = state.segments
		const masks = state.digits
		const values = [hundreds, tens, units]
		for (let slot = 0; slot < 3; slot += 1) {
			const mask = masks[values[slot]]
			const digitX = startX + slot * (digitWidth + gap)
			const lit = slot >= firstLit
			for (let segment = 0; segment < 7; segment += 1) {
				const on = lit && (mask & (1 << segment)) !== 0
				context.fillStyle = on ? litStyle : offStyle
				const base = segment * 4
				context.fillRect(
					digitX + segments[base] * scale,
					baseY + segments[base + 1] * scale,
					segments[base + 2] * scale,
					segments[base + 3] * scale
				)
			}
		}
		context.restore()
	},
}
