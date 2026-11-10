/**
 * 棱镜色散 (prism) — 光与色, docs/plan/01-effects-taxonomy.md §5.
 *
 * A white beam enters a triangular prism and leaves as a five-band spectrum fan.
 * `energy` opens both the incidence and the dispersion:
 *
 *   incidence  0.1 + 0.3e   rad (the beam's angle into the left face)
 *   fan        0.15 + 0.6e  rad (total spread of the five colour rays)
 *   band gap   2 + 4e       px  (lateral spacing of the rays at the exit face)
 *   brightness 0.4 + 0.6e
 *
 * The prism is a triangle sized from the live width / sky height; the white
 * beam, the internal segment and the five rays are derived from it. Ray colours
 * are mixed from `accent` towards white (light bands) and black (dark bands) —
 * no second palette. Every ray is clipped to the sky band by intersecting it
 * with the band edge, so nothing is drawn outside 0..sky. There are exactly
 * five 1.4px colour lines plus a soft underglow, and createState only holds the
 * clock the shimmer needs.
 *
 * Layout sky 46 / band 0 / bar / off: the prism lives in the 46px sky strip.
 */
const prismEffect = {
	id: 'prism',
	name: '棱镜色散',
	summary: '白光穿过三角棱镜散成五色彩带；档位越高扇越开、越亮',
	category: 'light',
	layout: { sky: 46, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.time += dt
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const time = state.time
		const TAU = Math.PI * 2

		// Parse the accent once: the five bands are mixes of this one colour.
		const match = /rgba?\(([^)]+)\)/.exec(accent)
		let baseR = 120
		let baseG = 200
		let baseB = 255
		if (match !== null) {
			const parts = match[1].split(',')
			baseR = Number(parts[0]) || 0
			baseG = Number(parts[1]) || 0
			baseB = Number(parts[2]) || 0
		}

		// --- the prism -------------------------------------------------------
		const top = artTop + 3
		const base = artTop + artHeight - 3
		const height = Math.max(8, base - top)
		const centerX = width * 0.32
		const halfBase = Math.max(10, Math.min(width * 0.115, artHeight * 0.72))

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'

		// The white beam: enter the left face at the level's incidence angle.
		const incidence = 0.1 + 0.3 * energy
		const tanIncidence = Math.tan(incidence)
		const startX = 0
		const startY = top + height * 0.24
		const entryFraction = Math.max(
			0.08,
			Math.min(0.92, (tanIncidence * centerX + startY - top) / (height + tanIncidence * halfBase))
		)
		const entryX = centerX - halfBase * entryFraction
		const entryY = top + height * entryFraction
		const exitX = centerX + halfBase * 0.55
		const exitY = top + height * 0.55

		// Glass body: a faint fill, a crisp edge and one bright inner edge.
		context.beginPath()
		context.moveTo(centerX, top)
		context.lineTo(centerX - halfBase, base)
		context.lineTo(centerX + halfBase, base)
		context.closePath()
		context.fillStyle = withAlpha(accent, 0.06 + 0.04 * energy)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.4 + 0.15 * energy)
		context.lineWidth = 1
		context.stroke()

		// The beam before the prism: accent mixed heavily with white.
		const beamRed = baseR + (255 - baseR) * 0.72
		const beamGreen = baseG + (255 - baseG) * 0.72
		const beamBlue = baseB + (255 - baseB) * 0.72
		context.strokeStyle = `rgba(${beamRed | 0}, ${beamGreen | 0}, ${beamBlue | 0}, ${0.45 + 0.35 * energy})`
		context.lineWidth = 1.5
		context.beginPath()
		context.moveTo(startX, startY)
		context.lineTo(entryX, entryY)
		context.stroke()
		// Internal segment, dimmer: the beam continues through the glass.
		context.strokeStyle = withAlpha(accent, 0.35)
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(entryX, entryY)
		context.lineTo(exitX, exitY)
		context.stroke()

		// --- the five dispersed bands ---------------------------------------
		const fan = 0.15 + 0.6 * energy
		const gap = 2 + 4 * energy
		const alpha = 0.4 + 0.6 * energy
		const shimmer = 0.04 * Math.sin(time * 1.1)
		const meanAngle = 0.02 + shimmer
		const margin = 2
		const rightEdge = width - margin
		const topEdge = artTop + margin
		const bottomEdge = artTop + artHeight - margin
		for (let index = 0; index < 5; index += 1) {
			const offset = (index - 2) * gap * 0.35
			const startRayX = exitX - Math.sin(meanAngle) * offset
			const startRayY = exitY + Math.cos(meanAngle) * offset
			const angle = meanAngle + ((index - 2) / 4) * fan
			const dirX = Math.cos(angle)
			const dirY = Math.sin(angle)
			// Intersect the ray with the band edge so it never leaves the sky.
			let travel = (rightEdge - startRayX) / (dirX > 0.0001 ? dirX : 0.0001)
			if (dirY > 0.0001) travel = Math.min(travel, (bottomEdge - startRayY) / dirY)
			else if (dirY < -0.0001) travel = Math.min(travel, (topEdge - startRayY) / dirY)
			if (!Number.isFinite(travel) || travel < 3) travel = Math.max(3, travel)
			const endX = startRayX + dirX * travel
			const endY = startRayY + dirY * travel
			// Lightness band: mix the accent towards white (top) and black (bottom).
			const shade = (index - 2) / 2
			let red = baseR
			let green = baseG
			let blue = baseB
			if (shade < 0) {
				const amount = -shade * 0.6
				red = baseR + (255 - baseR) * amount
				green = baseG + (255 - baseG) * amount
				blue = baseB + (255 - baseB) * amount
			} else if (shade > 0) {
				const amount = shade * 0.42
				red = baseR * (1 - amount)
				green = baseG * (1 - amount)
				blue = baseB * (1 - amount)
			}
			// Soft underglow, then the 1.4px band itself.
			context.strokeStyle = `rgba(${red | 0}, ${green | 0}, ${blue | 0}, ${alpha * 0.18})`
			context.lineWidth = 4
			context.beginPath()
			context.moveTo(startRayX, startRayY)
			context.lineTo(endX, endY)
			context.stroke()
			context.strokeStyle = `rgba(${red | 0}, ${green | 0}, ${blue | 0}, ${alpha})`
			context.lineWidth = 1.4
			context.beginPath()
			context.moveTo(startRayX, startRayY)
			context.lineTo(endX, endY)
			context.stroke()
		}

		// A bright split point where the white beam leaves the glass.
		context.fillStyle = withAlpha(accent, 0.7 + 0.3 * energy)
		context.beginPath()
		context.arc(exitX, exitY, 1.6 + 1.2 * energy, 0, TAU)
		context.fill()
		context.restore()
	},
}
