/**
 * 磁吸尾迹 (magnet-trail) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * The knob leaves a short fading trail of sparks behind it.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const magnetTrailEffect = {
	id: 'magnet-trail',
	name: '磁吸尾迹',
	summary: '拖动时在滑块后面留下渐隐的像素火花尾迹，停下 0.3s 内淡完',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0, xs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], head: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const jump = Math.abs(level - state.last) > 0.03
		state.head = (state.head + 1) % 10
		state.xs[state.head] = level
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const count = 6 + Math.round(4 * level)
		const size = Math.round(Math.max(8, Math.min(bandHeight - 8, 16 + 10 * level)))
		for (let step = 1; step <= count; step += 1) {
			const index = (state.head - step + 10) % 10
			const x = Math.round(state.xs[index] * (width - size))
			const y = Math.round(bandTop + (bandHeight - size) * 0.5)
			context.globalAlpha = 0.5 * (1 - step / (count + 1))
			if (art !== null) {
				context.imageSmoothingEnabled = false
				context.drawImage(art, Math.min(5, step >> 1) * 48, 0, 48, 48, x, y, size, size)
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				context.fillRect(x + size * 0.5, y + size * 0.5, 2, 2)
			}
		}
		context.globalAlpha = 1
	},
}
