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
