/**
 * 半色调 (halftone) — 材质与氛围, docs/plan/01-effects-taxonomy.md §9.
 *
 * A 128x128 seamless pixel texture generated with GPT Image, tiled with a cached
 * pattern and scrolled so the material drifts instead of sitting still. The
 * level drives scale and speed, never the texel size — the swatch stays crisp.
 *
 *   scale    0.6 + 0.8 * level      pattern pixels per texel
 *   drift    3 + 14 * level
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const halftoneEffect = {
	id: 'halftone',
	name: '半色调',
	summary: '半调网点纹理缓慢漂移，档位越高网点越大越密',
	category: 'texture',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, pattern: null, patternArt: null }),

	step(state, frame) {
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const scale = 0.6 + 0.8 * level
		const drift = 3 + 14 * level
		const offsetX = (state.time * drift * 0.6) % (art !== null ? art.naturalWidth : 128)
		const offsetY = (state.time * drift) % (art !== null ? art.naturalHeight : 128)

		context.save()
		context.beginPath()
		context.rect(0, top, width, height)
		context.clip()
		if (art !== null) {
			// Cache the pattern per image; it only changes when the swatch changes.
			if (state.pattern === null || state.patternArt !== art) {
				state.pattern = context.createPattern(art, 'repeat')
				state.patternArt = art
			}
			if (state.pattern !== null) {
				context.globalAlpha = 0.3 + 0.45 * level
				context.save()
				context.translate(-offsetX, -offsetY)
				context.scale(scale, scale)
				context.fillStyle = state.pattern
				context.fillRect(0, 0, width / scale + 128, height / scale + 128)
				context.restore()
			}
		} else {
			// 无图时的替身：6px 网格圆点，半径随亮度变化
			context.fillStyle = withAlpha(accent, 0.5)
			context.beginPath()
			for (let y = top + 3; y < top + height; y += 6) {
				for (let x = 3; x < width; x += 6) {
					const lum = 0.5 + 0.5 * Math.sin(x * 0.05 + y * 0.08 + state.time)
					const r = 0.4 + 1.8 * level * (1 - lum)
					if (r > 0.3) { context.moveTo(x + r, y); context.arc(x, y, r, 0, Math.PI * 2) }
				}
			}
			context.fill()
		}
		context.restore()
		
	},
}
