/**
 * 地形飞行 (terrain) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * Three ridge layers scroll at different speeds, low and close.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 56 / band 0 / bar / off.
 */
const terrainEffect = {
	id: 'terrain',
	name: '地形飞行',
	summary: '三层像素山脊以不同速度滚动，像低空飞行',
	category: 'depth',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.time += 1
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const layers = 3
		for (let layer = 0; layer < layers; layer += 1) {
			const depth = (layer + 1) / layers
			const speed = (20 + 60 * layer) * (0.5 + level)
			const offset = (state.time * speed * 0.06) % 256
			const scale = 1 + depth * 0.9
			const tileW = Math.round(256 * scale)
			const tileH = Math.round(48 * scale)
			const y = top + height - tileH + 4
			context.globalAlpha = 0.35 + 0.55 * depth
			if (art !== null) {
				context.imageSmoothingEnabled = false
				for (let x = -offset - tileW; x < width + tileW; x += tileW) {
					context.drawImage(art, Math.round(x), Math.round(y), tileW, tileH)
				}
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				context.beginPath()
				context.moveTo(0, y + tileH)
				for (let x = 0; x <= width; x += 20) context.lineTo(x, y + 12 + Math.sin((x + offset) * 0.02 + layer) * 6)
				context.lineTo(width, y + tileH)
				context.fill()
			}
		}
		context.globalAlpha = 1
	},
}
