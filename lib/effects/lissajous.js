/**
 * 李萨如 (lissajous)
 *
 * 两个不同频率的正弦分别驱动 x / y，在 30px band 里画出一张被压扁的编织网：
 *   x = sin(3u + 0.3e)、y = sin(k·u)，u 在 [t, t + 2π] 上取 96 个点，
 *   k = 2 + floor(4e)（2 / 3 / 4 / 5 / 6），相位速度 0.4 + 1.6e rad/s。
 * 频率比 k:3 随档位阶跃，每次切换都把上一组 k 的曲线再画一遍，并在 0.2s 内
 * 把它的 alpha 递减到 0（新曲线保持满亮度），避免换挡时图形突然闪断。
 *
 * 布局 0/bar/off：只占 30px band；y 振幅 clamp 在 band 内（mid ± 12），
 * x 振幅铺满画布宽度（± (W/2 - 14)），figures 不会碰到轨道。
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

			context.strokeStyle = withAlpha(accent, alpha)
			context.beginPath()
			// 96 个点围成一条闭合曲线；最后一段由 closePath 补上。
			for (let i = 0; i < 96; i += 1) {
				const u = state.t + (i / 96) * TAU
				const px = centerX + Math.sin(3 * u + 0.3 * level) * amplitudeX
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
