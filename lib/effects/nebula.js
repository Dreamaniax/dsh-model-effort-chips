/**
 * FBM 云雾 (nebula) — 材质与氛围, docs/plan/01-effects-taxonomy.md §9.
 *
 * A 128x128 seamless pixel texture generated with GPT Image, tiled with a cached
 * pattern and scrolled so the material drifts instead of sitting still. The
 * level drives scale and speed, never the texel size — the swatch stays crisp.
 *
 *   scale    0.7 + 0.5 * level      pattern pixels per texel
 *   drift    2 + 10 * level
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const nebulaEffect = {
	id: 'nebula',
	name: 'FBM 云雾',
	summary: '星云状像素云雾缓慢漂移，档位越高层次越明显',
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
		const scale = 0.7 + 0.5 * level
		const drift = 2 + 10 * level
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
				context.globalAlpha = 0.35 + 0.45 * level
				context.save()
				context.translate(-offsetX, -offsetY)
				context.scale(scale, scale)
				context.fillStyle = state.pattern
				context.fillRect(0, 0, width / scale + 128, height / scale + 128)
				context.restore()
			}
		} else {
			// 无图时的替身：三层错位正弦，近似云带
			for (let octave = 0; octave < 3; octave += 1) {
				const f = 0.02 + 0.03 * level + octave * 0.02
				context.fillStyle = withAlpha(accent, 0.08 + 0.1 * level)
				for (let y = top; y < top + height; y += 5) {
					const band = Math.sin(y * f * 6 + state.time * (0.4 + octave * 0.3)) * 0.5 + 0.5
					if (band > 0.5) context.fillRect(0, y, width, 3)
				}
			}
		}
		context.restore()
		
	},
}
