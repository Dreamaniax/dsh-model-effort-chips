/**
 * 藤蔓 (vine) — six growth stages of one vine, anchored to the bottom of the panel
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const vineEffect = {
	id: 'vine',
	name: '藤蔓',
	summary: '六帧像素藤蔓：从芽到开花逐档推进，始终锚在面板底部',
	category: 'life',
	layout: { sky: 60, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.y = 0
		state.frame = Math.floor(state.time * (0.55 + 1.5 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 58 + 34 * level), artHeight - 2))
		const x = width * 0.5 - size * 0.5
		const y = artTop + artHeight - size
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：一条向上生长的折线
			context.strokeStyle = accent
			context.lineWidth = 1.4
			const baseX = x + size * 0.5
			const baseY = y + size
			const grow = 0.3 + 0.7 * ((state.frame + 1) / 6)
			context.beginPath()
			context.moveTo(baseX, baseY)
			for (let step = 1; step <= 6; step += 1) {
				const t = (step / 6) * grow
				context.lineTo(baseX + Math.sin(t * 5) * 4, baseY - size * 0.9 * t)
			}
			context.stroke()
		}
		context.restore()
	},
}
