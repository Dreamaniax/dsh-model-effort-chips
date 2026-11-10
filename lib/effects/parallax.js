/**
 * 视差山峦 (parallax) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * Four ridge silhouettes slide at different speeds, so the flat band reads as depth.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 56 / band 0 / bar / off.
 */
const parallaxEffect = {
	id: 'parallax',
	name: '视差山峦',
	summary: '四层像素山峦按深度不同速度平移，形成视差',
	category: 'depth',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0}),

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
		for (let layer = 0; layer < 4; layer += 1) {
			const depth = (layer + 1) / 4
			const offset = (state.time * (10 * (layer + 1)) * (0.2 + 0.9 * level) * 0.05) % 256
			const scale = 0.7 + depth * 1.1
			const tileW = Math.round(256 * scale)
			const tileH = Math.round(48 * scale)
			const y = top + height - tileH + layer * 2
			context.globalAlpha = 0.25 + 0.5 * depth
			if (art !== null) {
				context.imageSmoothingEnabled = false
				for (let x = -offset - tileW; x < width + tileW; x += tileW) {
					context.drawImage(art, Math.round(x), Math.round(y), tileW, tileH)
				}
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				context.fillRect(0, y + tileH * 0.4, width, tileH * 0.6)
			}
		}
		context.globalAlpha = 1
	},
}
