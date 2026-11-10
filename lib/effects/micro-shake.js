/**
 * 微震 (micro-shake) — 交互反馈, docs/plan/01-effects-taxonomy.md §10.
 *
 * A level change lands with a short shake and an impact star at the knob.
 *
 * Effects never see pointer events: a level change is inferred from
 * `abs(energy - lastEnergy) > 0.03`, and everything it triggers decays on its own,
 * so the effect is idempotent and safe to re-enter mid-drag.
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const microShakeEffect = {
	id: 'micro-shake',
	name: '微震',
	summary: '换档时整体短促抖动（≤3px）并在位置打出一颗像素冲击星',
	category: 'feedback',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, last: 0, env: 0, at: 0.5 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const jump = Math.abs(level - state.last) > 0.03
		if (jump) {
			state.env = 1
			state.at = level
		}
		state.env = Math.max(0, state.env - dt / 0.22)
		state.last = level
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const calm = frame.reducedMotion === true
		const amp = !calm && state.env > 0 ? (0.5 + 2.5 * level) * state.env : 0
		const shakeX = Math.sin(state.time * (18 + 10 * level) * 6.283) * amp
		const shakeY = Math.cos(state.time * (18 + 10 * level) * 6.283) * amp
		context.save()
		// Clip first: a shake must never paint outside the band it declared.
		context.beginPath()
		context.rect(0, bandTop, width, bandHeight)
		context.clip()
		context.translate(Math.round(shakeX), Math.round(shakeY))
		const size = Math.min(bandHeight - 4, 26)
		const x = Math.round(state.at * (width - size))
		const y = bandTop + (bandHeight - size) * 0.5
		if (art !== null) {
			context.globalAlpha = state.env > 0 ? Math.min(1, state.env * 1.2) : 1
			context.imageSmoothingEnabled = false
			context.drawImage(art, 0, 0, 48, 48, x, y, size, size)
			context.imageSmoothingEnabled = true
			context.globalAlpha = 1
		} else {
			context.strokeStyle = accent
			context.lineWidth = 1.4
			context.beginPath()
			context.arc(x + size * 0.5, y + size * 0.5, size * (0.1 + 0.2 * state.env), 0, Math.PI * 2)
			context.stroke()
		}
		context.restore()
	},
}
