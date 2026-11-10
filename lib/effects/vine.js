/**
 * 藤蔓 (vine) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A vine sprouts from the bottom of the sky strip, meanders upwards, throws out
 * branches and unfurls leaves; once it reaches the top it stops growing and
 * sways gently. `energy` drives the growth:
 *
 *   growth    20 + 70e        px/s
 *   branches  0.04 + 0.18e    chance per new node
 *   leaves    18 - 8e         px between leaves
 *   nodes     40 + 60e         cap (<= 100, preallocated)
 *
 * All node / leaf / branch records are allocated once in createState. Growth is
 * driven by an accumulated length counter plus a fixed-seed LCG, so nothing is
 * random per frame and no arrays are sliced. Leaves and branches animate their
 * own growth factor; the stem only sways after the tip stops.
 *
 * Layout sky 60 / band 0 / bar / off.
 */
const vineEffect = {
	id: 'vine',
	name: '藤蔓',
	summary: '藤蔓从底部生长、分枝、长叶，到顶后停止并轻轻摆动；档位越高长得越快',
	category: 'life',
	layout: { sky: 60, band: 0, track: 'bar', spectrum: false },

	createState() {
		const nodes = []
		for (let index = 0; index < 100; index += 1) nodes.push({ x: 0, y: 0 })
		const leaves = []
		for (let index = 0; index < 24; index += 1) leaves.push({ x: 0, y: 0, angle: 0, grow: 0 })
		const branches = []
		for (let index = 0; index < 8; index += 1) branches.push({ x: 0, y: 0, angle: 0, length: 0, grow: 0 })
		return {
			time: 0,
			primed: false,
			seed: 0x2f6e2b1,
			nodes,
			leaves,
			branches,
			count: 0,
			acc: 0,
			totalLength: 0,
			nextLeaf: 0,
			leafCount: 0,
			branchCount: 0,
			headX: 0,
			headY: 0,
			headAngle: -Math.PI / 2,
			done: false,
		}
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const bottom = artTop + artHeight - 2
		const leftMargin = 8
		const rightMargin = width - 8
		const vertical = -Math.PI / 2
		const segment = 6
		const speed = 20 + 70 * energy
		const branchChance = 0.04 + 0.18 * energy
		const leafInterval = 18 - 8 * energy
		const nodeCap = Math.min(100, Math.round(40 + 60 * energy))

		state.time += dt
		if (!state.primed) {
			// Start with a small visible sprout so the first painted frame is a vine
			// and not an empty strip (also what reduced-motion users will see).
			state.primed = true
			state.headX = width * 0.5
			state.headY = bottom
			state.headAngle = vertical
			state.acc = segment * 2
			state.nextLeaf = leafInterval * 0.6
		}

		if (!state.done) {
			state.acc = Math.min(segment * 4, state.acc + speed * dt)
			while (state.acc >= segment && state.count < nodeCap && !state.done) {
				state.acc -= segment
				if (state.count > 0) {
					// LCG wander plus a pull back towards straight up.
					state.seed = (state.seed * 1664525 + 1013904223) >>> 0
					state.headAngle += ((state.seed / 4294967296) * 2 - 1) * 1
					state.headAngle += (vertical - state.headAngle) * 0.015
					state.headAngle = Math.max(vertical - 1.25, Math.min(vertical + 1.25, state.headAngle))
				}
				state.headX += Math.cos(state.headAngle) * segment
				state.headY += Math.sin(state.headAngle) * segment
				if (state.headX < leftMargin) {
					state.headX = leftMargin
					state.headAngle = -Math.PI - state.headAngle
				} else if (state.headX > rightMargin) {
					state.headX = rightMargin
					state.headAngle = -Math.PI - state.headAngle
				}
				if (state.headY <= artTop + 4) {
					state.headY = artTop + 4
					state.done = true
				}
				const node = state.nodes[state.count]
				node.x = state.headX
				node.y = state.headY
				state.count += 1
				state.totalLength += segment

				// A leaf every leafInterval px of stem.
				if (state.totalLength >= state.nextLeaf && state.leafCount < 24) {
					state.seed = (state.seed * 1664525 + 1013904223) >>> 0
					const side = state.seed / 4294967296 < 0.5 ? -1 : 1
					const leaf = state.leaves[state.leafCount]
					leaf.x = state.headX
					leaf.y = state.headY
					leaf.angle = state.headAngle + side * (0.9 + (state.seed / 4294967296) * 0.4)
					leaf.grow = 0
					state.leafCount += 1
					state.nextLeaf += leafInterval
				}

				// Branch off with the level's probability, up to eight.
				if (state.branchCount < 8 && state.count > 2) {
					state.seed = (state.seed * 1664525 + 1013904223) >>> 0
					if (state.seed / 4294967296 < branchChance) {
						const branch = state.branches[state.branchCount]
						state.seed = (state.seed * 1664525 + 1013904223) >>> 0
						const side = state.seed / 4294967296 < 0.5 ? -1 : 1
						branch.x = state.headX
						branch.y = state.headY
						branch.angle = state.headAngle + side * (0.55 + (state.seed / 4294967296) * 0.5)
						branch.length = 12 + (state.seed / 4294967296) * 12
						branch.grow = 0
						state.branchCount += 1
					}
				}
			}
		}

		// Leaves and branches keep opening even after the tip stops.
		for (let index = 0; index < state.leafCount; index += 1) {
			const leaf = state.leaves[index]
			if (leaf.grow < 1) leaf.grow = Math.min(1, leaf.grow + dt * 4)
		}
		for (let index = 0; index < state.branchCount; index += 1) {
			const branch = state.branches[index]
			if (branch.grow < 1) branch.grow = Math.min(1, branch.grow + dt * 3)
		}
	},

	paint(context, state, frame) {
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const bottom = artTop + artHeight - 2
		const sway = state.done ? 2.4 : 0

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// The stem: a smoothed polyline through the stored nodes.
		if (state.count > 1) {
			context.strokeStyle = withAlpha(accent, 0.82)
			context.lineWidth = 1.6
			context.beginPath()
			for (let index = 0; index < state.count; index += 1) {
				const node = state.nodes[index]
				const x = node.x + Math.sin(state.time * 0.9 + node.y * 0.05) * sway * ((bottom - node.y) / artHeight)
				if (index === 0) {
					context.moveTo(x, node.y)
				} else if (index < state.count - 1) {
					const next = state.nodes[index + 1]
					const midX = (node.x + next.x) * 0.5 + Math.sin(state.time * 0.9 + node.y * 0.05) * sway * ((bottom - node.y) / artHeight)
					const midY = (node.y + next.y) * 0.5
					context.quadraticCurveTo(x, node.y, midX, midY)
				} else {
					context.lineTo(x, node.y)
				}
			}
			context.stroke()
		}

		// Branches: a short curved shoot that grows out of its node.
		for (let index = 0; index < state.branchCount; index += 1) {
			const branch = state.branches[index]
			const grow = branch.grow
			if (grow <= 0) continue
			const tipX = branch.x + Math.cos(branch.angle) * branch.length * grow
			const tipY = branch.y + Math.sin(branch.angle) * branch.length * grow
			const midX = branch.x + Math.cos(branch.angle - 0.45) * branch.length * grow * 0.6
			const midY = branch.y + Math.sin(branch.angle - 0.45) * branch.length * grow * 0.6
			const offset = Math.sin(state.time * 0.9 + branch.y * 0.05) * sway * ((bottom - branch.y) / artHeight)
			context.strokeStyle = withAlpha(accent, 0.62)
			context.lineWidth = 1.2
			context.beginPath()
			context.moveTo(branch.x + offset, branch.y)
			context.quadraticCurveTo(midX + offset, midY, tipX + offset, tipY)
			context.stroke()
		}

		// Leaves: two curves, unfurling with their own grow factor.
		for (let index = 0; index < state.leafCount; index += 1) {
			const leaf = state.leaves[index]
			const grow = leaf.grow
			if (grow <= 0.01) continue
			const offset = Math.sin(state.time * 0.9 + leaf.y * 0.05) * sway * ((bottom - leaf.y) / artHeight)
			const size = 6.4 * grow
			context.save()
			context.translate(leaf.x + offset, leaf.y)
			context.rotate(leaf.angle)
			context.beginPath()
			context.moveTo(0, 0)
			context.quadraticCurveTo(size * 0.55, -size * 0.42, size, 0)
			context.quadraticCurveTo(size * 0.55, size * 0.42, 0, 0)
			context.closePath()
			context.fillStyle = withAlpha(accent, 0.3)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.7)
			context.lineWidth = 1
			context.stroke()
			context.restore()
		}
		context.restore()
	},
}
