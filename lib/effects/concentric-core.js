/**
 * 同心核心 (concentric-core) — 能量核心, docs/plan/02-ip-catalog.md §5.1.
 *
 * A procedural homage to the "energy core" motif, not a character: concentric
 * rings around a hexagonal centre. The catalogue's rule for this entry is
 * explicit — rings and a hex core only, no armour, no shell, no logo — so the
 * neutral id is `concentric-core` and every pixel here is geometry.
 *
 * One GPT Image strip carries all three materials: frames 0-5 are the hex core
 * lighting up, 6-11 are ring sets of increasing density, 12-17 are radial blades.
 *
 *   rings   2 + floor(3e)       alternating rotation, dash density from the frame
 *   spin    0.4 + 2.2e rad/s
 *   blades  e > 0.55, fade in to full at max
 *
 * Layout sky 72 / band 0 / bar / off.
 */
const concentricCoreEffect = {
	id: 'concentric-core',
	name: '同心核心',
	summary: '同心环 + 六边形核心，双环反向旋转，满档炸出八道辐射光刃',
	category: 'core',
	layout: { sky: 72, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, spin: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.spin += (0.4 + 2.2 * level) * dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		const art = frame.art ?? null
		const cx = width * 0.5
		const cy = artTop + artHeight * 0.5
		const unit = Math.min(artHeight - 4, 64)
		const coreSize = Math.round(unit * 0.42)
		const rings = 2 + Math.floor(3 * level)
		const calm = frame.reducedMotion === true

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()

		// Rings: alternate direction, grow with the level, denser frames at the top.
		const ringFrame = Math.min(5, Math.floor(level * 6))
		for (let index = 0; index < rings; index += 1) {
			// Rings stay inside the box: the outer one is the largest.
			const size = Math.round(unit * (0.5 + 0.16 * index))
			const angle = (calm ? 0 : state.spin * (index % 2 === 0 ? 1 : -0.7)) + index * 0.6
			context.globalAlpha = 0.5 - index * 0.1
			if (art !== null) {
				context.save()
				context.translate(cx, cy)
				context.rotate(angle)
				context.imageSmoothingEnabled = false
				const half = Math.round(size * 0.5)
				context.drawImage(art, (6 + ringFrame) * 48, 0, 48, 48, -half, -half, size, size)
				context.imageSmoothingEnabled = true
				context.restore()
			} else {
				context.strokeStyle = withAlpha(accent, 0.5 - index * 0.1)
				context.lineWidth = 1.2
				context.beginPath()
				context.arc(cx, cy, size * 0.42, 0, Math.PI * 2)
				context.stroke()
			}
		}

		// Blades: only near the top of the range, fading in.
		const bladeFade = clamp01((level - 0.55) / 0.45)
		if (bladeFade > 0.02) {
			const size = Math.round(unit * (0.75 + 0.35 * bladeFade))
			context.globalAlpha = bladeFade
			if (art !== null) {
				context.save()
				context.translate(cx, cy)
				context.rotate(calm ? 0 : state.spin * 0.35)
				context.imageSmoothingEnabled = false
				const half = Math.round(size * 0.5)
				context.drawImage(art, (12 + Math.min(5, Math.floor(bladeFade * 6))) * 48, 0, 48, 48, -half, -half, size, size)
				context.imageSmoothingEnabled = true
				context.restore()
			} else {
				context.strokeStyle = withAlpha(accent, bladeFade)
				context.lineWidth = 1.4
				for (let blade = 0; blade < 8; blade += 1) {
					const angle = (blade / 8) * Math.PI * 2 + state.spin * 0.35
					context.beginPath()
					context.moveTo(cx + Math.cos(angle) * unit * 0.2, cy + Math.sin(angle) * unit * 0.2)
					context.lineTo(cx + Math.cos(angle) * unit * 0.45, cy + Math.sin(angle) * unit * 0.45)
					context.stroke()
				}
			}
		}

		// Hex core last, so it sits on top of its own rings.
		context.globalAlpha = 1
		const coreFrame = Math.min(5, Math.floor(level * 6))
		if (art !== null) {
			context.imageSmoothingEnabled = false
			context.drawImage(art, coreFrame * 48, 0, 48, 48, Math.round(cx - coreSize * 0.5), Math.round(cy - coreSize * 0.5), coreSize, coreSize)
			context.imageSmoothingEnabled = true
		} else {
			context.fillStyle = withAlpha(accent, 0.35 + 0.5 * level)
			context.beginPath()
			for (let corner = 0; corner < 6; corner += 1) {
				const angle = (corner / 6) * Math.PI * 2 - Math.PI / 2
				const px = cx + Math.cos(angle) * coreSize * 0.42
				const py = cy + Math.sin(angle) * coreSize * 0.42
				if (corner === 0) context.moveTo(px, py)
				else context.lineTo(px, py)
			}
			context.closePath()
			context.fill()
		}

		context.globalAlpha = 1
		context.restore()
	},
}
