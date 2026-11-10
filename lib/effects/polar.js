/**
 * 极坐标变形 (polar) — 形变与过渡, docs/plan/01-effects-taxonomy.md §6.
 *
 * A polar radius morphs a circle into a star and a polygon:
 *
 *   k = 3 + floor(4e)              (3..7 lobes)
 *   r = R · (1 + 0.12e · cos(kθ))   with R = 8 + 14e px
 *   rotation 0.2 + 1e              rad/s
 *
 * 96 points per closed path; r is clamped positive. A k step does not pop: the
 * previous radius set is kept in state and both shapes are cross-faded over
 * 0.2s (the old one fading out while the new one fades in). R is scaled down
 * slightly at the top levels so the star's tips stay inside the 48px band.
 *
 * createState only holds the angle, the two k values and the blend progress;
 * step advances them and paint derives the 96 points twice per frame while a
 * blend runs. No blurred shadows, no per-frame objects.
 *
 * Layout sky 48 / band 0 / bar / off.
 */
const polarEffect = {
	id: 'polar',
	name: '极坐标变形',
	summary: '圆在多边形与星形之间变形旋转；档位越高边数越多、转得越快',
	category: 'morph',
	layout: { sky: 48, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ angle: 0, k: 3, prevK: 3, blend: 0 }),

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.angle = (state.angle + (0.2 + energy) * dt) % (Math.PI * 2)
		const k = 3 + Math.floor(4 * energy)
		if (k !== state.k) {
			state.prevK = state.k
			state.k = k
			state.blend = 1
		}
		if (state.blend > 0) state.blend = Math.max(0, state.blend - dt / 0.2)
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const centerX = width * 0.5
		const centerY = artTop + artHeight * 0.5
		const amplitude = 0.12 * energy
		// The taxonomy's R grows to 22px; cap it so the tallest star tips stay
		// two pixels inside the 48px sky instead of being clipped.
		const nominalR = 8 + 14 * energy
		const fit = Math.min(1, (artHeight * 0.5 - 2) / Math.max(1, nominalR * (1 + amplitude)))
		const radius = nominalR * fit
		const ease = 1 - state.blend

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineJoin = 'round'

		// The outgoing radius set, if a k step is still blending.
		if (state.blend > 0) {
			context.globalAlpha = state.blend
			context.beginPath()
			for (let index = 0; index < 96; index += 1) {
				const theta = (index / 96) * TAU
				const r = Math.max(0.6, radius * (1 + amplitude * Math.cos(state.prevK * (theta + state.angle))))
				const x = centerX + Math.cos(theta) * r
				const y = centerY + Math.sin(theta) * r
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.closePath()
			context.fillStyle = withAlpha(accent, 0.12)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.55)
			context.lineWidth = 1.4
			context.stroke()
		}

		// The incoming radius set (full weight once the blend ends).
		context.globalAlpha = ease
		context.beginPath()
		for (let index = 0; index < 96; index += 1) {
			const theta = (index / 96) * TAU
			const r = Math.max(0.6, radius * (1 + amplitude * Math.cos(state.k * (theta + state.angle))))
			const x = centerX + Math.cos(theta) * r
			const y = centerY + Math.sin(theta) * r
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.strokeStyle = withAlpha(accent, 0.15)
		context.lineWidth = 4
		context.stroke()
		context.fillStyle = withAlpha(accent, 0.12)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.75 + 0.25 * energy)
		context.lineWidth = 1.6
		context.stroke()
		context.restore()
	},
}
