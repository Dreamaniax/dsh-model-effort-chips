/**
 * 弹簧跟随 (spring-follow) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * The knob chases the level on a spring: one small overshoot, then it settles.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const springFollowEffect = {
	id: 'spring-follow',
	name: '弹簧跟随',
	summary: '像素手柄以弹簧追上档位，轻微过冲后吸附',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0, x: 0, v: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const jump = Math.abs(level - state.last) > 0.03
		const k = 60 + 180 * level
		const c = 8 + 10 * level
		const accel = (level - state.x) * k - state.v * c
		state.v += accel * dt
		state.x += state.v * dt
		if (Math.abs(level - state.x) < 0.0008 && Math.abs(state.v) < 0.01) { state.x = level; state.v = 0 }
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const size = Math.round(Math.min(bandHeight - 6, 22 + 8 * level))
		const x = Math.round(state.x * (width - size))
		const y = Math.round(bandTop + (bandHeight - size) * 0.5)
		if (art !== null) {
			context.imageSmoothingEnabled = false
			context.drawImage(art, (Math.floor(state.time * 6) % 6) * 48, 0, 48, 48, x, y, size, size)
			context.imageSmoothingEnabled = true
		} else {
			context.fillStyle = withAlpha(accent, 0.8)
			context.fillRect(x + size * 0.5 - 2, y + 2, 4, size - 4)
		}
	},
}
