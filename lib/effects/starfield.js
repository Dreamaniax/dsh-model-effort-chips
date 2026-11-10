/**
 * 星空跃迁 (starfield) — 伪 3D / 视差, docs/plan/01-effects-taxonomy.md §11.
 *
 * Sixty to a hundred and forty stars fly out of a vanishing point and stretch into streaks.
 *
 * Depth is faked on a flat canvas: points carry a `z`, the projection divides by
 * `z + offset` (always offset, never zero) and every layer scrolls at its own
 * speed. The artwork is a GPT Image pixel sprite; when it has not decoded yet a
 * vector stand-in keeps the band from going blank.
 *
 * Layout sky 52 / band 0 / bar / off.
 */
const starfieldEffect = {
	id: 'starfield',
	name: '星空跃迁',
	summary: '像素星从消失点飞出拉成速度线，档位越高飞得越快',
	category: 'depth',
	layout: { sky: 52, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, stars: null }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		if (state.stars === null) {
			// Pre-allocate once: 140 stars keep x/y/z normalised to the panel.
			const count = 140
			const stars = new Float32Array(count * 4)
			for (let index = 0; index < count; index += 1) {
				stars[index * 4] = ((index * 37) % 101) / 100 * 2 - 1
				stars[index * 4 + 1] = ((index * 53) % 101) / 100 * 2 - 1
				stars[index * 4 + 2] = 0.05 + ((index * 29) % 100) / 100
				stars[index * 4 + 3] = 0.6 + ((index * 17) % 40) / 100
			}
			state.stars = stars
		}
		const speed = 20 + 180 * level
		const stars = state.stars
		for (let index = 0; index < 140; index += 1) {
			const base = index * 4
			stars[base + 2] -= speed * dt
			if (stars[base + 2] < 0.1) {
				stars[base] = ((index * 37 + state.time * 13) % 101) / 100 * 2 - 1
				stars[base + 1] = ((index * 53 + state.time * 7) % 101) / 100 * 2 - 1
				stars[base + 2] = 1
			}
		}
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const top = frame.band?.height ? (frame.band?.top ?? 0) : (frame.artBox?.top ?? 0)
		const height = Math.max(1, frame.band?.height || frame.artBox?.height || 30)
		const art = frame.art ?? null
		const count = 60 + Math.round(80 * level)
		const cx = width * 0.5
		const cy = top + height * 0.5
		const size = 4 + 6 * level
		for (let index = 0; index < count; index += 1) {
			const base = index * 4
			const z = Math.max(0.1, state.stars[base + 2])
			const x = cx + (state.stars[base] / z) * width * 0.25
			const y = cy + (state.stars[base + 1] / z) * height * 0.45
			if (x < -8 || x > width + 8 || y < top - 8 || y > top + height + 8) continue
			const depth = clamp01(1 - z)
			context.globalAlpha = 0.25 + 0.75 * depth
			if (art !== null) {
				context.imageSmoothingEnabled = false
				const draw = Math.round(size * (0.4 + depth))
				context.drawImage(art, Math.min(5, Math.floor(depth * 6)) * 48, 0, 48, 48, Math.round(x - draw * 0.5), Math.round(y - draw * 0.5), draw, draw)
				context.imageSmoothingEnabled = true
			} else {
				context.fillStyle = accent
				context.fillRect(Math.round(x), Math.round(y), 2, 2)
			}
		}
		context.globalAlpha = 1
	},
}
