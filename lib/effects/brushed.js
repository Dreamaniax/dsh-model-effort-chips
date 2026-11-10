/**
 * 金属拉丝 (brushed) — 材质与氛围, docs/plan/01-effects-taxonomy.md §9.
 *
 * A 128x128 seamless pixel texture generated with GPT Image, tiled with a cached
 * pattern and scrolled so the material drifts instead of sitting still. The
 * level drives scale and speed, never the texel size — the swatch stays crisp.
 *
 *   scale    1      pattern pixels per texel
 *   drift    10 + 60 * level
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const brushedEffect = {
	id: 'brushed',
	name: '金属拉丝',
	summary: '拉丝金属纹理横向漂移，档位越高高光带跑得越快',
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
		const scale = 1
		const drift = 10 + 60 * level
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
				context.globalAlpha = 0.22 + 0.34 * level
				context.save()
				context.translate(-offsetX, -offsetY)
				context.scale(scale, scale)
				context.fillStyle = state.pattern
				context.fillRect(0, 0, width / scale + 128, height / scale + 128)
				context.restore()
			}
		} else {
			// 无图时的替身：14 条横纹
			for (let line = 0; line < 14; line += 1) {
				const y = top + (line + 0.5) * (height / 14)
				context.fillStyle = withAlpha(accent, 0.06 + 0.1 * level)
				context.fillRect(0, y, width, 1)
			}
		}
		context.restore()
		// 一条移动高光，让静止的拉丝也有方向感
		const sweep = ((state.time * (20 + 80 * level)) % (width + 60)) - 30
		context.fillStyle = withAlpha(accent, 0.05 + 0.12 * level)
		context.fillRect(sweep, top, 10 + 20 * level, height)
	},
}
