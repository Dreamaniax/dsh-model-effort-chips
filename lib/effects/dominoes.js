/**
 * 多米诺动效 (dominoes) — physics class, docs/plan/01-effects-taxonomy.md §1.
 *
 * A row of tiles stands on the track and topples left to right; the last one
 * rebounds off its stop, then the row quietly rebuilds. `energy` drives:
 *
 *   tiles   N = 8 + 24e              (8..32, hard cap: the preallocated 32)
 *           tile size and pitch are fixed at the 32-tile layout, so every level
 *           shows the same dominoes and only the count + fall speed change
 *   trigger = 0.18 - 0.1e            seconds between successive triggers
 *   omega   = 4 + 12e                rad / s while a tile is falling
 *   angle   clamped to PI / 2
 *
 * Angles are integrated, not keyframed, and the whole state is allocated once in
 * createState (32 tile objects). `paint` only reads state: it saves/translates/
 * rotates once per tile and draws a body plus a 1px top edge; no blurred shadows
 * and no per-frame allocations.
 *
 * layout `12/bar/off`: 12px of sky so the row has headroom over the DOM bar.
 */
const dominoesEffect = {
	id: 'dominoes',
	name: '多米诺动效',
	summary: '一排骨牌沿轨道依次倒下，末牌回弹；档位越高牌越多、倒得越快',
	layout: { sky: 12, band: 0, track: 'bar', spectrum: false },

	createState() {
		const tiles = []
		for (let index = 0; index < 32; index += 1) {
			tiles.push({ angle: 0, triggered: false, bounced: false, bounceT: 0 })
		}
		return { tiles, next: 0, trigger: 0, hold: -1 }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return

		const count = Math.max(1, Math.min(32, Math.round(8 + 24 * energy)))
		const interval = Math.max(0.03, 0.18 - 0.1 * energy)
		const omega = 4 + 12 * energy
		const halfPi = Math.PI / 2
		const tiles = state.tiles

		// The previous wave has finished (and faded); stand the row back up.
		if (state.hold >= 0) {
			state.hold -= dt
			if (state.hold < 0) {
				state.hold = -1
				state.next = 0
				state.trigger = 0
				for (let index = 0; index < tiles.length; index += 1) {
					const tile = tiles[index]
					tile.angle = 0
					tile.triggered = false
					tile.bounced = false
					tile.bounceT = 0
				}
			}
			return
		}

		// Sequential triggers on a fixed cadence, independent of the frame rate.
		state.trigger += dt
		if (state.trigger > interval * 2) state.trigger = interval * 2
		while (state.trigger >= interval && state.next < count) {
			tiles[state.next].triggered = true
			state.next += 1
			state.trigger -= interval
		}

		// Integrate: every triggered tile rotates at omega until it lies flat.
		const last = count - 1
		for (let index = 0; index < count; index += 1) {
			const tile = tiles[index]
			if (!tile.triggered) continue
			if (index === last) {
				if (!tile.bounced) {
					if (tile.angle < halfPi) tile.angle = Math.min(halfPi, tile.angle + omega * dt)
					if (tile.angle >= halfPi) {
						tile.angle = halfPi
						tile.bounced = true
						tile.bounceT = 0
					}
				} else if (tile.bounceT <= 1.5) {
					// Damped rebound: the last tile kicks back off the floor.
					tile.bounceT += dt
					const rebound = 0.45 * Math.sin(tile.bounceT * 13) * Math.exp(-tile.bounceT * 4.5)
					tile.angle = Math.max(0, Math.min(halfPi, halfPi - rebound))
					if (tile.bounceT > 1.5) {
						tile.angle = halfPi
						state.hold = 0.8
					}
				}
				continue
			}
			if (tile.angle < halfPi) tile.angle = Math.min(halfPi, tile.angle + omega * dt)
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const height = Math.max(1, Number(frame.height) || 0)
		const sky = Number(frame.sky ?? frame.band?.top ?? 0)
		const declaredTrack = Number(frame.trackY ?? sky + Number(frame.band?.height ?? 30) + 16)
		// 2px above the DOM bar's top edge, so a fallen tile stays fully visible.
		const floor = Math.max(6, Math.min(height, Number.isFinite(declaredTrack) ? declaredTrack : height - 42) - 6)
		const count = Math.max(1, Math.min(32, Math.round(8 + 24 * energy)))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const halfPi = Math.PI / 2
		const tiles = state.tiles

		// Every tile is the SAME size at every level — sized for the densest row
		// (32 tiles) and reused, so raising the level only adds tiles and speeds
		// up the fall instead of shrinking them.
		const tileHeight = Math.max(5, Math.min(16, floor * 0.56))
		// Reserve the tile's fall reach on both sides: a flat tile extends one
		// tile-height to the right of its pivot.
		const margin = Math.max(10, tileHeight + 2)
		const pitch = Math.min(tileHeight * 1.25, Math.max(1, width - margin * 2) / 31)
		const tileWidth = Math.max(1.5, Math.min(3, pitch * 0.3))
		const rowWidth = pitch * (count - 1)
		const left = (width - rowWidth) * 0.5
		const baseY = floor - 1
		const fade = state.hold >= 0 && state.hold < 0.3 ? Math.max(0, state.hold / 0.3) : 1

		context.fillStyle = accent
		for (let index = 0; index < count; index += 1) {
			const tile = tiles[index]
			const x = count === 1 ? width * 0.5 : left + pitch * index
			const angle = Math.max(0, Math.min(halfPi, tile.angle))
			const alpha = (0.42 + 0.5 * (1 - angle / halfPi)) * fade
			context.save()
			context.translate(x, baseY)
			context.rotate(angle)
			context.globalAlpha = alpha
			context.fillRect(-tileWidth * 0.5, -tileHeight, tileWidth, tileHeight)
			// A brighter 1px cap makes the tiles read as separate dominoes.
			context.globalAlpha = Math.min(1, alpha + 0.32)
			context.fillRect(-tileWidth * 0.5, -tileHeight, tileWidth, 1)
			context.restore()
		}
		context.globalAlpha = 1
	},
}
