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
		const reactDom = require('react-dom')
		const h = react.createElement

		const name = 'model-effort-chips'
		const inject = ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session']

		const SEAT = 'conversation.input.model'
		const FALLBACK = 'conversation.input.right'
		const TAG = 'dsh-model-effort-chips'

		const EMPTY_STATE = { current: null, groups: [], status: 'idle', pending: null, error: null }

		/** Bumped whenever the injected stylesheet changes; stale sheets are replaced. */
		const STYLE_VERSION = '0.7.0'

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

		/** Wave stroke width: thin at off, noticeably thicker at max. */
		function strokeWidthFor(energy) {
			return 1 + 2.4 * Math.max(0, Math.min(1, energy))
		}

		/** True when the composer is too narrow to show the chip text. */
		function isCompact(composerWidth) {
			return typeof composerWidth === 'number' && composerWidth > 0 && composerWidth < COMPACT_BELOW
		}

		/** Deterministic wave polyline points for a given energy. */
		function wavePoints(energy, width = 300, height = 26) {
			const mid = height / 2
			const amplitude = 1.5 + 9 * Math.max(0, Math.min(1, energy))
			const points = []
			for (let x = 0; x <= width; x += 6) {
				const y = mid - amplitude * (Math.sin(x / 16) * 0.55 + Math.sin(x / 41 + 1.2) * 0.45)
				points.push(`${x},${y.toFixed(2)}`)
			}
			return points.join(' ')
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
		const MAGNET_RANGE = 0.065
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

		// ----------------------------------------------------------------- styles

		/**
		 * One stylesheet for the whole plugin, injected once per document.
		 * Everything that decides a shape or a color lives inline or as an SVG
		 * attribute instead; this sheet only carries layout, type and motion.
		 */
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
.mec-particles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.mec-particle {
  position: absolute; width: 3px; height: 3px; border-radius: 50%;
  opacity: 0; animation: mec-float 2.6s ease-in infinite;
}
@keyframes mec-float {
  0% { opacity: 0; transform: translateY(6px) scale(.6); }
  35% { opacity: .9; }
  100% { opacity: 0; transform: translateY(-14px) scale(1.1); }
}
.mec-spectrum { position: absolute; right: 0; bottom: 0; display: flex; align-items: flex-end; gap: 2px; height: 24px; }
.mec-spectrum span {
  width: 2px; border-radius: 1px; transform-origin: bottom;
  animation: mec-pulse 1.1s ease-in-out infinite;
}
@keyframes mec-pulse { 0%,100% { transform: scaleY(.55); } 50% { transform: scaleY(1); } }

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
  	.mec-label, .mec-spectrum span, .mec-particle { transition: none; animation: none; }
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

		/** Resolve one session's shared directory, never throwing. */
		function tryDirectory(ctx, sessionId) {
			if (sessionId === undefined || sessionId === null) return null
			try {
				const directories = ctx.modelDirectories
				if (directories === undefined || typeof directories.directoryFor !== 'function') return null
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
		function useDirectory(ctx, sessionId) {
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
			}, [ctx, sessionId])

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

			return reactDom.createPortal(
				h('div', { ref: panelRef, className: 'mec-panel', 'data-dsh-mec': props.kind, style: props.style }, props.children),
				document.body
			)
		}

		/**
		 * One knob: a single absolutely-positioned SVG circle.
		 *
		 * Every placement value is inline. The host shell was overriding the
		 * class-based `position: absolute`, which left the knobs stacked in
		 * normal flow off the track; inline styles are the only thing the shell
		 * cannot win against.
		 */
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
						transition: 'left .12s linear, top .16s ease, filter .16s ease',
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
		 * The effort slider: energy wave and spectrum on top, the tinted track in
		 * the middle, level ticks and labels below. Drag anywhere on the rail; the
		 * knob follows live, magnets onto a level when it comes close, snaps on
		 * release and writes once. Arrow keys step one level.
		 */
		function EffortSlider(props) {
			const { levels, effectiveEffort, onChoose, disabled } = props
			const railRef = react.useRef(null)
			const trackRef = react.useRef(null)
			const dragRef = react.useRef(null)
			const [drag, setDrag] = react.useState(null) // { fraction, snapped } | null
			const isLight = useIsLightTheme()

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

			const fractionFromEvent = (event) => {
				const node = trackRef.current ?? railRef.current
				if (node === null) return null
				const rect = node.getBoundingClientRect()
				if (rect.width === 0) return null
				return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
			}

			const applyPointer = (event) => {
				const raw = fractionFromEvent(event)
				if (raw === null) return
				const magnetized = magnetize(raw, count)
				setDrag({ fraction: magnetized, snapped: Math.abs(raw - magnetized) > 0.002 })
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

			const wave = wavePoints(energy)
			const strokeWidth = strokeWidthFor(energy)

			// Everything below scales with energy so a low level is calm and the
			// top level is visibly dense.
			const particleCount = energy > 0.18 ? Math.round(3 + 9 * energy) : 0
			const particleSize = 2 + 2 * energy
			const particleDuration = 2.8 - 1.2 * energy
			const spectrumBars = energy > 0.22 ? Math.round(4 + 14 * energy) : 0
			const spectrumDuration = 1.25 - 0.55 * energy
			const spectrumHeight = (index) => 3 + 22 * energy * (0.35 + 0.65 * Math.abs(Math.sin(index * 1.7)))

			const knotBase = dragging ? 30 + (drag.snapped ? 3 : 0) : 24

			return h('div', { className: 'mec-slider' }, [
				h('div', { key: 'title', className: 'mec-slider-title' }, '思考强度'),
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
				h('div', { key: 'wave', className: 'mec-wave', style: { position: 'relative', height: '26px', marginBottom: '2px' } }, [
					h(
						'svg',
						{
							key: 'svg',
							className: 'mec-wave-svg',
							viewBox: '0 0 300 26',
							preserveAspectRatio: 'none',
							style: { display: 'block', width: '100%', height: '26px', overflow: 'visible' },
						},
						h('polyline', {
							points: wave,
							fill: 'none',
							stroke: previewAccent,
							strokeWidth,
							strokeLinecap: 'round',
							strokeLinejoin: 'round',
						})
					),
					particleCount > 0
						? h(
								'div',
								{ key: 'p', className: 'mec-particles' },
								Array.from({ length: particleCount }, (_value, index) =>
									h('span', {
										key: index,
										className: 'mec-particle',
										style: {
											left: `${6 + index * (88 / Math.max(1, particleCount - 1))}%`,
											width: `${particleSize}px`,
											height: `${particleSize}px`,
											background: previewAccent,
											animationDuration: `${particleDuration}s`,
											animationDelay: `${index * 180}ms`,
										},
									})
								)
							)
						: null,
					spectrumBars > 0
						? h(
								'div',
								{ key: 's', className: 'mec-spectrum' },
								Array.from({ length: spectrumBars }, (_value, index) =>
									h('span', {
										key: index,
										style: {
											height: `${spectrumHeight(index)}px`,
											background: previewAccent,
											opacity: 0.55 + 0.45 * energy,
											animationDuration: `${spectrumDuration}s`,
											animationDelay: `${index * 55}ms`,
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
								opacity: disabled ? 0.6 : 1,
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
			])
		}

		// ----------------------------------------------------------------- seat

		function createSeat(ctx) {
			function ModelEffortSeat(props) {
				const sessionId = props?.sessionId
				const directory = useDirectory(ctx, sessionId)
				const state = useDirectoryState(directory)
				const view = resolveSelection(state)

				const [openPanel, setOpenPanel] = react.useState(null) // 'model' | 'effort' | null
				const [rect, setRect] = react.useState(null)
				const seatRef = react.useRef(null)
				const modelRef = react.useRef(null)
				const effortRef = react.useRef(null)
				const loggedRef = react.useRef(false)
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

				const commit = async (selection) => {
					closePanel()
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

				const chooseEffort = (level) => {
					if (view.current === null) return
					if (view.effectiveEffort === level.id) {
						closePanel()
						return
					}
					void commit({
						provider: view.current.provider,
						model: view.current.model,
						reasoningEffort: level.id,
					})
				}

				const busy = view.pending !== null || state.status === 'selecting'
				const locked = props?.locked === true
				const disabled = busy || locked

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
									title: `思考强度\uff1a${effortText}`,
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

		function apply(ctx) {
			console.info(`[${TAG}] apply`)
			mountOccupant(ctx, SEAT, { name: SEAT, priority: -1 }, createSeat(ctx))

			try {
				ctx.slots.inject(FALLBACK, () => {
					try {
						return ctx.slots.register({ name: FALLBACK }, () =>
							h('button', { type: 'button', className: 'mec-chip', 'data-dsh-mec': 'fallback', title: 'model-effort-chips (fallback entry)' }, 'model \u00b7 effort')
						)
					} catch (error) {
						console.warn(`[${TAG}] fallback register failed`, error)
						return () => {}
					}
				})
			} catch (error) {
				console.warn(`[${TAG}] fallback inject failed`, error)
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
			strokeWidthFor,
			isCompact,
			magnetize,
			shade,
			accentFor,
			parseColorToRgb,
			luminanceOf,
			detectLightTheme,
			wavePoints,
		}
		return module.exports
	},
})
