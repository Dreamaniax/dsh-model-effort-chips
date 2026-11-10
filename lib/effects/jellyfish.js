/**
 * 水母 (jellyfish) — the dome pulses through six frames while it drifts upward and loops back
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const jellyfishEffect = {
	id: 'jellyfish',
	name: '水母',
	summary: '六帧像素水母：伞盖随节律收缩，整只缓慢上浮后从底部回场',
	category: 'life',
	layout: { sky: 54, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		// 上浮：升出天空区顶部后从底部回场
		// 浮沉用一个相位而不是回卷：y 在 [0, travel] 之间正弦往返，没有瞬跳
		state.y += (0.45 + 0.9 * level) * dt
		if (state.y > 6.283185307179586) state.y -= 6.283185307179586
		state.frame = Math.floor(state.time * (2.4 + 4.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 40 + 26 * level), artHeight - 18))
		const x = width * 0.5 - size * 0.5
		const travel = Math.max(0, artHeight - size)
		const y = artTop + travel * (0.5 - 0.5 * Math.cos(state.y))
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：一个伞盖 + 三条触手
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
