/**
 * dsh-model-effort-chips — browser half.
 *
 * M1 + M2: real data binding and the first working popovers.
 *
 *   - model chip  : opens the session's catalog, one click switches model.
 *                   The reasoning level carries across by INDEX (per user
 *                   decision): high (3rd) stays 3rd on the next model, and a
 *                   level the target does not declare clamps to the nearest
 *                   one it does.
 *   - effort chip : opens a plain (pre-visual) popover listing exactly the
 *                   levels the current model declares; clicking one writes
 *                   through the same `directory.select()` the official menu
 *                   uses.
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

		// ---------------------------------------------------------------- styles

		const chipStyle = {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '4px',
			height: '24px',
			padding: '0 8px',
			borderRadius: '999px',
			border: '1px solid transparent',
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			fontSize: '12px',
			lineHeight: '1',
			cursor: 'pointer',
			maxWidth: '220px',
			whiteSpace: 'nowrap',
		}

		const seatStyle = { display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: '0' }

		const panelStyle = (rect, width) => ({
			position: 'fixed',
			right: `${Math.max(8, window.innerWidth - Math.round(rect.right))}px`,
			bottom: `${Math.max(8, window.innerHeight - Math.round(rect.top) + 8)}px`,
			width: `${width}px`,
			maxHeight: '60vh',
			overflowY: 'auto',
			zIndex: 2147483000,
			padding: '6px',
			borderRadius: '12px',
			border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))',
			background: 'var(--dsw-alias-bg-layer-2, #22252b)',
			boxShadow: '0 12px 32px rgba(0,0,0,.45)',
			color: 'var(--dsw-alias-label-primary, #eee)',
			font: 'inherit',
			fontSize: '12px',
		})

		const rowStyle = {
			display: 'flex',
			alignItems: 'center',
			gap: '8px',
			width: '100%',
			padding: '7px 9px',
			borderRadius: '8px',
			border: 'none',
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			fontSize: '12px',
			textAlign: 'left',
			cursor: 'pointer',
		}

		const headingStyle = {
			padding: '6px 9px 4px',
			opacity: 0.5,
			fontSize: '11px',
			letterSpacing: '.02em',
			textTransform: 'uppercase',
		}

		const noteStyle = { padding: '8px 9px', opacity: 0.7, fontSize: '12px' }

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
				h('div', { ref: panelRef, 'data-dsh-mec': props.kind, style: panelStyle(props.rect, props.width) }, props.children),
				document.body
			)
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
				const chipOpacity = disabled ? 0.5 : 1

				const modelText = view.model?.name ?? view.current?.model ?? '选择模型'
				const effortText = view.levels.length === 0 ? null : view.effortLabel

				const modelPanel =
					openPanel === 'model' && rect !== null
						? h(
								AnchoredPanel,
								{ key: 'model-panel', kind: 'model-panel', rect, width: 300, anchorRef: modelRef, onClose: () => setOpenPanel(null) },
								view.groups.length === 0
									? h('div', { style: noteStyle }, state.status === 'error' ? state.error ?? '加载失败' : '暂无可用模型')
									: view.groups.map((group) =>
											h(
												'div',
												{ key: group.id, 'data-dsh-mec': 'provider-group' },
												h('div', { style: headingStyle }, group.name ?? group.id),
												(group.models ?? []).map((model) =>
													h(
														'button',
														{
															key: model.id,
															type: 'button',
															style: rowStyle,
															'data-dsh-mec': 'model-option',
															'data-model-id': model.id,
															onPointerDown: (event) => event.stopPropagation(),
															onClick: () => chooseModel(group, model),
														},
														[
															h(
																'span',
																{ key: 'n', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' } },
																model.name ?? model.id
															),
															model.id === view.current?.model
																? h('span', { key: 'c', style: { opacity: 0.75 } }, '\u2713')
																: null,
														]
													)
												)
											)
										)
							)
						: null

				const effortPanel =
					openPanel === 'effort' && rect !== null
						? h(
								AnchoredPanel,
								{ key: 'effort-panel', kind: 'effort-panel', rect, width: 260, anchorRef: effortRef, onClose: () => setOpenPanel(null) },
								view.levels.length === 0
									? h('div', { style: noteStyle }, '当前模型没有声明思考档位')
									: [
											h('div', { key: 'h', style: { ...headingStyle, textTransform: 'none' } }, '思考强度'),
											...view.levels.map((level) =>
												h(
													'button',
													{
														key: level.id,
														type: 'button',
														style: rowStyle,
														'data-dsh-mec': 'level-option',
														'data-effort': level.id,
														onPointerDown: (event) => event.stopPropagation(),
														onClick: () => chooseEffort(level),
													},
													[
														h('span', { key: 'n', style: { flex: '1' } }, level.name ?? level.id),
														level.id === view.effectiveEffort
															? h('span', { key: 'c', style: { opacity: 0.75 } }, '\u2713')
															: null,
													]
												)
											),
										]
							)
						: null

				return h(
					'div',
					{ 'data-dsh-mec': 'seat', style: seatStyle },
					[
						h(
							'button',
							{
								key: 'model',
								ref: modelRef,
								type: 'button',
								disabled,
								'data-dsh-mec': 'model',
								'data-model-id': view.current?.model ?? '',
								style: { ...chipStyle, opacity: chipOpacity },
								title: view.model?.name ?? '模型',
								onPointerDown: (event) => event.stopPropagation(),
								onClick: (event) => {
									event.stopPropagation()
									toggle('model')
								},
							},
							[
								h('span', { key: 't', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, modelText),
								h('span', { key: 'c', style: { opacity: 0.5, fontSize: '10px' }, 'aria-hidden': 'true' }, '\u2304'),
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
										'data-dsh-mec': 'effort',
										'data-effort': view.effectiveEffort ?? '',
										style: { ...chipStyle, opacity: chipOpacity },
										title: `思考强度\uff1a${effortText}`,
										onPointerDown: (event) => event.stopPropagation(),
										onClick: (event) => {
											event.stopPropagation()
											toggle('effort')
										},
									},
									effortText
								),
						modelPanel,
						effortPanel,
					]
				)
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
							h(
								'button',
								{ type: 'button', 'data-dsh-mec': 'fallback', style: chipStyle, title: 'model-effort-chips (fallback entry)' },
								'model \u00b7 effort'
							)
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
		exports.__internals = { mapEffortIndex, resolveSelection }
		return module.exports
	},
})
