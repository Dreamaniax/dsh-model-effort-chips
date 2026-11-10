/**
 * 隧道环 (tunnel) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * Seven rings rush from the vanishing point to the viewer.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 56 / band 0 / bar / off.
 */
const tunnelEffect = {
	id: 'tunnel',
	name: '隧道环',
	summary: '同心像素环由远及近放大，像穿过隧道，档位越高冲得越快',
	category: 'depth',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		// seconds; one ring takes 3 / (0.3 + 1.4e) s to come forward
		state.time += (0.3 + 1.4 * level) * dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		// Depth effects deliberately draw past the edges (stars fly out, ridges sit
		// under the horizon), so the canvas must be clipped to the declared box.
		context.save()
		context.beginPath()
		context.rect(0, top, width, height)
		context.clip()
		const cx = width * 0.5
		const cy = top + height * 0.5
		for (let index = 0; index < 7; index += 1) {
			// phase walks 0..3 and wraps; exp keeps the rings evenly spaced in depth
			const phase = (state.time + index * 0.42) % 3
			const scale = Math.exp(phase) * height * 0.02
			const size = Math.round(Math.min(height * 1.8, scale * 48))
			if (size < 6) continue
			const alpha = clamp01(phase / 3)
			context.globalAlpha = 0.2 + 0.7 * alpha
			if (art !== null) {
				context.imageSmoothingEnabled = false
				context.drawImage(art, Math.min(5, Math.floor(alpha * 6)) * 48, 0, 48, 48, Math.round(cx - size * 0.5), Math.round(cy - size * 0.5), size, size)
				context.imageSmoothingEnabled = true
			} else {
				context.strokeStyle = accent
				context.lineWidth = 1 + 2 * level
				context.beginPath()
				context.arc(cx, cy, size * 0.3, 0, Math.PI * 2)
				context.stroke()
			}
		}
		context.globalAlpha = 1
		context.restore()
	},
}
