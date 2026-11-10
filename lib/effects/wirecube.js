/**
 * 线框立方 (wirecube) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * A pixel wireframe cube turns on the spot; the level drives the spin.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 44 / band 0 / bar / off.
 */
const wirecubeEffect = {
	id: 'wirecube',
	name: '线框立方',
	summary: '像素线框立方体旋转，档位越高转得越快',
	category: 'depth',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.time += (0.3 + 1.7 * level) * dt * 60
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const size = Math.round(Math.min(height - 6, 26 + 12 * level))
		const x = Math.round(width * 0.5 - size * 0.5)
		const y = Math.round(top + (height - size) * 0.5)
		if (art !== null) {
			context.imageSmoothingEnabled = false
			context.drawImage(art, (Math.floor(state.time * 2) % 6) * 48, 0, 48, 48, x, y, size, size)
			context.imageSmoothingEnabled = true
		} else {
			context.strokeStyle = accent
			context.lineWidth = 1.2
			context.strokeRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6)
		}
	},
}
