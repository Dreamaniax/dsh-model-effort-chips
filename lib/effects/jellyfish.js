/**
 * 水母 (jellyfish) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A GPT Image pixel strip: six 48x48 frames of the same jellyfish pulsing. The
 * creature swims left to right (faster at higher levels) while it bobs on a
 * phase inside its sky band; leaving on the right brings it back on the left.
 *
 *   speed   12 + 52e px/s
 *   bob     0.45 + 0.9e rad/s over the room left below the sprite
 *   frames  2.4 + 4.2e fps
 *
 * Layout sky 54 / band 0 / bar / off.
 */
const jellyfishEffect = {
	id: 'jellyfish',
	name: '水母',
	summary: '六帧像素水母：伞盖随节律收缩，从左往右游，档位越高游得越快',
	category: 'life',
	layout: { sky: 54, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: -48, phase: 0, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		state.time += dt
		// 从左到右游：速度随档位提升，出右边再从左边入场
		state.x += (12 + 52 * level) * dt
		if (state.x > width + 8) state.x = -56
		// 浮沉用一个相位，不回卷，所以没有瞬跳
		state.phase += (0.45 + 0.9 * level) * dt
		if (state.phase > 6.283185307179586) state.phase -= 6.283185307179586
		state.frame = Math.floor(state.time * (2.4 + 4.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box: keep room to bob, or the sprite just sits still.
		const size = Math.round(Math.min(Math.max(16, 40 + 10 * level), artHeight - 18))
		const travel = Math.max(0, artHeight - size)
		const x = state.x
		const y = artTop + travel * (0.5 - 0.5 * Math.cos(state.phase))
		const art = frame.art ?? null
		context.save()
		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：伞盖 + 三条触手
			context.strokeStyle = accent
			context.fillStyle = withAlpha(accent, 0.25)
			context.lineWidth = 1.3
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.42, size * 0.32, size * 0.26, 0, Math.PI, 0)
			context.fill()
			context.stroke()
			for (let leg = 0; leg < 3; leg += 1) {
				const tx = x + size * (0.34 + leg * 0.16)
				context.beginPath()
				context.moveTo(tx, y + size * 0.42)
				context.quadraticCurveTo(tx + Math.sin(state.time * 2 + leg) * 2.5, y + size * 0.62, tx, y + size * 0.8)
				context.stroke()
			}
		}
		context.restore()
	},
}
