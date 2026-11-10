/**
 * 波折叠 (wave-fold)
 *
 * 一条正弦先放大再折回自身，产生锯齿与谐波；档位越高折得越狠：
 * 增益 1 + 7e、振幅 6 + 10e、频率 0.6 + 2e。
 * 折叠函数 fold(x) = 2·|2·(x/2 - floor(x/2 + 0.5))| - 1，只做两次 abs/floor，
 * 不递归；振幅按 band 高度 clamp，不会画到轨道上。
 */
/** Fold a signal back over itself: 2·|2·(x/2 - floor(x/2 + 0.5))| - 1. */
function foldSignal(value) {
	return 2 * Math.abs(2 * (value / 2 - Math.floor(value / 2 + 0.5))) - 1
}

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

		context.save()
		context.strokeStyle = withAlpha(accent, 0.9)
		context.lineWidth = 1.3
		context.lineJoin = 'round'
		context.beginPath()
		const stepX = 2
		for (let x = 0; x <= width; x += stepX) {
			const theta = (x / width) * Math.PI * 2 * waves - state.phase * Math.PI * 2
			const y = mid + foldSignal(gain * Math.sin(theta)) * amplitude
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
