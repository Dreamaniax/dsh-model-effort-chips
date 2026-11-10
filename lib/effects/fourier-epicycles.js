/**
 * 傅里叶本轮 (fourier-epicycles) — 几何线条, docs/plan/01-effects-taxonomy.md §4.
 *
 * A chain of rotating circles, each centred on the tip of the previous one. The
 * final tip is the pen; it traces the square-wave-like Fourier sum:
 *
 *   terms      K = 1 + floor(6e)                  (1..7 circles)
 *   radius     R_k = 16 / (2k - 1)                px, panel-scaled x 0.92
 *   angular    ω_k = (2k - 1) * (0.6 + 1.2e)      rad/s
 *
 * The pen path is stored in a fixed 240-point ring buffer (2 strokes per frame),
 * so the trail is finite and never shifts an array. When K changes the old ring
 * is copied into the ghost buffers and fades out over ~0.35s while the new curve
 * starts drawing — no hard cut. The chain is drawn with its radius lines and the
 * whole scene is clipped to the 30px band.
 *
 * Layout 0/band(30)/bar/off: the pen's vertical excursion is ~±13.6px, inside the
 * band; the chain is clipped at the band edges like a viewport.
 */
const fourierEpicyclesEffect = {
	id: 'fourier-epicycles',
	name: '傅里叶本轮',
	summary: '七个旋转圆首尾相连，笔尖描出方波曲线；档位越高项数越多、转得越快',
	category: 'geometry',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState() {
		const TRAIL = 240
		return {
			time: 0,
			terms: 1,
			angles: new Float64Array(7),
			trailX: new Float32Array(TRAIL),
			trailY: new Float32Array(TRAIL),
			trailHead: 0,
			trailCount: 0,
			ghostX: new Float32Array(TRAIL),
			ghostY: new Float32Array(TRAIL),
			ghostHead: 0,
			ghostCount: 0,
			ghostAlpha: 0,
		}
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const TAU = Math.PI * 2
		const SCALE = 0.86
		const speeds = 0.6 + 1.2 * energy
		const terms = Math.max(1, Math.min(7, 1 + Math.floor(6 * energy)))
		const angles = state.angles
		state.time += dt
		if (terms !== state.terms) {
			// Snapshot the finished curve, then start a fresh one; the ghost fades.
			state.ghostX.set(state.trailX)
			state.ghostY.set(state.trailY)
			state.ghostHead = state.trailHead
			state.ghostCount = state.trailCount
			state.ghostAlpha = 1
			state.trailHead = 0
			state.trailCount = 0
			state.terms = terms
		}
		if (state.ghostAlpha > 0) state.ghostAlpha = Math.max(0, state.ghostAlpha - dt / 0.35)
		let penX = 0
		let penY = 0
		for (let index = 0; index < terms; index += 1) {
			const order = 2 * (index + 1) - 1
			angles[index] = (angles[index] + order * speeds * dt) % TAU
			const radius = (16 / order) * SCALE
			penX += Math.cos(angles[index]) * radius
			penY += Math.sin(angles[index]) * radius
		}
		const head = state.trailHead
		state.trailX[head] = penX
		state.trailY[head] = penY
		state.trailHead = (head + 1) % 240
		state.trailCount = Math.min(240, state.trailCount + 1)
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const SCALE = 0.86
		const TAU = Math.PI * 2
		const terms = Math.max(1, Math.min(7, 1 + Math.floor(6 * energy)))
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const angles = state.angles
		const base = 0.5 + 0.5 * energy

		context.save()
		context.beginPath()
		context.rect(0, bandTop, width, bandHeight)
		context.clip()
		context.lineWidth = 1
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// Ghost of the previous term count: fades out over ~0.35s.
		if (state.ghostAlpha > 0 && state.ghostCount > 1) {
			const ghostStart = (state.ghostHead - state.ghostCount + 240) % 240
			context.strokeStyle = withAlpha(accent, 0.5 * state.ghostAlpha)
			context.beginPath()
			for (let index = 0; index < state.ghostCount; index += 1) {
				const slot = (ghostStart + index) % 240
				const x = centerX + state.ghostX[slot]
				const y = centerY + state.ghostY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()
		}

		// Trail: a wide soft understroke, the whole ring, then the recent second.
		if (state.trailCount > 1) {
			const trailStart = (state.trailHead - state.trailCount + 240) % 240
			context.strokeStyle = withAlpha(accent, 0.1 * base)
			context.lineWidth = 3
			context.beginPath()
			for (let index = 0; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()

			context.lineWidth = 1.2
			context.strokeStyle = withAlpha(accent, 0.5 * base)
			context.beginPath()
			for (let index = 0; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()

			const recentStart = Math.max(0, state.trailCount - 60)
			context.lineWidth = 1.4
			context.strokeStyle = withAlpha(accent, 0.9 * base)
			context.beginPath()
			for (let index = recentStart; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === recentStart) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()
		}

		// The epicycle chain: circles, the radius to each tip, and the pen.
		// Recomputed in paint because paint never writes state.
		let tipX = 0
		let tipY = 0
		for (let index = 0; index < terms; index += 1) {
			const order = 2 * (index + 1) - 1
			const radius = (16 / order) * SCALE
			const nextX = tipX + Math.cos(angles[index]) * radius
			const nextY = tipY + Math.sin(angles[index]) * radius
			context.strokeStyle = withAlpha(accent, 0.16)
			context.beginPath()
			context.arc(centerX + tipX, centerY + tipY, radius, 0, TAU)
			context.stroke()
			context.strokeStyle = withAlpha(accent, 0.34)
			context.beginPath()
			context.moveTo(centerX + tipX, centerY + tipY)
			context.lineTo(centerX + nextX, centerY + nextY)
			context.stroke()
			tipX = nextX
			tipY = nextY
		}
		context.fillStyle = withAlpha(accent, 0.75 + 0.25 * energy)
		context.beginPath()
		context.arc(centerX + tipX, centerY + tipY, 1.8, 0, TAU)
		context.fill()
		context.restore()
	},
}
