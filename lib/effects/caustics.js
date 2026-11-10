/**
 * 焦散 (caustics) — 材质与氛围, docs/plan/01-effects-taxonomy.md §9.
 *
 * A 128x128 seamless pixel texture generated with GPT Image, tiled with a cached
 * pattern and scrolled so the material drifts instead of sitting still. The
 * level drives scale and speed, never the texel size — the swatch stays crisp.
 *
 *   scale    0.8 + 0.6 * level      pattern pixels per texel
 *   drift    3 + 12 * level
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const causticsEffect = {
	id: 'caustics',
	name: '焦散',
	summary: '水下光斑网格缓慢游动，档位越高网眼越密',
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
		const scale = 0.8 + 0.6 * level
		const drift = 3 + 12 * level
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
				context.globalAlpha = 0.3 + 0.4 * level
				context.save()
				context.translate(-offsetX, -offsetY)
				context.scale(scale, scale)
				context.fillStyle = state.pattern
				context.fillRect(0, 0, width / scale + 128, height / scale + 128)
				context.restore()
			}
		} else {
			// 无图时的替身：正弦干涉的亮点
			const freq = 0.04 + 0.08 * level
			for (let y = top; y < top + height; y += 4) {
				for (let x = 0; x < width; x += 4) {
					const v = Math.sin(x * freq + state.time) + Math.sin(y * freq * 1.7 - state.time)
					if (v > 0.55 - 0.2 * level) { context.fillStyle = withAlpha(accent, 0.35); context.fillRect(x, y, 2, 2) }
				}
			}
		}
		context.restore()
		
	},
}
