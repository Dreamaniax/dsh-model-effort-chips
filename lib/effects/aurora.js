/**
 * 极光幕 (aurora) — 光与色, docs/plan/01-effects-taxonomy.md §5.
 *
 * Two to four vertical curtains of light sway over the night strip, each with a
 * bright top edge. `energy` drives:
 *
 *   curtains 2 + floor(2e)      (2..4)
 *   sway     4 + 12e            px, slow sine per curtain
 *   drift    0.2 + 1.2e         rad/s, phase speed of the sway and the edge wave
 *   alpha    0.1 + 0.35e        (gradient opacity, scaled with globalAlpha)
 *
 * Each curtain is a wavy vertical band filled with one vertical gradient:
 * bright at the top, transparent at the bottom. The gradient is created once per
 * (width x height x accent) and cached in state — it is NOT rebuilt per frame;
 * only a size change or an accent change invalidates it. The energy modulation
 * happens through globalAlpha, so dragging the slider never touches the cache.
 * Curtain positions ease toward their level's layout, so a count change slides
 * instead of snapping.
 *
 * Layout sky 76 / band 0 / bar / off: the whole scene lives in the 76px sky.
 */
const auroraEffect = {
	id: 'aurora',
	name: '极光幕',
	summary: '两到四条垂直渐变帘幕在天空缓慢摆动，顶部一条亮边；档位越高帘幕越多越亮',
	category: 'light',
	layout: { sky: 76, band: 0, track: 'bar', spectrum: false },

	createState() {
		const curtains = []
		for (let index = 0; index < 4; index += 1) {
			curtains.push({
				// u is the live centre position (normalised); it eases towards
				// the target layout instead of jumping when the count changes.
				u: index < 2 ? 0.18 + 0.64 * index : 0.82,
				phase: index * 1.7 + 0.4,
				width: index === 0 ? 0.11 : index === 1 ? 0.14 : index === 2 ? 0.16 : 0.12,
				depth: index === 0 ? 0.65 : index === 1 ? 0.85 : index === 2 ? 1 : 0.78,
			})
		}
		return { time: 0, curtains, gradient: null, gradientKey: '' }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.time += dt
		const count = 2 + Math.floor(2 * energy)
		const ease = Math.min(1, 5 * dt)
		for (let index = 0; index < state.curtains.length; index += 1) {
			const curtain = state.curtains[index]
			const target = count <= 1 ? 0.5 : 0.18 + (0.64 * Math.min(index, count - 1)) / (count - 1)
			curtain.u += (target - curtain.u) * ease
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const count = 2 + Math.floor(2 * energy)
		const sway = 4 + 12 * energy
		const drift = 0.2 + 1.2 * energy
		const alpha = 0.1 + 0.35 * energy

		// One vertical gradient shared by every curtain, cached by size + accent.
		// Energy only reaches the gradient through globalAlpha, so a level change
		// reuses the cache; dragging the slider does change the accent, and the
		// gradient is then rebuilt (one gradient + four stops — cheap, and the
		// colour would otherwise lag the level).
		const key = `${width}x${artHeight}|${accent}`
		if (state.gradient === null || state.gradientKey !== key) {
			const gradient = context.createLinearGradient(0, artTop, 0, artTop + artHeight)
			gradient.addColorStop(0, withAlpha(accent, 1))
			gradient.addColorStop(0.38, withAlpha(accent, 0.5))
			gradient.addColorStop(0.75, withAlpha(accent, 0.14))
			gradient.addColorStop(1, withAlpha(accent, 0))
			state.gradient = gradient
			state.gradientKey = key
		}

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'
		const steps = 10
		for (let index = 0; index < count; index += 1) {
			const curtain = state.curtains[index]
			const bandWidth = Math.max(12, width * curtain.width)
			const centerX = width * curtain.u + Math.sin(state.time * drift + curtain.phase) * sway
			const wave = sway * 0.42
			const wavePhase = state.time * drift * 0.7 + curtain.phase
			// A vertical band whose two edges ripple slightly out of phase.
			// The curtain narrows at the top and flares towards the ground, like a
			// sheet of light hanging down.
			context.beginPath()
			for (let step = 0; step <= steps; step += 1) {
				const t = step / steps
				const y = artTop + artHeight * t
				const halfWidth = bandWidth * 0.5 * (0.55 + 0.45 * t)
				const x = centerX + Math.sin(y * 0.06 + wavePhase) * wave - halfWidth
				if (step === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			for (let step = steps; step >= 0; step -= 1) {
				const t = step / steps
				const y = artTop + artHeight * t
				const halfWidth = bandWidth * 0.5 * (0.55 + 0.45 * t)
				const x = centerX + Math.sin(y * 0.06 + wavePhase + 0.9) * wave + halfWidth
				context.lineTo(x, y)
			}
			context.closePath()
			context.fillStyle = state.gradient
			context.globalAlpha = Math.min(1, alpha * curtain.depth)
			context.fill()

			// The bright top edge, with a short glow underneath it.
			const topShift = Math.sin(artTop * 0.06 + wavePhase) * wave
			const leftEdge = centerX + topShift - bandWidth * 0.275
			const rightEdge = centerX + topShift + bandWidth * 0.275
			context.globalAlpha = 1
			context.strokeStyle = withAlpha(accent, (0.5 + 0.5 * energy) * Math.min(1, curtain.depth))
			context.lineWidth = 1.6
			context.beginPath()
			context.moveTo(leftEdge, artTop + 1)
			context.lineTo(rightEdge, artTop + 1)
			context.stroke()
			context.strokeStyle = withAlpha(accent, 0.14 + 0.16 * energy)
			context.lineWidth = 4
			context.beginPath()
			context.moveTo(leftEdge, artTop + 2)
			context.lineTo(rightEdge, artTop + 2)
			context.stroke()
		}
		context.globalAlpha = 1
		context.restore()
	},
}
