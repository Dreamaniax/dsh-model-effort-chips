/**
 * 雷达 (radar) — 数据与文字, docs/plan/01-effects-taxonomy.md §8.
 *
 * A sonar-style polar sweep across a wide, flattened scope:
 *
 *   sweep      0.5 + 2.5 rev/s
 *   echoes     1 + floor(6e)       (max 7, preallocated pool)
 *   echo range 4 + 18e             px, the scope's vertical radius
 *   afterglow  0.35 rad, 6 wedges with decreasing alpha
 *
 * The scope is an ellipse that fills the 284x30 band (rx ~ 118, ry grows with the
 * level). The sweep is one rotating angle; the afterglow is six filled wedges
 * trailing it. Echoes are a fixed array created with a seeded LCG — no per-frame
 * random — and an echo lights up when the sweep angle passes it, then decays.
 * No gradients are created in paint (so no per-frame radial gradients), and all
 * of it is clipped to the band.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const radarEffect = {
	id: 'radar',
	name: '雷达',
	summary: '声呐式极坐标扫描线扫过扁平示波面，回波点在扫过时亮起再衰减',
	category: 'data',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState() {
		const TAU = Math.PI * 2
		const echoes = []
		let seed = 0x7f4a7c15
		for (let index = 0; index < 8; index += 1) {
			seed = (seed * 1664525 + 1013904223) >>> 0
			const angle = (seed / 4294967296) * TAU
			seed = (seed * 1664525 + 1013904223) >>> 0
			const distance = 0.28 + (seed / 4294967296) * 0.66
			echoes.push({ angle, distance, light: 0 })
		}
		return { sweep: 0, echoes }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const TAU = Math.PI * 2
		const stepAngle = (0.5 + 2.5 * energy) * TAU * dt
		state.sweep = (state.sweep + stepAngle) % TAU
		const echoes = state.echoes
		for (let index = 0; index < echoes.length; index += 1) {
			const echo = echoes[index]
			// Angle the sweep has travelled past this echo; it crosses zero once per
			// revolution, which is exactly when the blip lights up.
			let behind = state.sweep - echo.angle
			behind = ((behind % TAU) + TAU) % TAU
			if (behind < stepAngle + 0.02) echo.light = 1
			else if (echo.light > 0) echo.light = Math.max(0, echo.light - dt * 1.05)
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const radiusX = Math.min(width * 0.44, 118)
		const radiusY = Math.max(4, Math.min(bandHeight * 0.45, 14))
		// Echo range 4..22px mapped onto the scope: low levels cluster the blips
		// near the centre, the top level spreads them to the edge.
		const reach = (4 + 18 * energy) / 22
		const count = Math.max(1, Math.min(7, 1 + Math.floor(6 * energy)))
		const echoes = state.echoes
		const sweep = state.sweep

		context.save()
		context.beginPath()
		context.rect(0, bandTop, width, bandHeight)
		context.clip()

		// Scope: crosshair, then three concentric range rings.
		context.strokeStyle = withAlpha(accent, 0.12)
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(centerX - radiusX, centerY)
		context.lineTo(centerX + radiusX, centerY)
		context.moveTo(centerX, centerY - radiusY)
		context.lineTo(centerX, centerY + radiusY)
		context.stroke()
		for (let ring = 1; ring <= 3; ring += 1) {
			const factor = ring / 3
			context.save()
			context.translate(centerX, centerY)
			context.scale(radiusX * factor, radiusY * factor)
			context.beginPath()
			context.arc(0, 0, 1, 0, TAU)
			context.restore()
			context.strokeStyle = withAlpha(accent, 0.13)
			context.lineWidth = 1
			context.stroke()
		}

		// Afterglow: six wedges trailing the sweep, each dimmer than the last.
		const glowStep = 0.35 / 6
		for (let index = 0; index < 6; index += 1) {
			const end = sweep - index * glowStep
			const start = end - glowStep
			context.save()
			context.translate(centerX, centerY)
			context.scale(radiusX, radiusY)
			context.beginPath()
			context.moveTo(0, 0)
			context.arc(0, 0, 1, start, end, false)
			context.closePath()
			context.restore()
			context.fillStyle = withAlpha(accent, 0.72 * (1 - index / 6) * (1 - index / 6))
			context.fill()
		}

		// Sweep line from the centre to the scope edge.
		const cosSweep = Math.cos(sweep)
		const sinSweep = Math.sin(sweep)
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.2
		context.beginPath()
		context.moveTo(centerX, centerY)
		context.lineTo(centerX + cosSweep * radiusX, centerY + sinSweep * radiusY)
		context.stroke()
		context.strokeStyle = withAlpha(accent, 0.14)
		context.lineWidth = 4
		context.beginPath()
		context.moveTo(centerX, centerY)
		context.lineTo(centerX + cosSweep * radiusX, centerY + sinSweep * radiusY)
		context.stroke()

		// Echoes: fixed positions, brightness driven by the sweep pass.
		const dotRadius = 1.4 + 1.2 * energy
		for (let index = 0; index < count; index += 1) {
			const echo = echoes[index]
			const x = centerX + Math.cos(echo.angle) * echo.distance * reach * radiusX
			const y = centerY + Math.sin(echo.angle) * echo.distance * reach * radiusY
			const light = echo.light
			if (light > 0.01) {
				context.fillStyle = withAlpha(accent, 0.2 * light)
				context.beginPath()
				context.arc(x, y, dotRadius * 2.6, 0, TAU)
				context.fill()
			}
			context.fillStyle = withAlpha(accent, 0.18 + 0.8 * light)
			context.beginPath()
			context.arc(x, y, dotRadius, 0, TAU)
			context.fill()
		}

		// Centre marker.
		context.fillStyle = withAlpha(accent, 0.55)
		context.beginPath()
		context.arc(centerX, centerY, 1.2, 0, TAU)
		context.fill()
		context.restore()
	},
}
