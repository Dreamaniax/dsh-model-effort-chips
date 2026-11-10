/**
 * 莫尔条纹 (moire) — 几何线条, docs/plan/01-effects-taxonomy.md §4.
 *
 * Two nearly-parallel line gratings layered in the same accent. Their small
 * relative rotation makes the lines beat into broad vertical moiré bands:
 *
 *   spacing  gap = 3 + 4e              px
 *   angle    θ   = 0.02 + 0.25e        rad (relative rotation, clamped below π/4)
 *   width    0.8px lines, both layers at alpha 0.5
 *   lines    ≤ width / 3 per layer, count grows as the gratings tilt (45° densest)
 *
 * The lines run horizontally: two horizontal gratings rotated by ±θ/2 produce a
 * beat vector along x, i.e. the fringes stand vertically — the only orientation
 * that can read in a 284x30 band. The pattern is a live beat, not a still: the
 * angle breathes by ±0.015 rad and layer two slides by most of one gap, so the
 * fringes drift. Both gratings are clipped to the band and each layer is one
 * path + one stroke; createState only holds the clock.
 *
 * Layout 0/band(30)/bar/off.
 */
const moireEffect = {
	id: 'moire',
	name: '莫尔条纹',
	summary: '两层平行线栅格相对旋转，干涉出缓慢漂移的莫尔条纹；档位越高越密',
	category: 'geometry',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

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
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const gap = 3 + 4 * energy
		const baseAngle = 0.02 + 0.25 * energy
		// A slow breath around the level's angle keeps the fringes alive; the
		// clamp keeps the gratings away from the 45-degree aliasing point.
		const breath = 0.015 * Math.sin(state.time * 0.7)
		const angle = Math.max(0.004, Math.min(baseAngle + breath, Math.PI / 4 - 0.02))
		const half = angle * 0.5
		const drift = Math.sin(state.time * 0.35) * gap * 0.6
		// Lines needed to cover the band once tilted, capped at width / 3.
		const coverage = bandHeight * Math.cos(half) + width * Math.sin(half)
		const count = Math.max(3, Math.min(Math.floor(width / 3), Math.ceil(coverage / gap) + 2))
		const halfSpan = ((count - 1) * gap) * 0.5
		const reach = (width + bandHeight) * 0.5 + gap * 2

		context.save()
		context.beginPath()
		context.rect(0, bandTop, width, bandHeight)
		context.clip()
		context.strokeStyle = withAlpha(accent, 0.5)
		context.lineWidth = 0.8

		// Layer 1: rotated by -θ/2 around the band centre.
		context.save()
		context.translate(centerX, centerY)
		context.rotate(-half)
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const y = -halfSpan + index * gap
			context.moveTo(-reach, y)
			context.lineTo(reach, y)
		}
		context.stroke()
		context.restore()

		// Layer 2: rotated by +θ/2 and sliding by up to 0.6 of one gap.
		context.save()
		context.translate(centerX, centerY)
		context.rotate(half)
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const y = -halfSpan + index * gap + drift
			context.moveTo(-reach, y)
			context.lineTo(reach, y)
		}
		context.stroke()
		context.restore()

		context.restore()
	},
}
