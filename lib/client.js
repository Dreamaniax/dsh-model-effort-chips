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
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

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
 * 陀螺进动 (gyroscope)
 *
 * 视觉机制：一枚椭圆陀螺躺在虚线圆环上，沿环进动，同时自身高速自旋；
 * 一根轴线从陀螺中心穿出并按倾角倾斜。
 *
 * 尺寸恒定：圆环半径按画板宽度铺满（高度不足时由天空带高度封顶），
 * 陀螺本体、倾角、环半径都不随档位变化——档位只改两件事：
 * 自旋 3 + 15e rad/s、进动 0.2 + 1.4e rad/s。
 *
 * 布局：72/bar/off —— 72px 天空带，环的椭圆投影正好铺满画板。
 *
 * 纯参数方程：state 只存自旋/进动两个角度，paint 里按当前 angle 求位置；
 * 虚线环用固定 48 段、每 4 段亮 2 段的索引模式绘制，不建 Path2D、不 new 数组。
 */
const gyroscopeEffect = {
	id: 'gyroscope',
	name: '陀螺进动',
	summary: '椭圆陀螺沿铺满画板的虚线圆环进动，档位越高自旋与公转越快',
	layout: { sky: 72, band: 0, track: 'bar', spectrum: false },

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

		// 俯视圆的透视压扁；半径取「铺满画板宽度」与「不超出天空带高度」的较小值。
		const ringSquash = 0.3
		const ringRadius = Math.max(
			10,
			Math.min(width * 0.44, (boxHeight - 6) / (2 * ringSquash))
		)
		const ringRadiusY = ringRadius * ringSquash
		// 倾角、盘身、轴线全部与档位无关，只保留速度随档位变化。
		const tilt = 0.34
		const bodyRadiusX = 5.2
		const bodyRadiusY = 2.6
		const axisLength = bodyRadiusX + 1.2

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

/**
 * 李萨如 (lissajous)
 *
 * 两个不同频率的正弦分别驱动 x / y，在 30px band 里画出一张被压扁的编织网：
 *   x = sin(3u + 0.3e)、y = sin(k·u)，u 在 [t, t + 2π] 上取 96 个点，
 *   k = 2 + floor(4e)（2 / 3 / 4 / 5 / 6），相位速度 0.4 + 1.6e rad/s。
 * 频率比 k:3 随档位阶跃，每次切换都把上一组 k 的曲线再画一遍，并在 0.2s 内
 * 把它的 alpha 递减到 0（新曲线保持满亮度），避免换挡时图形突然闪断。
 * 唯一一处偏离公式：k=3（1:1）时 x/y 同频，公式里的 0.3e 相位差不足以撑开
 * 图形，会画成一条直线；这一档额外补 0.9 rad 相位，让它保持可读的椭圆。
 *
 * 布局 0/bar/off：只占 30px band；y 振幅 clamp 在 band 内（mid ± 12），
 * x 振幅铺满画布宽度（± (W/2 - 14)），图形不会碰到轨道。
 *
 * 零分配：paint 里只有一条 for 循环，不建点数组、不建 Path2D；state 只有
 * 4 个数字，t 在 step 里 % 2π（曲线对 t 严格周期，取模不产生跳变）。
 */
const lissajousEffect = {
	id: 'lissajous',
	name: '李萨如',
	summary: '两个不同频率的正弦交织成李萨如图形，档位越高频率比越复杂',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({
		t: 0,
		// k = 2 + floor(4e) 的当前值 / 上一组值（e=0 时就是最简的 2:3）。
		ratio: 2,
		previousRatio: 0,
		fade: 0,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const ratio = 2 + Math.floor(4 * level)

		if (state.fade > 0) state.fade = Math.max(0, state.fade - dt)
		if (ratio !== state.ratio) {
			state.previousRatio = state.ratio
			state.ratio = ratio
			state.fade = 0.2
		}
		state.t = (state.t + (0.4 + 1.6 * level) * dt) % TAU
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const midY = bandTop + bandHeight * 0.5
		const centerX = width * 0.5
		// y 留 2px 描边余量；x 只留边缘 14px，让图形横跨整块画布。
		const amplitudeY = Math.min(bandHeight * 0.42, 12)
		const amplitudeX = Math.max(20, width * 0.5 - 14)
		const baseAlpha = 0.55 + 0.35 * level
		const fading = state.fade > 0 && state.previousRatio !== 0
		const passes = fading ? 2 : 1

		context.save()
		context.lineJoin = 'round'
		context.lineCap = 'round'
		context.lineWidth = 1.25

		for (let pass = 0; pass < passes; pass += 1) {
			const isPrevious = fading && pass === 0
			const ratio = isPrevious ? state.previousRatio : state.ratio
			const alpha = isPrevious
				? baseAlpha * 0.65 * (state.fade / 0.2)
				: baseAlpha
			if (alpha <= 0.01) continue

			// k=3 时 y 与 x 同频（1:1），0.3e 的相位差只有 0.075–0.15 rad，曲线
			// 会退化成一条几乎笔直的细线；给 1:1 补 0.9 rad 相位，让它保持一个
			// 可读的椭圆。其余比例严格按 x = sin(3u + 0.3e)、y = sin(k·u)。
			const ratioPhase = ratio === 3 ? 0.9 : 0

			context.strokeStyle = withAlpha(accent, alpha)
			context.beginPath()
			// 96 个点围成一条闭合曲线；最后一段由 closePath 补上。
			for (let i = 0; i < 96; i += 1) {
				const u = state.t + (i / 96) * TAU
				const px = centerX + Math.sin(3 * u + 0.3 * level + ratioPhase) * amplitudeX
				const py = midY + Math.sin(ratio * u) * amplitudeY
				if (i === 0) context.moveTo(px, py)
				else context.lineTo(px, py)
			}
			context.closePath()
			context.stroke()
		}

		context.restore()
	},
}

/**
 * 谐波叠加 (harmonics)
 *
 * 一串正弦按 1/k^0.75 衰减地叠成一条单折线，谐波越多峰越尖：
 *   H = 1 + floor(7e)（1..8 阶跃）、A_k = 1/k^0.75、
 *   基频 f = 0.5 + 2.5e（横跨画布的基波周期数）、振幅 3 + 9e。
 *   y(u) = amp · Σ A_k·sin(2πf·k·u + φ) / norm(H)，u ∈ [0,1]，120 个采样点。
 * norm(H) 是这条「固定台阶振幅」波形自身的峰值：不归一化的话，叠加后的
 * 峰值会随 H 涨到 2.2 倍，高档反而冲出 band；归一到峰值后，每个 H 的尖脊
 * 都正好达到 3 + 9e，档位越高只是「更尖、更密」。
 *
 * H 阶跃时把上一组 H 的曲线用同一个 φ 再画一遍，0.2s 内 alpha 递减到 0，
 * 遮住换挡接缝。φ 的推进速度也乘上 f，所以不同档位的横向漂移速度差不多
 * （约 0.35–0.85 个画布宽/秒），不会出现低档飞快、高档粘住的反差。
 *
 * 布局 0/bar/off：只占 30px band，振幅 clamp 在 mid ± 12.6 以内。
 * createState 里一次性算好 A_k 与 norm(H)，paint 每帧只查表，不 new 数组、
 * 不调 Math.pow，state 全是数字 / 定长 Float64Array。
 */
const harmonicsEffect = {
	id: 'harmonics',
	name: '谐波叠加',
	summary: '八条按 1/k^0.75 衰减的正弦叠成一条尖脊，档位越高峰越尖',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const HARMONICS = 8
		const amplitudes = new Float64Array(HARMONICS)
		const norms = new Float64Array(HARMONICS)
		for (let k = 1; k <= HARMONICS; k += 1) amplitudes[k - 1] = Math.pow(k, -0.75)
		// 每个 H 的峰值在初始化时扫一遍固定波形即可（波形与档位无关）。
		for (let h = 1; h <= HARMONICS; h += 1) {
			let peak = 0
			for (let sample = 0; sample < 360; sample += 1) {
				const angle = (sample / 360) * Math.PI * 2
				let sum = 0
				for (let k = 1; k <= h; k += 1) sum += amplitudes[k - 1] * Math.sin(k * angle)
				const magnitude = Math.abs(sum)
				if (magnitude > peak) peak = magnitude
			}
			norms[h - 1] = peak > 0 ? peak : 1
		}
		return {
			phase: 0,
			harmonic: 1,
			previousHarmonic: 1,
			fade: 0,
			amplitudes,
			norms,
		}
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const harmonic = 1 + Math.floor(7 * level)
		const frequency = 0.5 + 2.5 * level

		if (state.fade > 0) state.fade = Math.max(0, state.fade - dt)
		if (harmonic !== state.harmonic) {
			state.previousHarmonic = state.harmonic
			state.harmonic = harmonic
			state.fade = 0.2
		}
		// 相位速度跟 f 走：横向漂移 ≈ (0.35 + 0.5e) 个画布宽/秒。
		state.phase = (state.phase + TAU * frequency * (0.35 + 0.5 * level) * dt) % TAU
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const midY = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.42, 3 + 9 * level)
		const frequency = 0.5 + 2.5 * level
		const baseAlpha = 0.6 + 0.32 * level
		const fading = state.fade > 0 && state.previousHarmonic !== state.harmonic
		const passes = fading ? 2 : 1

		context.save()
		context.lineJoin = 'round'
		context.lineCap = 'round'
		context.lineWidth = 1.3

		for (let pass = 0; pass < passes; pass += 1) {
			const isPrevious = fading && pass === 0
			const harmonic = isPrevious ? state.previousHarmonic : state.harmonic
			const norm = state.norms[harmonic - 1]
			const alpha = isPrevious ? baseAlpha * 0.6 * (state.fade / 0.2) : baseAlpha
			if (alpha <= 0.01) continue

			context.strokeStyle = withAlpha(accent, alpha)
			context.beginPath()
			// 120 点单折线；每点叠加 harmonic 个正弦，取峰值归一。
			for (let i = 0; i < 120; i += 1) {
				const u = i / 119
				let wave = 0
				for (let k = 1; k <= harmonic; k += 1) {
					wave += state.amplitudes[k - 1] * Math.sin(TAU * frequency * u * k + state.phase)
				}
				const px = u * width
				const py = midY + (wave / norm) * amplitude
				if (i === 0) context.moveTo(px, py)
				else context.lineTo(px, py)
			}
			context.stroke()
		}

		context.restore()
	},
}

/**
 * Chirp 扫频 (chirp)
 *
 * 一条频率随时间线性上升的正弦，像声呐/示波器的扫频：1.5s 一个扫频周期，
 * 瞬时频率从 0.3·F 线性升到 F（F = 2 + 20e Hz），振幅 3 + 10e。
 *
 * 为什么用 120 格环形缓冲而不是每帧解一个 y = f(x)：
 *   「频率随时间上升」在静态的一帧里只能从波形疏密看出来，所以画面上显示的
 *   是最近 120 个采样点（≈0.5s 的信号历史）：左端是较早、较低频的样本，
 *   右端是刚采到的高频样本，一整条折线上直接读出扫频的疏密梯度。
 *   step 每帧把它切成 4 个子步（240 样本/s）：最高档 22Hz 时每周期仍有
 *   ~11 个采样点，不会混叠。
 *
 * 连续性：波的连续性只由相位决定——每个子步 phase += 2πf·dt 后 % 2π，
 * 存入缓冲的是 sin(phase)。1.5s 扫频回卷时只重置「扫频进度」，相位与缓冲都
 * 不动：新样本只是从低频重新开始，旧的波形继续向左滑出，画面不会跳。
 * 首帧也不依赖预热：第一个 step 用当前档位的起始频率把缓冲填满一整条正弦。
 *
 * 布局 0/bar/off：只占 30px band；振幅 clamp 在 mid ± 12.6 内。
 * 缓冲在 createState 里一次性分配（不每帧 new 数组），paint 只读 state。
 */
const chirpEffect = {
	id: 'chirp',
	name: 'Chirp 扫频',
	summary: '频率在 1.5s 内线性上升的正弦扫频，档位越高扫得越密越快',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({
		phase: 0,
		sweep: 0,
		head: 0,
		// 120 个采样点，head 指向最旧的一格（下一个被覆盖的位置）。
		samples: new Float64Array(120),
		primed: 0,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const SWEEP = 1.5
		const SUBSTEPS = 4
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const peakFrequency = 2 + 20 * level
		const h = dt / SUBSTEPS

		// 首帧：按当前扫频起点把历史缓冲填成一条正弦，开局就有完整波形。
		if (state.primed === 0) {
			const sampleStep = (TAU * peakFrequency * 0.3) / 240
			for (let i = 0; i < 120; i += 1) state.samples[i] = Math.sin(i * sampleStep)
			state.phase = (120 * sampleStep) % TAU
			state.primed = 1
		}

		for (let sub = 0; sub < SUBSTEPS; sub += 1) {
			state.sweep += h
			if (state.sweep >= SWEEP) state.sweep -= SWEEP
			const progress = state.sweep / SWEEP
			const frequency = peakFrequency * (0.3 + 0.7 * progress)
			state.phase = (state.phase + TAU * frequency * h) % TAU
			state.samples[state.head] = Math.sin(state.phase)
			state.head = (state.head + 1) % 120
		}
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const midY = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.42, 3 + 10 * level)
		const alpha = 0.55 + 0.3 * level

		context.save()
		context.strokeStyle = withAlpha(accent, alpha)
		context.lineWidth = 1.3
		context.lineJoin = 'round'
		context.lineCap = 'round'
		context.beginPath()
		// 从最旧到最新画 120 点，缓冲里的疏密梯度就是扫频本身。
		for (let i = 0; i < 120; i += 1) {
			const sample = state.samples[(state.head + i) % 120]
			const px = (i / 119) * width
			const py = midY + sample * amplitude
			if (i === 0) context.moveTo(px, py)
			else context.lineTo(px, py)
		}
		context.stroke()
		context.restore()
	},
}

/**
 * PWM 方波 (pwm)
 *
 * 高低电平的方波沿画布展开，占空比随档位变宽，像脉冲宽度调制：
 * duty = 0.08 + 0.84e，周期 0.6 - 0.35e 秒，振幅 4 + 12e。
 * 阶梯折线（每个采样点两次 lineTo），占空比 clamp 到 0.02..0.98，
 * 保证极端档位下仍有一段可见的高电平，而不是整屏一条直线。
 */
const pwmEffect = {
	id: 'pwm',
	name: 'PWM 方波',
	summary: '方波的占空比随档位变宽、周期变短，像脉冲宽度调制',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const period = Math.max(0.08, 0.6 - 0.35 * level)
		state.phase = (state.phase + dt / period) % 1
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const mid = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.36, 4 + 12 * level)
		const duty = Math.min(0.98, Math.max(0.02, 0.08 + 0.84 * level))
		// two cycles across the canvas, scrolling with phase
		const cycles = 2
		const stepX = 2

		context.save()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.4
		context.lineJoin = 'miter'
		context.beginPath()
		let previousHigh = null
		for (let x = 0; x <= width; x += stepX) {
			const local = (((x / width) * cycles - state.phase) % 1 + 1) % 1
			const high = local < duty
			const y = high ? mid - amplitude : mid + amplitude
			if (previousHigh === null) context.moveTo(x, y)
			else if (previousHigh !== high) {
				context.lineTo(x, high ? mid - amplitude : mid + amplitude)
			}
			context.lineTo(x, y)
			previousHigh = high
		}
		context.stroke()

		// faint centre line so the square wave reads as a signal, not a border
		context.globalAlpha = 0.18
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, mid)
		context.lineTo(width, mid)
		context.stroke()
		context.restore()
	},
}

/**
 * 波折叠 (wave-fold)
 *
 * 一条正弦先放大再折回自身，产生锯齿与谐波；档位越高折得越狠：
 * 增益 1 + 7e、振幅 6 + 10e、频率 0.6 + 2e。
 * 折叠函数 fold(x) = 2·|2·(x/2 - floor(x/2 + 0.5))| - 1，只做两次 abs/floor，
 * 不递归；振幅按 band 高度 clamp，不会画到轨道上。
 */
const waveFoldEffect = {
	id: 'wave-fold',
	name: '波折叠',
	summary: '正弦被自身折叠成锯齿，档位越高折得越狠、谐波越多',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.phase = (state.phase + dt * (0.6 + 2 * level)) % 1
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const mid = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.42, 6 + 10 * level)
		const gain = 1 + 7 * level
		const waves = 1.6

		const fold = (value) => 2 * Math.abs(2 * (value / 2 - Math.floor(value / 2 + 0.5))) - 1

		context.save()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.3
		context.lineJoin = 'round'
		context.beginPath()
		const stepX = 2
		for (let x = 0; x <= width; x += stepX) {
			const theta = (x / width) * Math.PI * 2 * waves - state.phase * Math.PI * 2
			const y = mid + fold(gain * Math.sin(theta)) * amplitude
			if (x === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.stroke()
		context.globalAlpha = 0.22
		context.strokeStyle = accent
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, mid)
		context.lineTo(width, mid)
		context.stroke()
		context.restore()
	},
}

/**
 * 驻波 (standing-wave)
 *
 * 两端固定的弦上形成驻波，节点数随档位阶跃：
 * 模态 m = 1 + floor(3e)，y = amp·sin(mπx/W)·cos(2πft)，振幅 3 + 11e、f = 1 + 2e。
 * 模态跳变时对上一模态做 0.15s 交叉淡化，避免整条线瞬间闪一下。
 */
const standingWaveEffect = {
	id: 'standing-wave',
	name: '驻波',
	summary: '两端固定的弦上驻波，档位越高模态越高、节点越多',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, modal: 1, previousModal: 1, blend: 1 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		const modal = 1 + Math.floor(3 * level)
		if (modal !== state.modal) {
			state.previousModal = state.modal
			state.modal = modal
			state.blend = 0
		}
		state.blend = Math.min(1, state.blend + dt / 0.15)
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(8, frame.band?.height ?? 30)
		const mid = bandTop + bandHeight * 0.5
		const amplitude = Math.min(bandHeight * 0.42, 3 + 11 * level)
		const frequency = 1 + 2 * level
		const oscillation = Math.cos(Math.PI * 2 * frequency * state.time)
		const ease = state.blend * state.blend * (3 - 2 * state.blend)

		context.save()
		context.lineJoin = 'round'
		const trace = (modal, alpha) => {
			if (alpha <= 0.01) return
			context.globalAlpha = alpha
			context.strokeStyle = accent
			context.lineWidth = 1.3
			context.beginPath()
			for (let x = 0; x <= width; x += 2) {
				const envelope = Math.sin((modal * Math.PI * x) / width)
				const y = mid + envelope * oscillation * amplitude
				if (x === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()
		}

		if (ease < 1) trace(state.previousModal, 0.35 * (1 - ease))
		trace(state.modal, 0.35 + 0.65 * ease)

		// node markers: the points that never move
		context.globalAlpha = 0.5
		context.fillStyle = accent
		for (let node = 0; node <= state.modal; node += 1) {
			const x = (node / state.modal) * width
			context.fillRect(x - 1, mid - 1, 2, 2)
		}
		context.restore()
	},
}

/**
 * 心电 (ecg)
 *
 * 一条合成 PQRST 心电波形从左向右卷动，像监护仪：
 * BPM = 48 + 72e，振幅 4 + 10e，每拍由 5 个高斯凸起拼成（P/Q/R/S/T）。
 * 画面上的每个采样点取当前滚动相位对应的心搏电平，因此整条波形是连续的，
 * 不会因为重绘起点而跳变。
 */
const ecgEffect = {
	id: 'ecg',
	name: '心电',
	summary: '合成 PQRST 波形卷动，档位越高心率越快、振幅越大',
	category: 'wave',
	layout: { sky: 20, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time = (state.time + dt * (48 + 72 * level) / 60) % 1024
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(8, frame.width ?? 284)
		const bandTop = frame.artBox?.top ?? frame.band?.top ?? frame.sky ?? 0
		const boxHeight = Math.max(10, frame.artBox?.height ?? frame.band?.height ?? 30)
		const mid = bandTop + boxHeight * 0.62
		const amplitude = Math.min(boxHeight * 0.5, 4 + 10 * level)

		// P, Q, R, S, T as (centre, width, height) in beat-phase units
		const beats = [
			[0.16, 0.028, 0.16],
			[0.3, 0.012, -0.12],
			[0.34, 0.009, 1],
			[0.385, 0.013, -0.28],
			[0.58, 0.045, 0.24],
		]
		const gaussian = (phase, centre, spread) => {
			let delta = phase - centre
			if (delta > 0.5) delta -= 1
			if (delta < -0.5) delta += 1
			return Math.exp(-(delta * delta) / (2 * spread * spread))
		}
		const beat = (phase) => {
			let value = 0
			for (let index = 0; index < beats.length; index += 1) {
				const [centre, spread, height] = beats[index]
				value += height * gaussian(phase, centre, spread)
			}
			return value
		}

		context.save()
		context.strokeStyle = withAlpha(accent, 0.92)
		context.lineWidth = 1.3
		context.lineJoin = 'round'
		context.beginPath()
		const visibleBeats = 2.4
		for (let x = 0; x <= width; x += 2) {
			const phase = (((x / width) * visibleBeats + state.time) % 1 + 1) % 1
			const y = mid - beat(phase) * amplitude
			if (x === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.stroke()

		// baseline + a faint grid, the way a monitor draws it
		context.globalAlpha = 0.16
		context.lineWidth = 1
		context.beginPath()
		context.moveTo(0, mid)
		context.lineTo(width, mid)
		context.stroke()
		context.restore()
	},
}

		const PHYSICS_EFFECTS = [doublePendulumEffect, springMeshEffect, gyroscopeEffect, dominoesEffect, lissajousEffect, harmonicsEffect, chirpEffect, pwmEffect, waveFoldEffect, standingWaveEffect, ecgEffect]

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

		/**
		 * 动效大类。The menu shows these first, then the effects inside one, so the
		 * list stays short as more families land.
		 */
		const EFFECT_CATEGORIES = [
			{ id: 'classic', name: '经典', note: '内置的两种底层动效' },
			{ id: 'physics', name: '物理仿真', note: '力、碰撞、约束' },
			{ id: 'wave', name: '波形信号', note: '解析曲线与信号' },
			{ id: 'character', name: '角色演出', note: '插画式角色动画' },
		]

		/** id -> category. Effects without an entry fall back to 经典. */
		const EFFECT_CATEGORY = {
			kunpeng: 'character',
			'particle-wave': 'classic',
			'double-pendulum': 'physics',
			'spring-mesh': 'physics',
			gyroscope: 'physics',
			dominoes: 'physics',
		}

		function categoryOf(effect) {
			// A snippet may declare its own category; the table is the fallback for
			// effects written before categories existed.
			if (typeof effect.category === 'string') return effect.category
			return EFFECT_CATEGORY[effect.id] ?? 'classic'
		}

		/** Categories that actually hold at least one effect, in display order. */
		function visibleCategories() {
			return EFFECT_CATEGORIES.map((category) => ({
				...category,
				effects: EFFECTS.filter((effect) => categoryOf(effect) === category.id),
			})).filter((category) => category.effects.length > 0)
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
					// Nested overlays (the effect menu) live in their own portal, so
					// a pointerdown inside one would otherwise close this panel
					// before the click on the option is delivered.
					const ignore = props.ignoreSelector
					if (ignore !== undefined && typeof event.target?.closest === 'function' && event.target.closest(ignore) !== null) return
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
			const [menuCategory, setMenuCategory] = react.useState(null)

			const toggleMenu = () => {
				if (menuOpen) {
					setMenuOpen(false)
					return
				}
				const node = switchRef.current
				if (node !== null) setMenuRect(node.getBoundingClientRect())
				setMenuCategory(null)
				setMenuOpen(true)
			}

			const chooseEffect = (id) => {
				setEffectId(id)
				writeStoredEffectId(id)
				setMenuOpen(false)
				setMenuCategory(null)
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

			// The menu: categories first, then the effects inside the chosen one.
			const renderEffectMenu = () => {
				const width = 224
				const below = window.innerHeight - (menuRect?.bottom ?? 0)
				const openUp = below < 240
				const anchorTop = menuRect?.top ?? 0
				const anchorBottom = menuRect?.bottom ?? 0
				const style = {
					left: `${Math.max(8, Math.min(menuRect?.left ?? 8, window.innerWidth - width - 8))}px`,
					...(openUp
						? { bottom: `${Math.max(8, window.innerHeight - anchorTop + 6)}px` }
						: { top: `${anchorBottom + 6}px` }),
					width: `${width}px`,
					padding: '4px',
					maxHeight: `${Math.min(320, Math.max(160, window.innerHeight - 24))}px`,
				}

				const category = menuCategory === null ? null : visibleCategories().find((entry) => entry.id === menuCategory) ?? null

				const rows = []
				if (category === null) {
					rows.push(h('div', { key: 'head', className: 'mec-heading', role: 'presentation' }, '动效大类'))
					for (const entry of visibleCategories()) {
						const selected = entry.effects.some((effect) => effect.id === activeEffect.id)
						rows.push(
							h(
								'button',
								{
									key: entry.id,
									type: 'button',
									className: 'mec-row',
									'data-effect-category': entry.id,
									title: entry.note,
									onClick: (event) => {
										event.stopPropagation()
										setMenuCategory(entry.id)
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
											background: selected ? previewAccent : 'rgba(127,127,127,.45)',
										},
									}),
									h('span', { key: 'name', style: { flex: '1 1 auto' } }, entry.name),
									h('span', { key: 'count', style: { opacity: 0.5, fontSize: '10px' } }, entry.effects.length),
									h('span', { key: 'chev', style: { opacity: 0.45 } }, '›'),
								]
							)
						)
					}
				} else {
					rows.push(
						h(
							'button',
							{
								key: 'back',
								type: 'button',
								className: 'mec-row',
								'data-effect-back': 'true',
								style: { opacity: 0.75 },
								onClick: (event) => {
									event.stopPropagation()
									setMenuCategory(null)
								},
							},
							`‹ ${category.name}`
						)
					)
					for (const item of category.effects) {
						const selected = item.id === activeEffect.id
						rows.push(
							h(
								'button',
								{
									key: item.id,
									type: 'button',
									className: 'mec-row',
									role: 'option',
									'aria-selected': selected ? 'true' : 'false',
									'data-effect-option': item.id,
									style: selected ? { background: withAlpha(previewAccent, 0.16) } : undefined,
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
											background: selected ? previewAccent : 'rgba(127,127,127,.45)',
										},
									}),
									h('span', { key: 'text', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
										h('span', { key: 'name', style: { whiteSpace: 'nowrap' } }, item.name),
										h(
											'span',
											{
												key: 'sum',
												style: { fontSize: '10px', opacity: 0.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
											},
											item.summary
										),
									]),
								]
							)
						)
					}
				}

				return h(
					AnchoredPanel,
					{
						key: 'effect-menu',
						kind: 'effect-menu',
						role: 'listbox',
						ariaLabel: '动效',
						anchorRef: switchRef,
						onClose: () => setMenuOpen(false),
						style,
					},
					rows
				)
			}

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
				menuOpen && menuRect !== null ? renderEffectMenu() : null,
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
									ignoreSelector: '[data-dsh-mec="effect-menu"]',
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
