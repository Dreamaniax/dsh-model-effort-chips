/**
 * 瞳孔 (pupil) — an abstract eye whose pupil and lids step through six frames
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const pupilEffect = {
	id: 'pupil',
	name: '瞳孔',
	summary: '六帧像素眼：虹膜、瞳孔与眼睑按节律开合，闭合帧就是眨眼',
	category: 'life',
	layout: { sky: 54, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.y = 0
		state.frame = Math.floor(state.time * (1.6 + 3.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 46 + 24 * level), artHeight - 6))
		const x = width * 0.5 - size * 0.5
		const y = artTop + artHeight * 0.5 - size * 0.5
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：虹膜环 + 瞳孔
			context.strokeStyle = accent
			context.lineWidth = 1.4
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.5, size * 0.36, size * 0.26, 0, 0, Math.PI * 2)
			context.stroke()
			context.fillStyle = withAlpha(accent, 0.5)
			context.beginPath()
			context.arc(x + size * 0.5, y + size * 0.5, size * 0.12, 0, Math.PI * 2)
			context.fill()
		}
		context.restore()
	},
}
