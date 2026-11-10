/**
 * 吸积盘 (accretion-disk) — 粒子场 / 群集, docs/plan/01-effects-taxonomy.md §3.
 *
 * A thin, nearly edge-on particle disk around a bright nucleus, with two spiral
 * density waves. `energy` drives the disk:
 *
 *   particles  N = 100 + 80e                   (hard cap: the 180-slot pool)
 *   angular    ω = (0.4 + 1.6e) / r^1.5        (rad/s, r normalised, panel-paced)
 *   arms       2 logarithmic spirals, π apart
 *   brightness 0.2 + 0.8e
 *
 * Each grain stores r / θ plus the constants created once in createState
 * (spin = 1/r^1.5, kind, arm, spread, size). step() only advances angles: the
 * disk shears differentially, and the two density waves rotate as a rigid
 * pattern with a spring that keeps arm stars on the crest — otherwise the shear
 * would wind the arms into a blur within seconds. paint() derives x/y from
 * (r, θ) on a squashed ellipse that stays inside the 30px band; no sorting, no
 * per-frame allocation.
 *
 * A decoded 32x32 light sprite is used additively when the host supplies
 * frame.sprite; without it the same grains fall back to batched arc() dots.
 *
 * Layout 0/30/bar/off: everything lives in the 30px band.
 */
const accretionDiskEffect = {
	id: 'accretion-disk',
	name: '吸积盘',
	summary: '差速旋转的粒子盘托着两条旋臂密度波，档位越高越亮、转得越快',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState() {
		const TAU = Math.PI * 2
		const TWIST = 1.25
		const COUNT = 180
		let seed = 0x13579bdf
		// Deterministic LCG: the field must look the same on every mount.
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const particles = []
		for (let index = 0; index < COUNT; index += 1) {
			const roll = random()
			// 0 = nucleus, 1 = arm star, 2 = diffuse disk.
			const kind = roll < 0.1 ? 0 : roll < 0.85 ? 1 : 2
			let r
			if (kind === 0) r = 0.04 + 0.13 * random()
			else if (kind === 1) r = 0.12 + 0.88 * Math.sqrt(random())
			else r = 0.08 + 0.92 * Math.sqrt(random())
			const arm = index % 2
			const spread = kind === 1 ? (random() + random() + random() - 1.5) * 0.35 : 0
			const theta =
				kind === 1 ? arm * Math.PI + TWIST * Math.log(Math.max(0.08, r)) + spread : random() * TAU
			particles.push({
				r,
				theta,
				arm,
				spread,
				kind,
				// Static per-grain constants; only r / θ change every frame.
				spin: 1 / Math.pow(Math.max(0.12, r), 1.5),
				size: kind === 0 ? 1.5 + random() * 1.5 : kind === 1 ? 0.9 + random() * 0.9 : 0.7 + random() * 0.7,
			})
		}
		return { pattern: 0, particles }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const TAU = Math.PI * 2
		const TWIST = 1.25
		// The taxonomy curve is expressed for a normalised radius; 0.08 is the
		// panel-scale pacing (a literal 1x would spin the core at ~5 rev/s).
		const ORBIT_SCALE = 0.08
		const rate = 0.4 + 1.6 * energy
		const patternSpeed = (ORBIT_SCALE * rate) / Math.pow(0.55, 1.5)
		const cohesion = 2.2 + 2.2 * energy
		const particles = state.particles
		state.pattern = (state.pattern + patternSpeed * dt) % TAU
		for (let index = 0; index < particles.length; index += 1) {
			const grain = particles[index]
			let theta = grain.theta + ORBIT_SCALE * rate * grain.spin * dt
			if (grain.kind === 1) {
				// Density wave: pull arm stars back onto the rotating spiral crest.
				const armAngle =
					state.pattern + grain.arm * Math.PI + TWIST * Math.log(Math.max(0.08, grain.r)) + grain.spread
				let pull = armAngle - theta
				pull -= TAU * Math.round(pull / TAU)
				theta += pull * Math.min(1, cohesion * dt)
			}
			theta %= TAU
			if (theta < 0) theta += TAU
			grain.theta = theta
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const count = Math.max(0, Math.min(180, Math.round(100 + 80 * energy)))
		const TAU = Math.PI * 2
		const radius = Math.min(width * 0.47, 132)
		// Vertical squash: 0.4 of the band height, so the disk reads edge-on.
		const squash = (bandHeight * 0.45) / Math.max(1, radius)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const base = 0.2 + 0.8 * energy
		const particles = state.particles
		// Back to front: diffuse disk, then the arms, then the nucleus.
		const passes = [
			{ kind: 2, alpha: base * 0.22 },
			{ kind: 1, alpha: base * 0.72 },
			{ kind: 0, alpha: base * 1 },
		]
		if (sprite !== null) {
			context.globalCompositeOperation = 'lighter'
			for (let pass = 0; pass < passes.length; pass += 1) {
				const entry = passes[pass]
				context.globalAlpha = entry.alpha * 0.9
				for (let index = 0; index < count; index += 1) {
					const grain = particles[index]
					if (grain.kind !== entry.kind) continue
					const r = grain.r > 1 ? 1 : grain.r < 0.03 ? 0.03 : grain.r
					const x = centerX + Math.cos(grain.theta) * r * radius
					const y = centerY + Math.sin(grain.theta) * r * radius * squash
					const size = grain.size * 2.2 + 1.6
					context.drawImage(sprite, x - size * 0.5, y - size * 0.5, size, size)
				}
			}
			context.globalCompositeOperation = 'source-over'
			context.globalAlpha = 1
		} else {
			for (let pass = 0; pass < passes.length; pass += 1) {
				const entry = passes[pass]
				context.fillStyle = withAlpha(accent, entry.alpha)
				context.beginPath()
				for (let index = 0; index < count; index += 1) {
					const grain = particles[index]
					if (grain.kind !== entry.kind) continue
					const r = grain.r > 1 ? 1 : grain.r < 0.03 ? 0.03 : grain.r
					const x = centerX + Math.cos(grain.theta) * r * radius
					const y = centerY + Math.sin(grain.theta) * r * radius * squash
					context.moveTo(x + grain.size, y)
					context.arc(x, y, grain.size, 0, TAU)
				}
				context.fill()
			}
		}
		// Bright nucleus: one dot on top of the bulge.
		const nucleusSize = 2 + 2.5 * energy
		if (sprite !== null) {
			context.globalCompositeOperation = 'lighter'
			context.globalAlpha = 0.55 + 0.35 * energy
			context.drawImage(sprite, centerX - nucleusSize, centerY - nucleusSize, nucleusSize * 2, nucleusSize * 2)
			context.globalCompositeOperation = 'source-over'
			context.globalAlpha = 1
		} else {
			context.fillStyle = withAlpha(accent, 0.7 + 0.3 * energy)
			context.beginPath()
			context.arc(centerX, centerY, nucleusSize, 0, TAU)
			context.fill()
		}
	},
}
