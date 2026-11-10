/**
 * 档位涟漪 (ripple) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * A level change drops a ring that expands and fades, like a tap on water.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const rippleEffect = {
	id: 'ripple',
	name: '档位涟漪',
	summary: '换档时从当前位置扩散一圈像素涟漪，0.5s 自衰减，最多三圈',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0, rings: [0, 0, 0], ages: [1, 1, 1] }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const jump = Math.abs(level - state.last) > 0.03
		if (jump) {
			// Find the oldest dead ring and reuse it: the pool never grows.
			let slot = 0
			for (let index = 1; index < 3; index += 1) if (state.ages[index] > state.ages[slot]) slot = index
			state.rings[slot] = level
			state.ages[slot] = 0
		}
		for (let index = 0; index < 3; index += 1) state.ages[index] = Math.min(1, state.ages[index] + dt / 0.5)
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const size = Math.min(bandHeight - 4, 26)
		// Resting marker: the ring sits at the level, barely visible, so an idle
		// panel still shows where the knob is.
		const restX = Math.round(level * (width - size))
		const restY = Math.round(bandTop + (bandHeight - size) * 0.5)
		if (art !== null) {
			context.globalAlpha = 0.35
			context.imageSmoothingEnabled = false
			context.drawImage(art, 0, 0, 48, 48, restX, restY, size, size)
			context.imageSmoothingEnabled = true
		} else {
			context.strokeStyle = withAlpha(accent, 0.35)
			context.lineWidth = 1.2
			context.beginPath()
			context.arc(restX + size * 0.5, restY + size * 0.5, size * 0.18, 0, Math.PI * 2)
			context.stroke()
		}
		context.globalAlpha = 1
		for (let index = 0; index < 3; index += 1) {
			const age = state.ages[index]
			if (age >= 1) continue
			const x = Math.round(state.rings[index] * (width - size))
			const y = Math.round(bandTop + (bandHeight - size) * 0.5)
			context.globalAlpha = 1 - age
			if (art !== null) {
				context.imageSmoothingEnabled = false
				context.drawImage(art, Math.min(5, Math.floor(age * 6)) * 48, 0, 48, 48, x, y, size, size)
				context.imageSmoothingEnabled = true
			} else {
				context.strokeStyle = accent
				context.lineWidth = 1.4
				context.beginPath()
				context.arc(x + size * 0.5, y + size * 0.5, size * (0.15 + age * 0.35), 0, Math.PI * 2)
				context.stroke()
			}
		}
		context.globalAlpha = 1
	},
}
