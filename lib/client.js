/**
 * dsh-model-effort-chips — browser half (M0 skeleton).
 *
 * Takes over the composer's named model seat (`conversation.input.model`) with
 * `priority: -1` (a single slot: the lowest priority renders, so this shadows
 * the official occupant) and renders two static chips where the official seat
 * used to be. If the takeover throws for any reason we fall back to the tool
 * row (`conversation.input.right`) so the composer never ends up with no model
 * control at all.
 *
 * M0 scope: prove the load path and the takeover. Data binding, the model
 * list, and the effort popover land in M1/M2.
 */

window.__ModuleLoader__.load({
	id: 'dsh-model-effort-chips',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const react = require('react')

		const name = 'model-effort-chips'
		const inject = ['slots']

		const SEAT = 'conversation.input.model'
		const FALLBACK = 'conversation.input.right'
		const TAG = 'dsh-model-effort-chips'

		const chipStyle = {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '4px',
			height: '22px',
			padding: '0 8px',
			borderRadius: '999px',
			border: '1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.14))',
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			fontSize: '12px',
			lineHeight: '1',
			cursor: 'pointer',
		}

		const seatStyle = {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '6px',
			minWidth: '0',
		}

		const chevron = react.createElement(
			'span',
			{ key: 'chev', style: { opacity: 0.5, fontSize: '10px' }, 'aria-hidden': 'true' },
			'\u2304'
		)

		function ModelEffortSeat() {
			return react.createElement(
				'div',
				{ 'data-dsh-mec': 'seat', style: seatStyle },
				react.createElement(
					'button',
					{
						key: 'model',
						type: 'button',
						'data-dsh-mec': 'model',
						style: chipStyle,
						title: 'M0 skeleton \u2014 model chip',
					},
					[react.createElement('span', { key: 't' }, 'model'), chevron]
				),
				react.createElement(
					'button',
					{
						key: 'effort',
						type: 'button',
						'data-dsh-mec': 'effort',
						style: chipStyle,
						title: 'M0 skeleton \u2014 effort chip',
					},
					'high'
				)
			)
		}

		/** Register one occupant, swallowing registration failures. */
		function mountOccupant(ctx, slot, priority, component) {
			try {
				return ctx.slots.inject(slot, () =>
					ctx.slots.register({ name: slot, priority }, component)
				)
			} catch (error) {
				console.warn('[' + TAG + '] register failed for ' + slot, error)
				return () => {}
			}
		}

		function apply(ctx) {
			console.info('[' + TAG + '] apply')

			// Primary: shadow the official model seat with a lower priority.
			mountOccupant(ctx, SEAT, -1, ModelEffortSeat)

			// Fail-open: also offer a tool-row entry, so even if the seat
			// registration is rejected there is still a control in the composer.
			try {
				ctx.slots.inject(FALLBACK, () => {
					try {
						return ctx.slots.register({ name: FALLBACK }, () =>
							react.createElement(
								'button',
								{
									type: 'button',
									'data-dsh-mec': 'fallback',
									style: chipStyle,
									title: 'model-effort-chips (fallback entry)',
								},
								'model \u00b7 effort'
							)
						)
					} catch (error) {
						console.warn('[' + TAG + '] fallback register failed', error)
						return () => {}
					}
				})
			} catch (error) {
				console.warn('[' + TAG + '] fallback inject failed', error)
			}
		}

		exports.name = name
		exports.inject = inject
		exports.apply = apply
		return module.exports
	},
})
