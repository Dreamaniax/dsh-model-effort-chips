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
