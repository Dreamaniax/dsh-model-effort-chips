/**
 * 沙漏动效 (hourglass) — physics class, docs/plan/01-effects-taxonomy.md §1.
 *
 * The upper chamber holds a cloud of waiting grains; they are released through
 * the narrow neck at `flow` grains/s, slide down the funnel, and clamp onto a
 * cone-shaped pile. `energy` drives the counts and the forces:
 *
 *   grains  N = 24 + 96e      (hard cap: the 120-slot pool)
 *   flow       = 12 + 90e     grains / s
 *   fall speed = 40 + 160e    px / s
 *   mouth      = 6 + 2e       px
 *
 * There is no grain-grain collision: a falling grain is clamped onto the pile
 * surface (a small height profile that deposits and diffuses into a cone), rests
 * briefly, then returns to the upper chamber. Everything is allocated in
 * createState — 120 grain objects, a 17 column pile and one LCG seed — so step()
 * only moves numbers around: no per-frame particles, no array slicing, no timers.
 *
 * layout `30/bar/off`: 30px of sky, the DOM bar stays, no DOM spectrum.
 */
const hourglassEffect = {
	id: 'hourglass',
	name: '沙漏动效',
	summary: '沙粒从窄口落下，在底部堆成锥形；档位越高沙越多、落得越快',
	layout: { sky: 30, band: 0, track: 'bar', spectrum: false },

	createState() {
		const grains = []
		for (let index = 0; index < 120; index += 1) {
			grains.push({
				live: false,
				queued: false,
				// 0 = waiting in the upper chamber, 1 = falling, 2 = settled on the pile.
				mode: 0,
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				rest: 0,
				// A stable 0..1 hash per grain: keeps the pile texture deterministic.
				jitter: (index * 0.6180339887) % 1,
			})
		}
		const pile = []
		for (let column = 0; column < 17; column += 1) pile.push(0)
		return { seed: 0x2f6e2b1, emit: 0, grains, pile }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return

		const width = Math.max(1, Number(frame.width) || 0)
		const height = Math.max(1, Number(frame.height) || 0)
		const sky = Number(frame.sky ?? frame.band?.top ?? 0)
		const declaredTrack = Number(frame.trackY ?? sky + Number(frame.band?.height ?? 30) + 16)
		// The scene stands on top of the DOM bar (trackY - 4 is the bar's top edge).
		const floor = Math.max(8, Math.min(height, Number.isFinite(declaredTrack) ? declaredTrack : height - 42) - 4)
		const bodyHeight = Math.max(6, Math.min(38, floor - 2))
		const top = Math.max(0, floor - bodyHeight)
		const centerX = width * 0.5
		const halfWidth = Math.max(8, Math.min(34, width * 0.5 - 6, bodyHeight * 0.95))
		const neckY = top + bodyHeight * 0.5
		const mouth = 6 + 2 * energy
		const flow = 12 + 90 * energy
		const fallSpeed = 40 + 160 * energy
		const target = Math.round(24 + 96 * energy)
		const lowerHeight = Math.max(1, floor - neckY)
		// Taller cone at higher levels, a modest heap at the low end.
		const maxPile = lowerHeight * (0.34 + 0.3 * energy)
		const grains = state.grains
		const pile = state.pile

		// --- bookkeeping: who is alive, who is waiting for a free pool slot -----
		let live = 0
		let queued = 0
		for (let index = 0; index < grains.length; index += 1) {
			if (grains[index].live) live += 1
			else if (grains[index].queued) queued += 1
		}

		// A falling level drops grains from the tail of the pool.
		for (let index = grains.length - 1; index >= 0 && live + queued > target; index -= 1) {
			const grain = grains[index]
			if (grain.queued) {
				grain.queued = false
				queued -= 1
				continue
			}
			if (!grain.live) continue
			grain.live = false
			live -= 1
		}

		// A rising level (and the very first frame) fills the upper chamber at once.
		for (let index = 0; index < grains.length && live + queued < target; index += 1) {
			const grain = grains[index]
			if (grain.live || grain.queued) continue
			grain.queued = true
			queued += 1
		}

		// --- integrate: waiting grains hold still, falling grains move ---------
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode === 0) continue
			if (grain.mode === 2) {
				grain.rest -= dt
				if (grain.rest <= 0) {
					// Recycled: the cone keeps its shape, the grain returns to the top.
					grain.live = false
					grain.queued = true
					live -= 1
					queued += 1
				}
				continue
			}
			grain.x += grain.vx * dt
			grain.y += grain.vy * dt
			if (grain.y < neckY) {
				// The funnel wall narrows towards the mouth and pushes sand inwards.
				const depth = clamp01((grain.y - top) / Math.max(1, neckY - top))
				const limit = halfWidth + (mouth * 0.5 - halfWidth) * depth
				const offset = grain.x - centerX
				if (offset > limit) {
					grain.x = centerX + limit
					grain.vx = -Math.abs(grain.vx) * 0.25
				} else if (offset < -limit) {
					grain.x = centerX - limit
					grain.vx = Math.abs(grain.vx) * 0.25
				}
				continue
			}
			let column = Math.floor(((grain.x - (centerX - halfWidth)) / Math.max(1, 2 * halfWidth)) * 17)
			if (!Number.isFinite(column) || column < 0) column = 0
			else if (column > 16) column = 16
			const surface = floor - pile[column]
			if (grain.y < surface - 0.5) continue
			// Clamp onto the pile surface instead of colliding with other grains.
			grain.x = Math.min(centerX + halfWidth * 0.94, Math.max(centerX - halfWidth * 0.94, grain.x))
			grain.y = Math.max(top, surface - 0.5 - grain.jitter * 1.4)
			grain.vx = 0
			grain.vy = 0
			grain.mode = 2
			grain.rest = (0.35 + 0.55 * ((grain.jitter + 0.37) % 1)) * (1 - 0.2 * energy)
			pile[column] = Math.min(maxPile, pile[column] + 0.44)
			if (column > 0) pile[column - 1] = Math.min(maxPile, pile[column - 1] + 0.2)
			if (column < 16) pile[column + 1] = Math.min(maxPile, pile[column + 1] + 0.2)
		}

		// --- spawn: newly queued grains wait in the upper chamber ---------------
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.queued) continue
			state.seed = (state.seed * 1664525 + 1013904223) >>> 0
			const r1 = state.seed / 4294967296
			state.seed = (state.seed * 1664525 + 1013904223) >>> 0
			const r2 = state.seed / 4294967296
			const y = top + 1 + r1 * Math.max(1, neckY - top - 3)
			const depth = clamp01((y - top) / Math.max(1, neckY - top))
			const limit = (halfWidth + (mouth * 0.5 - halfWidth) * depth) * 0.78
			grain.queued = false
			grain.live = true
			grain.mode = 0
			grain.x = centerX + (r2 * 2 - 1) * limit
			grain.y = y
			grain.vx = 0
			grain.vy = 0
			grain.rest = 0
		}

		// --- release: the flow rate empties the chamber, lowest grain first -----
		state.emit = Math.min(3, state.emit + flow * dt)
		while (state.emit >= 1) {
			let candidate = null
			for (let index = 0; index < grains.length; index += 1) {
				const grain = grains[index]
				if (!grain.live || grain.mode !== 0) continue
				if (candidate === null || grain.y > candidate.y) candidate = grain
			}
			if (candidate === null) break
			candidate.mode = 1
			candidate.vx = (candidate.jitter * 2 - 1) * 5
			candidate.vy = fallSpeed * (0.85 + 0.3 * candidate.jitter)
			state.emit -= 1
		}
		if (state.emit >= 1) state.emit = Math.min(state.emit, 1)

		// --- the pile profile diffuses into a cone, then clamps -----------------
		// A gentle single pass: faster diffusion would flatten the cone and leak
		// the low-energy pile out through the glass walls before it reads.
		for (let column = 1; column < 16; column += 1) {
			pile[column] += ((pile[column - 1] + pile[column + 1]) * 0.5 - pile[column]) * 0.08
		}
		for (let column = 0; column < 17; column += 1) {
			const value = pile[column]
			pile[column] = value > maxPile ? maxPile : value > 0 ? value : 0
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const height = Math.max(1, Number(frame.height) || 0)
		const sky = Number(frame.sky ?? frame.band?.top ?? 0)
		const declaredTrack = Number(frame.trackY ?? sky + Number(frame.band?.height ?? 30) + 16)
		const floor = Math.max(8, Math.min(height, Number.isFinite(declaredTrack) ? declaredTrack : height - 42) - 4)
		const bodyHeight = Math.max(6, Math.min(38, floor - 2))
		const top = Math.max(0, floor - bodyHeight)
		const centerX = width * 0.5
		const halfWidth = Math.max(8, Math.min(34, width * 0.5 - 6, bodyHeight * 0.95))
		const neckY = top + bodyHeight * 0.5
		const mouth = 6 + 2 * energy
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const upperControl = halfWidth * 0.62
		const leftNeck = centerX - mouth * 0.5
		const rightNeck = centerX + mouth * 0.5
		const capWidth = (halfWidth + 3) * 2

		// Wooden caps: top and bottom of the glass.
		context.fillStyle = withAlpha(accent, 0.55)
		context.fillRect(centerX - halfWidth - 3, Math.max(0, top - 2), capWidth, 2)
		context.fillRect(centerX - halfWidth - 3, Math.max(0, floor - 1), capWidth, 2)

		// Glass silhouette: a glowing 3px understroke and a crisp 1px line.
		context.strokeStyle = withAlpha(accent, 0.16)
		context.lineWidth = 3
		context.beginPath()
		context.moveTo(centerX - halfWidth, top)
		context.quadraticCurveTo(centerX - upperControl, neckY - bodyHeight * 0.16, leftNeck, neckY)
		context.quadraticCurveTo(centerX - upperControl, neckY + bodyHeight * 0.16, centerX - halfWidth, floor)
		context.moveTo(centerX + halfWidth, top)
		context.quadraticCurveTo(centerX + upperControl, neckY - bodyHeight * 0.16, rightNeck, neckY)
		context.quadraticCurveTo(centerX + upperControl, neckY + bodyHeight * 0.16, centerX + halfWidth, floor)
		context.stroke()

		context.strokeStyle = withAlpha(accent, 0.46)
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(centerX - halfWidth, top)
		context.quadraticCurveTo(centerX - upperControl, neckY - bodyHeight * 0.16, leftNeck, neckY)
		context.quadraticCurveTo(centerX - upperControl, neckY + bodyHeight * 0.16, centerX - halfWidth, floor)
		context.moveTo(centerX + halfWidth, top)
		context.quadraticCurveTo(centerX + upperControl, neckY - bodyHeight * 0.16, rightNeck, neckY)
		context.quadraticCurveTo(centerX + upperControl, neckY + bodyHeight * 0.16, centerX + halfWidth, floor)
		context.stroke()

		// The pile cone: a filled profile under the surface line.
		const pile = state.pile
		const columnWidth = (2 * halfWidth) / 16
		context.beginPath()
		context.moveTo(centerX - halfWidth, floor)
		for (let column = 0; column < 17; column += 1) {
			const heightValue = pile[column] > 0 ? pile[column] : 0
			context.lineTo(centerX - halfWidth + columnWidth * column, floor - heightValue)
		}
		context.lineTo(centerX + halfWidth, floor)
		context.closePath()
		context.fillStyle = withAlpha(accent, 0.2 + 0.12 * energy)
		context.fill()

		// Grains: waiting in the chamber, falling through the neck, settled on the
		// pile. Three passes keep the fill style constant, all rects are 1px.
		const grains = state.grains
		context.fillStyle = accent
		context.globalAlpha = 0.5
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 0) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 0.75 + 0.25 * energy
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 1) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 0.55
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 2) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 1
	},
}
