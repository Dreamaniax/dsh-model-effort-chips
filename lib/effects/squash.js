/**
 * 挤压拉伸 (squash) — 形变与过渡, docs/plan/01-effects-taxonomy.md §6.
 *
 * A jelly disc keeps its area while it squashes on the beat:
 *
 *   sx = 1 + 0.35e · sin(2π(0.5 + 1.5e)t)   clamped to 0.55 .. 1.45
 *   sy = 1 / sx                            (area conserving)
 *   centre drops by 1 + 3e px
 *
 * One save / translate / scale / arc / fill + stroke / restore per frame — no
 * blurred shadows, no per-frame objects. createState only holds the clock; paint
 * reads it and derives everything from energy and the sky height, clipped to the
 * 44px art band so the stretched disc can never spill onto the DOM bar.
 *
 * Layout sky 44 / band 0 / bar / off.
 */
const squashEffect = {
	id: 'squash',
	name: '挤压拉伸',
	summary: '果冻圆按节拍压扁拉长、体积守恒；档位越高跳得越快、幅度越大',
	category: 'morph',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.time += dt
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const centerX = width * 0.5
		const centerY = artTop + artHeight * 0.5 + (1 + 3 * energy)
		const radius = Math.max(4, Math.min(artHeight * 0.26, width * 0.12))
		const beat = TAU * (0.5 + 1.5 * energy) * state.time
		const sx = Math.max(0.55, Math.min(1.45, 1 + 0.35 * energy * Math.sin(beat)))
		const sy = 1 / sx

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		// A single transform for the jelly: the same arc is squashed, not redrawn.
		context.translate(centerX, centerY)
		context.scale(sx, sy)
		context.beginPath()
		context.arc(0, 0, radius, 0, TAU)
		context.fillStyle = withAlpha(accent, 0.2 + 0.16 * energy)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.7 + 0.3 * energy)
		context.lineWidth = 1.6
		context.stroke()
		context.restore()
	},
}
