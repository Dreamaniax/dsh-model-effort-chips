/**
 * 粒子爆裂 (burst) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * A level change bursts into shards that fall away.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const burstEffect = {
	id: 'burst',
	name: '粒子爆裂',
	summary: '换档瞬间在位置炸出一簇像素碎片，0.4s 内自衰减',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0, ages: [1, 1, 1], xs: [0.5, 0.5, 0.5] }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const jump = Math.abs(level - state.last) > 0.03
		if (jump) {
			let slot = 0
			for (let index = 1; index < 3; index += 1) if (state.ages[index] > state.ages[slot]) slot = index
			state.ages[slot] = 0
			state.xs[slot] = level
		}
		for (let index = 0; index < 3; index += 1) state.ages[index] = Math.min(1, state.ages[index] + dt / 0.4)
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const size = Math.min(bandHeight - 2, 30)
		// A dim resting spark marks the level even when nothing is exploding.
		const restX = Math.round(level * (width - size))
		const restY = Math.round(bandTop + (bandHeight - size) * 0.5)
		if (art !== null) {
			context.globalAlpha = 0.3
			context.imageSmoothingEnabled = false
			context.drawImage(art, 0, 0, 48, 48, restX, restY, size, size)
			context.imageSmoothingEnabled = true
		} else {
			context.fillStyle = withAlpha(accent, 0.3)
			context.fillRect(restX + size * 0.5 - 1, restY + size * 0.5 - 1, 2, 2)
		}
		context.globalAlpha = 1
		for (let index = 0; index < 3; index += 1) {
			const age = state.ages[index]
			if (age >= 1) continue
			const x = Math.round(state.xs[index] * (width - size))
			const y = Math.round(bandTop + (bandHeight - size) * 0.5)
			context.globalAlpha = 1 - age * 0.8
			if (art !== null) {
				context.imageSmoothingEnabled = false
				context.drawImage(art, Math.min(5, Math.floor(age * 6)) * 48, 0, 48, 48, x, y, size, size)
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				for (let shard = 0; shard < 6; shard += 1) {
					const angle = (shard / 6) * Math.PI * 2
					context.fillRect(x + size * 0.5 + Math.cos(angle) * age * 10, y + size * 0.5 + Math.sin(angle) * age * 10, 2, 2)
				}
			}
		}
		context.globalAlpha = 1
	},
}
