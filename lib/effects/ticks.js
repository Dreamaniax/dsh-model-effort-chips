/**
 * 刻度填充 (ticks) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * Five pixel ticks mark the scale; the one you are on swells and pulses.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const ticksEffect = {
	id: 'ticks',
	name: '刻度填充',
	summary: '五格刻度按档位点亮，当前格用手柄精灵放大脉冲',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		// nothing to integrate: the marks follow the level directly
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const marks = 5
		const lit = Math.min(marks, Math.floor(level * marks) + 1)
		const base = Math.min(bandHeight - 8, 12)
		const gap = (width - 24) / marks
		for (let index = 0; index < marks; index += 1) {
			const current = index === lit - 1
			const size = current ? Math.round(base * (1.1 + 0.25 * (0.5 + 0.5 * Math.sin(state.time * 8)))) : Math.round(base)
			const x = Math.round(12 + gap * index + gap * 0.5 - size * 0.5)
			const y = Math.round(bandTop + (bandHeight - size) * 0.5)
			context.globalAlpha = index < lit ? (current ? 1 : 0.55) : 0.14
			if (art !== null) {
				context.imageSmoothingEnabled = false
				context.drawImage(art, (current ? Math.floor(state.time * 6) % 6 : 0) * 48, 0, 48, 48, x, y, size, size)
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				context.fillRect(x + size * 0.5 - 1.5, y, 3, size)
			}
		}
		context.globalAlpha = 1
	},
}
