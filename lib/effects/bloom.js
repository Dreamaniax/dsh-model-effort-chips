/**
 * 花开 (bloom) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A flower opens from the centre: petals swing out with a damped spring,
 * the whole head turns slowly, and the petal count grows with the level:
 *
 *   petals  5 + floor(3e)        (5..8)
 *   open    0.15 + 1.2e          target openness (spring-damped, may overshoot)
 *   radius  6 + 12e              px, scaled by `open`
 *   spin    0.2 + 0.8e           rad/s
 *
 * Each petal is two quadratic curves; a petal-count change cross-fades the two
 * sets over 0.2s instead of popping. `open` is a spring state (position +
 * velocity), so dragging the level makes the flower settle with a small
 * overshoot. Everything is clipped to the 54px sky band.
 *
 * Layout sky 54 / band 0 / bar / off.
 */
const bloomEffect = {
	id: 'bloom',
	name: '花开',
	summary: '花瓣按弹簧从中心展开、缓缓旋转；档位越高花瓣越多、开得越开',
	category: 'life',
	layout: { sky: 54, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ open: 0, openVel: 0, angle: 0, count: 5, prevCount: 5, blend: 0 }),

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.angle = (state.angle + (0.2 + 0.8 * energy) * dt) % (Math.PI * 2)
		// Damped spring towards the level's openness; slight overshoot is wanted.
		const target = 0.15 + 1.2 * energy
		state.openVel += ((target - state.open) * 90 - state.openVel * 12) * dt
		state.openVel = Math.max(-40, Math.min(40, state.openVel))
		state.open += state.openVel * dt
		if (state.open < 0) {
			state.open = 0
			state.openVel = 0
		} else if (state.open > 1.6) {
			state.open = 1.6
			state.openVel = 0
		}
		const count = 5 + Math.floor(3 * energy)
		if (count !== state.count) {
			state.prevCount = state.count
			state.count = count
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
		const radius = 6 + 12 * energy
		const open = Math.max(0, Math.min(1.6, state.open))
		const length = Math.max(2.5, radius * open)
		const ease = 1 - state.blend
		const spin = state.angle

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineJoin = 'round'

		// Outgoing petal set, still fading.
		if (state.blend > 0) {
			for (let index = 0; index < state.prevCount; index += 1) {
				const angle = spin + (index / state.prevCount) * TAU
				context.save()
				context.translate(centerX, centerY)
				context.rotate(angle)
				context.beginPath()
				context.moveTo(0, 0)
				context.quadraticCurveTo(length * 0.55, -length * 0.5, length, 0)
				context.quadraticCurveTo(length * 0.55, length * 0.5, 0, 0)
				context.closePath()
				context.globalAlpha = state.blend
				context.fillStyle = withAlpha(accent, 0.14)
				context.fill()
				context.strokeStyle = withAlpha(accent, 0.55)
				context.lineWidth = 1.2
				context.stroke()
				context.restore()
			}
		}

		// The incoming petal set.
		context.globalAlpha = ease
		for (let index = 0; index < state.count; index += 1) {
			const angle = spin + (index / state.count) * TAU
			context.save()
			context.translate(centerX, centerY)
			context.rotate(angle)
			context.beginPath()
			context.moveTo(0, 0)
			context.quadraticCurveTo(length * 0.55, -length * 0.5, length, 0)
			context.quadraticCurveTo(length * 0.55, length * 0.5, 0, 0)
			context.closePath()
			context.fillStyle = withAlpha(accent, 0.14 + 0.06 * energy)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.65 + 0.2 * energy)
			context.lineWidth = 1.2
			context.stroke()
			context.restore()
		}

		// Pollen core: a filled disc ringed by a thin corona.
		context.globalAlpha = ease
		context.fillStyle = withAlpha(accent, 0.6 + 0.25 * energy)
		context.beginPath()
		context.arc(centerX, centerY, 2.2 + 1.4 * energy, 0, TAU)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.35)
		context.lineWidth = 1
		context.beginPath()
		context.arc(centerX, centerY, (2.2 + 1.4 * energy) * 2.2, 0, TAU)
		context.stroke()
		context.globalAlpha = 1
		context.restore()
	},
}
