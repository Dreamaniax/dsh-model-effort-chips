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

		/**
		 * The life family renders GPT Image pixel strips: one 6-frame strip per
		 * creature, 48x48 a frame. The host loads them lazily and hands the current
		 * effect's image to `frame.art`; every effect keeps a vector fallback for
		 * the frames before the image decodes (and for the SSR preview).
		 */
		const LIFE_ART_IDS = new Set(['jellyfish', 'vine', 'microbe', 'bloom'])
		let lifeArtCache = null

		function lifeArtFor(id) {
			if (!LIFE_ART_IDS.has(id)) return null
			if (typeof window === 'undefined' || typeof window.Image !== 'function') return null
			if (lifeArtCache === null) lifeArtCache = new Map()
			if (lifeArtCache.has(id)) return lifeArtCache.get(id)
			const image = new window.Image()
			image.decoding = 'async'
			image.src = `/plugins/${ART_PACKAGE}/assets/life/${id}.png`
			lifeArtCache.set(id, image)
			return image
		}

		function readyLifeArt(id) {
			const image = lifeArtFor(id)
			if (image === null) return null
			return image.complete === true && image.naturalWidth > 0 ? image : null
		}

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
 * 万花尺 (spirograph)
 *
 * 视觉机制：小圆（半径 r=7）在大圆（半径 R=18+16e）内滚动，笔尖距小圆中心
 * d=8+16e，画出内摆线花瓣；档位越高 R/d 越大、花瓣越密。笔尖拖着一条 240 点
 * 定长尾迹，最近 4 秒的轨迹整条留在 band 里，像一支笔一直在画。
 *
 * 能量映射：R = 18 + 16e、r = 7、d = 8 + 16e、头部角速度 0.8 + 3.2e rad/s。
 * R/r = (18+16e)/7 始终非整数，所以轨迹首尾不闭合；这里用环形缓冲按时间顺序
 * 取点画折线，θ 连续累加、不重置，所以「回卷接缝」根本不存在（比保留 1 帧
 * 重叠更稳），折线也无需 closePath 去硬接首尾。
 *
 * 曲线原始半径 51px，按天空带高度自适应缩放（半径 ≈ 天空带 42%），不会缩成中间一个小点。
 * 尾迹在 createState 里一次性分配 Float64Array(240*2)，step/paint 只写槽位。
 */
const spirographEffect = {
	id: 'spirograph',
	name: '万花尺',
	summary: '内摆线笔尖拖着 240 点尾迹不停画花瓣，档位越高花瓣越密',
	category: 'geometry',
	layout: { sky: 84, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		theta: 0,
		// 240 个点、每点 x/y，定长复用；head 指向下一个写入槽位。
		trail: new Float64Array(240 * 2),
		head: 0,
		count: 0,
	}),

	step(state, frame) {
		const TRAIL = 240
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const rolling = 7
		const outer = 18 + 16 * level - rolling
		const pen = 8 + 16 * level
		const ratio = outer / rolling
		// Unit space: paint() multiplies by the sky-band height, so a taller panel
		// simply draws a bigger figure instead of a dot in the middle.
		const scale = 0.0098

		// θ 连续累加：不回卷，所以不存在参数接缝；精度足够跑满整个会话。
		state.theta += (0.8 + 3.2 * level) * dt
		const t = state.theta
		const x = (outer * Math.cos(t) + pen * Math.cos(ratio * t)) * scale
		const y = (outer * Math.sin(t) - pen * Math.sin(ratio * t)) * scale

		// 定长环形缓冲：只覆写槽位，不 push / shift / new。
		state.trail[state.head * 2] = x
		state.trail[state.head * 2 + 1] = y
		state.head = (state.head + 1) % TRAIL
		if (state.count < TRAIL) state.count += 1
	},

	paint(context, state, frame) {
		const TRAIL = 240
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.artBox?.top ?? frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		// The trail is stored in unit space; the sky-band height is the scale, so
		// the same curve fills a 30px band or a 64px one.
		const unit = bandHeight

		context.save()

		// 240 点尾迹：从最旧到最新画一条折线，一条 path 一次 stroke。
		const count = state.count
		if (count >= 2) {
			let cursor = (state.head - count + TRAIL) % TRAIL
			context.beginPath()
			context.moveTo(centerX + state.trail[cursor * 2] * unit, centerY + state.trail[cursor * 2 + 1] * unit)
			for (let index = 1; index < count; index += 1) {
				cursor = (cursor + 1) % TRAIL
				context.lineTo(centerX + state.trail[cursor * 2] * unit, centerY + state.trail[cursor * 2 + 1] * unit)
			}
			context.strokeStyle = withAlpha(accent, 0.34 + 0.36 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 笔尖亮点（最新的点）。
		if (count > 0) {
			const tip = (state.head - 1 + TRAIL) % TRAIL
			context.fillStyle = accent
			context.globalAlpha = 0.95
			context.fillRect(
				centerX + state.trail[tip * 2] * unit - 1.2,
				centerY + state.trail[tip * 2 + 1] * unit - 1.2,
				2.4,
				2.4
			)
			context.globalAlpha = 1
		}

		context.restore()
	},
}

/**
 * 傅里叶本轮 (fourier-epicycles) — 几何线条, docs/plan/01-effects-taxonomy.md §4.
 *
 * A chain of rotating circles, each centred on the tip of the previous one. The
 * final tip is the pen; it traces the square-wave-like Fourier sum:
 *
 *   terms      K = 1 + floor(6e)                  (1..7 circles)
 *   radius     R_k = 16 / (2k - 1)                px, panel-scaled x 0.92
 *   angular    ω_k = (2k - 1) * (0.6 + 1.2e)      rad/s
 *
 * The pen path is stored in a fixed 240-point ring buffer (2 strokes per frame),
 * so the trail is finite and never shifts an array. When K changes the old ring
 * is copied into the ghost buffers and fades out over ~0.35s while the new curve
 * starts drawing — no hard cut. The chain is drawn with its radius lines and the
 * whole scene is clipped to the 30px band.
 *
 * Layout 0/band(30)/bar/off: the pen's vertical excursion is ~±13.6px, inside the
 * band; the chain is clipped at the band edges like a viewport.
 */
const fourierEpicyclesEffect = {
	id: 'fourier-epicycles',
	name: '傅里叶本轮',
	summary: '七个旋转圆首尾相连，笔尖描出方波曲线；档位越高项数越多、转得越快',
	category: 'geometry',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState() {
		const TRAIL = 240
		return {
			time: 0,
			terms: 1,
			angles: new Float64Array(7),
			trailX: new Float32Array(TRAIL),
			trailY: new Float32Array(TRAIL),
			trailHead: 0,
			trailCount: 0,
			ghostX: new Float32Array(TRAIL),
			ghostY: new Float32Array(TRAIL),
			ghostHead: 0,
			ghostCount: 0,
			ghostAlpha: 0,
		}
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const TAU = Math.PI * 2
		const SCALE = 0.86
		const speeds = 0.6 + 1.2 * energy
		const terms = Math.max(1, Math.min(7, 1 + Math.floor(6 * energy)))
		const angles = state.angles
		state.time += dt
		if (terms !== state.terms) {
			// Snapshot the finished curve, then start a fresh one; the ghost fades.
			state.ghostX.set(state.trailX)
			state.ghostY.set(state.trailY)
			state.ghostHead = state.trailHead
			state.ghostCount = state.trailCount
			state.ghostAlpha = 1
			state.trailHead = 0
			state.trailCount = 0
			state.terms = terms
		}
		if (state.ghostAlpha > 0) state.ghostAlpha = Math.max(0, state.ghostAlpha - dt / 0.35)
		let penX = 0
		let penY = 0
		for (let index = 0; index < terms; index += 1) {
			const order = 2 * (index + 1) - 1
			angles[index] = (angles[index] + order * speeds * dt) % TAU
			const radius = (16 / order) * SCALE
			penX += Math.cos(angles[index]) * radius
			penY += Math.sin(angles[index]) * radius
		}
		const head = state.trailHead
		state.trailX[head] = penX
		state.trailY[head] = penY
		state.trailHead = (head + 1) % 240
		state.trailCount = Math.min(240, state.trailCount + 1)
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const bandTop = Number(frame.band?.top ?? frame.sky ?? 0)
		const bandHeight = Math.max(1, Number(frame.band?.height ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const SCALE = 0.86
		const TAU = Math.PI * 2
		const terms = Math.max(1, Math.min(7, 1 + Math.floor(6 * energy)))
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const angles = state.angles
		const base = 0.5 + 0.5 * energy

		context.save()
		context.beginPath()
		context.rect(0, bandTop, width, bandHeight)
		context.clip()
		context.lineWidth = 1
		context.lineCap = 'round'
		context.lineJoin = 'round'

		// Ghost of the previous term count: fades out over ~0.35s.
		if (state.ghostAlpha > 0 && state.ghostCount > 1) {
			const ghostStart = (state.ghostHead - state.ghostCount + 240) % 240
			context.strokeStyle = withAlpha(accent, 0.5 * state.ghostAlpha)
			context.beginPath()
			for (let index = 0; index < state.ghostCount; index += 1) {
				const slot = (ghostStart + index) % 240
				const x = centerX + state.ghostX[slot]
				const y = centerY + state.ghostY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()
		}

		// Trail: a wide soft understroke, the whole ring, then the recent second.
		if (state.trailCount > 1) {
			const trailStart = (state.trailHead - state.trailCount + 240) % 240
			context.strokeStyle = withAlpha(accent, 0.1 * base)
			context.lineWidth = 3
			context.beginPath()
			for (let index = 0; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()

			context.lineWidth = 1.2
			context.strokeStyle = withAlpha(accent, 0.5 * base)
			context.beginPath()
			for (let index = 0; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()

			const recentStart = Math.max(0, state.trailCount - 60)
			context.lineWidth = 1.4
			context.strokeStyle = withAlpha(accent, 0.9 * base)
			context.beginPath()
			for (let index = recentStart; index < state.trailCount; index += 1) {
				const slot = (trailStart + index) % 240
				const x = centerX + state.trailX[slot]
				const y = centerY + state.trailY[slot]
				if (index === recentStart) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.stroke()
		}

		// The epicycle chain: circles, the radius to each tip, and the pen.
		// Recomputed in paint because paint never writes state.
		let tipX = 0
		let tipY = 0
		for (let index = 0; index < terms; index += 1) {
			const order = 2 * (index + 1) - 1
			const radius = (16 / order) * SCALE
			const nextX = tipX + Math.cos(angles[index]) * radius
			const nextY = tipY + Math.sin(angles[index]) * radius
			context.strokeStyle = withAlpha(accent, 0.16)
			context.beginPath()
			context.arc(centerX + tipX, centerY + tipY, radius, 0, TAU)
			context.stroke()
			context.strokeStyle = withAlpha(accent, 0.34)
			context.beginPath()
			context.moveTo(centerX + tipX, centerY + tipY)
			context.lineTo(centerX + nextX, centerY + nextY)
			context.stroke()
			tipX = nextX
			tipY = nextY
		}
		context.fillStyle = withAlpha(accent, 0.75 + 0.25 * energy)
		context.beginPath()
		context.arc(centerX + tipX, centerY + tipY, 1.8, 0, TAU)
		context.fill()
		context.restore()
	},
}

/**
 * 流场 (flow-field)
 *
 * 视觉机制：最多 240 颗墨点被整数哈希 value noise 生成的向量场推着走，每颗拖一条
 * 4~14 点短尾迹，像风里的墨线；档位越高粒子越多、流场特征越小、速度越快。
 *
 * 能量映射：N = 80 + 160e（最多 240）、速度 15 + 90e px/s、
 *          噪声尺度 0.015 + 0.035e、尾迹 4 + 10e 点。
 * 布局：0/bar/off —— 只占 30px band，不显示频谱。
 *
 * 随机性：初始位置用固定种子的整数 LCG 生成，噪声用整数 hash，全程不碰
 * 随机数 API，所以同一帧的预览/测试可复现。粒子、尾迹（Float64Array 环形
 * 缓冲）与计数数组都在 createState 里一次性分配；step/paint 只写槽位。
 *
 * 噪声：value noise，四角 hash + smoothstep 双线性插值；角度 = value·4π，
 * 场本身随时间横向漂移，粒子路径不会永远重复同一条流线。
 *
 * 只靠静态向量场 + 边界环绕不行：240 颗粒子会全部收进同一个涡核，band 很快
 * 一半空掉。所以每颗粒子带 0.9~2.5s 的寿命，到期用固定种子 LCG 在带内重生
 * （尾迹清零、快速长回来），密度因此始终均匀；另外给方向加一点 +0.5 的向右
 * 偏置，让整体读起来是「被风吹着走的墨线」，而不是原地打转的涡。
 */
const flowFieldEffect = {
	id: 'flow-field',
	name: '流场',
	summary: '粒子被整型噪声向量场推着走，拖出短尾迹，档位越高越密越快',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 240
		const TRAIL = 14
		const x = new Float64Array(MAX)
		const y = new Float64Array(MAX)
		const trail = new Float64Array(MAX * TRAIL * 2)
		const trailHead = new Uint8Array(MAX)
		const trailCount = new Uint8Array(MAX)
		const age = new Float64Array(MAX)
		// 归一化寿命 [0,1)，step 里映射成 0.9~2.5s；相位错开避免成批重生。
		const lifeN = new Float64Array(MAX)
		let seed = 0x9e3779b9
		for (let index = 0; index < MAX; index += 1) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			x[index] = seed / 4294967296
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			y[index] = seed / 4294967296
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			age[index] = (seed / 4294967296) * 2
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			lifeN[index] = seed / 4294967296
		}
		return { x, y, trail, trailHead, trailCount, age, lifeN, seed, time: 0, ready: false }
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const MAX = 240
		const TRAIL = 14
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const bandBottom = bandTop + bandHeight
		const scale = 0.015 + 0.035 * level
		const speed = 15 + 90 * level

		if (!state.ready) {
			for (let index = 0; index < MAX; index += 1) {
				state.x[index] *= width
				state.y[index] = bandTop + state.y[index] * bandHeight
			}
			state.ready = true
		}
		state.time += dt
		const drift = state.time * 0.25

		for (let index = 0; index < MAX; index += 1) {
			const fieldX = state.x[index] * scale + drift
			const fieldY = state.y[index] * scale
			const ix = Math.floor(fieldX)
			const iy = Math.floor(fieldY)
			const fx = fieldX - ix
			const fy = fieldY - iy
			// smoothstep：格点之间一阶导连续，流线不会出现格子边的折角。
			const ux = fx * fx * (3 - 2 * fx)
			const uy = fy * fy * (3 - 2 * fy)

			// value noise：四个格点角各做一次整数 hash（Math.imul 保 32 位）。
			let n00 = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
			n00 = Math.imul(n00 ^ (n00 >>> 13), 1274126177)
			const v00 = ((n00 ^ (n00 >>> 16)) >>> 0) / 4294967296
			let n10 = Math.imul(ix + 1, 374761393) + Math.imul(iy, 668265263)
			n10 = Math.imul(n10 ^ (n10 >>> 13), 1274126177)
			const v10 = ((n10 ^ (n10 >>> 16)) >>> 0) / 4294967296
			let n01 = Math.imul(ix, 374761393) + Math.imul(iy + 1, 668265263)
			n01 = Math.imul(n01 ^ (n01 >>> 13), 1274126177)
			const v01 = ((n01 ^ (n01 >>> 16)) >>> 0) / 4294967296
			let n11 = Math.imul(ix + 1, 374761393) + Math.imul(iy + 1, 668265263)
			n11 = Math.imul(n11 ^ (n11 >>> 13), 1274126177)
			const v11 = ((n11 ^ (n11 >>> 16)) >>> 0) / 4294967296
			const top = v00 + (v10 - v00) * ux
			const bottom = v01 + (v11 - v01) * ux
			const value = top + (bottom - top) * uy
			const angle = value * TAU * 2

			// 生命周期：到期就换一个随机落点，密度才不会被涡核吸空。
			// lifeN 归一化，映射到 0.9~2.5s。
			state.age[index] += dt
			if (state.age[index] >= 0.9 + 1.6 * state.lifeN[index]) {
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				const rx = state.seed / 4294967296
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				const ry = state.seed / 4294967296
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				state.age[index] = (state.seed / 4294967296) * 0.15
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				state.lifeN[index] = state.seed / 4294967296
				state.x[index] = rx * width
				state.y[index] = bandTop + ry * bandHeight
				state.trailHead[index] = 0
				state.trailCount[index] = 0
				continue
			}

			// 方向加 0.5 的向右偏置（单位化后仍按 speed 走），像被风吹的墨线。
			const dirX = Math.cos(angle) + 0.5
			const dirY = Math.sin(angle)
			const stride = (speed * dt) / Math.hypot(dirX, dirY)
			let px = state.x[index] + dirX * stride
			let py = state.y[index] + dirY * stride
			let wrapped = false
			if (px < 0) {
				px += width
				wrapped = true
			} else if (px >= width) {
				px -= width
				wrapped = true
			}
			if (py < bandTop) {
				py += bandHeight
				wrapped = true
			} else if (py >= bandBottom) {
				py -= bandHeight
				wrapped = true
			}
			state.x[index] = px
			state.y[index] = py

			// 环形尾迹；跨边界时清空，避免一条线横穿整块画布。
			const base = index * TRAIL * 2
			if (wrapped) {
				state.trailHead[index] = 0
				state.trailCount[index] = 0
			}
			const head = state.trailHead[index]
			state.trail[base + head * 2] = px
			state.trail[base + head * 2 + 1] = py
			state.trailHead[index] = (head + 1) % TRAIL
			if (state.trailCount[index] < TRAIL) state.trailCount[index] += 1
		}
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		if (!state.ready) return
		const MAX = 240
		const TRAIL = 14
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const activeFloat = Math.min(MAX, 80 + 160 * level)
		const full = Math.floor(activeFloat)
		const partial = activeFloat - full
		const trailPoints = Math.max(2, Math.min(TRAIL, Math.round(4 + 10 * level)))

		context.save()

		// 所有尾迹合成一条 path 一次 stroke，避免 240 次 stroke 调用。
		context.beginPath()
		let anyTrail = false
		for (let index = 0; index < full; index += 1) {
			const points = Math.min(trailPoints, state.trailCount[index])
			if (points < 2) continue
			const base = index * TRAIL * 2
			let cursor = (state.trailHead[index] - points + TRAIL) % TRAIL
			context.moveTo(state.trail[base + cursor * 2], state.trail[base + cursor * 2 + 1])
			for (let step = 1; step < points; step += 1) {
				cursor = (cursor + 1) % TRAIL
				context.lineTo(state.trail[base + cursor * 2], state.trail[base + cursor * 2 + 1])
			}
			anyTrail = true
		}
		if (anyTrail) {
			context.strokeStyle = withAlpha(accent, 0.16 + 0.3 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 粒子头：有已解码的光点精灵就用 drawImage，否则退回实心圆。
		const radius = 0.7 + 0.6 * level
		const sprite = frame.sprite ?? null
		if (sprite !== null) {
			const size = 2.2 + 1.8 * level
			context.globalAlpha = 0.9
			for (let index = 0; index < full; index += 1) {
				context.drawImage(
					sprite,
					state.x[index] - size / 2,
					state.y[index] - size / 2,
					size,
					size
				)
			}
			if (partial > 0.02) {
				context.globalAlpha = 0.9 * partial
				context.drawImage(
					sprite,
					state.x[full] - size / 2,
					state.y[full] - size / 2,
					size,
					size
				)
			}
			context.globalAlpha = 1
		} else {
			context.fillStyle = accent
			context.globalAlpha = 0.9
			context.beginPath()
			for (let index = 0; index < full; index += 1) {
				context.moveTo(state.x[index] + radius, state.y[index])
				context.arc(state.x[index], state.y[index], radius, 0, TAU)
			}
			context.fill()
			if (partial > 0.02) {
				context.globalAlpha = 0.9 * partial
				context.beginPath()
				context.moveTo(state.x[full] + radius, state.y[full])
				context.arc(state.x[full], state.y[full], radius, 0, TAU)
				context.fill()
			}
			context.globalAlpha = 1
		}

		context.restore()
	},
}

/**
 * Boids 群集 (boids)
 *
 * 视觉机制：每条 boid 只受三股力——和邻居拉开距离（分离）、朝邻居平均朝向偏转
 * （对齐）、朝邻居质心靠拢（聚合）。档位越高个体越多、邻域越大、速度上限越高，
 * 群集自己长出密度与湍流，而不是把同一套运动放大。
 *
 * 能量映射：N = 24 + 56e（最多 80）；邻域 12 + 12e px；vmax = 30 + 90e px/s；
 * 分离权重 1.4。边界用反弹不用 wrap；三条边都在 band 内。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 80 个 boid 在 createState 里预分配；O(n²) 三力只对当前活跃数量做，step/paint
 * 不建数组、不建对象。位置/速度初值来自固定种子 LCG，可复现。
 * frame.sprite 是已解码的 32×32 光点精灵时用 drawImage 画头部，否则退回 arc。
 */
const boidsEffect = {
	id: 'boids',
	name: 'Boids 群集',
	summary: '分离/对齐/聚合三力驱动鸟群，档位越高越密越快，撞边反弹',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 80
		const boids = []
		for (let index = 0; index < MAX; index += 1) {
			boids.push({ x: 0, y: 0, vx: 0, vy: 0 })
		}
		// 固定种子 LCG：位置/初速可复现，测试与预览每次一样。
		let seed = 0x9e3779b9
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const starts = new Float64Array(MAX * 2)
		for (let index = 0; index < MAX; index += 1) {
			starts[index * 2] = random()
			starts[index * 2 + 1] = random()
			boids[index].vx = random() * 2 - 1
			boids[index].vy = (random() * 2 - 1) * 0.6
		}
		return { boids, starts, ready: false }
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const target = Math.max(8, Math.min(80, Math.round(24 + 56 * energy)))
		const radius = 12 + 12 * energy
		const radiusSq = radius * radius
		const maxSpeed = 30 + 90 * energy
		const minSpeed = maxSpeed * 0.35
		const separationWeight = 1.4
		const margin = Math.min(3, Math.max(1, bandHeight * 0.1))
		const loX = Math.min(margin, width * 0.4)
		const hiX = Math.max(loX + 1, width - loX)
		const loY = bandTop + margin
		const hiY = Math.max(loY + 1, bandTop + bandHeight - margin)
		const boids = state.boids
		const starts = state.starts

		// 首帧：把 80 个 boid 撒进 band，初速按当前 vmax 归一化。
		if (!state.ready) {
			for (let index = 0; index < boids.length; index += 1) {
				const boid = boids[index]
				boid.x = loX + starts[index * 2] * (hiX - loX)
				boid.y = loY + starts[index * 2 + 1] * (hiY - loY)
				const speed = Math.hypot(boid.vx, boid.vy)
				const scale = speed > 0.0001 ? (maxSpeed * 0.55) / speed : 0
				boid.vx *= scale
				boid.vy *= scale
			}
			state.ready = true
		}

		// O(n²) 三力：只遍历活跃个体，距离先用平方比较，邻居才开方。
		for (let index = 0; index < target; index += 1) {
			const boid = boids[index]
			let alignX = 0
			let alignY = 0
			let centerX = 0
			let centerY = 0
			let awayX = 0
			let awayY = 0
			let neighbors = 0

			for (let other = 0; other < target; other += 1) {
				if (other === index) continue
				const mate = boids[other]
				const dx = boid.x - mate.x
				const dy = boid.y - mate.y
				const distanceSq = dx * dx + dy * dy
				if (distanceSq >= radiusSq || distanceSq < 0.0001) continue
				const inverse = 1 / Math.sqrt(distanceSq)
				neighbors += 1
				alignX += mate.vx
				alignY += mate.vy
				centerX += mate.x
				centerY += mate.y
				awayX += dx * inverse
				awayY += dy * inverse
			}

			let ax = 0
			let ay = 0
			if (neighbors > 0) {
				// 对齐：朝邻居平均朝向偏转；聚合：朝邻居质心靠拢。
				const alignMag = Math.hypot(alignX, alignY)
				if (alignMag > 0.0001) {
					ax += ((alignX / alignMag) * maxSpeed - boid.vx) * 1.1
					ay += ((alignY / alignMag) * maxSpeed - boid.vy) * 1.1
				}
				const toCenterX = centerX / neighbors - boid.x
				const toCenterY = centerY / neighbors - boid.y
				const centerMag = Math.hypot(toCenterX, toCenterY)
				if (centerMag > 0.0001) {
					ax += ((toCenterX / centerMag) * maxSpeed - boid.vx) * 0.9
					ay += ((toCenterY / centerMag) * maxSpeed - boid.vy) * 0.9
				}
				// 分离：邻居越近推得越狠，权重 1.4 压过对齐/聚合。
				const awayMag = Math.hypot(awayX, awayY)
				if (awayMag > 0.0001) {
					ax += (awayX / awayMag) * maxSpeed * separationWeight * 1.6
					ay += (awayY / awayMag) * maxSpeed * separationWeight * 1.6
				}
			}

			// 靠近上下边时加一股回中力：否则高速群会贴着两条边滑成「车道」。
			const edgeZone = bandHeight * 0.28
			if (boid.y < loY + edgeZone) {
				ay += maxSpeed * 3 * (1 - (boid.y - loY) / edgeZone)
			} else if (boid.y > hiY - edgeZone) {
				ay -= maxSpeed * 3 * (1 - (hiY - boid.y) / edgeZone)
			}
			const sideZone = Math.min(width * 0.08, 20)
			if (boid.x < loX + sideZone) {
				ax += maxSpeed * 2 * (1 - (boid.x - loX) / sideZone)
			} else if (boid.x > hiX - sideZone) {
				ax -= maxSpeed * 2 * (1 - (hiX - boid.x) / sideZone)
			}

			boid.vx += ax * dt
			boid.vy += ay * dt

			// 限速：不许超过 vmax，也不许停死（否则群会散成一堆静止点）。
			let speed = Math.hypot(boid.vx, boid.vy)
			if (speed > maxSpeed) {
				boid.vx = (boid.vx / speed) * maxSpeed
				boid.vy = (boid.vy / speed) * maxSpeed
			} else if (speed < minSpeed) {
				if (speed > 0.0001) {
					boid.vx = (boid.vx / speed) * minSpeed
					boid.vy = (boid.vy / speed) * minSpeed
				} else {
					boid.vx = minSpeed
					boid.vy = 0
				}
			}

			boid.x += boid.vx * dt
			boid.y += boid.vy * dt

			// 边缘反弹，不用 wrap：撞墙把法向速度翻正。
			if (boid.x < loX) {
				boid.x = loX
				boid.vx = Math.abs(boid.vx)
			} else if (boid.x > hiX) {
				boid.x = hiX
				boid.vx = -Math.abs(boid.vx)
			}
			if (boid.y < loY) {
				boid.y = loY
				boid.vy = Math.abs(boid.vy)
			} else if (boid.y > hiY) {
				boid.y = hiY
				boid.vy = -Math.abs(boid.vy)
			}
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const count = Math.max(8, Math.min(80, Math.round(24 + 56 * energy)))
		const boids = state.boids
		const length = 1.5 + 2.5 * energy

		context.save()

		// 速度方向上的短线段：一只 boid 一笔，但整群一次 stroke。
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.45 + 0.15 * energy)
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const boid = boids[index]
			const speed = Math.hypot(boid.vx, boid.vy)
			if (speed < 0.0001) continue
			const tailX = boid.x - (boid.vx / speed) * length
			const tailY = boid.y - (boid.vy / speed) * length
			context.moveTo(tailX, tailY)
			context.lineTo(boid.x, boid.y)
		}
		context.stroke()

		if (sprite !== null) {
			// 有精灵：头部画成柔光点，颜色靠线段的 accent 读出来。
			const size = 4 + 2 * energy
			const half = size / 2
			context.globalAlpha = 0.75
			for (let index = 0; index < count; index += 1) {
				const boid = boids[index]
				context.drawImage(sprite, boid.x - half, boid.y - half, size, size)
			}
			context.globalAlpha = 1
		} else {
			// 没有精灵：退回实心圆点，一次 fill 画完。
			context.fillStyle = accent
			const headRadius = 1.2 + 0.6 * energy
			context.beginPath()
			for (let index = 0; index < count; index += 1) {
				const boid = boids[index]
				context.moveTo(boid.x + headRadius, boid.y)
				context.arc(boid.x, boid.y, headRadius, 0, Math.PI * 2)
			}
			context.fill()
		}

		context.restore()
	},
}

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
 * frame.sprite, and every grain still keeps a small accent arc core on top of
 * it — the glow alone washes out on light backgrounds. Without a sprite the
 * arc dots are the whole grain, so both paths draw the same thing.
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
		const TWIST = 1.6
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
			// Arm thickness is measured across the arm (constant screen px), so it
			// is converted to an angular offset that grows towards the centre.
			const spread =
				kind === 1 ? ((random() + random() + random() - 1.5) * 0.55 * 0.09) / Math.max(0.12, r) : 0
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
				size: kind === 0 ? 1.9 + random() * 1.6 : kind === 1 ? 1.2 + random() * 1.1 : 0.9 + random() * 0.8,
				// Disk thickness: a couple of px keeps it from reading as a 1px line.
				thickness: (random() * 2 - 1) * (kind === 0 ? 2 : 1.3),
			})
		}
		// Paint order + weight per grain kind; created once so paint never allocates.
		return {
			pattern: 0,
			particles,
			layers: [
				{ kind: 2, weight: 0.16 },
				{ kind: 1, weight: 0.85 },
				{ kind: 0, weight: 1 },
			],
		}
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const TAU = Math.PI * 2
		const TWIST = 1.6
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
		const radius = Math.min(width * 0.47, 110)
		// Vertical squash: 0.4 of the band height, so the disk reads edge-on.
		const squash = (bandHeight * 0.46) / Math.max(1, radius)
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const base = 0.2 + 0.8 * energy
		const particles = state.particles
		// Back to front: diffuse disk, then the arms, then the nucleus. The layer
		// table lives in state, so paint does not allocate on the hot path.
		const layers = state.layers
		for (let pass = 0; pass < layers.length; pass += 1) {
			const entry = layers[pass]
			const alpha = base * entry.weight
			context.fillStyle = withAlpha(accent, alpha)
			context.beginPath()
			if (sprite !== null) {
				context.globalCompositeOperation = 'lighter'
				context.globalAlpha = alpha * 0.6
			}
			for (let index = 0; index < count; index += 1) {
				const grain = particles[index]
				if (grain.kind !== entry.kind) continue
				const r = grain.r > 1 ? 1 : grain.r < 0.03 ? 0.03 : grain.r
				const x = centerX + Math.cos(grain.theta) * r * radius
				const y = centerY + Math.sin(grain.theta) * r * radius * squash + grain.thickness
				if (sprite !== null) {
					const size = grain.size * 2.2 + 1.6
					context.drawImage(sprite, x - size * 0.5, y - size * 0.5, size, size)
				}
				context.moveTo(x + grain.size, y)
				context.arc(x, y, grain.size, 0, TAU)
			}
			if (sprite !== null) {
				context.globalCompositeOperation = 'source-over'
				context.globalAlpha = 1
			}
			context.fill()
		}
		// Bright nucleus: an accent core with the sprite glow behind it when present.
		const nucleusSize = 2 + 2.5 * energy
		if (sprite !== null) {
			context.globalCompositeOperation = 'lighter'
			context.globalAlpha = 0.55 + 0.35 * energy
			context.drawImage(sprite, centerX - nucleusSize, centerY - nucleusSize, nucleusSize * 2, nucleusSize * 2)
			context.globalCompositeOperation = 'source-over'
			context.globalAlpha = 1
		}
		context.fillStyle = withAlpha(accent, 0.7 + 0.3 * energy)
		context.beginPath()
		context.moveTo(centerX + nucleusSize, centerY)
		context.arc(centerX, centerY, nucleusSize, 0, TAU)
		context.fill()
	},
}

/**
 * 风沙 (sandstorm)
 *
 * 视觉机制：240 粒沙被横向风场推着从左向右扫过，叠加正弦湍流让每颗沙的
 * 轨迹各自抖动，同时受一点重力下坠；每颗沙拖一条与速度成正比的 1px 短线，
 * 整片看起来像斜着扫过的沙暴。
 *
 * 能量映射：N = 120 + 120e（预分配 240）、风速 50 + 260e px/s、
 *          湍流 10 + 40e、寿命 0.8 - 0.4e 秒。
 * 布局：0/bar/off —— 只占 30px band，不显示频谱。
 *
 * 寿命只有 0.4~0.8s，比穿过画布所需时间短，所以死掉的沙粒按固定种子 LCG
 * 在带内任意位置重生（每帧最多重置 10% 的活跃粒子）：密度始终均匀，风场方向
 * 由水平速度与拖线表达，而不是靠粒子真的从左边飞到右边。粒子池与相位数组
 * 在 createState 里一次分配；step/paint 只写字段，不用 splice、不 new 数组。
 */
const sandstormEffect = {
	id: 'sandstorm',
	name: '风沙',
	summary: '沙粒被横向风场和正弦湍流卷着扫过，档位越高风越急、沙越密',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 240
		return {
			x: new Float64Array(MAX),
			y: new Float64Array(MAX),
			vx: new Float64Array(MAX),
			vy: new Float64Array(MAX),
			age: new Float64Array(MAX),
			phase: new Float64Array(MAX),
			seed: 0x51ed270b,
			time: 0,
			life: 0.8,
			ready: false,
		}
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const MAX = 240
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const bandBottom = bandTop + bandHeight
		const activeFloat = Math.min(MAX, 120 + 120 * level)
		const life = 0.8 - 0.4 * level
		const wind = 50 + 260 * level
		const turbulence = 10 + 40 * level
		const gravity = 18 + 14 * level
		const spin = 3.2 + 4 * level
		state.life = life

		if (!state.ready) {
			let seed = state.seed
			for (let index = 0; index < MAX; index += 1) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r1 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r2 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r3 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r4 = seed / 4294967296
				state.x[index] = r1 * width
				state.y[index] = bandTop + 0.8 + r2 * (bandHeight - 1.6)
				state.age[index] = r3 * life * 0.9
				state.phase[index] = r4 * TAU
				state.vx[index] = wind
				state.vy[index] = 0
			}
			state.seed = seed
			state.ready = true
		}

		state.time += dt
		// 文档的「每帧只重置死掉的 10%」：避免一帧里成批重生造成闪烁。
		const maxResets = Math.max(1, Math.ceil(activeFloat * 0.1))
		let resets = 0
		let seed = state.seed

		for (let index = 0; index < MAX; index += 1) {
			state.age[index] += dt
			const phase = state.phase[index]
			// 横向风 + 低频湍流；纵向是重力 + 异相湍流，沙才会一阵阵起伏。
			const vx = wind + turbulence * 0.55 * Math.sin(state.time * 1.7 + phase * 1.31)
			const vy = gravity + turbulence * 0.45 * Math.sin(state.time * spin + phase)
			state.vx[index] = vx
			state.vy[index] = vy

			const dead = state.age[index] >= life
			if (dead) {
				if (resets >= maxResets) continue
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r1 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r2 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r3 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r4 = seed / 4294967296
				// 带内均匀重生（寿命短于穿屏时间），密度不随档位塌到左边。
				state.x[index] = r1 * width
				state.y[index] = bandTop + 0.8 + r2 * (bandHeight - 1.6)
				state.age[index] = r3 * 0.15
				state.phase[index] = r4 * TAU
				state.vx[index] = wind
				state.vy[index] = gravity
				resets += 1
				continue
			}

			let x = state.x[index] + vx * dt
			let y = state.y[index] + vy * dt
			// 竖向不出带：触底沿地面滑、触顶被风压回。
			if (y < bandTop + 0.6) y = bandTop + 0.6
			else if (y > bandBottom - 0.6) y = bandBottom - 0.6
			// 极少数活过右边界的沙也回收一次，避免堆在画布外。
			if (x > width + 4) {
				state.age[index] = life
				continue
			}
			state.x[index] = x
			state.y[index] = y
		}
		state.seed = seed
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		if (!state.ready) return
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const activeFloat = Math.min(240, 120 + 120 * level)
		const full = Math.floor(activeFloat)
		const partial = activeFloat - full
		const life = state.life
		const streakSeconds = 0.035

		context.save()

		// 拖线全部合进一条 path 一次 stroke：1px 短线，长度随速度。
		context.beginPath()
		let anyStreak = false
		for (let index = 0; index < full; index += 1) {
			if (state.age[index] >= life) continue
			context.moveTo(state.x[index] - state.vx[index] * streakSeconds, state.y[index] - state.vy[index] * streakSeconds)
			context.lineTo(state.x[index], state.y[index])
			anyStreak = true
		}
		if (anyStreak) {
			context.strokeStyle = withAlpha(accent, 0.28 + 0.32 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 沙粒本体：有光点精灵就 drawImage，否则退化到 1px fillRect。
		const sprite = frame.sprite ?? null
		if (sprite !== null) {
			const size = 1.8 + 1.4 * level
			context.globalAlpha = 0.85
			for (let index = 0; index < full; index += 1) {
				if (state.age[index] >= life) continue
				context.drawImage(sprite, state.x[index] - size / 2, state.y[index] - size / 2, size, size)
			}
			if (partial > 0.02 && state.age[full] < life) {
				context.globalAlpha = 0.85 * partial
				context.drawImage(sprite, state.x[full] - size / 2, state.y[full] - size / 2, size, size)
			}
			context.globalAlpha = 1
		} else {
			context.fillStyle = accent
			context.globalAlpha = 0.85
			for (let index = 0; index < full; index += 1) {
				if (state.age[index] >= life) continue
				context.fillRect(state.x[index], state.y[index], 1.2, 1.2)
			}
			if (partial > 0.02 && state.age[full] < life) {
				context.globalAlpha = 0.85 * partial
				context.fillRect(state.x[full], state.y[full], 1.2, 1.2)
			}
			context.globalAlpha = 1
		}

		context.restore()
	},
}

/**
 * 萤火虫同步 (fireflies)
 *
 * 视觉机制：24 只萤火虫是 24 个相位振子，各自以略有差别的固有频率闪烁；彼此
 * 按 Kuramoto 方式耦合，档位越高耦合越强，闪烁从「各闪各的」逐渐收敛成
 * 「整片同亮」，再高也不会永远死锁在同一相位（频率差始终存在）。
 *
 * 能量映射：N = 24；dφ/dt = ω + (K/N)·Σ sin(φ_j - φ_i)；K = 2.4e 在 e≥0.35
 * 后经 smoothstep 才真正打开，e<0.35 时 K≈0（各闪各的）；相位 wrap 到 2π。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 24 个相位与耦合和都在 createState 预分配；step 先算完所有耦合和再统一推进
 * （Jacobi），避免就地更新改变动力学。paint 用 alpha/半径随脉冲闪。
 * frame.sprite 存在时用 drawImage 画光点，否则退回 arc 两层假辉光。
 */
const firefliesEffect = {
	id: 'fireflies',
	name: '萤火虫同步',
	summary: '24 个相位振子从各闪各的耦合到整片同亮，档位越高同步越快',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const N = 24
		const TAU = Math.PI * 2
		const phases = new Float64Array(N)
		const omega = new Float64Array(N)
		const sums = new Float64Array(N)
		const offsets = new Float64Array(N * 2)
		// 固定种子 LCG：初始相位与椭圆上的抖动可复现。
		let seed = 0x6d2b79f5
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		for (let index = 0; index < N; index += 1) {
			phases[index] = random() * TAU
			// 固有频率略有差别：完全一样就没有「同步」可看。
			omega[index] = 2 + 1.5 * (index / (N - 1))
			offsets[index * 2] = random() * 0.24 - 0.12
			offsets[index * 2 + 1] = random() * 0.24 - 0.12
		}
		return { phases, omega, sums, offsets }
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const N = 24
		// e<0.35 时 K 必须≈0；过了阈值用 smoothstep 打开，避免线性斜率在
		// 阈值处突然给一个不小的耦合。
		const gate = clamp01((energy - 0.35) / 0.2)
		const ramp = gate * gate * (3 - 2 * gate)
		const coupling = 2.4 * energy * ramp
		const phases = state.phases
		const omega = state.omega
		const sums = state.sums

		// 先算所有相位差的耦合和（Jacobi），再统一推进角度。
		for (let index = 0; index < N; index += 1) {
			let sum = 0
			for (let other = 0; other < N; other += 1) {
				sum += Math.sin(phases[other] - phases[index])
			}
			sums[index] = sum
		}
		for (let index = 0; index < N; index += 1) {
			let phase = phases[index] + (omega[index] + (coupling / N) * sums[index]) * dt
			phase %= TAU
			if (phase < 0) phase += TAU
			phases[index] = phase
		}
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const N = 24
		const centerX = width * 0.5
		const centerY = bandTop + bandHeight * 0.5
		const radiusX = Math.max(6, width * 0.33)
		const radiusY = Math.max(3, bandHeight * 0.28)
		const phases = state.phases
		const offsets = state.offsets

		context.save()

		if (sprite !== null) {
			// 精灵路径：柔光点大小/透明度随脉冲，再用一遍 accent 内核把颜色找回来。
			for (let index = 0; index < N; index += 1) {
				const angle = (index / N) * TAU
				const pulse = 0.5 + 0.5 * Math.sin(phases[index])
				const bright = pulse * pulse
				const size = 5 + 10 * bright + 2 * energy
				const px =
					centerX + Math.cos(angle) * radiusX * (1 + offsets[index * 2])
				const py =
					centerY + Math.sin(angle) * radiusY * (1 + offsets[index * 2 + 1])
				context.globalAlpha = 0.14 + 0.6 * bright
				context.drawImage(sprite, px - size / 2, py - size / 2, size, size)
			}
			context.globalAlpha = 0.8
			context.fillStyle = accent
			context.beginPath()
			for (let index = 0; index < N; index += 1) {
				const angle = (index / N) * TAU
				const pulse = 0.5 + 0.5 * Math.sin(phases[index])
				const bright = pulse * pulse
				const px =
					centerX + Math.cos(angle) * radiusX * (1 + offsets[index * 2])
				const py =
					centerY + Math.sin(angle) * radiusY * (1 + offsets[index * 2 + 1])
				context.moveTo(px + 0.7 + 0.8 * bright, py)
				context.arc(px, py, 0.7 + 0.8 * bright, 0, TAU)
			}
			context.fill()
			context.globalAlpha = 1
		} else {
			// 无精灵：两层圆的假辉光（外圈大而淡，内核小而亮）。
			context.fillStyle = accent
			for (let index = 0; index < N; index += 1) {
				const angle = (index / N) * TAU
				const pulse = 0.5 + 0.5 * Math.sin(phases[index])
				const bright = pulse * pulse
				const px =
					centerX + Math.cos(angle) * radiusX * (1 + offsets[index * 2])
				const py =
					centerY + Math.sin(angle) * radiusY * (1 + offsets[index * 2 + 1])
				const core = 0.9 + 1.4 * bright + 0.4 * energy
				context.globalAlpha = 0.12 + 0.22 * bright
				context.beginPath()
				context.arc(px, py, core * 2.2, 0, TAU)
				context.fill()
				context.globalAlpha = 0.35 + 0.65 * bright
				context.beginPath()
				context.arc(px, py, core, 0, TAU)
				context.fill()
			}
			context.globalAlpha = 1
		}

		context.restore()
	},
}

/**
 * 七段数码管 (seven-segment)
 *
 * 视觉机制：三位硬编码七段数字显示当前档位百分比（0–100），亮段用 accent、
 * 未亮段保留 alpha 0.12 的暗影，读数一眼可见。段全部是常量矩形，不碰字体、
 * 不调字体测量 API，位数固定为三位，换档时不会左右抖动。
 *
 * 能量映射：显示 round(e·100)；刷新频率 8 + 20e Hz —— step 里节流，只有累计
 * 时间超过 1/(8+20e) 才更新 state.shown，paint 只按已存值画。
 * 布局：0/bar/off —— 只用 30px band。
 *
 * 段位坐标与 0–9 的亮灭位掩码都在 createState 里一次性预计算（Float32Array /
 * Uint8Array），step/paint 只读，不 new、不调字体 API。
 */
const sevenSegmentEffect = {
	id: 'seven-segment',
	name: '七段数码管',
	summary: '三位硬编码七段数码管显示当前百分比，未亮段留暗影',
	category: 'data',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		// 七段在本地位坐标系里的矩形：a b c d e f g，顺序与位掩码一致。
		// 位：a=1, b=2, c=4, d=8, e=16, f=32, g=64。
		const segments = new Float32Array([
			// a: 上横
			2, 0, 8, 2,
			// b: 右上竖
			10, 2, 2, 9,
			// c: 右下竖
			10, 13, 2, 9,
			// d: 下横
			2, 22, 8, 2,
			// e: 左下竖
			0, 13, 2, 9,
			// f: 左上竖
			0, 2, 2, 9,
			// g: 中横
			2, 11, 8, 2,
		])
		// 0–9 的亮段掩码，顺序为 a b c d e f g。
		const digits = new Uint8Array([
			63, // 0: a b c d e f
			6, // 1: b c
			91, // 2: a b d e g
			79, // 3: a b c d g
			102, // 4: b c f g
			109, // 5: a c d f g
			125, // 6: a c d e f g
			7, // 7: a b c
			127, // 8: all
			111, // 9: a b c d f g
		])
		return { time: 0, shown: 0, accumulate: 0, ready: false, segments, digits }
	},

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.accumulate += dt

		// 节流刷新：8 + 20e Hz。越高的档刷新越快，但都不是每帧重算。
		const interval = 1 / (8 + 20 * level)
		if (!state.ready || state.accumulate >= interval) {
			state.ready = true
			state.accumulate = 0
			state.shown = Math.round(level * 100)
		}
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const segments = state.segments
		const digits = state.digits
		// 三位定宽：100 -> 1,0,0；7 -> 0,0,7，永远占满三个位，画面不抖。
		const value = Math.max(0, Math.min(100, Math.round(state.shown)))
		const digitWidth = 12
		const digitHeight = 24
		const gap = 4
		const totalWidth = digitWidth * 3 + gap * 2
		const originX = (width - totalWidth) * 0.5
		const originY = bandTop + (bandHeight - digitHeight) * 0.5

		context.save()

		// 先铺暗段，再铺亮段：两次 fillStyle，21 个 fillRect 就够了。
		context.fillStyle = withAlpha(accent, 0.12)
		for (let position = 0; position < 3; position += 1) {
			const digit = Math.floor(value / (position === 0 ? 100 : position === 1 ? 10 : 1)) % 10
			const mask = digits[digit]
			const baseX = originX + position * (digitWidth + gap)
			for (let segment = 0; segment < 7; segment += 1) {
				if ((mask & (1 << segment)) !== 0) continue
				const offset = segment * 4
				context.fillRect(
					baseX + segments[offset],
					originY + segments[offset + 1],
					segments[offset + 2],
					segments[offset + 3]
				)
			}
		}

		context.fillStyle = withAlpha(accent, 0.92)
		for (let position = 0; position < 3; position += 1) {
			const digit = Math.floor(value / (position === 0 ? 100 : position === 1 ? 10 : 1)) % 10
			const mask = digits[digit]
			const baseX = originX + position * (digitWidth + gap)
			for (let segment = 0; segment < 7; segment += 1) {
				if ((mask & (1 << segment)) === 0) continue
				const offset = segment * 4
				context.fillRect(
					baseX + segments[offset],
					originY + segments[offset + 1],
					segments[offset + 2],
					segments[offset + 3]
				)
			}
		}

		context.restore()
	},
}

/**
 * 分段进度 (segments) — 数据与文字, docs/plan/01-effects-taxonomy.md §8.
 *
 * A row of fixed-size blocks whose **count** follows the level: nothing at off,
 * a single block as soon as you drag, and enough blocks to fill the whole panel
 * at max. The block size never changes, so the row always reads as one scale.
 *
 *   block    6 x 14 px, 3 px gap (constant at every level)
 *   count    round(e * maxCount), maxCount = however many fit across the panel
 *   head     the newest block breathes, the rest sit at full alpha
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const segmentsEffect = {
	id: 'segments',
	name: '分段进度',
	summary: '方块大小固定，数量随档位从 0 增加到铺满整条滑条',
	category: 'data',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height || frame.height || 30)

		// Constant geometry: only the number of blocks changes with the level.
		const blockWidth = 6
		const gap = 3
		const blockHeight = Math.min(bandHeight - 8, 14)
		const stride = blockWidth + gap
		// Only 3px of margin: at max the row should read as the full slider.
		const maxCount = Math.max(1, Math.floor((width - 3 + gap) / stride))
		const count = Math.round(level * maxCount)
		const totalWidth = count > 0 ? count * blockWidth + (count - 1) * gap : 0
		const startX = Math.round((width - totalWidth) * 0.5)
		const y = Math.round(bandTop + (bandHeight - blockHeight) * 0.5)
		const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(state.time * 6))

		context.save()
		for (let index = 0; index < count; index += 1) {
			const newest = index === count - 1
			context.fillStyle = withAlpha(accent, newest ? pulse : 0.82)
			context.fillRect(startX + index * stride, y, blockWidth, blockHeight)
		}
		context.restore()
	},
}

/**
 * 仪表盘 (gauge) — 数据与文字, docs/plan/01-effects-taxonomy.md §8.
 *
 * A power-meter dial: a 240-degree arc scale, five ticks, a needle that springs
 * towards its level, and a hard-coded seven-segment percentage in the middle.
 *
 *   needle target   -120° + 240°e   (canvas angle -210° .. +30°)
 *   needle length   10 + 6e         px
 *   ticks           5               along the arc
 *   digits          round(e·100),   up to three, seven hard-coded segment rects
 *                                    each, lit + a 0.09 shadow for the off ones
 *
 * The needle is a spring (position + velocity) so a level change swings instead
 * of jumping; the angle is clamped to the dial's 240° sweep. The digits are
 * hard-coded rectangles (no font APIs) from a precomputed table, and the dial is
 * a plain `arc`. Everything is clipped to the 44px sky band.
 *
 * Layout sky 44 / band 0 / bar / off.
 */
const gaugeEffect = {
	id: 'gauge',
	name: '仪表盘',
	summary: '240° 刻度盘上指针弹簧式摆动，中间硬编码七段数字显示百分比',
	category: 'data',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

	createState() {
		// A 12 x 24 seven-segment digit, a b c d e f g order.
		const segments = new Float32Array([
			2, 0, 8, 2, // a top
			10, 2, 2, 9, // b upper right
			10, 13, 2, 9, // c lower right
			2, 22, 8, 2, // d bottom
			0, 13, 2, 9, // e lower left
			0, 2, 2, 9, // f upper left
			2, 11, 8, 2, // g middle
		])
		// 0-9 masks in the same a..g order.
		const digits = new Uint8Array([63, 6, 91, 79, 102, 109, 125, 7, 127, 111])
		return { needle: -Math.PI * 7 / 6, needleVel: 0, segments, digits }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		const START = (-Math.PI * 7) / 6
		const SWEEP = (Math.PI * 4) / 3
		const target = START + SWEEP * energy
		// Damped spring towards the level; the drawn angle is clamped to the dial.
		state.needleVel += ((target - state.needle) * 110 - state.needleVel * 16) * dt
		state.needleVel = Math.max(-30, Math.min(30, state.needleVel))
		state.needle += state.needleVel * dt
		if (state.needle < START) {
			state.needle = START
			state.needleVel = 0
		} else if (state.needle > START + SWEEP) {
			state.needle = START + SWEEP
			state.needleVel = 0
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const START = (-Math.PI * 7) / 6
		const SWEEP = (Math.PI * 4) / 3
		const centerX = width * 0.5
		const radius = Math.max(10, Math.min(artHeight * 0.52, width * 0.3))
		const centerY = artTop + artHeight * 0.58
		const needle = Math.max(START, Math.min(START + SWEEP, state.needle))

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'

		// Dial arc: the full track, then the lit part up to the needle.
		context.strokeStyle = withAlpha(accent, 0.16)
		context.lineWidth = 2
		context.beginPath()
		context.arc(centerX, centerY, radius, START, START + SWEEP, false)
		context.stroke()
		context.strokeStyle = withAlpha(accent, 0.75)
		context.lineWidth = 2
		context.beginPath()
		context.arc(centerX, centerY, radius, START, needle, false)
		context.stroke()

		// Five ticks along the sweep.
		context.strokeStyle = withAlpha(accent, 0.6)
		context.lineWidth = 1
		context.beginPath()
		for (let index = 0; index < 5; index += 1) {
			const angle = START + (SWEEP * index) / 4
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			context.moveTo(centerX + cos * (radius - 3), centerY + sin * (radius - 3))
			context.lineTo(centerX + cos * radius, centerY + sin * radius)
		}
		context.stroke()

		// Needle: a bright blade plus a short counterweight.
		const needleLength = 10 + 6 * energy
		const cosNeedle = Math.cos(needle)
		const sinNeedle = Math.sin(needle)
		context.strokeStyle = withAlpha(accent, 0.95)
		context.lineWidth = 2
		context.beginPath()
		context.moveTo(centerX - cosNeedle * 3.5, centerY - sinNeedle * 3.5)
		context.lineTo(centerX + cosNeedle * needleLength, centerY + sinNeedle * needleLength)
		context.stroke()
		context.fillStyle = withAlpha(accent, 0.9)
		context.beginPath()
		context.arc(centerX, centerY, 2, 0, TAU)
		context.fill()

		// Seven-segment read-out: round(e·100), up to three digits. Leading zeros
		// keep only their 0.09 shadow so the number never jumps sideways.
		const value = Math.max(0, Math.min(100, Math.round(energy * 100)))
		const hundreds = Math.floor(value / 100)
		const tens = Math.floor(value / 10) % 10
		const units = value % 10
		const firstLit = value >= 100 ? 0 : value >= 10 ? 1 : 2
		const scale = 0.36
		const digitWidth = 12 * scale
		const gap = 1.6
		const totalWidth = digitWidth * 3 + gap * 2
		const startX = centerX - totalWidth * 0.5
		const baseY = artTop + artHeight * 0.72
		const litStyle = withAlpha(accent, 0.85)
		const offStyle = withAlpha(accent, 0.09)
		const segments = state.segments
		const masks = state.digits
		for (let slot = 0; slot < 3; slot += 1) {
			// Three scalars, not an array literal: paint must not allocate.
			const digit = slot === 0 ? hundreds : slot === 1 ? tens : units
			const mask = masks[digit]
			const digitX = startX + slot * (digitWidth + gap)
			const lit = slot >= firstLit
			for (let segment = 0; segment < 7; segment += 1) {
				const on = lit && (mask & (1 << segment)) !== 0
				context.fillStyle = on ? litStyle : offStyle
				const base = segment * 4
				context.fillRect(
					digitX + segments[base] * scale,
					baseY + segments[base + 1] * scale,
					segments[base + 2] * scale,
					segments[base + 3] * scale
				)
			}
		}
		context.restore()
	},
}

/**
 * 水母 (jellyfish) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A GPT Image pixel strip: six 48x48 frames of the same jellyfish pulsing. The
 * creature swims left to right (faster at higher levels) while it bobs on a
 * phase inside its sky band; leaving on the right brings it back on the left.
 *
 *   speed   20 + 70e px/s
 *   bob     0.45 + 0.9e rad/s over the room left below the sprite
 *   frames  2.4 + 4.2e fps
 *
 * Layout sky 54 / band 0 / bar / off.
 */
const jellyfishEffect = {
	id: 'jellyfish',
	name: '水母',
	summary: '六帧像素水母：伞盖随节律收缩，从左往右游，档位越高游得越快',
	category: 'life',
	layout: { sky: 54, band: 0, track: 'bar', spectrum: false },

	// starts just inside the left edge: the panel should never open on an empty box
	createState: () => ({ time: 0, x: -20, phase: 0, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		state.time += dt
		// 从左到右游：速度随档位提升，出右边再从左边入场
		state.x += (20 + 70 * level) * dt
		if (state.x > width + 8) state.x = -56
		// 浮沉用一个相位，不回卷，所以没有瞬跳
		state.phase += (0.45 + 0.9 * level) * dt
		if (state.phase > 6.283185307179586) state.phase -= 6.283185307179586
		state.frame = Math.floor(state.time * (2.4 + 4.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box: keep room to bob, or the sprite just sits still.
		const size = Math.round(Math.min(Math.max(16, 40 + 10 * level), artHeight - 18))
		const travel = Math.max(0, artHeight - size)
		const x = state.x
		const y = artTop + travel * (0.5 - 0.5 * Math.cos(state.phase))
		const art = frame.art ?? null
		context.save()
		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：伞盖 + 三条触手
			context.strokeStyle = accent
			context.fillStyle = withAlpha(accent, 0.25)
			context.lineWidth = 1.3
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.42, size * 0.32, size * 0.26, 0, Math.PI, 0)
			context.fill()
			context.stroke()
			for (let leg = 0; leg < 3; leg += 1) {
				const tx = x + size * (0.34 + leg * 0.16)
				context.beginPath()
				context.moveTo(tx, y + size * 0.42)
				context.quadraticCurveTo(tx + Math.sin(state.time * 2 + leg) * 2.5, y + size * 0.62, tx, y + size * 0.8)
				context.stroke()
			}
		}
		context.restore()
	},
}

/**
 * 藤蔓 (vine) — six growth stages of one vine, anchored to the bottom of the panel
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const vineEffect = {
	id: 'vine',
	name: '藤蔓',
	summary: '六帧像素藤蔓：从芽到开花逐档推进，始终锚在面板底部',
	category: 'life',
	layout: { sky: 60, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.y = 0
		state.frame = Math.floor(state.time * (0.55 + 1.5 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 58 + 34 * level), artHeight - 2))
		const x = width * 0.5 - size * 0.5
		const y = artTop + artHeight - size
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：一条向上生长的折线
			context.strokeStyle = accent
			context.lineWidth = 1.4
			const baseX = x + size * 0.5
			const baseY = y + size
			const grow = 0.3 + 0.7 * ((state.frame + 1) / 6)
			context.beginPath()
			context.moveTo(baseX, baseY)
			for (let step = 1; step <= 6; step += 1) {
				const t = (step / 6) * grow
				context.lineTo(baseX + Math.sin(t * 5) * 4, baseY - size * 0.9 * t)
			}
			context.stroke()
		}
		context.restore()
	},
}

/**
 * 微生物 (microbe) — 生命 / 角色, docs/plan/01-effects-taxonomy.md §7.
 *
 * A GPT Image pixel strip whose six frames are **evolution stages**, not a swim
 * cycle: a plain cell, two flagella, three with bumps, spikes, segments, and a
 * fully armoured organism. The displayed stage follows the level, so dragging up
 * metamorphoses the creature; a short cross-fade keeps the jump from popping.
 *
 *   swim    20 + 95e px/s, left to right, wraps at the edge
 *   stage   floor(e * 6), clamped 0..5, cross-faded over 0.18s
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const microbeEffect = {
	id: 'microbe',
	name: '微生物',
	summary: '六帧像素微生物：档位越高游得越快，同时逐级变态进化成更大的形态',
	category: 'life',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, stage: 0, from: 0, blend: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		state.time += dt
		// 游动：档位越高越快，出右边从左边回场
		state.x += (20 + 95 * level) * dt
		if (state.x > width + 40) state.x = -48
		// 变态：阶段跟随档位，换阶时交叉淡化 0.18s
		const target = Math.min(5, Math.max(0, Math.floor(level * 6)))
		if (target !== state.stage) {
			state.from = state.stage
			state.stage = target
			state.blend = 0
		}
		state.blend = Math.min(1, state.blend + dt / 0.18)
		state.frame = state.stage
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const bandTop = frame.band?.top ?? 0
		const bandHeight = Math.max(1, frame.band?.height || 30)
		// Grows a little with the stage; the pixels carry the rest of it.
		const size = Math.round(Math.min(Math.max(16, 26 + 18 * level), bandHeight - 6))
		const x = Math.round(state.x)
		const bob = Math.sin(state.time * (1.4 + 1.6 * level)) * 2
		const y = Math.round(bandTop + bandHeight * 0.5 - size * 0.5 + bob)
		const art = frame.art ?? null
		context.save()
		if (art !== null) {
			context.imageSmoothingEnabled = false
			const fade = Math.max(0, Math.min(1, state.blend))
			if (fade < 1 && state.from !== state.stage) {
				context.globalAlpha = 1 - fade
				context.drawImage(art, state.from * 48, 0, 48, 48, x, y, size, size)
				context.globalAlpha = fade
			}
			context.drawImage(art, state.stage * 48, 0, 48, 48, x, y, size, size)
			context.globalAlpha = 1
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：身体随阶段变长、鞭毛随阶段变多
			context.strokeStyle = accent
			context.lineWidth = 1.2
			const body = 0.24 + 0.05 * state.stage
			context.beginPath()
			context.ellipse(x + size * 0.5, y + size * 0.5, size * body, size * 0.2, 0, 0, Math.PI * 2)
			context.stroke()
			const tails = 1 + state.stage
			for (let tail = 0; tail < tails; tail += 1) {
				context.beginPath()
				const offset = size * (0.36 + tail * 0.06)
				context.moveTo(x + size * 0.5 + body * size, y + offset)
				for (let step = 1; step <= 6; step += 1) {
					context.lineTo(
						x + size * 0.5 + body * size + step * 2.2,
						y + offset + Math.sin(state.time * 6 + step + tail) * 2,
					)
				}
				context.stroke()
			}
		}
		context.restore()
	},
}

/**
 * 花开 (bloom) — one flower opening across six frames, from bud to full petals
 *
 * Drawn from a GPT Image pixel-art strip: six 48x48 frames packed left to right,
 * cycled by a phase clock and scaled with the level. The host passes the strip as
 * `frame.art`; until it decodes (and in the SSR preview) a vector stand-in is
 * drawn instead, so the effect never renders an empty box.
 */
const bloomEffect = {
	id: 'bloom',
	name: '花开',
	summary: '六帧像素花：花苞到盛开逐档展开，循环回花苞',
	category: 'life',
	layout: { sky: 58, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ time: 0, x: 0, y: 0, dir: 1, frame: 0 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.y = 0
		state.frame = Math.floor(state.time * (0.9 + 2.2 * level)) % 6
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(1, frame.artBox?.height || frame.band?.height || 30)
		// Never taller than the box it lives in: a pixel sprite that overflows
		// gets clipped mid-frame, which reads as a bug.
		const size = Math.round(Math.min(Math.max(16, 52 + 30 * level), artHeight - 6))
		const x = width * 0.5 - size * 0.5
		const y = artTop + artHeight * 0.5 - size * 0.5
		const art = frame.art ?? null
		context.save()

		if (art !== null) {
			// Pixel art: no smoothing, whole pixels only.
			context.imageSmoothingEnabled = false
			context.drawImage(art, state.frame * 48, 0, 48, 48, Math.round(x), Math.round(y), size, size)
			context.imageSmoothingEnabled = true
		} else {
			// 无图时的替身：花瓣由少到多
			const petals = 2 + state.frame
			context.strokeStyle = accent
			context.lineWidth = 1.2
			for (let petal = 0; petal < petals; petal += 1) {
				const angle = (petal / petals) * Math.PI * 2 - Math.PI / 2
				context.beginPath()
				context.ellipse(x + size * 0.5 + Math.cos(angle) * size * 0.2, y + size * 0.5 + Math.sin(angle) * size * 0.2, size * 0.12, size * 0.18, angle, 0, Math.PI * 2)
				context.stroke()
			}
		}
		context.restore()
	},
}

/**
 * 液态金属 (metaballs)
 *
 * 视觉机制：3–5 个圆各自产生一个紧支撑的二次衰减隐式场，场值相加后取等值线：
 * 圆靠近时等值线连成一片、远离时裂开，像缓慢流动的液态金属。
 *
 * 能量映射：圆数 3 + round(2e)（3–5）、半径 6 + 8e、阈值 0.55 - 0.25e；
 * 圆心各自以不同速度/相位绕天空中心慢速环绕，横向铺开约 28 + 12e px。
 * 布局：46/bar/off —— 只用 46px 天空区，不占 band。
 *
 * 场用预分配的 Float32Array 存（4px 网格，284px 宽约 71×11 格，左上对齐后
 * 垂直居中）；step 逐点重算场值，paint 用 marching squares 描等值线，一条
 * path 一次描两遍（宽淡光晕 + 细亮线）。全程不 new 数组、不做全分辨率采样。
 */
const metaballsEffect = {
	id: 'metaballs',
	name: '液态金属',
	summary: '几个圆的隐式场等值线随距离融合/分裂，像缓慢流动的液态金属',
	category: 'morph',
	layout: { sky: 46, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		const MAX_COLS = 128
		const MAX_ROWS = 12
		return {
			// 网格点场值，按 STRIDE = MAX_COLS + 1 行优先存放，预分配复用。
			field: new Float32Array((MAX_COLS + 1) * (MAX_ROWS + 1)),
			cx: new Float32Array(5),
			cy: new Float32Array(5),
			time: 0,
			cols: 0,
			rows: 0,
			top: 0,
			threshold: 0.55,
			count: 3,
		}
	},

	step(state, frame) {
		const MAX_COLS = 128
		const MAX_ROWS = 12
		const STRIDE = MAX_COLS + 1
		const CELL = 4
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const artTop = frame.artBox?.top ?? 0
		const artHeight = Math.max(8, frame.artBox?.height ?? 46)
		const cols = Math.min(MAX_COLS, Math.max(1, Math.floor(width / CELL)))
		const rows = Math.min(MAX_ROWS, Math.max(1, Math.floor(artHeight / CELL)))
		// 网格比天空区矮一点：垂直居中，两边各留 remainder/2 的边。
		const top = artTop + (artHeight - rows * CELL) * 0.5

		state.cols = cols
		state.rows = rows
		state.top = top
		state.time += dt

		const count = 3 + Math.round(2 * level)
		const radius = 6 + 8 * level
		const threshold = 0.55 - 0.25 * level
		const spacing = 28 + 12 * level
		const centerX = width * 0.5
		const centerY = top + rows * CELL * 0.5
		state.threshold = threshold
		state.count = count

		// 圆心慢速环绕：每个圆不同速度/相位，偶尔靠近就融合、远离就分裂。
		for (let index = 0; index < 5; index += 1) {
			const phase = index * 2.399963
			const speed = 0.22 + 0.06 * index
			state.cx[index] = centerX + Math.cos(state.time * speed + phase) * spacing * (0.7 + 0.3 * Math.cos(phase * 1.7))
			state.cy[index] = centerY + Math.sin(state.time * speed * 0.73 + phase * 1.3) * spacing * 0.18
		}

		// 4px 网格逐点求场：Σ 2·(1 - d²/r²)（d < r 才有贡献，紧支撑）。
		// 紧支撑保证等值线一定落在某个圆的支撑半径内，46px 天空区不会被裁边；
		// 低档小圆、高档阈值变低 -> 圆之间叠加更多，等值线自然融合。
		const radiusSquared = radius * radius
		const field = state.field
		for (let row = 0; row <= rows; row += 1) {
			const y = top + row * CELL
			const base = row * STRIDE
			for (let col = 0; col <= cols; col += 1) {
				const x = col * CELL
				let sum = 0
				for (let index = 0; index < count; index += 1) {
					const dx = x - state.cx[index]
					const dy = y - state.cy[index]
					const distanceSquared = dx * dx + dy * dy
					if (distanceSquared < radiusSquared) sum += 2 * (1 - distanceSquared / radiusSquared)
				}
				field[base + col] = sum
			}
		}
	},

	paint(context, state, frame) {
		const MAX_COLS = 128
		const STRIDE = MAX_COLS + 1
		const CELL = 4
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const cols = state.cols
		const rows = state.rows
		const top = state.top
		const threshold = state.threshold
		const radius = 6 + 8 * level
		if (cols === 0 || rows === 0) return

		const field = state.field
		context.save()
		context.beginPath()

		// marching squares：每个 4px 格子按四角是否过阈值查 16 种连接。
		for (let row = 0; row < rows; row += 1) {
			const y0 = top + row * CELL
			const y1 = y0 + CELL
			const base = row * STRIDE
			const next = base + STRIDE
			for (let col = 0; col < cols; col += 1) {
				const a = field[base + col]
				const b = field[base + col + 1]
				const c = field[next + col]
				const d = field[next + col + 1]
				const mask = (a > threshold ? 1 : 0) | (b > threshold ? 2 : 0) | (d > threshold ? 4 : 0) | (c > threshold ? 8 : 0)
				if (mask === 0 || mask === 15) continue

				const x0 = col * CELL
				const x1 = x0 + CELL
				const onTop = ((mask & 1) !== 0) !== ((mask & 2) !== 0)
				const onRight = ((mask & 2) !== 0) !== ((mask & 4) !== 0)
				const onBottom = ((mask & 4) !== 0) !== ((mask & 8) !== 0)
				const onLeft = ((mask & 8) !== 0) !== ((mask & 1) !== 0)
				// 只在真正被穿过的边上插值，避免除以 0。
				const topX = onTop ? x0 + (CELL * (threshold - a)) / (b - a) : x0
				const rightY = onRight ? y0 + (CELL * (threshold - b)) / (d - b) : y0
				const bottomX = onBottom ? x0 + (CELL * (threshold - c)) / (d - c) : x0
				const leftY = onLeft ? y0 + (CELL * (threshold - a)) / (c - a) : y0

				// 每个 case 是一到两条线段；5/10 是鞍点，固定配对。
				switch (mask) {
					case 1:
					case 14:
						context.moveTo(x0, leftY)
						context.lineTo(topX, y0)
						break
					case 2:
					case 13:
						context.moveTo(topX, y0)
						context.lineTo(x1, rightY)
						break
					case 3:
					case 12:
						context.moveTo(x0, leftY)
						context.lineTo(x1, rightY)
						break
					case 4:
					case 11:
						context.moveTo(x1, rightY)
						context.lineTo(bottomX, y1)
						break
					case 6:
					case 9:
						context.moveTo(topX, y0)
						context.lineTo(bottomX, y1)
						break
					case 7:
					case 8:
						context.moveTo(x0, leftY)
						context.lineTo(bottomX, y1)
						break
					case 5:
						context.moveTo(x0, leftY)
						context.lineTo(topX, y0)
						context.moveTo(x1, rightY)
						context.lineTo(bottomX, y1)
						break
					case 10:
						context.moveTo(topX, y0)
						context.lineTo(x1, rightY)
						context.moveTo(x0, leftY)
						context.lineTo(bottomX, y1)
						break
					default:
						break
				}
			}
		}

		// 宽淡光晕 + 细亮等值线，两遍 stroke 同一条 path。
		context.strokeStyle = withAlpha(accent, 0.16 + 0.1 * level)
		context.lineWidth = 4
		context.lineJoin = 'round'
		context.stroke()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.2
		context.stroke()

		// 每个圆芯再铺一点半透明底色：等值线是「壳」，芯让液滴有体积感。
		context.beginPath()
		for (let index = 0; index < state.count; index += 1) {
			const core = radius * 0.45
			context.moveTo(state.cx[index] + core, state.cy[index])
			context.arc(state.cx[index], state.cy[index], core, 0, Math.PI * 2)
		}
		context.fillStyle = withAlpha(accent, 0.1 + 0.1 * level)
		context.fill()

		context.restore()
	},
}

/**
 * 挤压拉伸 (squash) — 形变与过渡, docs/plan/01-effects-taxonomy.md §6.
 *
 * A jelly disc keeps its area while it squashes on the beat:
 *
 *   sx = 1 + 0.35e · sin(2π(0.5 + 1.5e)t)   clamped to 0.55 .. 1.45
 *   sy = 1 / sx                            (area conserving)
 *   centre drops by 1 + 3e px
 *
 * One save / translate / scale / arc / fill + stroke / restore per frame — no
 * blurred shadows, no per-frame objects. createState only holds the clock; paint
 * reads it and derives everything from energy and the sky height, clipped to the
 * 44px art band so the stretched disc can never spill onto the DOM bar.
 *
 * Layout sky 44 / band 0 / bar / off.
 */
const squashEffect = {
	id: 'squash',
	name: '挤压拉伸',
	summary: '果冻圆按节拍压扁拉长、体积守恒；档位越高跳得越快、幅度越大',
	category: 'morph',
	layout: { sky: 44, band: 0, track: 'bar', spectrum: false },

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
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const centerX = width * 0.5
		const centerY = artTop + artHeight * 0.5 + (1 + 3 * energy)
		const radius = Math.max(4, Math.min(artHeight * 0.26, width * 0.12))
		const beat = TAU * (0.5 + 1.5 * energy) * state.time
		const sx = Math.max(0.55, Math.min(1.45, 1 + 0.35 * energy * Math.sin(beat)))
		const sy = 1 / sx

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		// A single transform for the jelly: the same arc is squashed, not redrawn.
		context.translate(centerX, centerY)
		context.scale(sx, sy)
		context.beginPath()
		context.arc(0, 0, radius, 0, TAU)
		context.fillStyle = withAlpha(accent, 0.2 + 0.16 * energy)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.7 + 0.3 * energy)
		context.lineWidth = 1.6
		context.stroke()
		context.restore()
	},
}

/**
 * 极坐标变形 (polar) — 形变与过渡, docs/plan/01-effects-taxonomy.md §6.
 *
 * A polar radius morphs a circle into a star and a polygon:
 *
 *   k = 3 + floor(4e)              (3..7 lobes)
 *   r = R · (1 + 0.12e · cos(kθ))   with R = 8 + 14e px
 *   rotation 0.2 + 1e              rad/s
 *
 * 96 points per closed path; r is clamped positive. A k step does not pop: the
 * previous radius set is kept in state and both shapes are cross-faded over
 * 0.2s (the old one fading out while the new one fades in). R is scaled down
 * slightly at the top levels so the star's tips stay inside the 48px band.
 *
 * createState only holds the angle, the two k values and the blend progress;
 * step advances them and paint derives the 96 points twice per frame while a
 * blend runs. No blurred shadows, no per-frame objects.
 *
 * Layout sky 48 / band 0 / bar / off.
 */
const polarEffect = {
	id: 'polar',
	name: '极坐标变形',
	summary: '圆在多边形与星形之间变形旋转；档位越高边数越多、转得越快',
	category: 'morph',
	layout: { sky: 48, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ angle: 0, k: 3, prevK: 3, blend: 0 }),

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.angle = (state.angle + (0.2 + energy) * dt) % (Math.PI * 2)
		const k = 3 + Math.floor(4 * energy)
		if (k !== state.k) {
			state.prevK = state.k
			state.k = k
			state.blend = 1
		}
		if (state.blend > 0) state.blend = Math.max(0, state.blend - dt / 0.2)
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const TAU = Math.PI * 2
		const centerX = width * 0.5
		const centerY = artTop + artHeight * 0.5
		const amplitude = 0.12 * energy
		// The taxonomy's R grows to 22px; cap it so the tallest star tips stay
		// two pixels inside the 48px sky instead of being clipped.
		const nominalR = 8 + 14 * energy
		const fit = Math.min(1, (artHeight * 0.5 - 2) / Math.max(1, nominalR * (1 + amplitude)))
		const radius = nominalR * fit
		const ease = 1 - state.blend

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineJoin = 'round'

		// The outgoing radius set, if a k step is still blending.
		if (state.blend > 0) {
			context.globalAlpha = state.blend
			context.beginPath()
			for (let index = 0; index < 96; index += 1) {
				const theta = (index / 96) * TAU
				const r = Math.max(0.6, radius * (1 + amplitude * Math.cos(state.prevK * (theta + state.angle))))
				const x = centerX + Math.cos(theta) * r
				const y = centerY + Math.sin(theta) * r
				if (index === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			context.closePath()
			context.fillStyle = withAlpha(accent, 0.12)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.55)
			context.lineWidth = 1.4
			context.stroke()
		}

		// The incoming radius set (full weight once the blend ends).
		context.globalAlpha = ease
		context.beginPath()
		for (let index = 0; index < 96; index += 1) {
			const theta = (index / 96) * TAU
			const r = Math.max(0.6, radius * (1 + amplitude * Math.cos(state.k * (theta + state.angle))))
			const x = centerX + Math.cos(theta) * r
			const y = centerY + Math.sin(theta) * r
			if (index === 0) context.moveTo(x, y)
			else context.lineTo(x, y)
		}
		context.closePath()
		context.strokeStyle = withAlpha(accent, 0.15)
		context.lineWidth = 4
		context.stroke()
		context.fillStyle = withAlpha(accent, 0.12)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.75 + 0.25 * energy)
		context.lineWidth = 1.6
		context.stroke()
		context.restore()
	},
}

/**
 * 极光幕 (aurora) — 光与色, docs/plan/01-effects-taxonomy.md §5.
 *
 * Two to four vertical curtains of light sway over the night strip, each with a
 * bright top edge. `energy` drives:
 *
 *   curtains 2 + floor(2e)      (2..4)
 *   sway     4 + 12e            px, slow sine per curtain
 *   drift    0.2 + 1.2e         rad/s, phase speed of the sway and the edge wave
 *   alpha    0.1 + 0.35e        (gradient opacity, scaled with globalAlpha)
 *
 * Each curtain is a wavy vertical band filled with one vertical gradient:
 * bright at the top, transparent at the bottom. The gradient is created once per
 * (width x height x accent) and cached in state — it is NOT rebuilt per frame;
 * only a size change or an accent change invalidates it. The energy modulation
 * happens through globalAlpha, so dragging the slider never touches the cache.
 * Curtain positions ease toward their level's layout, so a count change slides
 * instead of snapping.
 *
 * Layout sky 76 / band 0 / bar / off: the whole scene lives in the 76px sky.
 */
const auroraEffect = {
	id: 'aurora',
	name: '极光幕',
	summary: '两到四条垂直渐变帘幕在天空缓慢摆动，顶部一条亮边；档位越高帘幕越多越亮',
	category: 'light',
	layout: { sky: 76, band: 0, track: 'bar', spectrum: false },

	createState() {
		const curtains = []
		for (let index = 0; index < 4; index += 1) {
			curtains.push({
				// u is the live centre position (normalised); it eases towards
				// the target layout instead of jumping when the count changes.
				u: index < 2 ? 0.18 + 0.64 * index : 0.82,
				phase: index * 1.7 + 0.4,
				width: index === 0 ? 0.11 : index === 1 ? 0.14 : index === 2 ? 0.16 : 0.12,
				depth: index === 0 ? 0.65 : index === 1 ? 0.85 : index === 2 ? 1 : 0.78,
			})
		}
		return { time: 0, curtains, gradient: null, gradientKey: '' }
	},

	step(state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const dtInput = Number(frame.dt)
		const dt = Number.isFinite(dtInput) && dtInput > 0 ? Math.min(0.05, dtInput) : 0
		if (dt === 0) return
		state.time += dt
		const count = 2 + Math.floor(2 * energy)
		const ease = Math.min(1, 5 * dt)
		for (let index = 0; index < state.curtains.length; index += 1) {
			const curtain = state.curtains[index]
			const target = count <= 1 ? 0.5 : 0.18 + (0.64 * Math.min(index, count - 1)) / (count - 1)
			curtain.u += (target - curtain.u) * ease
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(Number(frame.energy) || 0)
		const width = Math.max(1, Number(frame.width) || 0)
		const artTop = Number(frame.artBox?.top ?? 0)
		const artHeight = Math.max(1, Number(frame.artBox?.height ?? frame.sky ?? 30))
		const accent = typeof frame.accent === 'string' && frame.accent.length > 0 ? frame.accent : 'rgb(120, 200, 255)'
		const count = 2 + Math.floor(2 * energy)
		const sway = 4 + 12 * energy
		const drift = 0.2 + 1.2 * energy
		const alpha = 0.1 + 0.35 * energy

		// One vertical gradient shared by every curtain, cached by size + accent.
		// Energy only reaches the gradient through globalAlpha, so a level change
		// reuses the cache; dragging the slider does change the accent, and the
		// gradient is then rebuilt (one gradient + four stops — cheap, and the
		// colour would otherwise lag the level).
		const key = `${width}x${artHeight}|${accent}`
		if (state.gradient === null || state.gradientKey !== key) {
			const gradient = context.createLinearGradient(0, artTop, 0, artTop + artHeight)
			gradient.addColorStop(0, withAlpha(accent, 1))
			gradient.addColorStop(0.38, withAlpha(accent, 0.5))
			gradient.addColorStop(0.75, withAlpha(accent, 0.14))
			gradient.addColorStop(1, withAlpha(accent, 0))
			state.gradient = gradient
			state.gradientKey = key
		}

		context.save()
		context.beginPath()
		context.rect(0, artTop, width, artHeight)
		context.clip()
		context.lineCap = 'round'
		const steps = 10
		for (let index = 0; index < count; index += 1) {
			const curtain = state.curtains[index]
			const bandWidth = Math.max(12, width * curtain.width)
			const centerX = width * curtain.u + Math.sin(state.time * drift + curtain.phase) * sway
			const wave = sway * 0.42
			const wavePhase = state.time * drift * 0.7 + curtain.phase
			// A vertical band whose two edges ripple slightly out of phase.
			// The curtain narrows at the top and flares towards the ground, like a
			// sheet of light hanging down.
			context.beginPath()
			for (let step = 0; step <= steps; step += 1) {
				const t = step / steps
				const y = artTop + artHeight * t
				const halfWidth = bandWidth * 0.5 * (0.55 + 0.45 * t)
				const x = centerX + Math.sin(y * 0.06 + wavePhase) * wave - halfWidth
				if (step === 0) context.moveTo(x, y)
				else context.lineTo(x, y)
			}
			for (let step = steps; step >= 0; step -= 1) {
				const t = step / steps
				const y = artTop + artHeight * t
				const halfWidth = bandWidth * 0.5 * (0.55 + 0.45 * t)
				const x = centerX + Math.sin(y * 0.06 + wavePhase + 0.9) * wave + halfWidth
				context.lineTo(x, y)
			}
			context.closePath()
			context.fillStyle = state.gradient
			context.globalAlpha = Math.min(1, alpha * curtain.depth)
			context.fill()

			// The bright top edge, with a short glow underneath it.
			const topShift = Math.sin(artTop * 0.06 + wavePhase) * wave
			const leftEdge = centerX + topShift - bandWidth * 0.275
			const rightEdge = centerX + topShift + bandWidth * 0.275
			context.globalAlpha = 1
			context.strokeStyle = withAlpha(accent, (0.5 + 0.5 * energy) * Math.min(1, curtain.depth))
			context.lineWidth = 1.6
			context.beginPath()
			context.moveTo(leftEdge, artTop + 1)
			context.lineTo(rightEdge, artTop + 1)
			context.stroke()
			context.strokeStyle = withAlpha(accent, 0.14 + 0.16 * energy)
			context.lineWidth = 4
			context.beginPath()
			context.moveTo(leftEdge, artTop + 2)
			context.lineTo(rightEdge, artTop + 2)
			context.stroke()
		}
		context.globalAlpha = 1
		context.restore()
	},
}

/**
 * 余晖拖尾 (afterglow)
 *
 * 视觉机制：一颗光点在天空带里缓慢转向、撞边反弹，身后拖一条长曝光似的余晖。
 * 越旧的轨迹越淡，档位越高点速越快、拖尾越长、衰减越慢。
 *
 * 能量映射：拖尾 4 + 14e 段（16 帧环形缓冲封顶）；衰减 0.82 + 0.12e / 段；
 * 点速 40 + 140e px/s。位置写入定长环形缓冲、用索引取模回看，禁止 shift()。
 * 布局：34/bar/off —— 只在 34px 天空带作画，不占 band、不显示频谱。
 *
 * 轨迹坐标、角度、时间都在 createState 里预分配；step/paint 不建数组/对象。
 * 光点头优先用 frame.sprite，缺图时回退 arc 假辉光。
 */
const afterglowEffect = {
	id: 'afterglow',
	name: '余晖拖尾',
	summary: '光点在天空里转向反弹，16 帧环形缓冲拖出越旧越淡的长曝光余晖',
	category: 'light',
	layout: { sky: 34, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		// 16 帧定长环形缓冲，每帧写一个点；x/y 各一条。
		trailX: new Float64Array(16),
		trailY: new Float64Array(16),
		head: 0,
		filled: 0,
		x: 0,
		y: 0,
		angle: 0,
		time: 0,
		ready: false,
	}),

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 34)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const speed = 40 + 140 * energy

		if (!state.ready) {
			state.x = width * 0.5
			state.y = sky * 0.5
			state.angle = 0.35
			state.head = 0
			state.filled = 0
			state.ready = true
		}

		state.time += dt
		// 缓慢转向：角度随 sin 漂移，光点自己转弯，轨迹不会是一条直线。
		state.angle += Math.sin(state.time * 0.9 + 0.7) * (0.9 + 0.6 * energy) * dt
		let angle = state.angle % TAU
		if (angle > Math.PI) angle -= TAU
		else if (angle < -Math.PI) angle += TAU
		state.angle = angle

		state.x += Math.cos(angle) * speed * dt
		state.y += Math.sin(angle) * speed * dt

		// 撞边反弹：把方向角沿墙翻折，位置再 clamp 一次防 dt 抖动越界。
		const margin = 5
		const left = margin
		const right = Math.max(left + 1, width - margin)
		const top = margin
		const bottom = Math.max(top + 1, sky - margin)
		if (state.x < left) {
			state.x = left
			state.angle = Math.PI - state.angle
		} else if (state.x > right) {
			state.x = right
			state.angle = Math.PI - state.angle
		}
		if (state.y < top) {
			state.y = top
			state.angle = -state.angle
		} else if (state.y > bottom) {
			state.y = bottom
			state.angle = -state.angle
		}
		state.x = Math.max(left, Math.min(right, state.x))
		state.y = Math.max(top, Math.min(bottom, state.y))

		// 环形缓冲：覆写 head 槽位，head 自增取模，不 push / shift。
		state.trailX[state.head] = state.x
		state.trailY[state.head] = state.y
		state.head = (state.head + 1) % 16
		if (state.filled < 16) state.filled += 1
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const trailX = state.trailX
		const trailY = state.trailY
		// 4 + 14e 段；16 槽缓冲封顶（e=1 时公式是 18，按缓冲长度截断）。
		const active = Math.min(16, Math.max(2, Math.round(4 + 14 * energy)))
		const decay = 0.82 + 0.12 * energy
		const head = state.head
		const filled = state.filled

		context.save()
		context.lineCap = 'round'
		context.lineJoin = 'round'
		context.strokeStyle = accent
		context.fillStyle = accent

		// 从最新一段往旧画：每退一段乘一次衰减，越旧越淡。
		let alpha = 0.9
		for (let age = 0; age < active - 1; age += 1) {
			if (age > filled - 2) break
			const newer = (head - 1 - age + 16) % 16
			const older = (head - 2 - age + 16) % 16
			alpha *= decay
			context.globalAlpha = alpha
			context.lineWidth = Math.max(0.5, 1.8 - age * 0.06)
			context.beginPath()
			context.moveTo(trailX[older], trailY[older])
			context.lineTo(trailX[newer], trailY[newer])
			context.stroke()
		}

		// 光点头：外圈假辉光 + 亮核；有精灵时再叠一层柔光点。
		const headX = head === 0 ? trailX[15] : trailX[head - 1]
		const headY = head === 0 ? trailY[15] : trailY[head - 1]
		context.globalAlpha = 0.16 + 0.1 * energy
		context.beginPath()
		context.arc(headX, headY, 3 + 1.5 * energy, 0, TAU)
		context.fill()
		context.globalAlpha = 0.95
		context.beginPath()
		context.arc(headX, headY, 1.6 + 0.8 * energy, 0, TAU)
		context.fill()
		if (sprite !== null) {
			const size = 5 + 3 * energy
			context.globalAlpha = 0.6
			context.drawImage(sprite, headX - size / 2, headY - size / 2, size, size)
		}
		context.globalAlpha = 1

		context.restore()
	},
}

/**
 * 黑体余烬 (embers)
 *
 * 视觉机制：火星从天空带底部缓慢上升，底部靠近火口处偏白/亮，升得越高越冷却、
 * 颜色混向暗色；每颗按 sin(8t + i) 闪烁，像余烬里的忽明忽暗。
 *
 * 能量映射：火星 20 + 50e（≤70）；上升 10 + 40e px/s；闪烁 sin(8t + i)；
 * 颜色 shade(A, -0.3 + 0.5·(1 - y/H))，H 是天空带高度。粒子池在 createState
 * 预分配，升到顶后从底部重生；按 1–2px 方点绘制。
 * 布局：56/bar/off —— 只在 56px 天空带作画，不占 band、不显示频谱。
 *
 * 70 个粒子与 24 级色板都在 createState 预分配；色板只在 accent 变化时重建，
 * step/paint 不建数组/对象。frame.sprite 存在时叠一层柔光，缺图只画方点。
 */
const embersEffect = {
	id: 'embers',
	name: '黑体余烬',
	summary: '火星从底部升起，底部偏白越高越暗，按 sin(8t+i) 闪烁，颜色在强调色与白黑间过渡',
	category: 'light',
	layout: { sky: 56, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 70
		// 固定种子 LCG：初始散布、速度与摆动相位可复现。
		let seed = 0x1f123bb5
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const pool = []
		for (let index = 0; index < MAX; index += 1) {
			pool.push({
				x: 0,
				y: 0,
				nx: random(),
				ny: random(),
				speedFactor: 0.7 + 0.6 * random(),
				phase: random() * Math.PI * 2,
			})
		}
		return {
			pool,
			active: 0,
			time: 0,
			seed: 0x2545f491,
			palette: new Array(24),
			accentSource: '',
			baseR: 120,
			baseG: 200,
			baseB: 255,
			ready: false,
		}
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 56)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const target = Math.max(4, Math.min(70, Math.round(20 + 50 * energy)))
		const rise = 10 + 40 * energy
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const pool = state.pool

		// 只在 accent 变化时重建 24 级色板：从 accent 混向黑再混向白。
		if (accent !== state.accentSource) {
			const open = accent.indexOf('(')
			const close = accent.indexOf(')', open + 1)
			let r = 120
			let g = 200
			let b = 255
			if (open > 0 && close > open) {
				const parts = accent.slice(open + 1, close).split(',')
				const parsedR = Number(parts[0])
				const parsedG = Number(parts[1])
				const parsedB = Number(parts[2])
				if (Number.isFinite(parsedR) && Number.isFinite(parsedG) && Number.isFinite(parsedB)) {
					r = parsedR
					g = parsedG
					b = parsedB
				}
			}
			state.baseR = r
			state.baseG = g
			state.baseB = b
			state.accentSource = accent
			for (let index = 0; index < 24; index += 1) {
				const amount = -0.35 + (0.6 * index) / 23
				const shadeTarget = amount < 0 ? 0 : 255
				const mix = Math.min(1, Math.abs(amount))
				const rr = Math.round(r + (shadeTarget - r) * mix)
				const gg = Math.round(g + (shadeTarget - g) * mix)
				const bb = Math.round(b + (shadeTarget - b) * mix)
				state.palette[index] = `rgb(${rr}, ${gg}, ${bb})`
			}
		}

		if (!state.ready) {
			for (let index = 0; index < pool.length; index += 1) {
				const ember = pool[index]
				ember.x = ember.nx * width
				ember.y = ember.ny * sky
			}
			state.ready = true
		}

		state.time += dt
		for (let index = 0; index < target; index += 1) {
			const ember = pool[index]
			ember.y -= rise * ember.speedFactor * dt
			ember.x += Math.sin(state.time * 1.6 + ember.phase) * (4 + 6 * energy) * dt
			if (ember.x < 0) ember.x += width
			else if (ember.x > width) ember.x -= width
			// 升到顶：从底部重生，换一个横向位置与速度。
			if (ember.y < 0) {
				state.seed = (state.seed * 1664525 + 1013904223) >>> 0
				const nextX = (state.seed / 4294967296) * width
				state.seed = (state.seed * 1664525 + 1013904223) >>> 0
				ember.speedFactor = 0.7 + 0.6 * (state.seed / 4294967296)
				ember.x = nextX
				ember.y = sky - 0.5
			}
			// 兜底：无论 dt 多大都不让火星爬出天空带。
			if (ember.y > sky) ember.y = sky - 0.5
		}
		state.active = target
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const sprite = frame.sprite ?? null
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 56)
		const pool = state.pool
		const palette = state.palette
		const active = state.active

		context.save()
		for (let index = 0; index < active; index += 1) {
			const ember = pool[index]
			const flicker = 0.5 + 0.5 * Math.sin(8 * state.time + index)
			const brightness = 0.25 + 0.75 * flicker
			// shade(A, -0.3 + 0.5·(1 - y/H))：y 是「离底部的高度」，换成 canvas
			// 坐标即 -0.3 + 0.5·(canvasY/H)。底部 0.2（靠近火口、偏白），
			// 顶部 -0.3（冷却、混向暗色）。
			const heightFraction = clamp01(ember.y / sky)
			const amount = -0.3 + 0.5 * heightFraction
			let colorIndex = Math.round(((amount + 0.35) / 0.6) * 23)
			if (colorIndex < 0) colorIndex = 0
			else if (colorIndex > 23) colorIndex = 23

			const size = flicker > 0.7 ? 2 : 1
			const py = Math.max(0, Math.min(sky - size, ember.y))
			if (sprite !== null) {
				const glowY = Math.max(0, Math.min(sky - 4, py - 2))
				context.globalAlpha = 0.06 + 0.12 * flicker
				context.drawImage(sprite, ember.x - 2, glowY, 4, 4)
			}
			context.globalAlpha = brightness
			context.fillStyle = palette[colorIndex]
			context.fillRect(ember.x, py, size, size)
		}
		context.globalAlpha = 1
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
		// 归一化用振幅的 L1 和 ΣA_k：它对任意相位都是上界，波形永远不会越出 band。
		// 之前按 phase=0 采样峰值归一，相位一转峰值就超过基准（H=8 时 1.5 倍），
		// 高档会把波脊画到 band 外。
		let running = 0
		for (let h = 1; h <= HARMONICS; h += 1) {
			running += amplitudes[h - 1]
			norms[h - 1] = running > 0 ? running : 1
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
				// clamp 只是保险：L1 归一后 |wave| <= norm 恒成立。
				const value = Math.max(-1, Math.min(1, wave / norm))
				const py = midY + value * amplitude
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
 * 驻波 (standing-wave)
 *
 * 两端固定的弦上形成驻波，节点数随档位阶跃：
 * 模态 m = 1 + floor(3e)，y = amp·sin(mπx/W)·cos(2πft)，振幅 3 + 11e、f = 1 + 2e。
 * 模态跳变时对上一模态做 0.15s 交叉淡化，避免整条线瞬间闪一下。
 */
/** One mode of the string, drawn as a single polyline (scalars only). */
function traceModal(context, modal, alpha, accent, width, mid, oscillation, amplitude) {
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

const standingWaveEffect = {
	id: 'standing-wave',
	name: '驻波',
	summary: '两端固定的弦上驻波，档位越高模态越高、节点越多',
	category: 'wave',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ phase: 0, modal: 1, previousModal: 1, blend: 1 }),

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		// Integrate the oscillation phase: multiplying the current frequency by a
		// running clock jumps the string whenever the level (and so f) changes.
		state.phase = (state.phase + Math.PI * 2 * (1 + 2 * level) * dt) % (Math.PI * 2)
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
		const oscillation = Math.cos(state.phase)
		const ease = state.blend * state.blend * (3 - 2 * state.blend)

		context.save()
		context.lineJoin = 'round'
		if (ease < 1) traceModal(context, state.previousModal, 0.35 * (1 - ease), accent, width, mid, oscillation, amplitude)
		traceModal(context, state.modal, 0.35 + 0.65 * ease, accent, width, mid, oscillation, amplitude)

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

		const PHYSICS_EFFECTS = [doublePendulumEffect, springMeshEffect, gyroscopeEffect, dominoesEffect, spirographEffect, fourierEpicyclesEffect, flowFieldEffect, boidsEffect, accretionDiskEffect, sandstormEffect, firefliesEffect, sevenSegmentEffect, segmentsEffect, gaugeEffect, jellyfishEffect, vineEffect, microbeEffect, bloomEffect, metaballsEffect, squashEffect, polarEffect, auroraEffect, afterglowEffect, embersEffect, harmonicsEffect, chirpEffect, standingWaveEffect]

		// ---- end physics effects ----

		/**
		 * A soft particle sprite (32x32, generated with GPT Image) that particle
		 * effects may use instead of drawing circles. Loaded once per page; the
		 * frame carries `sprite` only after it decodes, so an effect must keep a
		 * procedural fallback.
		 */
		let particleSpriteElement = null
		function particleSprite() {
			if (particleSpriteElement !== null) return particleSpriteElement
			if (typeof window === 'undefined' || typeof window.Image !== 'function') return null
			const image = new window.Image()
			image.decoding = 'async'
			image.src = `/plugins/${ART_PACKAGE}/assets/particles/dot.png`
			particleSpriteElement = image
			return image
		}

		/** The sprite once it can be drawn, else null. */
		function readyParticleSprite() {
			const image = particleSprite()
			if (image === null) return null
			return image.complete === true && image.naturalWidth > 0 ? image : null
		}

		/**
		 * A 64x64 greyscale noise mask (GPT Image, downscaled). Effects that
		 * dissolve or erode something sample it instead of hashing per frame;
		 * `frame.noise` is null until it decodes, so they keep a fallback.
		 */
		let noiseMaskElement = null
		function noiseMask() {
			if (noiseMaskElement !== null) return noiseMaskElement
			if (typeof window === 'undefined' || typeof window.Image !== 'function') return null
			const image = new window.Image()
			image.decoding = 'async'
			image.src = `/plugins/${ART_PACKAGE}/assets/particles/noise.png`
			noiseMaskElement = image
			return image
		}

		function readyNoiseMask() {
			const image = noiseMask()
			if (image === null) return null
			return image.complete === true && image.naturalWidth > 0 ? image : null
		}

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
			{ id: 'particle', name: '粒子场', note: '群集、流场、磁粉' },
			{ id: 'geometry', name: '几何线条', note: '参数曲线与递归' },
			{ id: 'light', name: '光与色', note: '辉光、扫描、色散' },
			{ id: 'morph', name: '形变与过渡', note: '融合、挤压、极坐标' },
			{ id: 'life', name: '生命角色', note: '节律、生长、姿态' },
			{ id: 'data', name: '数据与文字', note: '读数、刻度、字形' },
			{ id: 'wave', name: '波形信号', note: '解析曲线与信号' },
			{ id: 'character', name: '角色演出', note: '插画式角色动画' },
		]

		/** id -> category. Effects without an entry fall back to 经典. */
		const EFFECT_CATEGORY = {
			kunpeng: 'character',
			// the ball pit is a little physics solver, so it lives with the others
			'particle-wave': 'physics',
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
					const frame = { energy, accent, totalLevels, width, height, dt, band, trackY, sky, rail: RAIL_HEIGHT, artBox: { top: 0, height: sky }, sprite: readyParticleSprite(), noise: readyNoiseMask(), art: readyLifeArt(effect.id) }
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
									role: 'menuitem',
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
								role: 'menuitem',
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
									role: 'menuitemradio',
									'aria-checked': selected ? 'true' : 'false',
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
						role: 'menu',
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
							'aria-haspopup': 'menu',
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
