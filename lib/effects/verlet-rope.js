/**
 * Verlet 绳索 (verlet-rope) — docs/plan/01-effects-taxonomy.md §1 物理仿真.
 *
 * A rope is strung across the canvas, pinned at both ends: gravity makes it hang
 * in a shallow catenary, a travelling `sin(t)` gust pushes its middle around, and
 * two distance-constraint passes keep the 12px links together. Higher energy adds
 * gravity (400 + 800e), wind (20 + 120e) and slack, so the rope hangs deeper and
 * sways harder instead of just moving faster.
 *
 * This file is a SNIPPET: it is injected verbatim into the plugin module scope,
 * so it must stay a single top-level declaration. Around it the host provides the
 * math built-ins, the Canvas 2D API and `clamp01(x)` / `withAlpha(color, a)`. The
 * host owns the canvas, the DPR transform, clearRect and the rAF loop, so this
 * effect never starts a timer, imports anything, uses Math.random(), shadowBlur,
 * or allocates arrays/objects inside step/paint.
 *
 * frame = { energy, accent, totalLevels, width, height, dt, band, sky, trackY,
 *           rail, artBox }. With layout { sky: 30, band: 0 } the canvas is 88px
 * tall (sky + band + rail) but the rope belongs in the 30px sky strip above the
 * track, i.e. inside frame.artBox — so the rig is sized from artBox, not from
 * frame.height, and it still works on a bare 30px canvas.
 */
const verletRopeEffect = {
	id: 'verlet-rope',
	name: 'Verlet 绳索',
	summary: '两端固定的绳横跨画布，重力下垂、风力推摆，档位越高风越猛、绳越松',
	layout: { sky: 30, band: 0, track: 'bar', spectrum: false },

	createState() {
		// 18 points, each keeping its previous position (Verlet integration).
		// These four arrays are the only allocation this effect ever makes.
		const points = 18
		return {
			t: 0,
			ready: false,
			width: 0,
			boxHeight: 0,
			x: new Array(points).fill(0),
			y: new Array(points).fill(0),
			prevX: new Array(points).fill(0),
			prevY: new Array(points).fill(0),
		}
	},

	step(state, frame) {
		const points = state.x.length
		const links = points - 1
		const dt = Math.min(1 / 30, Math.max(1 / 240, Number(frame.dt) || 1 / 60))
		const energy = clamp01(frame.energy ?? 0)
		state.t = (state.t + dt) % (Math.PI * 2 * 1000)

		const width = Math.max(24, Number(frame.width) || 284)
		const boxTop = Number(frame.artBox?.top ?? 0)
		const boxHeight = Math.max(
			14,
			Number(frame.artBox?.height ?? frame.sky ?? frame.height ?? 30)
		)

		// 12px per link as specified (17 x 12 = 204px). A narrower panel squeezes
		// the links just enough for the pins to stay inside the canvas.
		const segment = Math.min(12, (width - 16) / links)
		// The rope is a few pixels longer than the gap between its pins, so it
		// hangs in a shallow catenary and higher levels get more slack ("绳越松").
		const slack = segment * (0.14 + 0.08 * energy)
		const span = links * segment - slack
		const left = (width - span) * 0.5
		const pinY = boxTop + boxHeight * 0.1

		// First frame, or the host resized: lay the rope on a resting curve without
		// touching the integrator arrays.
		if (!state.ready || state.width !== width || state.boxHeight !== boxHeight) {
			state.ready = true
			state.width = width
			state.boxHeight = boxHeight
			for (let index = 0; index < points; index += 1) {
				const along = index / links
				state.x[index] = left + span * along
				state.y[index] = pinY + Math.sin(Math.PI * along) * segment * 0.9
				state.prevX[index] = state.x[index]
				state.prevY[index] = state.y[index]
			}
		}

		const gravity = 400 + 800 * energy
		// The sky strip is only 30px tall and the rope hangs almost taut, so at the
		// literal 20..140 px/s² a gust is swallowed by the 400..1200 px/s² gravity.
		// The mapping is kept as specified and scaled once, here, so the sway is
		// actually legible at panel size (and still gentle at rest).
		const wind = (20 + 120 * energy) * 10
		// Fixed sub-step duration (~1/480s): the constraint stiffness then stays the
		// same whether the host runs at 30, 60 or 120fps, and dt can never blow the
		// rope up. dt is already clamped to 1/30s, so this stays within 2..16.
		const substeps = Math.max(1, Math.min(16, Math.ceil(dt * 480)))
		const step = dt / substeps
		const step2 = step * step
		const damping = Math.pow(0.985, 1 / substeps)

		for (let sub = 0; sub < substeps; sub += 1) {
			// Verlet: position + (position - previous) * damping + accel * step².
			// The wind is a travelling sine wave along the rope — deterministic,
			// never Math.random() — so the same time/energy always looks the same.
			// The horizontal push makes the sag swing, the vertical part ripples it.
			for (let index = 1; index < links; index += 1) {
				const x = state.x[index]
				const y = state.y[index]
				const gust =
					Math.sin(state.t * 1.9 + index * 0.34) * 0.6 +
					Math.sin(state.t * 0.73 + index * 0.18 + 1.7) * 0.22 +
					Math.sin(state.t * 2.9 + index * 0.5 + 3.4) * 0.18
				const lift =
					Math.sin(state.t * 1.16 + index * 0.17) * 0.6 +
					Math.sin(state.t * 0.44 + index * 0.09 + 2.3) * 0.22 +
					Math.sin(state.t * 1.77 + index * 0.25 + 4.1) * 0.18
				const vx = (x - state.prevX[index]) * damping
				const vy = (y - state.prevY[index]) * damping
				state.prevX[index] = x
				state.prevY[index] = y
				state.x[index] = x + vx + wind * gust * step2
				state.y[index] = y + vy + (gravity + wind * lift * 0.4) * step2
			}

			// Pins own their positions; zero their velocity so they never drift.
			state.x[0] = left
			state.y[0] = pinY
			state.prevX[0] = left
			state.prevY[0] = pinY
			state.x[links] = left + span
			state.y[links] = pinY
			state.prevX[links] = left + span
			state.prevY[links] = pinY

			// Two passes of distance constraints, the second walked right to left so
			// the correction reaches the middle from both pins (2 iterations is the
			// documented budget; fewer visibly stretches the rope).
			for (let pass = 0; pass < 2; pass += 1) {
				for (let stepIndex = 0; stepIndex < links; stepIndex += 1) {
					const index = pass === 0 ? stepIndex : links - 1 - stepIndex
					const next = index + 1
					const ax = state.x[index]
					const ay = state.y[index]
					const bx = state.x[next]
					const by = state.y[next]
					const dx = bx - ax
					const dy = by - ay
					const distance = Math.sqrt(dx * dx + dy * dy) || 1e-4
					const pull = (distance - segment) / distance
					const cx = dx * pull
					const cy = dy * pull
					const firstFree = index !== 0
					const secondFree = next !== links
					if (!firstFree && !secondFree) continue
					if (!firstFree) {
						state.x[next] = bx - cx
						state.y[next] = by - cy
					} else if (!secondFree) {
						state.x[index] = ax + cx
						state.y[index] = ay + cy
					} else {
						state.x[index] = ax + cx * 0.5
						state.y[index] = ay + cy * 0.5
						state.x[next] = bx - cx * 0.5
						state.y[next] = by - cy * 0.5
					}
				}
			}
		}

		// Safety rail: a hard gust may not push the rope out of its strip.
		const minX = 1
		const maxX = width - 1
		const minY = boxTop + 1
		const maxY = boxTop + boxHeight - 1
		for (let index = 1; index < links; index += 1) {
			if (state.x[index] < minX) state.x[index] = minX
			else if (state.x[index] > maxX) state.x[index] = maxX
			if (state.y[index] < minY) state.y[index] = minY
			else if (state.y[index] > maxY) state.y[index] = maxY
		}
		// The pins are placed last so clamping can never move them.
		state.x[0] = left
		state.x[links] = left + span
		state.y[0] = pinY
		state.y[links] = pinY
	},

	paint(context, state, frame) {
		const points = state.x.length
		const energy = clamp01(frame.energy ?? 0)
		const accent =
			typeof frame.accent === 'string' && frame.accent.length > 0
				? frame.accent
				: 'rgb(120, 200, 255)'

		// One path, two strokes: a soft halo under the crisp rope. `stroke()` keeps
		// the current path, so this costs no rebuilding and no arrays.
		context.beginPath()
		context.moveTo(state.x[0], state.y[0])
		for (let index = 1; index < points; index += 1) {
			context.lineTo(state.x[index], state.y[index])
		}
		context.lineCap = 'round'
		context.lineJoin = 'round'

		context.strokeStyle = withAlpha(accent, 0.16 + 0.14 * energy)
		context.lineWidth = 3.2 + 1.8 * energy
		context.stroke()

		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.1 + 0.8 * energy
		context.stroke()

		// Both pins, so the rope reads as fixed rather than floating.
		const pinRadius = 1.6 + 0.5 * energy
		context.fillStyle = withAlpha(accent, 0.92)
		context.beginPath()
		context.moveTo(state.x[0] + pinRadius, state.y[0])
		context.arc(state.x[0], state.y[0], pinRadius, 0, Math.PI * 2)
		context.moveTo(state.x[points - 1] + pinRadius, state.y[points - 1])
		context.arc(state.x[points - 1], state.y[points - 1], pinRadius, 0, Math.PI * 2)
		context.fill()

		context.lineWidth = 1
		context.globalAlpha = 1
	},
}
