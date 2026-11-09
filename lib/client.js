/**
 * dsh-model-effort-chips — browser half.
 *
 *   - model chip  : opens the session's catalog, one click switches model.
 *                   The reasoning level carries across by INDEX (per user
 *                   decision): high (3rd) stays 3rd on the next model, and a
 *                   level the target does not declare clamps to the nearest
 *                   one it does.
 *   - effort chip : opens the effort slider drawn as the reference artwork:
 *                   energy wave + spectrum above, a level-tinted gradient
 *                   track through the middle, one knob per declared level and
 *                   the level labels below. The active level is a glowing
 *                   sphere; you can CLICK a level or DRAG the knob along the
 *                   track (snap on release) and the wave/spectrum react live.
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

		/**
		 * Color for level `index` of `count` levels, sampled along the palette.
		 * Position drives the color, so a 2-level model is green->magenta and a
		 * 5-level model walks the whole ramp. Always returns `rgb(...)`.
		 */
		function colorAt(index, count) {
			if (count <= 1) return lerpColor(PALETTE[0], PALETTE[0], 0)
			const t = Math.max(0, Math.min(1, index / (count - 1)))
			const scaled = t * (PALETTE.length - 1)
			const lower = Math.floor(scaled)
			const upper = Math.min(PALETTE.length - 1, lower + 1)
			return lerpColor(PALETTE[lower], PALETTE[upper], scaled - lower)
		}

		/** Color for a continuous position 0..1. */
		function colorAtFraction(fraction) {
			const t = Math.max(0, Math.min(1, fraction))
			const scaled = t * (PALETTE.length - 1)
			const lower = Math.floor(scaled)
			const upper = Math.min(PALETTE.length - 1, lower + 1)
			return lerpColor(PALETTE[lower], PALETTE[upper], scaled - lower)
		}

		/** Horizontal position of level `index`, as a percentage. */
		function percentAt(index, count) {
			if (count <= 1) return 50
			return (index / (count - 1)) * 100
		}

		/** Energy 0..1 for a level index (drives wave amplitude and particles). */
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

		/** Deterministic wave polyline points for a given energy. */
		function wavePoints(energy, width = 300, height = 26) {
			const mid = height / 2
			const amplitude = 1.5 + 9 * energy
			const points = []
			for (let x = 0; x <= width; x += 6) {
				const y = mid - amplitude * (Math.sin(x / 16) * 0.55 + Math.sin(x / 41 + 1.2) * 0.45)
				points.push(`${x},${y.toFixed(2)}`)
			}
			return points.join(' ')
		}

		// ----------------------------------------------------------------- styles

		/**
		 * One stylesheet for the whole plugin, injected once per document.
		 * Knob geometry is set inline (see EffortSlider) because the host shell
		 * styles `button` globally and a bare class rule can lose to it.
		 */
		function ensureStyles() {
			if (typeof document === 'undefined') return
			if (document.getElementById('dsh-model-effort-chips-style') !== null) return
			const style = document.createElement('style')
			style.id = 'dsh-model-effort-chips-style'
			style.textContent = `
.mec-seat { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.mec-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 999px; background: transparent;
  color: inherit; font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
  max-width: 220px; white-space: nowrap; transition: background .15s ease, border-color .15s ease;
}
.mec-chip:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.mec-chip:disabled { cursor: default; }
.mec-chip:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 40%, transparent); outline-offset: 1px; }
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
.mec-row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }

/* ---- effort slider ---- */
.mec-slider { padding: 10px 14px 6px; width: 312px; touch-action: none; }
.mec-slider-title { font-size: 11px; opacity: .55; margin-bottom: 8px; letter-spacing: .02em; }
.mec-wave { position: relative; height: 26px; margin-bottom: 2px; }
.mec-wave-svg { display: block; width: 100%; height: 26px; overflow: visible; }
.mec-wave-line { fill: none; stroke-width: 1.6; stroke-linecap: round; opacity: .9; }
.mec-wave-halo { fill: none; stroke-width: 5; stroke-linecap: round; opacity: .18; }
.mec-particles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.mec-particle {
  position: absolute; width: 3px; height: 3px; border-radius: 50%;
  background: #f0abfc; opacity: 0; animation: mec-float 2.6s ease-in infinite;
}
@keyframes mec-float {
  0% { opacity: 0; transform: translateY(6px) scale(.6); }
  35% { opacity: .9; }
  100% { opacity: 0; transform: translateY(-14px) scale(1.1); }
}
.mec-spectrum { position: absolute; right: 0; bottom: 0; display: flex; align-items: flex-end; gap: 2px; height: 24px; }
.mec-spectrum span {
  width: 2px; border-radius: 1px; background: linear-gradient(180deg, #f0abfc, #a855f7);
  transform-origin: bottom; animation: mec-pulse 1.1s ease-in-out infinite;
}
@keyframes mec-pulse { 0%,100% { transform: scaleY(.55); } 50% { transform: scaleY(1); } }

.mec-rail {
  position: relative; height: 58px; margin: 0 2px 2px; outline: none;
  touch-action: none; cursor: pointer; user-select: none;
}
.mec-rail:focus-visible .mec-track { box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent); }
.mec-track {
  position: absolute; left: 0; right: 0; top: 12px; height: 8px; border-radius: 999px;
  transition: box-shadow .15s ease;
}
.mec-track-glow {
  position: absolute; left: 0; top: 3px; height: 26px; border-radius: 999px;
  opacity: .38; filter: blur(10px); pointer-events: none; transition: width .12s linear;
}
.mec-knob {
  position: absolute; top: 16px; border-radius: 999px; pointer-events: none;
  box-sizing: border-box; transition: left .12s linear, width .16s ease, height .16s ease,
    margin .16s ease, box-shadow .16s ease, background .16s ease, border-color .16s ease;
}
.mec-knob.is-idle {
  background: var(--dsw-alias-bg-base, #16181d);
  border: 2px solid var(--mec-color);
  box-shadow: inset 0 0 6px color-mix(in srgb, var(--mec-color) 45%, transparent);
}
.mec-knob.is-active {
  background: radial-gradient(circle at 34% 30%, #ffffff 0%, var(--mec-color) 70%);
  border: 2px solid color-mix(in srgb, var(--mec-color) 55%, #ffffff);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--mec-color) 16%, transparent),
    0 0 20px color-mix(in srgb, var(--mec-color) 70%, transparent);
}
.mec-label {
  position: absolute; top: 32px; transform: translateX(-50%); padding: 3px 9px;
  border-radius: 999px; color: var(--mec-color); font-size: 12px; white-space: nowrap;
  opacity: .62; pointer-events: none; transition: opacity .15s ease, background .15s ease,
    box-shadow .15s ease, transform .15s ease;
}
.mec-label.is-active {
  opacity: 1; background: color-mix(in srgb, var(--mec-color) 18%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--mec-color) 32%, transparent);
  transform: translateX(-50%) scale(1.04);
}
@media (prefers-reduced-motion: reduce) {
  .mec-knob, .mec-label, .mec-track-glow, .mec-spectrum span, .mec-particle { transition: none; animation: none; }
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
		 * The effort slider: energy wave and spectrum on top, the tinted track in
		 * the middle, level labels below. Drag anywhere on the rail to slide the
		 * knob; it snaps to the nearest declared level on release and only then
		 * writes. Arrow keys move one level at a time.
		 */
		function EffortSlider(props) {
			const { levels, effectiveEffort, onChoose, disabled } = props
			const railRef = react.useRef(null)
			const trackRef = react.useRef(null)
			const dragRef = react.useRef(null)
			const [dragFraction, setDragFraction] = react.useState(null)

			const count = levels.length
			const activeIndex = Math.max(
				0,
				levels.findIndex((level) => level.id === effectiveEffort)
			)
			const dragging = dragFraction !== null
			const previewFraction = dragging ? dragFraction : percentAt(activeIndex, count) / 100
			const previewPercent = previewFraction * 100
			const previewColor = dragging ? colorAtFraction(previewFraction) : colorAt(activeIndex, count)
			const energy = dragging ? previewFraction : energyFor(activeIndex, count)
			const colors = levels.map((_level, index) => colorAt(index, count))
			const gradientStops = colors.map((color, index) => `${color} ${percentAt(index, count).toFixed(2)}%`).join(', ')

			const fractionFromEvent = (event) => {
				const node = trackRef.current ?? railRef.current
				if (node === null) return null
				const rect = node.getBoundingClientRect()
				if (rect.width === 0) return null
				return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
			}

			const commitFraction = (fraction) => {
				if (disabled || fraction === null) return
				const index = nearestIndex(fraction, count)
				onChoose(levels[index])
			}

			const onPointerDown = (event) => {
				if (disabled || event.button !== 0) return
				event.preventDefault()
				event.stopPropagation()
				const fraction = fractionFromEvent(event)
				if (fraction === null) return
				dragRef.current = { pointerId: event.pointerId, moved: false }
				setDragFraction(fraction)
				railRef.current?.setPointerCapture?.(event.pointerId)
				railRef.current?.focus?.()
			}

			const onPointerMove = (event) => {
				const drag = dragRef.current
				if (drag === null || drag.pointerId !== event.pointerId) return
				const fraction = fractionFromEvent(event)
				if (fraction === null) return
				drag.moved = true
				setDragFraction(fraction)
			}

			const endDrag = (event) => {
				const drag = dragRef.current
				if (drag === null || drag.pointerId !== event.pointerId) return
				dragRef.current = null
				const fraction = fractionFromEvent(event) ?? dragFraction
				setDragFraction(null)
				railRef.current?.releasePointerCapture?.(event.pointerId)
				commitFraction(fraction)
			}

			const onKeyDown = (event) => {
				if (disabled) return
				const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
				if (step === 0) return
				event.preventDefault()
				event.stopPropagation()
				const next = Math.max(0, Math.min(count - 1, activeIndex + step))
				if (next !== activeIndex) onChoose(levels[next])
			}

			const wave = wavePoints(energy)
			const particleCount = energy > 0.34 ? Math.round(2 + energy * 5) : 0
			const spectrumBars = energy > 0.4 ? 12 : 0

			return h('div', { className: 'mec-slider' }, [
				h('div', { key: 'title', className: 'mec-slider-title' }, '思考强度'),
				h('div', { key: 'wave', className: 'mec-wave' }, [
					h(
						'svg',
						{ key: 'svg', className: 'mec-wave-svg', viewBox: '0 0 300 26', preserveAspectRatio: 'none' },
						[
							h('defs', { key: 'defs' }, [
								h(
									'linearGradient',
									{ key: 'g', id: 'mec-wave-grad', x1: '0', y1: '0', x2: '1', y2: '0' },
									[
										h('stop', { key: 's0', offset: '0%', stopColor: '#22c55e' }),
										h('stop', { key: 's1', offset: '55%', stopColor: colors[activeIndex] ?? '#a855f7' }),
										h('stop', { key: 's2', offset: '100%', stopColor: '#e879f9' }),
									]
								),
							]),
							h('polyline', { key: 'h', className: 'mec-wave-halo', points: wave, stroke: previewColor }),
							h('polyline', { key: 'l', className: 'mec-wave-line', points: wave, stroke: 'url(#mec-wave-grad)' }),
						]
					),
					particleCount > 0
						? h(
								'div',
								{ key: 'p', className: 'mec-particles' },
								Array.from({ length: particleCount }, (_v, index) =>
									h('span', {
										key: index,
										className: 'mec-particle',
										style: {
											left: `${8 + index * (84 / Math.max(1, particleCount - 1))}%`,
											animationDelay: `${index * 240}ms`,
										},
									})
								)
							)
						: null,
					spectrumBars > 0
						? h(
								'div',
								{ key: 's', className: 'mec-spectrum' },
								Array.from({ length: spectrumBars }, (_v, index) =>
									h('span', {
										key: index,
										style: {
											height: `${4 + Math.round(18 * energy * (0.45 + 0.55 * Math.abs(Math.sin(index * 1.7))))}px`,
											animationDelay: `${index * 70}ms`,
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
						h('div', {
							key: 'glow',
							className: 'mec-track-glow',
							style: {
								width: `${previewPercent}%`,
								background: `linear-gradient(90deg, ${colors[0]}, ${previewColor})`,
							},
						}),
						h('div', {
							key: 'track',
							ref: trackRef,
							className: 'mec-track',
							'data-dsh-mec': 'track',
							style: { background: `linear-gradient(90deg, ${gradientStops})` },
						}),
						// Idle knobs are decoration only: geometry lives inline so the
						// host shell's global button/div rules cannot square them off.
						...levels.map((level, index) =>
							index === activeIndex && !dragging
								? null
								: h('div', {
										key: `knob:${level.id}`,
										className: 'mec-knob is-idle',
										'data-effort': level.id,
										style: {
											left: `${percentAt(index, count)}%`,
											width: '13px',
											height: '13px',
											margin: '-6.5px 0 0 -6.5px',
											borderRadius: '999px',
											'--mec-color': colorAt(index, count),
										},
									})
						),
						h('div', {
							key: 'active-knob',
							className: 'mec-knob is-active',
							'data-dsh-mec': 'active-knob',
							style: {
								left: `${previewPercent}%`,
								width: dragging ? '30px' : '24px',
								height: dragging ? '30px' : '24px',
								margin: dragging ? '-15px 0 0 -15px' : '-12px 0 0 -12px',
								borderRadius: '999px',
								'--mec-color': previewColor,
							},
						}),
						...levels.map((level, index) =>
							h(
								'div',
								{
									key: `label:${level.id}`,
									className: `mec-label${index === (dragging ? nearestIndex(previewFraction, count) : activeIndex) ? ' is-active' : ''}`,
									'data-effort': level.id,
									style: { left: `${percentAt(index, count)}%`, '--mec-color': colorAt(index, count) },
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
				const modelRef = react.useRef(null)
				const effortRef = react.useRef(null)
				const loggedRef = react.useRef(false)

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

				const toggle = (which) => {
					if (openPanel === which) {
						setOpenPanel(null)
						return
					}
					const node = which === 'model' ? modelRef.current : effortRef.current
					if (node === null) return
					setRect(node.getBoundingClientRect())
					setOpenPanel(which)
				}

				const commit = async (selection) => {
					setOpenPanel(null)
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
						setOpenPanel(null)
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
						setOpenPanel(null)
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

				const modelPanel =
					openPanel === 'model' && rect !== null
						? h(
								AnchoredPanel,
								{
									key: 'model-panel',
									kind: 'model-panel',
									anchorRef: modelRef,
									onClose: () => setOpenPanel(null),
									style: {
										right: `${Math.max(8, window.innerWidth - Math.round(rect.right))}px`,
										bottom: `${Math.max(8, window.innerHeight - Math.round(rect.top) + 8)}px`,
										width: '300px',
									},
								},
								view.groups.length === 0
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
									onClose: () => setOpenPanel(null),
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

				return h('div', { className: 'mec-seat', 'data-dsh-mec': 'seat' }, [
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
							onPointerDown: (event) => event.stopPropagation(),
							onClick: (event) => {
								event.stopPropagation()
								toggle('model')
							},
						},
						[
							h('span', { key: 't', className: 'mec-chip-text' }, modelText),
							h('span', { key: 'c', className: 'mec-chevron', 'aria-hidden': 'true' }, '\u2304'),
						]
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
									onPointerDown: (event) => event.stopPropagation(),
									onClick: (event) => {
										event.stopPropagation()
										toggle('effort')
									},
								},
								[
									h('span', { key: 't', className: 'mec-chip-text' }, effortText),
									h('span', { key: 'c', className: 'mec-chevron', 'aria-hidden': 'true' }, '\u2304'),
								]
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
			percentAt,
			energyFor,
			nearestIndex,
			wavePoints,
		}
		return module.exports
	},
})
