/**
 * 磁力轨道 (magnetic-orbits)
 *
 * 视觉机制：两个磁极并排立在 band 底部，粒子沿各自磁极上方的椭圆轨道绕行，
 * 像被场线约束的带电尘埃。档位越高粒子越多、角速度越快、轨道半径越大。
 *
 * 能量映射：粒子数 N = 6 + 8e（最多 14）；角速度 ω = 1.5 + 4e；第 i 个粒子的
 * 轨道半径 r = 6 + 12e·(i/N)；电荷 q = 0.3 + 1.7e 只影响点的大小与亮度。
 * 只推进角度，不做真实 N-body，也不做除零：N 下限为 6。
 * 布局：0/bar/on —— 占用 30px band，保留 DOM 直条与频谱柱。
 *
 * 14 个粒子在 createState 里预分配，step/paint 不建数组、不建对象。
 */
const magneticOrbitsEffect = {
	id: 'magnetic-orbits',
	name: '磁力轨道',
	summary: '两个磁极上方 6~14 个粒子沿椭圆轨道绕行，档位越高越快越大',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: true },

	createState: () => {
		const TAU = Math.PI * 2
		const golden = 2.399963229728653
		const particles = []
		for (let index = 0; index < 14; index += 1) {
			// 黄金角起始相位，14 个粒子一开始就错开，不会重叠在一条线上。
			particles.push({ angle: (index * golden) % TAU, pole: index % 2 })
		}
		return { particles, count: 6, energy: 0 }
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const omega = 1.5 + 4 * energy
		const particles = state.particles

		// 只推进角度：两个磁极方向相反，像两组反向绕行的场线。
		for (let index = 0; index < particles.length; index += 1) {
			const particle = particles[index]
			const direction = particle.pole === 0 ? 1 : -1
			particle.angle = (particle.angle + direction * omega * dt) % TAU
			if (particle.angle < 0) particle.angle += TAU
		}

		state.energy = energy
		state.count = 6 + 8 * energy
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const particles = state.particles
		// N 是连续值：整数部分画实点，小数部分给下一个点淡入。
		const target = 6 + 8 * energy
		const full = Math.min(14, Math.floor(target))
		const partial = target - full
		const N = Math.max(6, target)
		const poleY = bandTop + bandHeight - 4
		const poleLeft = width * 0.32
		const poleRight = width * 0.68
		const charge = 0.3 + 1.7 * energy
		const dot = 0.9 + 1.5 * energy

		context.save()

		// 场线：每个磁极一圈最大的椭圆轨道，静态描边，读作磁场边界。
		const fieldX = 6 + 12 * energy
		const fieldY = Math.max(1.5, fieldX * 0.42)
		const fieldCenterY = poleY - 5 - fieldY
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.16 + 0.1 * energy)
		for (let pole = 0; pole < 2; pole += 1) {
			const poleX = pole === 0 ? poleLeft : poleRight
			context.beginPath()
			context.ellipse(poleX, fieldCenterY, fieldX, fieldY, 0, 0, TAU)
			context.stroke()
		}

		// 两个磁极：外环 + 磁芯，档位越高越亮。
		for (let pole = 0; pole < 2; pole += 1) {
			const poleX = pole === 0 ? poleLeft : poleRight
			context.fillStyle = withAlpha(accent, 0.22 + 0.2 * energy)
			context.beginPath()
			context.arc(poleX, poleY, 4.5, 0, TAU)
			context.fill()
			context.strokeStyle = withAlpha(accent, 0.55 + 0.35 * energy)
			context.beginPath()
			context.arc(poleX, poleY, 2.6, 0, TAU)
			context.stroke()
			context.fillStyle = accent
			context.beginPath()
			context.arc(poleX, poleY, 1.1, 0, TAU)
			context.fill()
		}

		// 粒子：椭圆轨道，半径随档位与序号变大，只读 angle 不做互斥。
		const visible = full + (partial > 0 ? 1 : 0)
		context.fillStyle = accent
		for (let index = 0; index < visible; index += 1) {
			const particle = particles[index]
			const poleX = particle.pole === 0 ? poleLeft : poleRight
			const orbitX = 6 + 12 * energy * (index / N)
			const orbitY = Math.max(1.5, orbitX * 0.42)
			const centerY = poleY - 5 - orbitY
			const px = poleX + Math.cos(particle.angle) * orbitX
			const py = centerY + Math.sin(particle.angle) * orbitY
			context.globalAlpha = index < full ? 0.55 + 0.45 * charge : Math.max(0.08, partial * 0.55)
			context.beginPath()
			context.arc(px, py, dot * (1 - 0.35 * (index / N)), 0, TAU)
			context.fill()
		}
		context.globalAlpha = 1

		context.restore()
	},
}
