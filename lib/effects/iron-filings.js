/**
 * 铁粉场 (iron-filings) — 粒子场 / 群集, docs/plan/01-effects-taxonomy.md §3.
 *
 * Iron filings scattered on paper over two fixed magnetic poles. Each filing is
 * a 1px segment aligned with the local dipole field:
 *
 *   filings     N = 60 + 60e       (hard cap: the 120-slot pool)
 *   field       B = 0.2 + 1.8e     (alignment strength)
 *   length      1 + 3e             px
 *   poles       2, fixed at 36% / 64% of the width, clear of the panel edges
 *
 * The field is a pair of opposite 1/r² monopoles; the segment angle is atan2 of
 * the summed field. Low levels leave a wide deterministic jitter around the
 * field direction (a loose, thermal scatter); high levels snap the filings onto
 * the field lines. Angles are recomputed every second frame using a frame
 * counter (state.tick) and eased in between, so a level change visibly snaps.
 *
 * paint() draws all 120 segments in a single path/stroke. When the host supplies
 * a decoded frame.sprite the two poles are drawn additively with drawImage,
 * otherwise they fall back to arc() for the glow and the cores.
 *
 * Layout 0/30/bar/off: the whole field lives in the 30px band.
 */
const ironFilingsEffect = {
	id: 'iron-filings',
	name: '铁粉场',
	summary: '短线段沿双极磁场排列，档位越高场越强、铁粉越齐',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState() {
		const COUNT = 120
		let seed = 0x2468ace0
		// Deterministic LCG: every mount shows the same iron-filing pattern.
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const filings = []
		for (let index = 0; index < COUNT; index += 1) {
			filings.push({
				// Normalised layout inside the band; mapped with the live frame size.
				u: 0.04 + 0.92 * random(),
				v: 0.14 + 0.72 * random(),
				angle: 0,
				target: 0,
				jitter: (random() * 2 - 1) * 1.5,
				phase: random() * Math.PI * 2,
			})
		}
		return { tick: 0, time: 0, filings }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.tick += 1
		state.time += dt
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const field = 0.2 + 1.8 * energy
		const align = clamp01(field * 0.5)
		const left = 10
		const top = bandTop + 2
		const innerWidth = Math.max(1, width - left * 2)
		const innerHeight = Math.max(1, bandHeight - 4)
		const poleLeftX = width * 0.36
		const poleRightX = width * 0.64
		const poleY = bandTop + bandHeight * 0.5
		// Field angles are cheap enough to refresh every other frame; the segment
		// angle eases towards the new target on every frame in between.
		const recompute = state.tick === 1 || state.tick % 2 === 0
		const ease = state.tick === 1 ? 1 : 1 - Math.exp(-(7 + 9 * align) * dt)
		const filings = state.filings
		for (let index = 0; index < filings.length; index += 1) {
			const filing = filings[index]
			if (recompute) {
				const x = left + filing.u * innerWidth
				const y = top + filing.v * innerHeight
				let dxLeft = x - poleLeftX
				let dyLeft = y - poleY
				let leftDistance = Math.sqrt(dxLeft * dxLeft + dyLeft * dyLeft)
				if (leftDistance < 6) leftDistance = 6
				let dxRight = x - poleRightX
				let dyRight = y - poleY
				let rightDistance = Math.sqrt(dxRight * dxRight + dyRight * dyRight)
				if (rightDistance < 6) rightDistance = 6
				const leftFalloff = 1 / (leftDistance * leftDistance)
				const rightFalloff = 1 / (rightDistance * rightDistance)
				const fieldX = (dxLeft / leftDistance) * leftFalloff - (dxRight / rightDistance) * rightFalloff
				const fieldY = (dyLeft / leftDistance) * leftFalloff - (dyRight / rightDistance) * rightFalloff
				const fieldAngle = Math.atan2(fieldY, fieldX)
				const wobble = 0.65 + 0.35 * Math.sin(state.time * 0.9 + filing.phase)
				filing.target = fieldAngle + filing.jitter * (1 - align) * wobble
			}
			// A segment has no head or tail: ease along the shortest half-turn.
			let delta = filing.target - filing.angle
			delta -= Math.PI * Math.round(delta / Math.PI)
			filing.angle += delta * ease
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const count = Math.max(0, Math.min(120, Math.round(60 + 60 * energy)))
		const TAU = Math.PI * 2
		const left = 10
		const top = bandTop + 2
		const innerWidth = Math.max(1, width - left * 2)
		const innerHeight = Math.max(1, bandHeight - 4)
		const poleLeftX = width * 0.36
		const poleRightX = width * 0.64
		const poleY = bandTop + bandHeight * 0.5
		const segment = (1 + 3 * energy) * 0.5
		const field = 0.2 + 1.8 * energy
		const filings = state.filings

		// Every filing in one path, one stroke: 120 short segments are cheap.
		context.strokeStyle = withAlpha(accent, 0.22 + 0.5 * energy)
		context.lineWidth = 1
		context.lineCap = 'round'
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const filing = filings[index]
			const x = left + filing.u * innerWidth
			const y = top + filing.v * innerHeight
			const dx = Math.cos(filing.angle) * segment
			const dy = Math.sin(filing.angle) * segment
			context.moveTo(x - dx, y - dy)
			context.lineTo(x + dx, y + dy)
		}
		context.stroke()

		// Poles: a soft halo plus a hard core, fixed relative to the panel width.
		const glow = 5 + 4 * energy
		if (sprite !== null) {
			context.globalCompositeOperation = 'lighter'
			context.globalAlpha = 0.3 + 0.35 * energy
			context.drawImage(sprite, poleLeftX - glow, poleY - glow, glow * 2, glow * 2)
			context.drawImage(sprite, poleRightX - glow, poleY - glow, glow * 2, glow * 2)
			context.globalCompositeOperation = 'source-over'
			context.globalAlpha = 1
		} else {
			context.fillStyle = withAlpha(accent, 0.16 + 0.24 * energy)
			context.beginPath()
			context.moveTo(poleLeftX + glow, poleY)
			context.arc(poleLeftX, poleY, glow, 0, TAU)
			context.moveTo(poleRightX + glow, poleY)
			context.arc(poleRightX, poleY, glow, 0, TAU)
			context.fill()
		}
		context.fillStyle = withAlpha(accent, 0.65 + 0.3 * energy)
		context.beginPath()
		context.moveTo(poleLeftX + 1.7, poleY)
		context.arc(poleLeftX, poleY, 1.7 + 0.5 * (field / 2), 0, TAU)
		context.moveTo(poleRightX + 1.7, poleY)
		context.arc(poleRightX, poleY, 1.7 + 0.5 * (field / 2), 0, TAU)
		context.fill()
	},
}
