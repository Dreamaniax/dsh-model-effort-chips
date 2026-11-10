/**
 * 等距网格 (grid) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * A perspective grid rolls towards the horizon, synthwave style.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 56 / band 0 / bar / off.
 */
const gridEffect = {
	id: 'grid',
	name: '等距网格',
	summary: '像素网格向地平线滚动，档位越高越快，像 80 年代合成波',
	category: 'depth',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.time += (0.2 + 1.8 * level) * dt * 60
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const tile = 64
		const offset = (state.time * 40) % tile
		context.save()
		context.beginPath()
		context.rect(0, top, width, height)
		context.clip()
		if (art !== null) {
			for (let row = 0; row < 6; row += 1) {
				// rows compress towards the horizon: the further up, the shorter
				const scale = 0.3 + row * 0.22
				const h = Math.round(tile * scale)
				const y = top + height - row * (height * 0.16) - offset * scale * 0.3
				context.imageSmoothingEnabled = false
				for (let x = -tile; x < width + tile; x += Math.round(tile * scale)) {
					context.globalAlpha = 0.2 + 0.3 * scale
					context.drawImage(art, Math.round(x), Math.round(y), Math.round(tile * scale), h)
				}
				context.imageSmoothingEnabled = true
			}
		} else {
			context.strokeStyle = accent
			context.lineWidth = 1
			for (let row = 0; row < 6; row += 1) {
				const y = top + height - row * (height * 0.16) - offset * 0.3
				context.beginPath()
				context.moveTo(0, y)
				context.lineTo(width, y)
				context.stroke()
			}
		}
		context.globalAlpha = 1
		context.restore()
	},
}
