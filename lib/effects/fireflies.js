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
		return { phases, omega, sums, offsets, time: 0 }
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
		state.time += dt
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
			// 精灵路径：柔光点大小/透明度随脉冲，直径 5..16px。
			for (let index = 0; index < N; index += 1) {
				const angle = (index / N) * TAU
				const pulse = 0.5 + 0.5 * Math.sin(phases[index])
				const bright = pulse * pulse
				const size = 5 + 10 * bright + 2 * energy
				const px =
					centerX + Math.cos(angle) * radiusX * (1 + offsets[index * 2])
				const py =
					centerY + Math.sin(angle) * radiusY * (1 + offsets[index * 2 + 1])
				context.globalAlpha = 0.18 + 0.72 * bright
				context.drawImage(sprite, px - size / 2, py - size / 2, size, size)
			}
			context.globalAlpha = 1
		} else {
			// 无精灵：两层圆的假辉光（外圈大而淡，内核小而亮）。
			for (let index = 0; index < N; index += 1) {
				const angle = (index / N) * TAU
				const pulse = 0.5 + 0.5 * Math.sin(phases[index])
				const bright = pulse * pulse
				const px =
					centerX + Math.cos(angle) * radiusX * (1 + offsets[index * 2])
				const py =
					centerY + Math.sin(angle) * radiusY * (1 + offsets[index * 2 + 1])
				const core = 0.9 + 1.4 * bright + 0.4 * energy
				context.fillStyle = accent
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
