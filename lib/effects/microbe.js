/**
 * 微生物 (microbe) — one oval cell swimming across the band, flagella beating through six frames
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const microbeEffect = {
	id: 'microbe',
	name: '微生物',
	summary: '六帧像素微生物：椭圆身体左右游动，出界从另一侧回场',
	category: 'life',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		// 横向游动，出界后从另一侧回场
		state.x += state.dir * (18 + 70 * level) * dt
		const limit = Math.max(60, (frame.width ?? 284) + 40)
		if (state.x > limit) state.x = -40
		state.y = Math.sin(state.time * (1.4 + 1.6 * level)) * 2
		state.frame = Math.floor(state.time * (5 + 7 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 26 + 10 * level), artHeight - 6))
		const x = state.x
		const y = (frame.band?.top ?? 0) + (frame.band?.height ?? 30) * 0.5 - size * 0.5 + state.y
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：椭圆身体 + 两根鞭毛
			context.strokeStyle = accent
			context.lineWidth = 1.2
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.5, size * 0.3, size * 0.2, 0, 0, Math.PI * 2)
			context.stroke()
			for (let tail = 0; tail < 2; tail += 1) {
				context.beginPath()
				context.moveTo(x + size * 0.8, y + size * (0.45 + tail * 0.1))
				for (let step = 1; step <= 6; step += 1) {
					context.lineTo(x + size * 0.8 + step * 2.2, y + size * (0.45 + tail * 0.1) + Math.sin(state.time * 6 + step) * 2)
				}
				context.stroke()
			}
		}
		context.restore()
	},
}
