/**
 * dsh-model-effort-chips — browser half.
 *
 *   - model chip  : opens the session's catalog, one click switches model.
 *                   The reasoning level carries across by INDEX (per user
 *                   decision): high (3rd) stays 3rd on the next model, and a
 *                   level the target does not declare clamps to the nearest
 *                   one it does.
 *   - effort chip : opens the effort slider. Energy wave + spectrum on top, a
 *                   level-tinted gradient track, one knob per declared level
 *                   and the labels below. CLICK or DRAG the rail; the active
 *                   knob follows the pointer live, snaps on release and only
 *                   then writes.
 *
 * Rendering notes (learned the hard way):
 *   - knobs are SVG circles, not styled divs: the host shell styles generic
 *     elements, and a styled div kept rendering as a square.
 *   - the waveform sets fill/stroke as SVG attributes, never through CSS: an
 *     unstyled <polyline> defaults to a black fill, which showed up as black
 *     blocks once the amplitude grew.
 *   - no blurred layers: a blurred rectangle behind the track read as a block,
 *     so the glow now lives on the knob as an SVG drop-shadow.
 *
 * Data comes only from the public surface:
 *   ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot()
 *   directory.select({ provider, model, reasoningEffort })
 *
 * The seat is taken over with `priority: -1` (single slot: lowest priority
 * renders), and a tool-row fallback keeps a control in the composer if that
 * registration ever stops working.
 */

window.__ModuleLoader__.load({
	id: 'dsh-model-effort-chips',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')
		let reactDom = null
		try {
			reactDom = require('react-dom')
		} catch (error) {
			console.warn(`[${TAG}] react-dom unavailable; panels will render inline`, error)
		}
		const h = react.createElement

		const name = 'model-effort-chips'
		// Nothing is a hard requirement: a plugin-level inject that never resolves
		// leaves apply() uncalled, which silently hands the composer back to the
		// official seat. The slot is resolved through ctx.inject and every service
		// is looked up lazily instead.
		const inject = []

		const SEAT = 'conversation.input.model'
		const FALLBACK = 'conversation.input.right'
		const TAG = 'dsh-model-effort-chips'

		const EMPTY_STATE = { current: null, groups: [], status: 'idle', pending: null, error: null }

		/** Bumped whenever the injected stylesheet changes; stale sheets are replaced. */
		const STYLE_VERSION = '1.5.0'

		/** Below this composer width the chips drop their text to icons. */
		const COMPACT_BELOW = 360

		/** Level palette, sampled by position: green -> cyan -> indigo -> violet -> magenta. */
		const PALETTE = ['#22c55e', '#22d3ee', '#6366f1', '#a855f7', '#e879f9']

		// ------------------------------------------------------------------ color

		/** '#rrggbb' -> [r,g,b]. */
		function parseHex(hex) {
			const value = Number.parseInt(hex.slice(1), 16)
			return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
		}

		/** Linear RGB interpolation between two '#rrggbb' colors. */
		function lerpColor(from, to, t) {
			const a = parseHex(from)
			const b = parseHex(to)
			const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * Math.max(0, Math.min(1, t)))
			return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
		}

		/** 'rgb(r, g, b)' | '#rrggbb' -> 'rgba(r, g, b, a)'. */
		function withAlpha(color, alpha) {
			const match = /rgba?\(([^)]+)\)/.exec(color)
			if (match !== null) {
				const parts = match[1].split(',').map((part) => Number.parseFloat(part))
				return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
			}
			if (color.startsWith('#')) {
				const [r, g, b] = parseHex(color)
				return `rgba(${r}, ${g}, ${b}, ${alpha})`
			}
			return color
		}

		/**
		 * Color for a continuous position 0..1 along the palette.
		 * Always returns `rgb(...)`.
		 */
		function colorAtFraction(fraction) {
			const t = Math.max(0, Math.min(1, fraction))
			const scaled = t * (PALETTE.length - 1)
			const lower = Math.floor(scaled)
			const upper = Math.min(PALETTE.length - 1, lower + 1)
			return lerpColor(PALETTE[lower], PALETTE[upper], scaled - lower)
		}

		/** Color for level `index` of `count` levels. */
		function colorAt(index, count) {
			if (count <= 1) return colorAtFraction(0)
			return colorAtFraction(index / (count - 1))
		}

		/** Horizontal position of level `index`, as a percentage. */
		function percentAt(index, count) {
			if (count <= 1) return 50
			return (index / (count - 1)) * 100
		}

		/** Energy 0..1 for a level index (drives wave amplitude and thickness). */
		function energyFor(index, count) {
			if (count <= 1) return 1
			return Math.max(0, Math.min(1, index / (count - 1)))
		}

		/** Nearest level index for a dragged fraction 0..1. */
		function nearestIndex(fraction, count) {
			if (count <= 1) return 0
			const clamped = Math.max(0, Math.min(1, fraction))
			return Math.max(0, Math.min(count - 1, Math.round(clamped * (count - 1))))
		}

		/** True when the composer is too narrow to show the chip text. */
		function isCompact(composerWidth) {
			return typeof composerWidth === 'number' && composerWidth > 0 && composerWidth < COMPACT_BELOW
		}

		/**
		 * Height of spectrum bar `index`, driven by the same breathing value.
		 *
		 * The pulse DEPTH grows with the level (35% swing at off, 90% at max), so
		 * high/max visibly breathe instead of all levels pulsing by the same 45%.
		 */
		function spectrumPulseDepthFor(energy) {
			return 0.35 + 0.55 * Math.max(0, Math.min(1, energy))
		}

		function spectrumBarHeightFor(index, energy, breathe) {
			const level = Math.max(0, Math.min(1, energy))
			const base = 3 + 22 * level * (0.35 + 0.65 * Math.abs(Math.sin(index * 1.7)))
			const depth = spectrumPulseDepthFor(level)
			const pulse = 1 - depth * (0.5 - 0.5 * Math.max(-1, Math.min(1, breathe)))
			return base * pulse
		}

		// ------------------------------------------------------------- theming

		/** 'rgb()' | 'rgba()' | '#rrggbb' -> [r,g,b] or null. */
		function parseColorToRgb(value) {
			if (typeof value !== 'string') return null
			const text = value.trim()
			const match = /rgba?\(([^)]+)\)/.exec(text)
			if (match !== null) {
				const parts = match[1].split(',').map((part) => Number.parseFloat(part))
				if (parts.length >= 3 && parts.every((part) => Number.isFinite(part))) return [parts[0], parts[1], parts[2]]
				return null
			}
			if (/^#[0-9a-f]{6}$/i.test(text)) return parseHex(text)
			return null
		}

		/** Relative luminance 0..1 of an [r,g,b] triple. */
		function luminanceOf(rgb) {
			return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
		}

		/** Mix a color toward black (amount < 0) or white (amount > 0). */
		function shade(color, amount) {
			const rgb = parseColorToRgb(color)
			if (rgb === null) return color
			const target = amount < 0 ? 0 : 255
			const t = Math.min(1, Math.abs(amount))
			const chan = (index) => Math.round(rgb[index] + (target - rgb[index]) * t)
			return `rgb(${chan(0)}, ${chan(1)}, ${chan(2)})`
		}

		/**
		 * Whether the surrounding surface is light.
		 *
		 * The host publishes its surface tokens as CSS variables on body, so the
		 * luminance of `--dsw-alias-bg-layer-2` is the authority; a missing token
		 * falls back to the OS colour preference.
		 */
		function detectLightTheme() {
			if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return false
			try {
				const raw = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-2')
				const rgb = parseColorToRgb(raw)
				if (rgb !== null) return luminanceOf(rgb) > 0.5
			} catch {
				// fall through to the media query
			}
			try {
				return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
					? !window.matchMedia('(prefers-color-scheme: dark)').matches
					: false
			} catch {
				return false
			}
		}

		/** Accent for level `index`: the palette colour, darkened on a light surface. */
		function accentFor(index, count, isLight) {
			return isLight ? shade(colorAt(index, count), -0.2) : colorAt(index, count)
		}

		/** How close a drag has to come before a level pulls it in, as a fraction of the track. */
		const MAGNET_RANGE = 0.1
		/** How much of the remaining distance the magnet removes. */
		const MAGNET_STRENGTH = 0.78

		/**
		 * Pull a dragged fraction toward the nearest level inside MAGNET_RANGE.
		 * Outside that range the pointer stays exactly where it is.
		 */
		function magnetize(fraction, count) {
			if (count <= 1) return fraction
			const anchor = percentAt(nearestIndex(fraction, count), count) / 100
			const distance = fraction - anchor
			if (Math.abs(distance) >= MAGNET_RANGE) return fraction
			return anchor + distance * (1 - MAGNET_STRENGTH)
		}

		/**
		 * Droplet count for an energy 0..1 over `totalLevels` levels.
		 *
		 * off has none; the SECOND level (index 1) already shows six, then the
		 * count keeps climbing geometrically. The fractional position is used so
		 * the count also ramps while dragging.
		 */
		function particleCountFor(energy, totalLevels = 4) {
			const levels = Math.max(1, totalLevels)
			const position = Math.max(0, Math.min(levels - 1, Math.max(0, Math.min(1, energy)) * (levels - 1)))
			if (position <= 0.08) return 0
			return Math.min(14, Math.round(6 * Math.pow(position, 1.25)))
		}

		/** Clamp a fraction into 0..1. */
		function clamp01(value) {
			return Math.max(0, Math.min(1, value))
		}

		/**
		 * Radius of one ball, px — CONSTANT across levels by request.
		 *
		 * The size is pinned at what the low level used to draw, so a level change
		 * only alters how many balls there are and how hard they move.
		 */
		const DROPLET_RADIUS = 2.5

		/** Radius of one ball, px — constant across levels by request. */
		function dropletRadiusFor() {
			return DROPLET_RADIUS
		}

		/** Gravity, px/s^2. The drum is struck harder at high levels. */
		function dropletGravityFor(energy) {
			return 240 + 500 * clamp01(energy)
		}

		/** Energy injected on every floor hit, px/s. */
		function dropletSpeedFor(energy) {
			return 40 + 140 * clamp01(energy)
		}

		/** Bounciness on impact, 0..1. */
		function dropletRestitutionFor(energy) {
			return Math.min(0.9, 0.55 + 0.28 * clamp01(energy))
		}

		/**
		 * 粒子波动特效 (particle-wave) — the first effect.
		 *
		 * Balls fall under gravity, bounce off the floor and walls, and collide
		 * with each other; higher levels add count, gravity, launch speed and
		 * bounciness, so collisions get denser and more violent on their own.
		 *
		 * EFFECT CONTRACT — add an object with these members and register it:
		 *   id, name, summary            identity shown in docs / future settings
		 *   createState()                returns the mutable state for the loop
		 *   step(state, frame)           advance one frame; frame = { energy,
		 *                                totalLevels, width, height, dt }
		 *   paint(context, state, frame) draw; frame = { energy, accent, width, height }
		 */
		const particleWaveEffect = {
			id: 'particle-wave',
			name: '粒子波动特效',
			summary: '小球在鼓面上弹跳碰撞，档位越高越密越猛',
			layout: { sky: 0, track: 'bar', spectrum: true },

			createState: () => ({ balls: [] }),

			step(state, frame) {
				const { energy, totalLevels, width, height, dt } = frame
				// The canvas now spans band + rail; keep the balls inside the band.
				const bandTop = frame.band?.top ?? 0
				const bandHeight = frame.band?.height ?? height
				const floor = bandTop + bandHeight
				const radius = dropletRadiusFor()
				const gravity = dropletGravityFor(energy)
				const speed = dropletSpeedFor(energy)
				const restitution = dropletRestitutionFor(energy)
				const target = particleCountFor(energy, totalLevels)
				const balls = state.balls

				while (balls.length < target) {
					balls.push({
						x: radius + Math.random() * Math.max(1, width - radius * 2),
						y: floor - radius - Math.random() * 4,
						vx: (Math.random() * 2 - 1) * speed * 0.7,
						vy: -speed * (0.55 + Math.random() * 0.9),
						r: radius,
					})
				}
				while (balls.length > target) balls.pop()

				for (const ball of balls) {
					ball.r = radius
					ball.vy += gravity * dt
				}

				// ball vs ball: equal mass, impulse along the contact normal
				for (let i = 0; i < balls.length; i += 1) {
					for (let j = i + 1; j < balls.length; j += 1) {
						const a = balls[i]
						const b = balls[j]
						const dx = b.x - a.x
						const dy = b.y - a.y
						const distance = Math.hypot(dx, dy)
						const minimum = a.r + b.r
						if (distance === 0 || distance >= minimum) continue
						const nx = dx / distance
						const ny = dy / distance
						const overlap = (minimum - distance) / 2
						a.x -= nx * overlap
						a.y -= ny * overlap
						b.x += nx * overlap
						b.y += ny * overlap
						const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
						if (relative >= 0) continue
						const impulse = (-(1 + restitution) * relative) / 2
						a.vx -= impulse * nx
						a.vy -= impulse * ny
						b.vx += impulse * nx
						b.vy += impulse * ny
					}
				}

				for (const ball of balls) {
					ball.x += ball.vx * dt
					ball.y += ball.vy * dt
					if (ball.x < ball.r) {
						ball.x = ball.r
						ball.vx = Math.abs(ball.vx) * restitution
					} else if (ball.x > width - ball.r) {
						ball.x = width - ball.r
						ball.vx = -Math.abs(ball.vx) * restitution
					}
					if (ball.y > floor - ball.r) {
						ball.y = floor - ball.r
						// re-strike: the drum keeps feeding energy in
						ball.vy = -Math.abs(ball.vy) * restitution - speed * 0.35
					} else if (ball.y < bandTop + ball.r) {
						ball.y = bandTop + ball.r
						ball.vy = Math.abs(ball.vy) * restitution
					}
				}
			},

			paint(context, state, frame) {
				context.fillStyle = frame.accent
				context.globalAlpha = 0.92
				for (const ball of state.balls) {
					context.beginPath()
					context.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
					context.fill()
				}
				context.globalAlpha = 1
			},
		}

		// ------------------------------------------------------- 鲲鹏动效 helpers

		/** Body scale of the creature: a small whale at off, a big Kunpeng at max. */
		function kunpengScaleFor(energy) {
			return 0.6 + 0.7 * clamp01(energy)
		}

		/** Wing growth 0..1, smoothstepped between 40% and 85% of the range. */
		function kunpengWingFor(energy) {
			const t = clamp01((clamp01(energy) - 0.4) / 0.45)
			return t * t * (3 - 2 * t)
		}

		/** How far the creature lifts off the ribbon, px, inside the fixed panel. */
		function kunpengLiftFor(energy) {
			return 3 + 22 * Math.pow(clamp01(energy), 2.2)
		}

		/** Pitch of the body, radians: level swimming to a climb. */
		function kunpengAngleFor(energy) {
			return -0.08 - 0.55 * Math.pow(clamp01(energy), 1.6)
		}

		/**
		 * 鲲鹏动效 (kunpeng) — the second effect.
		 *
		 * The flat track becomes a luminous wave ribbon, and a creature travels
		 * along it: a small whale at off, growing wings as the level rises, and at
		 * max it lifts off the ribbon and climbs into the sky.
		 */
		const kunpengEffect = {
			id: 'kunpeng',
			name: '鲲鹏动效',
			summary: '小鲸鱼沿轨道游过；档位越高体形越大、长出翅膀，max 时振翅飞天',
			layout: { sky: 0, track: 'bar', spectrum: false },

			createState: () => ({ time: 0, x: -70 }),

			step(state, frame) {
				const width = Math.max(1, frame.width || 1)
				state.time += frame.dt
				const speed = 36 + 30 * clamp01(frame.energy)
				state.x += speed * frame.dt
				if (state.x > width + 90) state.x = -90
			},

			paint(context, state, frame) {
				const { energy, accent, width, height } = frame
				const level = clamp01(energy)
				const time = state.time

				// night sky: a few twinkling stars
				context.save()
				for (let index = 0; index < 14; index += 1) {
					const sx = ((index * 53.7) % Math.max(1, width - 2)) + 1
					const sy = 4 + ((index * 31.3) % 30)
					const twinkle = 0.35 + 0.45 * Math.abs(Math.sin(time * 1.6 + index * 1.7))
					context.globalAlpha = twinkle * (0.45 + 0.4 * level)
					context.fillStyle = index % 3 === 0 ? '#f0abfc' : '#a5f3fc'
					context.fillRect(sx, sy, 1.3, 1.3)
				}
				context.restore()

				const lineY = frame.trackY ?? (frame.band ? frame.band.top + frame.band.height : height - 40)

				// water shimmer at low levels, cloud puffs at high levels
				context.save()
				if (level < 0.55) {
					context.globalAlpha = 0.35 * (1 - level / 0.55)
					context.fillStyle = accent
					for (let x = 0; x < width; x += 7) {
						const crest = 1.6 + Math.sin(x / 19 + time * 2.4) * 1.4
						context.fillRect(x, lineY - 5 - crest, 3, 1.4)
					}
				} else {
					context.globalAlpha = 0.16 + 0.1 * level
					context.fillStyle = '#c4b5fd'
					for (const cloud of [
						{ x: 16, y: lineY - 24, r: 10 },
						{ x: width - 24, y: lineY - 28, r: 12 },
						{ x: width * 0.55, y: lineY - 32, r: 8 },
					]) {
						const drift = Math.sin(time * 0.6 + cloud.x) * 3
						context.beginPath()
						context.arc(cloud.x + drift, cloud.y, cloud.r, 0, Math.PI * 2)
						context.arc(cloud.x + drift + cloud.r * 0.8, cloud.y + 3, cloud.r * 0.75, 0, Math.PI * 2)
						context.fill()
					}
				}
				context.restore()

				// the creature
				const scale = kunpengScaleFor(level)
				const wing = kunpengWingFor(level)
				const lift = kunpengLiftFor(level)
				const angle = kunpengAngleFor(level)
				const bob = Math.sin(time * 2.2) * (1.2 + 1.2 * level)
				const reach = (wing > 0.05 ? 18 * wing + 7 : 8) * scale
				const y = Math.max(reach + 2, lineY - lift - bob)

				drawKunpeng(context, { x: state.x, y, scale, wing, angle, accent, time, energy: level })
			},
		}

		/** Paint the whale -> Kunpeng in local units (roughly 44 long). */
		function drawKunpeng(context, options) {
			const { x, y, scale, wing, angle, accent, time, energy } = options
			context.save()
			context.translate(x, y)
			context.rotate(angle)
			context.scale(scale, scale)

			const rim = energy > 0.5 ? '#f0abfc' : '#a5f3fc'
			const glowColor = energy > 0.5 ? '#c084fc' : accent
			context.lineJoin = 'round'
			context.lineCap = 'round'

			// ---- tail fluke (behind the body) ---------------------------
			const flap = Math.sin(time * 6) * (2 + 5 * energy)
			context.save()
			context.shadowColor = glowColor
			context.shadowBlur = 8 + 10 * energy
			context.beginPath()
			context.moveTo(-16, 0)
			context.quadraticCurveTo(-26, -8 + flap, -34, -6 + flap)
			context.quadraticCurveTo(-28, 0, -34, 6 - flap)
			context.quadraticCurveTo(-26, 8 - flap, -16, 0)
			context.closePath()
			context.fillStyle = accent
			context.globalAlpha = 0.85
			context.fill()
			context.globalAlpha = 1
			context.lineWidth = 1
			context.strokeStyle = rim
			context.stroke()
			context.restore()

			// ---- wings (grow with the level) -----------------------------
			if (wing > 0.01) {
				const spread = 18 + 7 * wing
				for (const direction of [-1, 1]) {
					context.save()
					context.shadowColor = glowColor
					context.shadowBlur = 10 + 10 * wing
					// three feather blades, longest on the outside
					for (let blade = 0; blade < 3; blade += 1) {
						const reachY = direction * spread * (0.6 + blade * 0.26)
						const reachX = -8 - blade * 7
						const alpha = wing * (0.8 - blade * 0.14)
						context.globalAlpha = alpha
						context.fillStyle = blade === 0 ? '#7dd3fc' : blade === 1 ? accent : '#e879f9'
						context.beginPath()
						context.moveTo(9 - blade * 2, direction * 2)
						context.quadraticCurveTo(reachX - 2, direction * (spread * 0.5), reachX, reachY)
						context.quadraticCurveTo(reachX + 16, direction * (spread * (0.78 + blade * 0.06)), 4, direction * 5)
						context.closePath()
						context.fill()
						context.globalAlpha = alpha * 0.9
						context.lineWidth = 0.7
						context.strokeStyle = rim
						context.stroke()
					}
					context.restore()
				}
				context.globalAlpha = 1
			}

			// ---- body ---------------------------------------------------
			context.save()
			context.shadowColor = glowColor
			context.shadowBlur = 12 + 10 * energy
			const bodyGradient = context.createLinearGradient(0, -10, 0, 10)
			bodyGradient.addColorStop(0, '#0ea5e9')
			bodyGradient.addColorStop(0.45, '#67e8f9')
			bodyGradient.addColorStop(1, '#7c3aed')
			context.fillStyle = bodyGradient
			context.beginPath()
			context.moveTo(20, -1)
			context.bezierCurveTo(14, -9, -2, -10, -10, -8)
			context.bezierCurveTo(-16, -6, -18, -2, -18, 0)
			context.bezierCurveTo(-18, 3, -14, 7, -6, 8)
			context.bezierCurveTo(6, 9, 16, 5, 20, -1)
			context.closePath()
			context.fill()
			context.lineWidth = 1.2
			context.strokeStyle = rim
			context.stroke()

			// dorsal fin
			context.globalAlpha = 0.85
			context.beginPath()
			context.moveTo(-2, -9)
			context.quadraticCurveTo(2, -17, 9, -8)
			context.closePath()
			context.fillStyle = accent
			context.fill()
			context.globalAlpha = 1
			context.restore()

			// ---- eye + mouth line ---------------------------------------
			context.shadowBlur = 0
			context.beginPath()
			context.arc(12, -2.5, 1.4, 0, Math.PI * 2)
			context.fillStyle = 'rgba(8, 12, 24, 0.9)'
			context.fill()
			context.beginPath()
			context.moveTo(16, 2.5)
			context.quadraticCurveTo(12, 4.5, 8, 3.5)
			context.strokeStyle = 'rgba(8, 12, 24, 0.55)'
			context.lineWidth = 0.9
			context.stroke()

			context.restore()
		}

		/** Every effect the plugin knows. */
		const EFFECTS = [particleWaveEffect, kunpengEffect]

		/**
		 * The panel size is FIXED at the 粒子波动特效 layout (324 x 141 CSS px,
		 * canvas 284 x 92). Effects may declare `layout.sky`, but it is clamped to
		 * zero here: a new effect must fit the existing panel, never enlarge it.
		 */
		const MAX_STAGE_SKY = 0

		/** Effective sky for an effect, clamped by the panel standard. */
		function effectiveSky(effect) {
			const declared = Number(effect?.layout?.sky ?? 0)
			if (!Number.isFinite(declared)) return 0
			return Math.max(0, Math.min(MAX_STAGE_SKY, declared))
		}

		/** The effect currently painted in the effort panel. */
		const DEFAULT_EFFECT_ID = 'kunpeng'

		/** Look up an effect by id; an unknown id falls back to the first one. */
		function resolveEffect(id) {
			return EFFECTS.find((effect) => effect.id === id) ?? EFFECTS[0]
		}

		/** localStorage key for the chosen effect. */
		const EFFECT_STORAGE_KEY = 'dsh-model-effort-chips:effect'

		/** The effect id saved by the user, if it still exists. */
		function readStoredEffectId() {
			try {
				if (typeof window === 'undefined' || window.localStorage === undefined) return null
				const stored = window.localStorage.getItem(EFFECT_STORAGE_KEY)
				return EFFECTS.some((effect) => effect.id === stored) ? stored : null
			} catch {
				return null
			}
		}

		/** Persist the chosen effect id; failures are ignored (private mode etc). */
		function writeStoredEffectId(id) {
			try {
				if (typeof window === 'undefined' || window.localStorage === undefined) return
				window.localStorage.setItem(EFFECT_STORAGE_KEY, id)
			} catch {
				// storage unavailable: the choice lasts for the session only
			}
		}

		/** Next effect in the registry, wrapping around. */
		function nextEffectId(id) {
			const index = EFFECTS.findIndex((effect) => effect.id === id)
			return EFFECTS[(index + 1) % EFFECTS.length].id
		}

		const ACTIVE_EFFECT = resolveEffect(DEFAULT_EFFECT_ID)

		// ----------------------------------------------------------------- styles

		function ensureStyles() {
			if (typeof document === 'undefined') return
			const existing = document.getElementById('dsh-model-effort-chips-style')
			// The module host can reload this bundle without a page reload (HMR),
			// which left the OLD stylesheet in place while the NEW markup used
			// class names it never defined. Key the sheet by version and replace.
			if (existing !== null) {
				if (existing.dataset.version === STYLE_VERSION) return
				existing.remove()
			}
			const style = document.createElement('style')
			style.id = 'dsh-model-effort-chips-style'
			style.dataset.version = STYLE_VERSION
			style.textContent = `
.mec-seat { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.mec-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 999px; background: transparent;
  color: inherit; font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
  max-width: 220px; white-space: nowrap;
}
.mec-chip:hover:not(:disabled) { background: rgba(127,127,127,.14); }
.mec-chip:disabled { cursor: default; }
.mec-chip:focus-visible { outline: 2px solid rgba(127,127,127,.55); outline-offset: 1px; }
.mec-chip-text { overflow: hidden; text-overflow: ellipsis; }
.mec-chevron { opacity: .5; font-size: 10px; }
.mec-panel {
  position: fixed; z-index: 2147483000; padding: 6px; border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14));
  background: var(--dsw-alias-bg-layer-2, #22252b);
  box-shadow: 0 12px 32px rgba(0,0,0,.45); color: var(--dsw-alias-label-primary, #eee);
  font: inherit; font-size: 12px; max-height: 60vh; overflow-y: auto;
}
.mec-heading { padding: 6px 9px 4px; opacity: .5; font-size: 11px; letter-spacing: .02em; text-transform: uppercase; }
.mec-note { padding: 8px 9px; opacity: .7; }
.mec-row {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px;
  border: 0; border-radius: 8px; background: transparent; color: inherit;
  font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.mec-row:hover { background: rgba(127,127,127,.14); }

/* ---- effort slider ---- */
.mec-slider { padding: 10px 14px 6px; width: 312px; touch-action: none; }
.mec-slider-title { font-size: 11px; opacity: .55; margin-bottom: 8px; letter-spacing: .02em; }
.mec-wave { position: relative; height: 26px; margin-bottom: 2px; }
.mec-wave-svg { display: block; width: 100%; height: 26px; overflow: visible; }
.mec-drops { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.mec-spectrum { position: absolute; right: 0; bottom: 0; display: flex; align-items: flex-end; gap: 2px; height: 24px; }
.mec-spectrum span { width: 2px; border-radius: 1px; }

.mec-rail {
  position: relative; height: 58px; margin: 0 2px 2px; outline: none;
  touch-action: none; cursor: pointer; user-select: none;
}
.mec-track {
  position: absolute; left: 0; right: 0; top: 12px; height: 8px; border-radius: 999px;
  transition: box-shadow .15s ease;
}
.mec-rail:focus-visible .mec-track { box-shadow: 0 0 0 3px rgba(127,127,127,.45); }
.mec-knob-svg { display: block; overflow: visible; }
.mec-label {
  position: absolute; top: 32px; transform: translateX(-50%); padding: 3px 9px;
  border-radius: 999px; font-size: 12px; white-space: nowrap; pointer-events: none;
  transition: opacity .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease;
}
.mec-label.is-active { transform: translateX(-50%) scale(1.04); }
@media (prefers-reduced-motion: reduce) {
  	.mec-label { transition: none; }
}
`
			document.head.appendChild(style)
		}

		// ------------------------------------------------------------ pure logic

		/**
		 * Map a reasoning level across models by index, clamping into range.
		 *
		 * @param {Array<{id:string,name?:string}>} fromLevels current model's levels
		 * @param {string|undefined} fromId current level id
		 * @param {Array<{id:string,name?:string}>} toLevels target model's levels
		 * @param {string|undefined} toDefault target model's default level id
		 * @returns {string|undefined} the level id to select on the target model
		 */
		function mapEffortIndex(fromLevels, fromId, toLevels, toDefault) {
			if (!Array.isArray(toLevels) || toLevels.length === 0) return undefined
			const fromIndex = Array.isArray(fromLevels) ? fromLevels.findIndex((level) => level.id === fromId) : -1
			if (fromIndex >= 0) return toLevels[Math.min(fromIndex, toLevels.length - 1)]?.id
			const defaultIndex = toLevels.findIndex((level) => level.id === toDefault)
			return toLevels[defaultIndex >= 0 ? defaultIndex : 0]?.id
		}

		/** Wheel notch throttle, ms. Trackpads fire dozens of events per gesture. */
		const WHEEL_THROTTLE_MS = 120

		/** Next level index for one wheel notch, clamped to the declared levels. */
		function stepLevelIndex(index, delta, totalLevels) {
			if (totalLevels <= 0) return 0
			// -1 means "no level chosen yet": one step up lands on the first stop.
			const current = index < 0 ? -1 : index
			return Math.max(0, Math.min(totalLevels - 1, current + delta))
		}

		/**
		 * Wheel support on one element: one level per notch, throttled, and with
		 * the page scroll suppressed. Attached natively because React's root
		 * wheel listener is passive and cannot preventDefault.
		 */
		function useWheelStep(ref, handler, enabled) {
			const handlerRef = react.useRef(handler)
			handlerRef.current = handler

			react.useEffect(() => {
				const node = ref.current
				if (node === null || !enabled) return undefined
				let last = 0
				let queued = 0
				let timer = 0

				const fire = (direction) => {
					last = Date.now()
					handlerRef.current(direction)
				}

				const listener = (event) => {
					if (Math.abs(event.deltaY) < 1) return
					event.preventDefault()
					const direction = event.deltaY < 0 ? 1 : -1
					const now = Date.now()
					if (now - last >= WHEEL_THROTTLE_MS) {
						queued = 0
						if (timer !== 0) {
							clearTimeout(timer)
							timer = 0
						}
						fire(direction)
						return
					}
					// Inside the throttle window: remember only the latest direction as
					// a trailing step. Without this a quick flick was swallowed whole and
					// the level looked stuck.
					queued = direction
					if (timer !== 0) clearTimeout(timer)
					timer = setTimeout(() => {
						timer = 0
						if (queued === 0) return
						const pending = queued
						queued = 0
						fire(pending)
					}, Math.max(0, WHEEL_THROTTLE_MS - (now - last)))
				}

				node.addEventListener('wheel', listener, { passive: false })
				return () => {
					node.removeEventListener('wheel', listener)
					if (timer !== 0) clearTimeout(timer)
				}
			}, [ref, enabled])
		}

		/** Resolve one session's shared directory, never throwing. */
		function tryDirectory(ctx, sessionId) {
			if (sessionId === undefined || sessionId === null) return null
			try {
				const directories =
					typeof ctx.get === 'function' ? ctx.get('modelDirectories', false) : ctx.modelDirectories
				if (directories === undefined || directories === null || typeof directories.directoryFor !== 'function') return null
				return directories.directoryFor(sessionId) ?? null
			} catch (error) {
				console.warn(`[${TAG}] directoryFor failed`, error)
				return null
			}
		}

		/** Pick the catalog entry for the current selection. */
		function resolveSelection(state) {
			const current = state?.current ?? null
			const groups = Array.isArray(state?.groups) ? state.groups : []
			const group = current === null ? undefined : groups.find((entry) => entry.id === current.provider)
			const model = group === undefined ? undefined : group.models?.find((entry) => entry.id === current.model)
			const reasoning = model?.reasoning ?? undefined
			const levels = Array.isArray(reasoning?.efforts) ? reasoning.efforts : []
			const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
			const level = levels.find((entry) => entry.id === effectiveEffort)
			return {
				current,
				groups,
				group,
				model,
				levels,
				defaultEffort: reasoning?.defaultEffort,
				effectiveEffort,
				effortLabel: level?.name ?? effectiveEffort ?? (levels.length > 0 ? 'default' : null),
				pending: state?.pending ?? null,
			}
		}

		// --------------------------------------------------------------- hooks

		/** Resolve (and keep retrying) the session directory until it exists. */
		function useDirectory(ctx, sessionId, epoch = 0) {
			const [directory, setDirectory] = react.useState(() => tryDirectory(ctx, sessionId))

			react.useEffect(() => {
				const immediate = tryDirectory(ctx, sessionId)
				if (immediate !== null) {
					setDirectory(immediate)
					return undefined
				}
				let alive = true
				let tries = 0
				const timer = setInterval(() => {
					tries += 1
					const next = alive ? tryDirectory(ctx, sessionId) : null
					if (next !== null) {
						setDirectory(next)
						clearInterval(timer)
						return
					}
					if (tries >= 40) clearInterval(timer)
				}, 250)
				return () => {
					alive = false
					clearInterval(timer)
				}
			}, [ctx, sessionId, epoch])

			return directory
		}

		/** Subscribe to a directory's snapshot (uSES-safe). */
		function useDirectoryState(directory) {
			const subscribe = react.useCallback(
				(onChange) => (directory === null ? () => {} : directory.store.subscribe(onChange)),
				[directory]
			)
			const getSnapshot = react.useCallback(
				() => (directory === null ? EMPTY_STATE : directory.store.getSnapshot()),
				[directory]
			)
			return react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
		}

		/** Watch the composer card's width so the chips can fall back to icons. */
		function useComposerWidth(nodeRef) {
			const [width, setWidth] = react.useState(null)

			react.useEffect(() => {
				const node = nodeRef.current
				if (node === null || typeof ResizeObserver === 'undefined') return undefined
				const card = node.closest?.('[data-composer-card]') ?? node.parentElement
				if (card === null || card === undefined) return undefined
				const observer = new ResizeObserver(() => setWidth(card.getBoundingClientRect().width))
				observer.observe(card)
				setWidth(card.getBoundingClientRect().width)
				return () => observer.disconnect()
			}, [nodeRef])

			return width
		}

		/** Tracks the surrounding surface's lightness so accents can adapt. */
		function useIsLightTheme() {
			const [light, setLight] = react.useState(() => detectLightTheme())
			react.useEffect(() => {
				setLight(detectLightTheme())
			}, [])
			return light
		}

		// ---------------------------------------------------------------- panels

		/** A body portal anchored above the chip, so the composer cannot clip it. */
		function AnchoredPanel(props) {
			const panelRef = react.useRef(null)
			const { onClose, anchorRef } = props

			react.useEffect(() => {
				const onPointerDown = (event) => {
					const panel = panelRef.current
					if (panel !== null && panel.contains(event.target)) return
					if (anchorRef?.current?.contains?.(event.target)) return
					onClose()
				}
				const onKeyDown = (event) => {
					if (event.key === 'Escape') onClose()
				}
				document.addEventListener('pointerdown', onPointerDown, true)
				document.addEventListener('keydown', onKeyDown, true)
				return () => {
					document.removeEventListener('pointerdown', onPointerDown, true)
					document.removeEventListener('keydown', onKeyDown, true)
				}
			}, [onClose, anchorRef])

			const panel = h(
				'div',
				{ ref: panelRef, className: 'mec-panel', 'data-dsh-mec': props.kind, style: props.style },
				props.children
			)
			if (reactDom !== null && typeof reactDom.createPortal === 'function') return reactDom.createPortal(panel, document.body)
			return panel
		}

		/**
		 * One knob: a single absolutely-positioned SVG circle.
		 *
		 * Every placement value is inline. The host shell was overriding the
		 * class-based `position: absolute`, which left the knobs stacked in
		 * normal flow off the track; inline styles are the only thing the shell
		 * cannot win against.
		 */
		/**
		 * Keeps the seat alive if rendering throws: a crashed slot subtree hands
		 * the composer back to the official control, which is exactly the
		 * "everything reverted" symptom. This boundary swaps in a minimal chip
		 * instead and records the failure.
		 */
		function createGuard() {
			return class SeatGuard extends react.Component {
				constructor(props) {
					super(props)
					this.state = { failed: false }
				}

				static getDerivedStateFromError() {
					return { failed: true }
				}

				componentDidCatch(error) {
					mark('render-failed')
					this.seatError = String(error?.message ?? error)
					console.error(`[${TAG}] seat render threw`, error)
				}

				render() {
					if (this.state.failed) {
						return h(
							'span',
							{
								className: 'mec-chip',
								'data-dsh-mec': 'crashed',
								title: `model-effort-chips render failed: ${this.seatError ?? 'see console'}`,
							},
							'⚠️ effort'
						)
					}
					return this.props.children
				}
			}
		}

		function Knob(props) {
			const { fraction, color, active, dragging } = props
			const size = typeof props.size === 'number' ? props.size : active ? (dragging ? 30 : 24) : 13
			const radius = active ? 9 : 4.5
			return h(
				'svg',
				{
					className: 'mec-knob-svg',
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					'data-dsh-mec': active ? 'active-knob' : 'knob',
					style: {
						position: 'absolute',
						left: `${fraction}%`,
						top: `${16 - size / 2}px`,
						transform: 'translateX(-50%)',
						display: 'block',
						overflow: 'visible',
						pointerEvents: 'none',
						// A transition here makes the knob trail the pointer during a
						// drag; it is only wanted for click-to-change.
						transition: dragging ? 'top .16s ease, filter .16s ease' : 'left .12s linear, top .16s ease, filter .16s ease',
						filter: active ? `drop-shadow(0 0 7px ${color})` : 'none',
					},
				},
				h('circle', {
					cx: 12,
					cy: 12,
					r: radius,
					fill: active ? 'url(#mec-knob-fill)' : 'none',
					stroke: color,
					strokeWidth: 2,
				})
			)
		}

		/**
		 * ONE clock for the wave and the spectrum: a continuously advancing phase
		 * in radians.
		 *
		 * It starts on the first animation frame after mount, so the panel moves
		 * immediately instead of waiting a period. The speed follows the level
		 * through a ref (a dependency would restart the clock on every pointer
		 * move), and the rate is integrated over time so a speed change never
		 * makes the phase jump. State is written at most every ~28 ms.
		 */
		function useMotionPhase(energy) {
			const energyRef = react.useRef(energy)
			energyRef.current = energy
			const [phase, setPhase] = react.useState(0)
			const alive = energy > 0.05

			react.useEffect(() => {
				if (!alive) {
					setPhase(0)
					return undefined
				}
				const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
				let accumulated = 0
				let previous = now()
				let emitted = -1
				let frame = 0
				const tick = () => {
					const stamp = now()
					const delta = Math.min(0.1, (stamp - previous) / 1000)
					previous = stamp
					const speed = 2.2 + 2.6 * Math.max(0, Math.min(1, energyRef.current))
					accumulated = (accumulated + delta * speed) % (Math.PI * 2)
					if (emitted < 0 || Math.abs(accumulated - emitted) > 0.18 || accumulated < emitted) {
						emitted = accumulated
						setPhase(accumulated)
					}
					frame = requestAnimationFrame(tick)
				}
				frame = requestAnimationFrame(tick)
				return () => cancelAnimationFrame(frame)
			}, [alive])

			return alive ? phase : 0
		}

		/**
		 * Generic canvas host for an effect.
		 *
		 * Owns the canvas, the DPR scaling, the resize observer and the frame loop;
		 * the effect only advances and paints its own state. Adding an effect never
		 * touches this component.
		 */
		function EffectCanvas(props) {
			const { effect } = props
			const canvasRef = react.useRef(null)
			const paramsRef = react.useRef(props)
			paramsRef.current = props

			react.useEffect(() => {
				const canvas = canvasRef.current
				if (canvas === null || typeof canvas.getContext !== 'function') return undefined
				const context = canvas.getContext('2d')
				if (context === null) return undefined

				const reduced =
					typeof window !== 'undefined' &&
					typeof window.matchMedia === 'function' &&
					window.matchMedia('(prefers-reduced-motion: reduce)').matches

				let width = 0
				let height = 0
				const state = effect.createState()

				const resize = () => {
					const rect = canvas.getBoundingClientRect()
					width = Math.max(0, Math.round(rect.width))
					height = Math.max(0, Math.round(rect.height))
					const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
					canvas.width = Math.max(1, Math.round(width * dpr))
					canvas.height = Math.max(1, Math.round(height * dpr))
					context.setTransform(dpr, 0, 0, dpr, 0, 0)
				}
				resize()

				const observer =
					typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize())
				if (observer !== null) observer.observe(canvas)

				let frame = 0
				let previous = typeof performance !== 'undefined' ? performance.now() : Date.now()

				const layout = effect.layout ?? { sky: 0, track: 'bar', spectrum: true }
				const sky = effectiveSky(effect)
				const BAND_HEIGHT = 30
				const RAIL_HEIGHT = 58
				const TRACK_IN_RAIL = 16

				const draw = (delta) => {
					if (width === 0 || height === 0) return
					const { energy, accent, totalLevels } = paramsRef.current
					const dt = Math.min(0.033, Math.max(0.001, delta))
					const band = { top: sky, height: BAND_HEIGHT }
					const trackY = sky + BAND_HEIGHT + TRACK_IN_RAIL
					const frame = { energy, accent, totalLevels, width, height, dt, band, trackY, sky, rail: RAIL_HEIGHT }
					effect.step(state, frame)
					context.clearRect(0, 0, width, height)
					effect.paint(context, state, frame)
				}

				const tick = () => {
					const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
					const delta = Math.min(0.05, (now - previous) / 1000)
					previous = now
					draw(delta)
					frame = requestAnimationFrame(tick)
				}

				if (reduced) draw(0.016)
				else frame = requestAnimationFrame(tick)

				return () => {
					if (frame !== 0) cancelAnimationFrame(frame)
					if (observer !== null) observer.disconnect()
				}
			}, [effect])

			return h('canvas', {
				ref: canvasRef,
				className: 'mec-drops',
				'data-dsh-mec': 'drops',
				'data-effect': effect.id,
				'aria-hidden': 'true',
			})
		}

		/**
		 * The effort slider: energy wave and spectrum on top, the tinted track in
		 * the middle, level ticks and labels below. Drag anywhere on the rail; the
		 * knob follows live, magnets onto a level when it comes close, snaps on
		 * release and writes once. Arrow keys step one level.
		 */
		function EffortSlider(props) {
			const { levels, effectiveEffort, onChoose, onStep, disabled } = props
			const railRef = react.useRef(null)
			const trackRef = react.useRef(null)
			const dragRef = react.useRef(null)
			const [drag, setDrag] = react.useState(null) // { fraction, snapped } | null
			const [pulseRound, setPulseRound] = react.useState(0)
			const isLight = useIsLightTheme()

			const [effectId, setEffectId] = react.useState(() => readStoredEffectId() ?? DEFAULT_EFFECT_ID)
			const activeEffect = resolveEffect(effectId)
			const layout = activeEffect.layout ?? { sky: 0, track: 'bar', spectrum: true }
			const sky = effectiveSky(activeEffect)
			const cycleEffect = () => {
				const next = nextEffectId(activeEffect.id)
				setEffectId(next)
				writeStoredEffectId(next)
			}
			const count = levels.length
			const activeIndex = Math.max(
				0,
				levels.findIndex((level) => level.id === effectiveEffort)
			)
			const accentAt = (index) => accentFor(index, count, isLight)
			const trackColors = levels.map((_level, index) => shade(colorAt(index, count), isLight ? -0.1 : 0))

			const dragging = drag !== null
			const previewFraction = dragging ? drag.fraction : percentAt(activeIndex, count) / 100
			const previewPercent = previewFraction * 100
			const previewAccent = dragging
				? shade(colorAtFraction(previewFraction), isLight ? -0.2 : 0)
				: accentAt(activeIndex)
			const energy = dragging ? previewFraction : energyFor(activeIndex, count)
			const gradientStops = trackColors.map((color, index) => `${color} ${percentAt(index, count).toFixed(2)}%`).join(', ')
			const nearest = dragging ? nearestIndex(previewFraction, count) : activeIndex

			useWheelStep(
				railRef,
				(delta) => {
					const next = stepLevelIndex(activeIndex, delta, count)
					if (next === activeIndex) return
					const step = typeof onStep === 'function' ? onStep : onChoose
					step(levels[next])
				},
				!disabled && count > 0
			)

			const fractionFromEvent = (event) => {
				const node = trackRef.current ?? railRef.current
				if (node === null) return null
				const rect = node.getBoundingClientRect()
				if (rect.width === 0) return null
				return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
			}

			const rafRef = react.useRef(0)
			const pendingRef = react.useRef(null)

			react.useEffect(() => () => {
				if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current)
			}, [])

			/** Coalesce pointer moves into one state write per animation frame. */
			const applyPointer = (event) => {
				const raw = fractionFromEvent(event)
				if (raw === null) return
				pendingRef.current = raw
				if (rafRef.current !== 0) return
				rafRef.current = requestAnimationFrame(() => {
					rafRef.current = 0
					const pending = pendingRef.current
					if (pending === null) return
					const magnetized = magnetize(pending, count)
					setDrag({ fraction: magnetized, snapped: Math.abs(pending - magnetized) > 0.002 })
				})
			}

			const onPointerDown = (event) => {
				if (disabled || event.button !== 0) return
				event.preventDefault()
				event.stopPropagation()
				if (fractionFromEvent(event) === null) return
				dragRef.current = { pointerId: event.pointerId }
				applyPointer(event)
				railRef.current?.setPointerCapture?.(event.pointerId)
				railRef.current?.focus?.()
			}

			const onPointerMove = (event) => {
				const current = dragRef.current
				if (current === null || current.pointerId !== event.pointerId) return
				applyPointer(event)
			}

			const endDrag = (event) => {
				const current = dragRef.current
				if (current === null || current.pointerId !== event.pointerId) return
				dragRef.current = null
				if (rafRef.current !== 0) {
					cancelAnimationFrame(rafRef.current)
					rafRef.current = 0
				}
				pendingRef.current = null
				const raw = fractionFromEvent(event)
				setDrag(null)
				railRef.current?.releasePointerCapture?.(event.pointerId)
				if (disabled || raw === null) return
				onChoose(levels[nearestIndex(raw, count)])
			}

			const onKeyDown = (event) => {
				if (disabled) return
				const step =
					event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
				if (step === 0) return
				event.preventDefault()
				event.stopPropagation()
				const next = Math.max(0, Math.min(count - 1, activeIndex + step))
				if (next !== activeIndex) onChoose(levels[next])
			}

			// Everything here scales with energy so a low level is calm and the top
			// level is visibly dense. Declared BEFORE the motion hook below so the
			// hook never receives a value that is still in the temporal dead zone
			// (that exact mistake crashed the panel once).
			const spectrumBars = energy > 0.12 ? Math.round(8 + 16 * energy) : 0

			// The spectrum bars still breathe on the shared clock; the waveform is
			// gone by request, and the droplets carry the motion now.
			const motionPhase = useMotionPhase(energy)
			const breathe = Math.sin(motionPhase)

			const knotBase = dragging ? 30 + (drag.snapped ? 3 : 0) : 24

			return h('div', { className: 'mec-slider' }, [
				h('div', { key: 'title', className: 'mec-slider-title', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
					h('span', { key: 'label' }, '思考强度'),
					h(
						'button',
						{
							key: 'effect',
							type: 'button',
							className: 'mec-effect-switch',
							'data-dsh-mec': 'effect-switch',
							'data-effect': activeEffect.id,
							title: '切换动效（当前：' + activeEffect.name + '）',
							style: {
								border: '1px solid rgba(127,127,127,.45)',
								background: 'transparent',
								color: 'inherit',
								borderRadius: '999px',
								padding: '1px 7px',
								font: 'inherit',
								fontSize: '10.5px',
								lineHeight: '1.5',
								cursor: 'pointer',
								opacity: 0.75,
							},
							onPointerDown: (event) => event.stopPropagation(),
							onClick: (event) => {
								event.stopPropagation()
								cycleEffect()
							},
						},
						activeEffect.name
					),
				]),
				// Sphere gradient: white core fading into the live level colour.
				h(
					'svg',
					{ key: 'defs', width: 0, height: 0, 'aria-hidden': 'true', style: { position: 'absolute' } },
					h(
						'defs',
						null,
						h(
							'radialGradient',
							{ id: 'mec-knob-fill', cx: '35%', cy: '30%', r: '78%' },
							h('stop', { offset: '0%', stopColor: isLight ? '#ffffff' : '#ffffff' }),
							h('stop', { offset: '48%', stopColor: '#ffffff' }),
							h('stop', { offset: '100%', stopColor: previewAccent })
						)
					)
				),
				h('div', { key: 'stage', className: 'mec-stage', style: { position: 'relative', paddingTop: `${sky}px` } }, [
					h(EffectCanvas, {
						key: 'effect',
						effect: activeEffect,
						energy,
						accent: previewAccent,
						totalLevels: Math.max(1, count),
						disabled,
					}),
				h('div', { key: 'band', className: 'mec-wave', style: { position: 'relative', height: '30px', marginBottom: '2px', zIndex: 1 } }, [
					h(EffectCanvas, {
						key: 'effect',
						effect: activeEffect,
						energy,
						accent: previewAccent,
						totalLevels: Math.max(1, count),
						disabled,
					}),
					layout.spectrum && spectrumBars > 0
						? h(
								'div',
								{
									key: 's',
									className: 'mec-spectrum',
									'data-dsh-mec': 'spectrum',
									style: {
										position: 'absolute',
										left: 0,
										bottom: 0,
										height: '24px',
										// Anchored at the left and grown to the knob, so dragging
										// right visibly extends the spectrum under the finger.
										width: `${Math.max(6, previewPercent)}%`,
										display: 'flex',
										alignItems: 'flex-end',
										justifyContent: 'space-between',
										pointerEvents: 'none',
										transition: dragging ? 'none' : 'width .12s linear',
									},
								},
								Array.from({ length: spectrumBars }, (_value, index) =>
									h('span', {
										key: index,
										style: {
											width: '2px',
											borderRadius: '1px',
											height: `${spectrumBarHeightFor(index, energy, breathe).toFixed(2)}px`,
											background: previewAccent,
											opacity: 0.55 + 0.45 * energy,
											// Motion is driven by the shared phase, not by CSS.
											animation: 'none',
										},
									})
								)
							)
						: null,
				]),
				h(
					'div',
					{
						key: 'rail',
						ref: railRef,
						className: 'mec-rail',
						style: {
							position: 'relative',
							zIndex: 1,
							height: '58px',
							margin: '0 2px 2px',
							touchAction: 'none',
							userSelect: 'none',
							cursor: 'pointer',
							outline: 'none',
						},
						role: 'slider',
						tabIndex: disabled ? -1 : 0,
						'aria-label': '思考强度',
						'aria-valuemin': 0,
						'aria-valuemax': Math.max(0, count - 1),
						'aria-valuenow': activeIndex,
						'aria-valuetext': levels[activeIndex]?.name ?? levels[activeIndex]?.id ?? '',
						'aria-disabled': disabled ? 'true' : undefined,
						'data-dsh-mec': 'rail',
						onPointerDown,
						onPointerMove,
						onPointerUp: endDrag,
						onPointerCancel: endDrag,
						onKeyDown,
					},
					[
						// Tick marks: one connector per level, from the track down to its label.
						...levels.map((level, index) =>
							h('div', {
								key: `tick:${level.id}`,
								'data-dsh-mec': 'tick',
								style: {
									position: 'absolute',
									top: '20px',
									left: `${percentAt(index, count)}%`,
									width: '1px',
									height: index === nearest ? '12px' : '9px',
									transform: 'translateX(-50%)',
									borderRadius: '1px',
									background: accentAt(index),
									opacity: index === nearest ? 0.95 : 0.4,
									pointerEvents: 'none',
									transition: 'opacity .15s ease, height .15s ease',
								},
							})
						),
						h('div', {
							key: 'track',
							ref: trackRef,
							className: 'mec-track',
							'data-dsh-mec': 'track',
							style: {
								position: 'absolute',
								left: 0,
								right: 0,
								top: '12px',
								height: '8px',
								borderRadius: '999px',
								background: `linear-gradient(90deg, ${gradientStops})`,
								boxShadow: `0 0 14px ${withAlpha(previewAccent, 0.28)}`,
								opacity: layout.track === 'wave' ? 0 : disabled ? 0.6 : 1,
							},
						}),
						...levels.map((level, index) =>
							index === nearest && dragging
								? null
								: h(Knob, {
										key: `knob:${level.id}`,
										fraction: percentAt(index, count),
										color: accentAt(index),
										active: index === activeIndex && !dragging,
									})
						),
						dragging
							? h(Knob, { key: 'drag-knob', fraction: previewPercent, color: previewAccent, active: true, dragging: true, size: knotBase })
							: null,
						...levels.map((level, index) =>
							h(
								'div',
								{
									key: `label:${level.id}`,
									className: `mec-label${index === nearest ? ' is-active' : ''}`,
									'data-effort': level.id,
									style: {
										position: 'absolute',
										top: '32px',
										left: `${percentAt(index, count)}%`,
										transform: index === nearest ? 'translateX(-50%) scale(1.04)' : 'translateX(-50%)',
										padding: '3px 9px',
										borderRadius: '999px',
										whiteSpace: 'nowrap',
										pointerEvents: 'none',
										fontSize: '12px',
										transition: 'opacity .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease',
										color: accentAt(index),
										opacity: index === nearest ? 1 : 0.62,
										background: index === nearest ? withAlpha(accentAt(index), isLight ? 0.14 : 0.18) : 'transparent',
										boxShadow: index === nearest ? `0 0 14px ${withAlpha(accentAt(index), isLight ? 0.2 : 0.32)}` : 'none',
									},
								},
								level.name ?? level.id
							)
						),
					]
				),
				]),
			])
		}

		// ----------------------------------------------------------------- seat

		function createSeat(ctx) {
			function ModelEffortSeat(props) {
				const sessionId = props?.sessionId
				const [epoch, setEpoch] = react.useState(0)
				const directory = useDirectory(ctx, sessionId, epoch)
				const state = useDirectoryState(directory)
				const view = resolveSelection(state)

				const [openPanel, setOpenPanel] = react.useState(null) // 'model' | 'effort' | null
				const [rect, setRect] = react.useState(null)
				const seatRef = react.useRef(null)
				const modelRef = react.useRef(null)
				const effortRef = react.useRef(null)
				const loggedRef = react.useRef(false)
				const optimisticRef = react.useRef(null)
				const composerWidth = useComposerWidth(seatRef)
				const compact = isCompact(composerWidth)

				react.useEffect(() => {
					ensureStyles()
				}, [])

				react.useEffect(() => {
					if (loggedRef.current || state.status === 'idle' || state.status === 'loading') return
					loggedRef.current = true
					console.info(`[${TAG}] directory snapshot`, {
						status: state.status,
						current: state.current,
						groups: state.groups?.length,
						levels: view.levels.length,
					})
				}, [state, view.levels.length])

				// Stall watchdog: a select whose RPC never settles leaves the store in
				// "selecting" forever. After four seconds re-resolve the directory (a
				// rebuilt instance is a fresh store) and drop the optimistic position.
				const waiting = view.pending !== null || state.status === 'selecting'
				react.useEffect(() => {
					if (!waiting) return undefined
					const timer = setTimeout(() => {
						optimisticRef.current = null
						setEpoch((value) => value + 1)
					}, 4000)
					return () => clearTimeout(timer)
				}, [waiting, state.status, state.pending, epoch])

				// Closing always returns focus to the chip that opened the panel.
				const closePanel = () => {
					setOpenPanel((previous) => {
						if (previous === 'model') modelRef.current?.focus?.()
						if (previous === 'effort') effortRef.current?.focus?.()
						return null
					})
				}

				const toggle = (which) => {
					if (openPanel === which) {
						closePanel()
						return
					}
					const node = which === 'model' ? modelRef.current : effortRef.current
					if (node === null) return
					setRect(node.getBoundingClientRect())
					setOpenPanel(which)
				}

				const commit = async (selection, keepOpen = false) => {
					if (!keepOpen) closePanel()
					if (directory === null) return
					try {
						await directory.select(selection)
					} catch (error) {
						console.warn(`[${TAG}] select failed`, error)
					}
				}

				const chooseModel = (group, model) => {
					if (view.current === null) return
					if (view.current.provider === group.id && view.current.model === model.id) {
						closePanel()
						return
					}
					const targetLevels = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : []
					const effort = mapEffortIndex(view.levels, view.effectiveEffort, targetLevels, model.reasoning?.defaultEffort)
					void commit({
						provider: group.id,
						model: model.id,
						...(effort === undefined ? {} : { reasoningEffort: effort }),
					})
				}

				const chooseEffort = (level, keepOpen = false) => {
					if (view.current === null) return
					if (view.effectiveEffort === level.id) {
						if (!keepOpen) closePanel()
						return
					}
					void commit(
						{
							provider: view.current.provider,
							model: view.current.model,
							reasoningEffort: level.id,
						},
						keepOpen
					)
				}

				const busy = view.pending !== null || state.status === 'selecting'
				const locked = props?.locked === true
				// `busy` is NOT part of disabled: a select that never settles used to
				// disable the chip (and its wheel listener) forever, which read as
				// "stuck on one level". The store serialises generations itself, so a
				// new choice during a pending one is safe.
				const disabled = locked

				// Optimistic position: consecutive notches advance even while the
				// store is still catching up, and the ref clears once it matches.
				const storeIndex = view.levels.findIndex((level) => level.id === view.effectiveEffort)
				if (optimisticRef.current !== null && view.levels[optimisticRef.current]?.id === view.effectiveEffort) {
					optimisticRef.current = null
				}
				const wheelIndex = optimisticRef.current ?? storeIndex

				useWheelStep(
					effortRef,
					(delta) => {
						const next = stepLevelIndex(wheelIndex, delta, view.levels.length)
						if (next === wheelIndex) return
						if (view.levels[next] === undefined) return
						optimisticRef.current = next
						chooseEffort(view.levels[next], true)
					},
					!disabled && view.levels.length > 0
				)

				const modelText = view.model?.name ?? view.current?.model ?? '选择模型'
				const effortText = view.levels.length === 0 ? null : view.effortLabel
				const loadingNote = state.status === 'loading' && view.groups.length === 0

				const chipContent = (text, kind) => {
					if (compact) {
						return kind === 'model'
							? [h('span', { key: 'i', 'aria-hidden': 'true' }, '\u25c6')]
							: [h('span', { key: 'i' }, String(text ?? ''))]
					}
					return [
						h('span', { key: 't', className: 'mec-chip-text' }, text),
						h('span', { key: 'c', className: 'mec-chevron', 'aria-hidden': 'true' }, '\u2304'),
					]
				}

				const modelPanel =
					openPanel === 'model' && rect !== null
						? h(
								AnchoredPanel,
								{
									key: 'model-panel',
									kind: 'model-panel',
									anchorRef: modelRef,
									onClose: closePanel,
									style: {
										right: `${Math.max(8, window.innerWidth - Math.round(rect.right))}px`,
										bottom: `${Math.max(8, window.innerHeight - Math.round(rect.top) + 8)}px`,
										width: '300px',
									},
								},
								loadingNote
									? h('div', { className: 'mec-note' }, '目录加载中…')
									: view.groups.length === 0
										? h('div', { className: 'mec-note' }, state.status === 'error' ? state.error ?? '加载失败' : '暂无可用模型')
										: view.groups.map((group) =>
												h('div', { key: group.id, 'data-dsh-mec': 'provider-group' }, [
													h('div', { key: 'h', className: 'mec-heading' }, group.name ?? group.id),
													...(group.models ?? []).map((model) =>
														h(
															'button',
															{
																key: model.id,
																type: 'button',
																className: 'mec-row',
																'data-dsh-mec': 'model-option',
																'data-model-id': model.id,
																onPointerDown: (event) => event.stopPropagation(),
																onClick: () => chooseModel(group, model),
															},
															[
																h('span', { key: 'n', className: 'mec-chip-text', style: { flex: '1' } }, model.name ?? model.id),
																model.id === view.current?.model
																	? h('span', { key: 'c', style: { opacity: 0.75 } }, '\u2713')
																	: null,
															]
														)
													),
												])
											)
							)
						: null

				const effortPanel =
					openPanel === 'effort' && rect !== null
						? h(
								AnchoredPanel,
								{
									key: 'effort-panel',
									kind: 'effort-panel',
									anchorRef: effortRef,
									onClose: closePanel,
									style: {
										right: `${Math.max(8, window.innerWidth - Math.round(rect.right))}px`,
										bottom: `${Math.max(8, window.innerHeight - Math.round(rect.top) + 8)}px`,
									},
								},
								view.levels.length === 0
									? h('div', { className: 'mec-note' }, '当前模型没有声明思考档位')
									: h(EffortSlider, {
											levels: view.levels,
											effectiveEffort: view.effectiveEffort,
											disabled,
											onChoose: chooseEffort,
											onStep: (level) => chooseEffort(level, true),
										})
							)
						: null

				return h('div', { ref: seatRef, className: 'mec-seat', 'data-dsh-mec': 'seat' }, [
					h(
						'button',
						{
							key: 'model',
							ref: modelRef,
							type: 'button',
							disabled,
							className: 'mec-chip',
							'data-dsh-mec': 'model',
							'data-model-id': view.current?.model ?? '',
							title: view.model?.name ?? '模型',
							'aria-label': `模型：${modelText}`,
							'aria-haspopup': 'menu',
							'aria-expanded': openPanel === 'model' ? 'true' : 'false',
							onPointerDown: (event) => event.stopPropagation(),
							onClick: (event) => {
								event.stopPropagation()
								toggle('model')
							},
						},
						chipContent(modelText, 'model')
					),
					effortText === null
						? null
						: h(
								'button',
								{
									key: 'effort',
									ref: effortRef,
									type: 'button',
									disabled,
									className: 'mec-chip',
									'data-dsh-mec': 'effort',
									'data-effort': view.effectiveEffort ?? '',
									title: `思考强度：${effortText}（滚轮可调）`,
									'aria-label': `思考强度：${effortText}`,
									'aria-haspopup': 'menu',
									'aria-expanded': openPanel === 'effort' ? 'true' : 'false',
									onPointerDown: (event) => event.stopPropagation(),
									onClick: (event) => {
										event.stopPropagation()
										toggle('effort')
									},
								},
								chipContent(effortText, 'effort')
							),
					modelPanel,
					effortPanel,
				])
			}

			return ModelEffortSeat
		}

		// ----------------------------------------------------------------- apply

		function mountOccupant(ctx, slot, options, component) {
			try {
				return ctx.slots.inject(slot, () => ctx.slots.register(options, component))
			} catch (error) {
				console.warn(`[${TAG}] register failed for ${slot}`, error)
				return () => {}
			}
		}

		/** Record the mount verdict where a human can read it (window.__dshMec). */
		function mark(verdict) {
			try {
				window.__dshMec = verdict
			} catch {
				// no window: ignore
			}
		}

		const guard = createGuard()

		function apply(ctx) {
			console.info(`[${TAG}] apply`)
			mark('applied')

			try {
				ctx.inject(['slots'], (scope) => {
					try {
						const Seat = createSeat(scope)
						const Guard = guard
						mountOccupant(scope, SEAT, { name: SEAT, priority: -1 }, (props) => h(Guard, null, h(Seat, props)))
						mark('seated')
					} catch (error) {
						mark('seat-failed')
						console.error(`[${TAG}] seat takeover threw`, error)
					}

					try {
						scope.slots.inject(FALLBACK, () => {
							try {
								return scope.slots.register({ name: FALLBACK }, () =>
									h(
										'button',
										{ type: 'button', className: 'mec-chip', 'data-dsh-mec': 'fallback', title: 'model-effort-chips (fallback entry)' },
										'\u2699\ufe0f effort'
									)
								)
							} catch (error) {
								console.error(`[${TAG}] fallback register failed`, error)
								return () => {}
							}
						})
					} catch (error) {
						console.error(`[${TAG}] fallback inject failed`, error)
					}
				})
			} catch (error) {
				mark('inject-failed')
				console.error(`[${TAG}] slots injection failed`, error)
			}
		}

		exports.name = name
		exports.inject = inject
		exports.apply = apply
		exports.__internals = {
			mapEffortIndex,
			resolveSelection,
			colorAt,
			colorAtFraction,
			withAlpha,
			percentAt,
			energyFor,
			nearestIndex,
			isCompact,
			stepLevelIndex,
			WHEEL_THROTTLE_MS,
			magnetize,
			particleCountFor,
			EFFECTS,
			DEFAULT_EFFECT_ID,
			resolveEffect,
			particleWaveEffect,
			kunpengEffect,
			kunpengScaleFor,
			kunpengWingFor,
			kunpengLiftFor,
			kunpengAngleFor,
			readStoredEffectId,
			writeStoredEffectId,
			nextEffectId,
			effectiveSky,
			MAX_STAGE_SKY,
			EFFECT_STORAGE_KEY,
			dropletRadiusFor,
			dropletGravityFor,
			dropletSpeedFor,
			dropletRestitutionFor,
			shade,
			accentFor,
			parseColorToRgb,
			luminanceOf,
			detectLightTheme,
			spectrumBarHeightFor,
			spectrumPulseDepthFor,
			EffortSlider,
		}
		return module.exports
	},
})
