/**
 * 微生物 (microbe) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A GPT Image pixel strip whose six frames are **evolution stages**, not a swim
 * cycle: a plain cell, two flagella, three with bumps, spikes, segments, and a
 * fully armoured organism. The displayed stage follows the level, so dragging up
 * metamorphoses the creature; a short cross-fade keeps the jump from popping.
 *
 *   swim    20 + 95e px/s, left to right, wraps at the edge
 *   stage   floor(e * 6), clamped 0..5, cross-faded over 0.18s
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const microbeEffect = {
	id: 'microbe',
	name: '微生物',
	summary: '六帧像素微生物：档位越高游得越快，同时逐级变态进化成更大的形态',
	category: 'life',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: -40, stage: 0, from: 0, blend: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		state.time += dt
		// 游动：档位越高越快，出右边从左边回场
		state.x += (20 + 95 * level) * dt
		if (state.x > width + 40) state.x = -48
		// 变态：阶段跟随档位，换阶时交叉淡化 0.18s
		const target = Math.min(5, Math.max(0, Math.floor(level * 6)))
		if (target !== state.stage) {
			state.from = state.stage
			state.stage = target
			state.blend = 0
		}
		state.blend = Math.min(1, state.blend + dt / 0.18)
		state.frame = state.stage
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const bandTop = frame.band?.top ?? 0
		const bandHeight = Math.max(1, frame.band?.height || 30)
		// Grows a little with the stage; the pixels carry the rest of it.
		const size = Math.round(Math.min(Math.max(16, 26 + 18 * level), bandHeight - 6))
		const x = Math.round(state.x)
		const bob = Math.sin(state.time * (1.4 + 1.6 * level)) * 2
		const y = Math.round(bandTop + bandHeight * 0.5 - size * 0.5 + bob)
		const art = frame.art ?? null
		context.save()
		if (art !== null) {
			context.imageSmoothingEnabled = false
			const fade = Math.max(0, Math.min(1, state.blend))
			if (fade < 1 && state.from !== state.stage) {
				context.globalAlpha = 1 - fade
				context.drawImage(art, state.from * 48, 0, 48, 48, x, y, size, size)
				context.globalAlpha = fade
			}
			context.drawImage(art, state.stage * 48, 0, 48, 48, x, y, size, size)
			context.globalAlpha = 1
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：身体随阶段变长、鞭毛随阶段变多
			context.strokeStyle = accent
			context.lineWidth = 1.2
			const body = 0.24 + 0.05 * state.stage
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.5, size * body, size * 0.2, 0, 0, Math.PI * 2)
			context.stroke()
			const tails = 1 + state.stage
			for (let tail = 0; tail < tails; tail += 1) {
				context.beginPath()
				const offset = size * (0.36 + tail * 0.06)
				context.moveTo(x + size * 0.5 + body * size, y + offset)
				for (let step = 1; step <= 6; step += 1) {
					context.lineTo(
						x + size * 0.5 + body * size + step * 2.2,
						y + offset + Math.sin(state.time * 6 + step + tail) * 2,
					)
				}
				context.stroke()
			}
		}
		context.restore()
	},
}
