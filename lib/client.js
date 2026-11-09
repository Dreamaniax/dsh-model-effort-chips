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

		// ------------------------------------------------- illustration variant

		/**
		 * Art packs live in `lib/assets/kunpeng/<level>.png` and are served by the
		 * client-module host at `/plugins/<package>/assets/...`. Each file should be
		 * a WIDE still (recommended 568 x 184, i.e. 2x the panel canvas) showing the
		 * same creature at that level on a dark background.
		 */
		const ART_PACKAGE = 'dsh-model-effort-chips'
		const ART_LEVELS = ['off', 'low', 'high', 'max']

		/**
		 * Each level is one horizontal strip of equal frames generated as a sprite
		 * sheet (3x2 grid) and packed left to right. Playback walks the frames.
		 */
		const ART_FRAMES = 6

		/** Frames per second for a level: the swim / wing beat speeds up with it. */
		function kunpengFrameRate(energy) {
			return 3.5 + 6.5 * clamp01(energy)
		}

		/** Seconds to cross the whole panel, left to right. Higher = faster. */
		function kunpengCrossSeconds(energy) {
			return 9 - 5.5 * clamp01(energy)
		}

		/** How tall the creature is drawn, as a fraction of the art box. */
		function kunpengDrawScale(energy) {
			return 0.55 + 0.45 * clamp01(energy)
		}

		/** How many frames a loaded strip holds (a plain 1-frame pack still works). */
		function artFramesOf(image) {
			if (image === null || !image.naturalWidth) return 1
			return image.naturalWidth % ART_FRAMES === 0 ? ART_FRAMES : 1
		}

		/** URL for one level's art file, or null when the host has no asset route. */
		function artUrlFor(level) {
			return `/plugins/${ART_PACKAGE}/assets/kunpeng/${level}.png`
		}

		/** Lazily loaded art pack: level -> HTMLImageElement. */
		function createArtCache() {
			const cache = new Map()
			return {
				get(level) {
					if (typeof window === 'undefined' || typeof window.Image !== 'function') return null
					if (cache.has(level)) return cache.get(level)
					const image = new window.Image()
					image.decoding = 'async'
					image.src = artUrlFor(level)
					cache.set(level, image)
					return image
				},
				ready(level) {
					const image = this.get(level)
					return image !== null && image.complete === true && image.naturalWidth > 0
				},
			}
		}

		/**
		 * 鲲鹏动效 (kunpeng) — the only kunpeng effect.
		 *
		 * Four sprite strips generated with GPT Image, one per level, played frame
		 * by frame while the creature swims / flies left to right. Missing art
		 * borrows another ready level, and an empty pack draws nothing at all.
		 */
		const kunpengEffect = {
			id: 'kunpeng',
			name: '鲲鹏动效',
			summary: '四张像素图随档位切换，画在轨道上方，交叉淡入 + 缓慢漂移；缺图自动回退',
			layout: { sky: 84, band: 0, track: 'bar', spectrum: false },

			createState: () => ({ time: 0, travel: 0, art: createArtCache(), lastIndex: 0, blend: 0 }),

			step(state, frame) {
				state.time += frame.dt
				// travel: 0 = just off the left edge, 1 = just off the right edge
				state.travel = (state.travel + frame.dt / kunpengCrossSeconds(frame.energy)) % 1
				const index = Math.round(clamp01(frame.energy) * 3)
				if (index !== state.lastIndex) {
					state.lastIndex = index
					state.blend = 1
				}
				state.blend = Math.max(0, state.blend - frame.dt * 3)
			},

			paint(context, state, frame) {
				const { energy, width, height, accent } = frame
				const level = clamp01(energy)
				const index = Math.round(level * 3)
				const wanted = ART_LEVELS[index]
				const art = state.art

				// Missing art: borrow whichever level is ready, else draw nothing
				// rather than falling back to a second renderer.
				let levelName = wanted
				if (!art.ready(levelName)) {
					const fallback = ART_LEVELS.find((candidate) => art.ready(candidate))
					if (fallback === undefined) return
					levelName = fallback
				}

				const image = art.get(levelName)
				const boxTop = frame.artBox?.top ?? 0
				const boxHeight = Math.max(1, frame.artBox?.height ?? height)
				const frames = artFramesOf(image)
				const frameWidth = image.naturalWidth / frames
				const frameIndex = Math.floor(state.time * kunpengFrameRate(level)) % frames

				context.save()
				// The pack is pixel art: keep the blocks crisp on 1x displays.
				context.imageSmoothingEnabled = false
				// Swim / fly across the panel, re-entering from the left.
				const drawHeight = boxHeight * kunpengDrawScale(level)
				const drawWidth = drawHeight * (frameWidth / image.naturalHeight)
				const x = -drawWidth + (width + drawWidth) * state.travel
				const y = boxTop + (boxHeight - drawHeight) / 2
				context.globalAlpha = 0.55 + 0.45 * (1 - state.blend)
				context.drawImage(image, frameIndex * frameWidth, 0, frameWidth, image.naturalHeight, x, y, drawWidth, drawHeight)
				context.globalAlpha = 1
				context.restore()
			},
		}

		// ---- physics effects: generated by scripts/assemble-effects.mjs ----

/**
 * 双摆混沌 (double-pendulum)
 *
 * 视觉机制：两根连杆串起两颗摆锤，第二颗摆锤拖一条 12 点定长尾迹。档位越高
 * 连杆越长、重力越大，两条摆的相位差迅速发酵成混沌轨迹。
 *
 * 能量映射：L1 = 10 + 8e、L2 = 8 + 6e（按 48px 天空区缩放 0.7）、
 *          g = 600 + 900e；每根连杆各按 α = -(g/L)sinθ - 0.02ω 积分
 *          （半隐式欧拉），两个角度每帧 wrap 到 ±π。
 * 布局：48/bar/off —— 只在天空区作画，不占 band、不显示频谱。
 *
 * 阻尼 0.02 很轻，摆动能持续数分钟；为了常驻面板不出现「彻底停摆」，速度
 * 低于 2.4 rad/s 时叠加一个随档位增大的微驱动（和 spring-mesh 的周期泵浦
 * 同一目的：画面不会死掉），速度一高它就自动归零。
 *
 * 尾迹用 createState 里预分配的 Float64Array + 环形索引，step/paint 均不分配
 * 对象或数组；paint 只读 state。
 */
const doublePendulumEffect = {
	id: 'double-pendulum',
	name: '双摆混沌',
	summary: '两根连杆的双摆被重力甩出混沌轨迹，12 点尾迹随档位越摆越乱',
	layout: { sky: 48, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		angle1: 2.2,
		angle2: 2.55,
		velocity1: 0,
		velocity2: 0,
		// 12 个点、每点 x/y，定长复用；trailHead 是下一个写入槽位。
		trail: new Float64Array(24),
		trailHead: 0,
		trailCount: 0,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		// 48px 天空区放不下 32px 全展开双摆，按 0.7 缩放，最长摆仍在框内。
		const scale = 0.7
		const length1 = (10 + 8 * level) * scale
		const length2 = (8 + 6 * level) * scale
		const gravity = 600 + 900 * level
		const damping = 0.02
		const substeps = 2
		const h = dt / substeps

		// 两根连杆各自按文档的单摆公式积分（半隐式欧拉）：
		// α = -(g/L)sinθ - 0.02ω。两个 L 不同 => 相位差持续漂移，轨迹越走越乱。
		for (let sub = 0; sub < substeps; sub += 1) {
			const speed = Math.abs(state.velocity1) + Math.abs(state.velocity2)
			const sustain = speed < 2.4 ? (2.4 - speed) * (0.5 + 0.5 * level) : 0
			const alpha1 =
				-(gravity / length1) * Math.sin(state.angle1) -
				damping * state.velocity1 +
				sustain
			const alpha2 =
				-(gravity / length2) * Math.sin(state.angle2) -
				damping * state.velocity2 -
				sustain * 0.8

			// 边界：角速度钳到 ±60 rad/s，避免数值爆炸。
			state.velocity1 = Math.max(-60, Math.min(60, state.velocity1 + alpha1 * h))
			state.velocity2 = Math.max(-60, Math.min(60, state.velocity2 + alpha2 * h))
			state.angle1 += state.velocity1 * h
			state.angle2 += state.velocity2 * h

			// 角度 wrap 到 ±π；不 wrap 会让 sin/cos 精度逐步漂掉。
			let wrapped1 = (state.angle1 + Math.PI) % TAU
			if (wrapped1 < 0) wrapped1 += TAU
			state.angle1 = wrapped1 - Math.PI
			let wrapped2 = (state.angle2 + Math.PI) % TAU
			if (wrapped2 < 0) wrapped2 += TAU
			state.angle2 = wrapped2 - Math.PI
		}

		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 48)
		const pivotX = width * 0.5
		const pivotY = boxTop + boxHeight * 0.5
		const tipX =
			pivotX + length1 * Math.sin(state.angle1) + length2 * Math.sin(state.angle2)
		const tipY =
			pivotY + length1 * Math.cos(state.angle1) + length2 * Math.cos(state.angle2)

		// 定长环形缓冲：只覆写槽位，不 push / shift / new。
		const slot = state.trailHead * 2
		state.trail[slot] = tipX
		state.trail[slot + 1] = tipY
		state.trailHead = (state.trailHead + 1) % 12
		if (state.trailCount < 12) state.trailCount += 1
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 48)
		const scale = 0.7
		const length1 = (10 + 8 * level) * scale
		const length2 = (8 + 6 * level) * scale
		const pivotX = width * 0.5
		const pivotY = boxTop + boxHeight * 0.5
		const jointX = pivotX + length1 * Math.sin(state.angle1)
		const jointY = pivotY + length1 * Math.cos(state.angle1)
		const tipX = jointX + length2 * Math.sin(state.angle2)
		const tipY = jointY + length2 * Math.cos(state.angle2)

		context.save()

		// 尾迹：从最旧的点画到最新的点，越新越亮。
		const count = state.trailCount
		context.fillStyle = accent
		for (let k = 0; k < count; k += 1) {
			const index = (state.trailHead - count + k + 24) % 12
			const px = state.trail[index * 2]
			const py = state.trail[index * 2 + 1]
			context.globalAlpha = 0.06 + 0.5 * ((k + 1) / count) * (0.6 + 0.4 * level)
			context.beginPath()
			context.arc(px, py, 0.9, 0, TAU)
			context.fill()
		}

		// 两段连杆。
		context.globalAlpha = 1
		context.strokeStyle = accent
		context.lineWidth = 1.3
		context.beginPath()
		context.moveTo(pivotX, pivotY)
		context.lineTo(jointX, jointY)
		context.lineTo(tipX, tipY)
		context.stroke()

		// 两颗摆锤 + 支点。
		context.fillStyle = accent
		context.globalAlpha = 0.95
		context.beginPath()
		context.arc(jointX, jointY, 2.2, 0, TAU)
		context.fill()
		context.beginPath()
		context.arc(tipX, tipY, 1.7, 0, TAU)
		context.fill()
		context.globalAlpha = 0.5
		context.beginPath()
		context.arc(pivotX, pivotY, 1.2, 0, TAU)
		context.fill()

		context.restore()
	},
}

/**
 * 沙漏动效 (hourglass) — physics class, docs/plan/01-effects-taxonomy.md §1.
 *
 * The upper chamber holds a cloud of waiting grains; they are released through
 * the narrow neck at `flow` grains/s, slide down the funnel, and clamp onto a
 * cone-shaped pile. `energy` drives the counts and the forces:
 *
 *   grains  N = 24 + 96e      (hard cap: the 120-slot pool)
 *   flow       = 12 + 90e     grains / s
 *   fall speed = 40 + 160e    px / s
 *   mouth      = 6 + 2e       px
 *
 * There is no grain-grain collision: a falling grain is clamped onto the pile
 * surface (a small height profile that deposits and diffuses into a cone), rests
 * briefly, then returns to the upper chamber. Everything is allocated in
 * createState — 120 grain objects, a 17 column pile and one LCG seed — so step()
 * only moves numbers around: no per-frame particles, no array slicing, no timers.
 *
 * layout `30/bar/off`: 30px of sky, the DOM bar stays, no DOM spectrum.
 */
const hourglassEffect = {
	id: 'hourglass',
	name: '沙漏动效',
	summary: '沙粒从窄口落下，在底部堆成锥形；档位越高沙越多、落得越快',
	layout: { sky: 30, band: 0, track: 'bar', spectrum: false },

	createState() {
		const grains = []
		for (let index = 0; index < 120; index += 1) {
			grains.push({
				live: false,
				queued: false,
				// 0 = waiting in the upper chamber, 1 = falling, 2 = settled on the pile.
				mode: 0,
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				rest: 0,
				// A stable 0..1 hash per grain: keeps the pile texture deterministic.
				jitter: (index * 0.6180339887) % 1,
			})
		}
		const pile = []
		for (let column = 0; column < 17; column += 1) pile.push(0)
		return { seed: 0x2f6e2b1, emit: 0, grains, pile }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return

		const width = Math.max(1, Number(frame.width) || 0)
		const height = Math.max(1, Number(frame.height) || 0)
		const sky = Number(frame.sky ?? frame.band?.top ?? 0)
		const declaredTrack = Number(frame.trackY ?? sky + Number(frame.band?.height ?? 30) + 16)
		// The scene stands on top of the DOM bar (trackY - 4 is the bar's top edge).
		const floor = Math.max(8, Math.min(height, Number.isFinite(declaredTrack) ? declaredTrack : height - 42) - 4)
		const bodyHeight = Math.max(6, Math.min(38, floor - 2))
		const top = Math.max(0, floor - bodyHeight)
		const centerX = width * 0.5
		const halfWidth = Math.max(8, Math.min(34, width * 0.5 - 6, bodyHeight * 0.95))
		const neckY = top + bodyHeight * 0.5
		const mouth = 6 + 2 * energy
		const flow = 12 + 90 * energy
		const fallSpeed = 40 + 160 * energy
		const target = Math.round(24 + 96 * energy)
		const lowerHeight = Math.max(1, floor - neckY)
		// Taller cone at higher levels, a modest heap at the low end.
		const maxPile = lowerHeight * (0.34 + 0.3 * energy)
		const grains = state.grains
		const pile = state.pile

		// --- bookkeeping: who is alive, who is waiting for a free pool slot -----
		let live = 0
		let queued = 0
		for (let index = 0; index < grains.length; index += 1) {
			if (grains[index].live) live += 1
			else if (grains[index].queued) queued += 1
		}

		// A falling level drops grains from the tail of the pool.
		for (let index = grains.length - 1; index >= 0 && live + queued > target; index -= 1) {
			const grain = grains[index]
			if (grain.queued) {
				grain.queued = false
				queued -= 1
				continue
			}
			if (!grain.live) continue
			grain.live = false
			live -= 1
		}

		// A rising level (and the very first frame) fills the upper chamber at once.
		for (let index = 0; index < grains.length && live + queued < target; index += 1) {
			const grain = grains[index]
			if (grain.live || grain.queued) continue
			grain.queued = true
			queued += 1
		}

		// --- integrate: waiting grains hold still, falling grains move ---------
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode === 0) continue
			if (grain.mode === 2) {
				grain.rest -= dt
				if (grain.rest <= 0) {
					// Recycled: the cone keeps its shape, the grain returns to the top.
					grain.live = false
					grain.queued = true
					live -= 1
					queued += 1
				}
				continue
			}
			grain.x += grain.vx * dt
			grain.y += grain.vy * dt
			if (grain.y < neckY) {
				// The funnel wall narrows towards the mouth and pushes sand inwards.
				const depth = clamp01((grain.y - top) / Math.max(1, neckY - top))
				const limit = halfWidth + (mouth * 0.5 - halfWidth) * depth
				const offset = grain.x - centerX
				if (offset > limit) {
					grain.x = centerX + limit
					grain.vx = -Math.abs(grain.vx) * 0.25
				} else if (offset < -limit) {
					grain.x = centerX - limit
					grain.vx = Math.abs(grain.vx) * 0.25
				}
				continue
			}
			let column = Math.floor(((grain.x - (centerX - halfWidth)) / Math.max(1, 2 * halfWidth)) * 17)
			if (!Number.isFinite(column) || column < 0) column = 0
			else if (column > 16) column = 16
			const surface = floor - pile[column]
			if (grain.y < surface - 0.5) continue
			// Clamp onto the pile surface instead of colliding with other grains.
			grain.x = Math.min(centerX + halfWidth * 0.94, Math.max(centerX - halfWidth * 0.94, grain.x))
			grain.y = Math.max(top, surface - 0.5 - grain.jitter * 1.4)
			grain.vx = 0
			grain.vy = 0
			grain.mode = 2
			grain.rest = (0.35 + 0.55 * ((grain.jitter + 0.37) % 1)) * (1 - 0.2 * energy)
			pile[column] = Math.min(maxPile, pile[column] + 0.44)
			if (column > 0) pile[column - 1] = Math.min(maxPile, pile[column - 1] + 0.2)
			if (column < 16) pile[column + 1] = Math.min(maxPile, pile[column + 1] + 0.2)
		}

		// --- spawn: newly queued grains wait in the upper chamber ---------------
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.queued) continue
			state.seed = (state.seed * 1664525 + 1013904223) >>> 0
			const r1 = state.seed / 4294967296
			state.seed = (state.seed * 1664525 + 1013904223) >>> 0
			const r2 = state.seed / 4294967296
			const y = top + 1 + r1 * Math.max(1, neckY - top - 3)
			const depth = clamp01((y - top) / Math.max(1, neckY - top))
			const limit = (halfWidth + (mouth * 0.5 - halfWidth) * depth) * 0.78
			grain.queued = false
			grain.live = true
			grain.mode = 0
			grain.x = centerX + (r2 * 2 - 1) * limit
			grain.y = y
			grain.vx = 0
			grain.vy = 0
			grain.rest = 0
		}

		// --- release: the flow rate empties the chamber, lowest grain first -----
		state.emit = Math.min(3, state.emit + flow * dt)
		while (state.emit >= 1) {
			let candidate = null
			for (let index = 0; index < grains.length; index += 1) {
				const grain = grains[index]
				if (!grain.live || grain.mode !== 0) continue
				if (candidate === null || grain.y > candidate.y) candidate = grain
			}
			if (candidate === null) break
			candidate.mode = 1
			candidate.vx = (candidate.jitter * 2 - 1) * 5
			candidate.vy = fallSpeed * (0.85 + 0.3 * candidate.jitter)
			state.emit -= 1
		}
		if (state.emit >= 1) state.emit = Math.min(state.emit, 1)

		// --- the pile profile diffuses into a cone, then clamps -----------------
		// A gentle single pass: faster diffusion would flatten the cone and leak
		// the low-energy pile out through the glass walls before it reads.
		for (let column = 1; column < 16; column += 1) {
			pile[column] += ((pile[column - 1] + pile[column + 1]) * 0.5 - pile[column]) * 0.08
		}
		for (let column = 0; column < 17; column += 1) {
			const value = pile[column]
			pile[column] = value > maxPile ? maxPile : value > 0 ? value : 0
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const height = Math.max(1, Number(frame.height) || 0)
		const sky = Number(frame.sky ?? frame.band?.top ?? 0)
		const declaredTrack = Number(frame.trackY ?? sky + Number(frame.band?.height ?? 30) + 16)
		const floor = Math.max(8, Math.min(height, Number.isFinite(declaredTrack) ? declaredTrack : height - 42) - 4)
		const bodyHeight = Math.max(6, Math.min(38, floor - 2))
		const top = Math.max(0, floor - bodyHeight)
		const centerX = width * 0.5
		const halfWidth = Math.max(8, Math.min(34, width * 0.5 - 6, bodyHeight * 0.95))
		const neckY = top + bodyHeight * 0.5
		const mouth = 6 + 2 * energy
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const upperControl = halfWidth * 0.62
		const leftNeck = centerX - mouth * 0.5
		const rightNeck = centerX + mouth * 0.5
		const capWidth = (halfWidth + 3) * 2

		// Wooden caps: top and bottom of the glass.
		context.fillStyle = withAlpha(accent, 0.55)
		context.fillRect(centerX - halfWidth - 3, Math.max(0, top - 2), capWidth, 2)
		context.fillRect(centerX - halfWidth - 3, Math.max(0, floor - 1), capWidth, 2)

		// Glass silhouette: a glowing 3px understroke and a crisp 1px line.
		context.strokeStyle = withAlpha(accent, 0.16)
		context.lineWidth = 3
		context.beginPath()
		context.moveTo(centerX - halfWidth, top)
		context.quadraticCurveTo(centerX - upperControl, neckY - bodyHeight * 0.16, leftNeck, neckY)
		context.quadraticCurveTo(centerX - upperControl, neckY + bodyHeight * 0.16, centerX - halfWidth, floor)
		context.moveTo(centerX + halfWidth, top)
		context.quadraticCurveTo(centerX + upperControl, neckY - bodyHeight * 0.16, rightNeck, neckY)
		context.quadraticCurveTo(centerX + upperControl, neckY + bodyHeight * 0.16, centerX + halfWidth, floor)
		context.stroke()

		context.strokeStyle = withAlpha(accent, 0.46)
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(centerX - halfWidth, top)
		context.quadraticCurveTo(centerX - upperControl, neckY - bodyHeight * 0.16, leftNeck, neckY)
		context.quadraticCurveTo(centerX - upperControl, neckY + bodyHeight * 0.16, centerX - halfWidth, floor)
		context.moveTo(centerX + halfWidth, top)
		context.quadraticCurveTo(centerX + upperControl, neckY - bodyHeight * 0.16, rightNeck, neckY)
		context.quadraticCurveTo(centerX + upperControl, neckY + bodyHeight * 0.16, centerX + halfWidth, floor)
		context.stroke()

		// The pile cone: a filled profile under the surface line.
		const pile = state.pile
		const columnWidth = (2 * halfWidth) / 16
		context.beginPath()
		context.moveTo(centerX - halfWidth, floor)
		for (let column = 0; column < 17; column += 1) {
			const heightValue = pile[column] > 0 ? pile[column] : 0
			context.lineTo(centerX - halfWidth + columnWidth * column, floor - heightValue)
		}
		context.lineTo(centerX + halfWidth, floor)
		context.closePath()
		context.fillStyle = withAlpha(accent, 0.2 + 0.12 * energy)
		context.fill()

		// Grains: waiting in the chamber, falling through the neck, settled on the
		// pile. Three passes keep the fill style constant, all rects are 1px.
		const grains = state.grains
		context.fillStyle = accent
		context.globalAlpha = 0.5
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 0) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 0.75 + 0.25 * energy
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 1) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 0.55
		for (let index = 0; index < grains.length; index += 1) {
			const grain = grains[index]
			if (!grain.live || grain.mode !== 2) continue
			context.fillRect(grain.x, grain.y, 1, 1)
		}
		context.globalAlpha = 1
	},
}

/**
 * 弹簧网格 (spring-mesh)
 *
 * 视觉机制：8×3 = 24 个节点的线框网格被中心冲量激起，节点在弹簧力下向静止位
 * 回弹，波沿上下左右的邻接边扩散；档位越高刚度越大、阻尼越小、冲量越猛，网格
 * 抖得越久越碎。
 *
 * 能量映射：刚度 k = 0.15 + 0.85e；阻尼 0.86 + 0.1e；中心冲量 2 + 14e。
 * 积分固定 1/60 步长（不跟着 host 的 dt 变），位移 clamp 在 band 内，避免数值
 * 爆炸或飞出画布。
 * 布局：0/bar/on —— 占用 30px band，保留 DOM 直条与频谱柱。
 *
 * 24 个节点与两个加速度缓冲都在 createState 里一次性建好，step/paint 不分配
 * 数组或对象；耦合用 Jacobi 方式先算完所有加速度再统一积分，比逐个就地更新稳。
 */
const springMeshEffect = {
	id: 'spring-mesh',
	name: '弹簧网格',
	summary: '8×3 节点网格被中心冲量激起，向静止位回弹、波沿邻接边扩散',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: true },

	createState: () => {
		// 24 个节点，col/row 固定，x/y 是当前位移，vx/vy 是速度。
		const nodes = []
		for (let index = 0; index < 24; index += 1) {
			nodes.push({ col: index % 8, row: Math.floor(index / 8), x: 0, y: 0, vx: 0, vy: 0 })
		}
		// 加速度缓冲预分配，整帧复用。
		return {
			nodes,
			ax: new Float64Array(24),
			ay: new Float64Array(24),
			ready: false,
			accum: 0,
			kickClock: 0,
			lastEnergy: -1,
		}
	},

	step(state, frame) {
		const STEP = 1 / 60
		const dt = Math.max(0.001, Math.min(0.1, frame.dt ?? STEP))
		state.accum = (state.accum ?? 0) + dt
		let steps = Math.min(4, Math.floor(state.accum / STEP))
		if (steps === 0 && !state.ready) steps = 1
		state.accum -= steps * STEP
		for (let subStep = 0; subStep < steps; subStep += 1) {
			const energy = clamp01(frame.energy ?? 0)
			const width = Math.max(1, frame.width ?? 284)
			const bandTop = frame.band?.top ?? frame.sky ?? 0
			const bandHeight = Math.max(1, frame.band?.height ?? 30)
			const stiffness = 0.15 + 0.85 * energy
			const damping = 0.86 + 0.1 * energy
			const impulse = 2 + 14 * energy
			// 邻接耦合系数：只做 1 环差分，够让波沿边扩散，又不会把显式积分推爆。
			const coupling = 0.12 + 0.1 * energy
			const maxSpeed = 6 + 24 * energy
			const margin = 12
			const gapX = Math.max(1, width - margin * 2) / 7
			const padY = 5
			const gapY = Math.max(1, bandHeight - padY * 2) / 2
			const nodes = state.nodes
			const ax = state.ax
			const ay = state.ay

			// 首帧先把节点摆到静止位，并且立刻敲一下：prefers-reduced-motion 只画
			// 一帧，t=0 就必须能看到波，不能等 0.9s 后的第一次泵浦。
			let kick = 0
			if (!state.ready) {
				for (let index = 0; index < nodes.length; index += 1) {
					const node = nodes[index]
					node.x = margin + node.col * gapX
					node.y = bandTop + padY + node.row * gapY
					node.vx = 0
					node.vy = 0
				}
				state.ready = true
				state.lastEnergy = energy
				state.kickClock = 0
				kick = 1
			} else if (Math.abs(energy - state.lastEnergy) > 0.02) {
				// 换档也算一次冲量，让「档位一变，网格立刻被敲一下」。
				state.lastEnergy = energy
				state.kickClock = 0
				kick = 0.85
			}
			state.kickClock += STEP
			// 周期泵浦：回弹快停下来时再敲一次，画面不会死掉。
			const interval = 0.9 - 0.45 * energy
			if (state.kickClock >= interval) {
				state.kickClock -= interval
				kick = Math.max(kick, 0.8)
			}

			if (kick > 0) {
				// 中心冲量：只敲中间一行（靠近中心的列最强），上下两行靠耦合被带起来。
				const strength = impulse * kick
				for (let index = 0; index < nodes.length; index += 1) {
					const node = nodes[index]
					const dx = (node.col - 3.5) / 3.5
					const dy = node.row - 1
					const falloff = Math.max(0, 1 - (dx * dx + dy * dy))
					if (falloff <= 0) continue
					node.vx += dx * strength * 0.45 * falloff
					node.vy += (node.row === 1 ? -1 : 0.55) * strength * 0.8 * falloff
				}
			}

			// 先算所有节点的加速度（Jacobi）：弹簧力拉回静止位，邻接差分把波传出去。
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index]
				const selfX = node.x - (margin + node.col * gapX)
				const selfY = node.y - (bandTop + padY + node.row * gapY)
				let forceX = -selfX * stiffness
				let forceY = -selfY * stiffness

				if (node.col > 0) {
					const other = nodes[index - 1]
					forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
					forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
				}
				if (node.col < 7) {
					const other = nodes[index + 1]
					forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
					forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
				}
				if (node.row > 0) {
					const other = nodes[index - 8]
					forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
					forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
				}
				if (node.row < 2) {
					const other = nodes[index + 8]
					forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
					forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
				}

				ax[index] = forceX
				ay[index] = forceY
			}

			// 再统一积分（半隐式欧拉），阻尼吃掉能量，位移 clamp 在 band 内。
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index]
				node.vx = (node.vx + ax[index]) * damping
				node.vy = (node.vy + ay[index]) * damping
				// 速度钳位只是积分保险，真正的边界是下面的位移 clamp。
				node.vx = Math.max(-maxSpeed, Math.min(maxSpeed, node.vx))
				node.vy = Math.max(-maxSpeed, Math.min(maxSpeed, node.vy))
				node.x += node.vx
				node.y += node.vy

				// 撞边时清掉法向速度，避免贴边抖动。
				if (node.x < 0) {
					node.x = 0
					node.vx = 0
				} else if (node.x > width) {
					node.x = width
					node.vx = 0
				}
				if (node.y < bandTop) {
					node.y = bandTop
					node.vy = 0
				} else if (node.y > bandTop + bandHeight) {
					node.y = bandTop + bandHeight
					node.vy = 0
				}
			}
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const nodes = state.nodes
		const radius = 1 + 1.6 * energy

		context.save()

		// 线框：先横边（每行 7 条），再竖边（每列 2 条）。
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.3 + 0.25 * energy)
		context.beginPath()
		for (let row = 0; row < 3; row += 1) {
			for (let col = 0; col < 7; col += 1) {
				const a = nodes[row * 8 + col]
				const b = nodes[row * 8 + col + 1]
				context.moveTo(a.x, a.y)
				context.lineTo(b.x, b.y)
			}
		}
		for (let row = 0; row < 2; row += 1) {
			for (let col = 0; col < 8; col += 1) {
				const a = nodes[row * 8 + col]
				const b = nodes[(row + 1) * 8 + col]
				context.moveTo(a.x, a.y)
				context.lineTo(b.x, b.y)
			}
		}
		context.stroke()

		// 节点：档位越高越大，和线框一起读作「抖动强度」。
		context.fillStyle = accent
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index]
			context.beginPath()
			context.arc(node.x, node.y, radius, 0, Math.PI * 2)
			context.fill()
		}

		context.restore()
	},
}

/**
 * Verlet 绳索 (verlet-rope) — docs/plan/01-effects-taxonomy.md §1 物理仿真.
 *
 * A rope is strung across the canvas, pinned at both ends: gravity makes it hang
 * in a shallow catenary, a travelling `sin(t)` gust pushes its middle around, and
 * two distance-constraint passes keep the 12px links together. Higher energy adds
 * gravity (400 + 800e), wind (20 + 120e) and slack, so the rope hangs deeper and
 * sways harder instead of just moving faster.
 *
 * This file is a SNIPPET: it is injected verbatim into the plugin module scope,
 * so it must stay a single top-level declaration. Around it the host provides the
 * math built-ins, the Canvas 2D API and `clamp01(x)` / `withAlpha(color, a)`. The
 * host owns the canvas, the DPR transform, clearRect and the rAF loop, so this
 * effect never starts a timer, imports anything, uses Math.random(), shadowBlur,
 * or allocates arrays/objects inside step/paint.
 *
 * frame = { energy, accent, totalLevels, width, height, dt, band, sky, trackY,
 *           rail, artBox }. With layout { sky: 30, band: 0 } the canvas is 88px
 * tall (sky + band + rail) but the rope belongs in the 30px sky strip above the
 * track, i.e. inside frame.artBox — so the rig is sized from artBox, not from
 * frame.height, and it still works on a bare 30px canvas.
 */
const verletRopeEffect = {
	id: 'verlet-rope',
	name: 'Verlet 绳索',
	summary: '两端固定的绳横跨画布，重力下垂、风力推摆，档位越高风越猛、绳越松',
	layout: { sky: 30, band: 0, track: 'bar', spectrum: false },

	createState() {
		// 18 points, each keeping its previous position (Verlet integration).
		// These four arrays are the only allocation this effect ever makes.
		const points = 18
		return {
			t: 0,
			ready: false,
			width: 0,
			boxHeight: 0,
			x: new Array(points).fill(0),
			y: new Array(points).fill(0),
			prevX: new Array(points).fill(0),
			prevY: new Array(points).fill(0),
		}
	},

	step(state, frame) {
		const points = state.x.length
		const links = points - 1
		const dt = Math.min(1 / 30, Math.max(1 / 240, Number(frame.dt) || 1 / 60))
		const energy = clamp01(frame.energy ?? 0)
		state.t = (state.t + dt) % (Math.PI * 2 * 1000)

		const width = Math.max(24, Number(frame.width) || 284)
		const boxTop = Number(frame.artBox?.top ?? 0)
		const boxHeight = Math.max(
			14,
			Number(frame.artBox?.height ?? frame.sky ?? frame.height ?? 30)
		)

		// 12px per link as specified (17 x 12 = 204px). A narrower panel squeezes
		// the links just enough for the pins to stay inside the canvas.
		const segment = Math.min(12, (width - 16) / links)
		// The rope is a few pixels longer than the gap between its pins, so it
		// hangs in a shallow catenary and higher levels get more slack ("绳越松").
		const slack = segment * (0.14 + 0.08 * energy)
		const span = links * segment - slack
		const left = (width - span) * 0.5
		const pinY = boxTop + boxHeight * 0.1

		// First frame, or the host resized: lay the rope on a resting curve without
		// touching the integrator arrays.
		if (!state.ready || state.width !== width || state.boxHeight !== boxHeight) {
			state.ready = true
			state.width = width
			state.boxHeight = boxHeight
			for (let index = 0; index < points; index += 1) {
				const along = index / links
				state.x[index] = left + span * along
				state.y[index] = pinY + Math.sin(Math.PI * along) * segment * 0.9
				state.prevX[index] = state.x[index]
				state.prevY[index] = state.y[index]
			}
		}

		const gravity = 400 + 800 * energy
		// The sky strip is only 30px tall and the rope hangs almost taut, so at the
		// literal 20..140 px/s² a gust is swallowed by the 400..1200 px/s² gravity.
		// The mapping is kept as specified and scaled once, here, so the sway is
		// actually legible at panel size (and still gentle at rest).
		const wind = (20 + 120 * energy) * 10
		// Fixed sub-step duration (~1/480s): the constraint stiffness then stays the
		// same whether the host runs at 30, 60 or 120fps, and dt can never blow the
		// rope up. dt is already clamped to 1/30s, so this stays within 2..16.
		const substeps = Math.max(1, Math.min(16, Math.ceil(dt * 480)))
		const step = dt / substeps
		const step2 = step * step
		const damping = Math.pow(0.985, 1 / substeps)

		for (let sub = 0; sub < substeps; sub += 1) {
			// Verlet: position + (position - previous) * damping + accel * step².
			// The wind is a travelling sine wave along the rope — deterministic,
			// never Math.random() — so the same time/energy always looks the same.
			// The horizontal push makes the sag swing, the vertical part ripples it.
			for (let index = 1; index < links; index += 1) {
				const x = state.x[index]
				const y = state.y[index]
				const gust =
					Math.sin(state.t * 1.9 + index * 0.34) * 0.6 +
					Math.sin(state.t * 0.73 + index * 0.18 + 1.7) * 0.22 +
					Math.sin(state.t * 2.9 + index * 0.5 + 3.4) * 0.18
				const lift =
					Math.sin(state.t * 1.16 + index * 0.17) * 0.6 +
					Math.sin(state.t * 0.44 + index * 0.09 + 2.3) * 0.22 +
					Math.sin(state.t * 1.77 + index * 0.25 + 4.1) * 0.18
				const vx = (x - state.prevX[index]) * damping
				const vy = (y - state.prevY[index]) * damping
				state.prevX[index] = x
				state.prevY[index] = y
				state.x[index] = x + vx + wind * gust * step2
				state.y[index] = y + vy + (gravity + wind * lift * 0.4) * step2
			}

			// Pins own their positions; zero their velocity so they never drift.
			state.x[0] = left
			state.y[0] = pinY
			state.prevX[0] = left
			state.prevY[0] = pinY
			state.x[links] = left + span
			state.y[links] = pinY
			state.prevX[links] = left + span
			state.prevY[links] = pinY

			// Two passes of distance constraints, the second walked right to left so
			// the correction reaches the middle from both pins (2 iterations is the
			// documented budget; fewer visibly stretches the rope).
			for (let pass = 0; pass < 2; pass += 1) {
				for (let stepIndex = 0; stepIndex < links; stepIndex += 1) {
					const index = pass === 0 ? stepIndex : links - 1 - stepIndex
					const next = index + 1
					const ax = state.x[index]
					const ay = state.y[index]
					const bx = state.x[next]
					const by = state.y[next]
					const dx = bx - ax
					const dy = by - ay
					const distance = Math.sqrt(dx * dx + dy * dy) || 1e-4
					const pull = (distance - segment) / distance
					const cx = dx * pull
					const cy = dy * pull
					const firstFree = index !== 0
					const secondFree = next !== links
					if (!firstFree && !secondFree) continue
					if (!firstFree) {
						state.x[next] = bx - cx
						state.y[next] = by - cy
					} else if (!secondFree) {
						state.x[index] = ax + cx
						state.y[index] = ay + cy
					} else {
						state.x[index] = ax + cx * 0.5
						state.y[index] = ay + cy * 0.5
						state.x[next] = bx - cx * 0.5
						state.y[next] = by - cy * 0.5
					}
				}
			}
		}

		// Safety rail: a hard gust may not push the rope out of its strip.
		const minX = 1
		const maxX = width - 1
		const minY = boxTop + 1
		const maxY = boxTop + boxHeight - 1
		for (let index = 1; index < links; index += 1) {
			if (state.x[index] < minX) state.x[index] = minX
			else if (state.x[index] > maxX) state.x[index] = maxX
			if (state.y[index] < minY) state.y[index] = minY
			else if (state.y[index] > maxY) state.y[index] = maxY
		}
		// The pins are placed last so clamping can never move them.
		state.x[0] = left
		state.x[links] = left + span
		state.y[0] = pinY
		state.y[links] = pinY
	},

	paint(context, state, frame) {
		const points = state.x.length
		const energy = clamp01(frame.energy ?? 0)
		const accent =
			typeof frame.accent === 'string' && frame.accent.length > 0
				? frame.accent
				: 'rgb(120, 200, 255)'

		// One path, two strokes: a soft halo under the crisp rope. `stroke()` keeps
		// the current path, so this costs no rebuilding and no arrays.
		context.beginPath()
		context.moveTo(state.x[0], state.y[0])
		for (let index = 1; index < points; index += 1) {
			context.lineTo(state.x[index], state.y[index])
		}
		context.lineCap = 'round'
		context.lineJoin = 'round'

		context.strokeStyle = withAlpha(accent, 0.16 + 0.14 * energy)
		context.lineWidth = 3.2 + 1.8 * energy
		context.stroke()

		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.1 + 0.8 * energy
		context.stroke()

		// Both pins, so the rope reads as fixed rather than floating.
		const pinRadius = 1.6 + 0.5 * energy
		context.fillStyle = withAlpha(accent, 0.92)
		context.beginPath()
		context.moveTo(state.x[0] + pinRadius, state.y[0])
		context.arc(state.x[0], state.y[0], pinRadius, 0, Math.PI * 2)
		context.moveTo(state.x[points - 1] + pinRadius, state.y[points - 1])
		context.arc(state.x[points - 1], state.y[points - 1], pinRadius, 0, Math.PI * 2)
		context.fill()

		context.lineWidth = 1
		context.globalAlpha = 1
	},
}

/**
 * 陀螺进动 (gyroscope)
 *
 * 视觉机制：一枚椭圆陀螺躺在虚线圆环上，沿环缓缓进动，同时自身高速自旋；
 * 一根轴线从陀螺中心穿出并按倾角倾斜。档位越高，自旋与进动越快、倾角越大、
 * 圆环半径越大。
 *
 * 能量映射：自旋 3 + 15e rad/s、进动 0.2 + 1.4e rad/s、
 *          倾角 0.15 + 0.5e rad、环半径 6 + 10e。
 * 布局：20/bar/off —— 只在 20px 天空区内作画，不占 band、不显示频谱。
 *
 * 纯参数方程：state 只存自旋/进动两个角度，paint 里按当前 angle 求位置；
 * 虚线环用固定 48 段、每 4 段亮 2 段的索引模式绘制，不建 Path2D、不 new 数组。
 */
const gyroscopeEffect = {
	id: 'gyroscope',
	name: '陀螺进动',
	summary: '椭圆陀螺沿虚线圆环进动，档位越高自旋越快、倾角越狠、环越大',
	layout: { sky: 20, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ spin: 0, precession: 0 }),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.spin = (state.spin + (3 + 15 * level) * dt) % TAU
		state.precession = (state.precession + (0.2 + 1.4 * level) * dt) % TAU
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 20)
		const centerX = width * 0.5
		const centerY = boxTop + boxHeight * 0.51

		const ringRadius = 6 + 10 * level
		// 俯视圆的透视压扁 + 轴长收紧：20px 天空区里上下都不出框。
		const ringSquash = 0.26
		const ringRadiusY = ringRadius * ringSquash
		const tilt = 0.15 + 0.5 * level
		// 盘身随环半径一起长大，避免 e=0 时陀螺把整个小环盖住。
		const bodyRadiusX = 3.2 + 2.3 * level
		const bodyRadiusY = 1.9 + 1 * level
		// 轴线必须比盘身长一点，才能从盘面两侧探出来。
		const axisLength = bodyRadiusX + 0.9

		context.save()

		// 虚线圆环：48 段，i % 4 < 2 的段可见（固定 dash 模式，无数组分配）。
		const segments = 48
		const segmentAngle = TAU / segments
		context.beginPath()
		for (let i = 0; i < segments; i += 1) {
			if (i % 4 >= 2) continue
			const from = i * segmentAngle
			const to = from + segmentAngle
			context.moveTo(
				centerX + Math.cos(from) * ringRadius,
				centerY + Math.sin(from) * ringRadiusY
			)
			context.lineTo(
				centerX + Math.cos(to) * ringRadius,
				centerY + Math.sin(to) * ringRadiusY
			)
		}
		context.strokeStyle = withAlpha(accent, 0.26 + 0.2 * level)
		context.lineWidth = 1
		context.stroke()

		// 陀螺在环上的进动位置。
		const gyroX = centerX + Math.cos(state.precession) * ringRadius
		const gyroY = centerY + Math.sin(state.precession) * ringRadiusY
		// 盘面随倾角一起偏转（轴线是盘面法线，两者角度一致）。
		const bodyAngle = tilt

		context.save()
		context.translate(gyroX, gyroY)
		context.rotate(bodyAngle)

		// 椭圆盘身，用 24 段折线近似，走 preview 也支持的原语。
		context.beginPath()
		for (let i = 0; i <= 24; i += 1) {
			const angle = (i / 24) * TAU
			const pointX = Math.cos(angle) * bodyRadiusX
			const pointY = Math.sin(angle) * bodyRadiusY
			if (i === 0) context.moveTo(pointX, pointY)
			else context.lineTo(pointX, pointY)
		}
		context.closePath()
		context.fillStyle = withAlpha(accent, 0.16 + 0.2 * level)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.72)
		context.lineWidth = 1
		context.stroke()

		// 自旋：盘面内一根随 spin 角转动的辐条。
		const spokeX = Math.cos(state.spin) * (bodyRadiusX - 1.1)
		const spokeY = Math.sin(state.spin) * (bodyRadiusY - 0.6)
		context.beginPath()
		context.moveTo(-spokeX, -spokeY)
		context.lineTo(spokeX, spokeY)
		context.strokeStyle = withAlpha(accent, 0.45 + 0.25 * level)
		context.lineWidth = 1
		context.stroke()

		context.restore()

		// 轴线：穿过盘心，按倾角偏离竖直方向。
		const axisX = Math.sin(tilt) * axisLength
		const axisY = Math.cos(tilt) * axisLength
		context.beginPath()
		context.moveTo(gyroX - axisX, gyroY + axisY)
		context.lineTo(gyroX + axisX, gyroY - axisY)
		context.strokeStyle = withAlpha(accent, 0.5 + 0.35 * level)
		context.lineWidth = 1.2
		context.stroke()

		// 轴顶亮点 + 盘心。
		context.fillStyle = accent
		context.globalAlpha = 0.85
		context.beginPath()
		context.arc(gyroX + axisX, gyroY - axisY, 0.9, 0, TAU)
		context.fill()
		context.globalAlpha = 0.6
		context.beginPath()
		context.arc(gyroX, gyroY, 0.8, 0, TAU)
		context.fill()
		context.globalAlpha = 1

		context.restore()
	},
}

/**
 * 磁力轨道 (magnetic-orbits)
 *
 * 视觉机制：两个磁极并排立在 band 底部，粒子沿各自磁极上方的椭圆轨道绕行，
 * 像被场线约束的带电尘埃。档位越高粒子越多、角速度越快、轨道半径越大。
 *
 * 能量映射：粒子数 N = 6 + 8e（最多 14）；角速度 ω = 1.5 + 4e；第 i 个粒子的
 * 轨道半径 r = 6 + 12e·(i/N)；电荷 q = 0.3 + 1.7e 只影响点的大小与亮度。
 * 只推进角度，不做真实 N-body，也不做除零：N 下限为 6。
 * 布局：0/bar/on —— 占用 30px band，保留 DOM 直条与频谱柱。
 *
 * 14 个粒子在 createState 里预分配，step/paint 不建数组、不建对象。
 */
const magneticOrbitsEffect = {
	id: 'magnetic-orbits',
	name: '磁力轨道',
	summary: '两个磁极上方 6~14 个粒子沿椭圆轨道绕行，档位越高越快越大',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: true },

	createState: () => {
		const TAU = Math.PI * 2
		const golden = 2.399963229728653
		const particles = []
		for (let index = 0; index < 14; index += 1) {
			// 黄金角起始相位，14 个粒子一开始就错开，不会重叠在一条线上。
			particles.push({ angle: (index * golden) % TAU, pole: index % 2 })
		}
		return { particles, count: 6, energy: 0 }
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const omega = 1.5 + 4 * energy
		const particles = state.particles

		// 只推进角度：两个磁极方向相反，像两组反向绕行的场线。
		for (let index = 0; index < particles.length; index += 1) {
			const particle = particles[index]
			const direction = particle.pole === 0 ? 1 : -1
			particle.angle = (particle.angle + direction * omega * dt) % TAU
			if (particle.angle < 0) particle.angle += TAU
		}

		state.energy = energy
		state.count = 6 + 8 * energy
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const particles = state.particles
		// N 是连续值：整数部分画实点，小数部分给下一个点淡入。
		const target = 6 + 8 * energy
		const full = Math.min(14, Math.floor(target))
		const partial = target - full
		const N = Math.max(6, target)
		const poleY = bandTop + bandHeight - 4
		const poleLeft = width * 0.32
		const poleRight = width * 0.68
		const charge = 0.3 + 1.7 * energy
		const dot = 0.9 + 1.5 * energy

		context.save()

		// 场线：每个磁极一圈最大的椭圆轨道，静态描边，读作磁场边界。
		const fieldX = 6 + 12 * energy
		const fieldY = Math.max(1.5, fieldX * 0.42)
		const fieldCenterY = poleY - 5 - fieldY
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.16 + 0.1 * energy)
		for (let pole = 0; pole < 2; pole += 1) {
			const poleX = pole === 0 ? poleLeft : poleRight
			context.beginPath()
			context.ellipse(poleX, fieldCenterY, fieldX, fieldY, 0, 0, TAU)
			context.stroke()
		}

		// 两个磁极：外环 + 磁芯，档位越高越亮。
		for (let pole = 0; pole < 2; pole += 1) {
			const poleX = pole === 0 ? poleLeft : poleRight
			context.fillStyle = withAlpha(accent, 0.22 + 0.2 * energy)
			context.beginPath()
			context.arc(poleX, poleY, 4.5, 0, TAU)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.55 + 0.35 * energy)
			context.beginPath()
			context.arc(poleX, poleY, 2.6, 0, TAU)
			context.stroke()
			context.fillStyle = accent
			context.beginPath()
			context.arc(poleX, poleY, 1.1, 0, TAU)
			context.fill()
		}

		// 粒子：椭圆轨道，半径随档位与序号变大，只读 angle 不做互斥。
		const visible = full + (partial > 0 ? 1 : 0)
		context.fillStyle = accent
		for (let index = 0; index < visible; index += 1) {
			const particle = particles[index]
			const poleX = particle.pole === 0 ? poleLeft : poleRight
			const orbitX = 6 + 12 * energy * (index / N)
			const orbitY = Math.max(1.5, orbitX * 0.42)
			const centerY = poleY - 5 - orbitY
			const px = poleX + Math.cos(particle.angle) * orbitX
			const py = centerY + Math.sin(particle.angle) * orbitY
			context.globalAlpha = index < full ? 0.55 + 0.45 * charge : Math.max(0.08, partial * 0.55)
			context.beginPath()
			context.arc(px, py, dot * (1 - 0.35 * (index / N)), 0, TAU)
			context.fill()
		}
		context.globalAlpha = 1

		context.restore()
	},
}

/**
 * 多米诺动效 (dominoes) — physics class, docs/plan/01-effects-taxonomy.md §1.
 *
 * A row of tiles stands on the track and topples left to right; the last one
 * rebounds off its stop, then the row quietly rebuilds. `energy` drives:
 *
 *   tiles   N = 8 + 24e              (8..32, hard cap: the preallocated 32)
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

		// The row is centred and grows with the tile count: 8 tiles = a compact
		// cluster, 32 tiles = the full width. Pitch never exceeds 1.25 x tile.
		const tileHeight = Math.max(5, Math.min(16, floor * 0.56))
		// Reserve the tile's fall reach on both sides: a flat tile extends one
		// tile-height to the right of its pivot.
		const margin = Math.max(10, tileHeight + 2)
		const pitch = Math.min(tileHeight * 1.25, Math.max(1, width - margin * 2) / Math.max(1, count - 1))
		const rowWidth = pitch * (count - 1)
		const left = (width - rowWidth) * 0.5
		const tileWidth = Math.max(1.5, Math.min(3, pitch * 0.3))
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

		const PHYSICS_EFFECTS = [doublePendulumEffect, hourglassEffect, springMeshEffect, verletRopeEffect, gyroscopeEffect, magneticOrbitsEffect, dominoesEffect]

		// ---- end physics effects ----

		/** Every effect the plugin knows. */
		const EFFECTS = [kunpengEffect, particleWaveEffect, ...PHYSICS_EFFECTS]

		/**
		 * Extra height an effect may add above the track, in CSS px. The particle
		 * effect needs none (its panel is the baseline 324 x 141); the pixel-art
		 * variant asks for a sky band so the creature sits ABOVE the bar instead
		 * of being crossed by it. Anything larger than this is clamped.
		 */
		const MAX_STAGE_SKY = 96

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
				{
					ref: panelRef,
					className: 'mec-panel',
					'data-dsh-mec': props.kind,
					role: props.role,
					'aria-label': props.ariaLabel,
					style: props.style,
				},
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
				const BAND_HEIGHT = Math.max(0, Number(layout.band ?? 30))
				const RAIL_HEIGHT = 58
				const TRACK_IN_RAIL = 16

				const draw = (delta) => {
					if (width === 0 || height === 0) return
					const { energy, accent, totalLevels } = paramsRef.current
					const dt = Math.min(0.033, Math.max(0.001, delta))
					const band = { top: sky, height: BAND_HEIGHT }
					const trackY = sky + BAND_HEIGHT + TRACK_IN_RAIL
					const frame = { energy, accent, totalLevels, width, height, dt, band, trackY, sky, rail: RAIL_HEIGHT, artBox: { top: 0, height: sky } }
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
			const bandHeight = Math.max(0, Number(layout.band ?? 30))
			const switchRef = react.useRef(null)
			const [menuOpen, setMenuOpen] = react.useState(false)
			const [menuRect, setMenuRect] = react.useState(null)

			const toggleMenu = () => {
				if (menuOpen) {
					setMenuOpen(false)
					return
				}
				const node = switchRef.current
				if (node !== null) setMenuRect(node.getBoundingClientRect())
				setMenuOpen(true)
			}

			const chooseEffect = (id) => {
				setEffectId(id)
				writeStoredEffectId(id)
				setMenuOpen(false)
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
							ref: switchRef,
							className: 'mec-effect-switch',
							'data-dsh-mec': 'effect-switch',
							'data-effect': activeEffect.id,
							'aria-haspopup': 'listbox',
							'aria-expanded': menuOpen ? 'true' : 'false',
							title: '选择动效（当前：' + activeEffect.name + '）',
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
								toggleMenu()
							},
						},
						activeEffect.name,
						h('span', { key: 'chev', 'aria-hidden': 'true', style: { marginLeft: '4px', opacity: 0.6 } }, '⌄')
					),
				]),
				menuOpen && menuRect !== null
					? h(
							AnchoredPanel,
							{
								key: 'effect-menu',
								kind: 'effect-menu',
								role: 'listbox',
								ariaLabel: '动效',
								anchorRef: switchRef,
								onClose: () => setMenuOpen(false),
								style: {
									left: `${Math.max(8, Math.min(menuRect.left, window.innerWidth - 232))}px`,
									top: `${menuRect.bottom + 6}px`,
									width: '224px',
									padding: '4px',
								},
							},
							[
								h('div', { key: 'head', className: 'mec-heading', role: 'presentation' }, '动效'),
								...EFFECTS.map((item) =>
									h(
										'button',
										{
											key: item.id,
											type: 'button',
											className: 'mec-row',
											role: 'option',
											'aria-selected': item.id === activeEffect.id ? 'true' : 'false',
											'data-effect-option': item.id,
											style: item.id === activeEffect.id ? { background: withAlpha(previewAccent, 0.16) } : undefined,
											onClick: (event) => {
												event.stopPropagation()
												chooseEffect(item.id)
											},
										},
										[
											h('span', {
												key: 'dot',
												style: {
													width: '6px',
													height: '6px',
													borderRadius: '999px',
													flex: '0 0 auto',
													background: item.id === activeEffect.id ? previewAccent : 'rgba(127,127,127,.45)',
												},
											}),
											h('span', { key: 'text', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
												h('span', { key: 'name', style: { whiteSpace: 'nowrap' } }, item.name),
												h(
													'span',
													{ key: 'sum', style: { fontSize: '10px', opacity: 0.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
													item.summary
												),
											]),
										]
									)
								),
							]
						)
					: null,
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
				bandHeight > 0
					? h(
							'div',
							{
								key: 'band',
								className: 'mec-wave',
								style: { position: 'relative', height: `${bandHeight}px`, marginBottom: '2px', zIndex: 1 },
							},
							[
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
														// Motion is driven by the shared phase, not CSS.
														animation: 'none',
													},
												})
											)
										)
									: null,
							]
						)
					: null,
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
			kunpengFrameRate,
			kunpengCrossSeconds,
			kunpengDrawScale,
			artFramesOf,
			ART_FRAMES,
			artUrlFor,
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
