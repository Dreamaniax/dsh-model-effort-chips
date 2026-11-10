/**
 * 花开 (bloom) — one flower opening across six frames, from bud to full petals
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const bloomEffect = {
	id: 'bloom',
	name: '花开',
	summary: '六帧像素花：花苞到盛开逐档展开，循环回花苞',
	category: 'life',
	layout: { sky: 58, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.y = 0
		state.frame = Math.floor(state.time * (0.9 + 2.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 52 + 30 * level), artHeight - 6))
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
			// 无图时的替身：花瓣由少到多
			const petals = 2 + state.frame
			context.strokeStyle = accent
			context.lineWidth = 1.2
			for (let petal = 0; petal < petals; petal += 1) {
				const angle = (petal / petals) * Math.PI * 2 - Math.PI / 2
				context.beginPath()
				context.ellipse(x + size * 0.5 + Math.cos(angle) * size * 0.2, y + size * 0.5 + Math.sin(angle) * size * 0.2, size * 0.12, size * 0.18, angle, 0, Math.PI * 2)
				context.stroke()
			}
		}
		context.restore()
	},
}
