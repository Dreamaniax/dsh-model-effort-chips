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
