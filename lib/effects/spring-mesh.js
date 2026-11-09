/**
 * 弹簧网格 (spring-mesh)
 *
 * 视觉机制：8×3 = 24 个节点的线框网格被中心冲量激起，节点在弹簧力下向静止位
 * 回弹，波沿上下左右的邻接边扩散；档位越高刚度越大、阻尼越小、冲量越猛，网格
 * 抖得越久越碎。
 *
 * 能量映射：刚度 k = 0.15 + 0.85e；阻尼 0.86 + 0.1e；中心冲量 2 + 14e。
 * 积分固定 1/60 步长（不跟着 host 的 dt 变），位移 clamp 在 band 内，避免数值
 * 爆炸或飞出画布。
 * 布局：0/bar/on —— 占用 30px band，保留 DOM 直条与频谱柱。
 *
 * 24 个节点与两个加速度缓冲都在 createState 里一次性建好，step/paint 不分配
 * 数组或对象；耦合用 Jacobi 方式先算完所有加速度再统一积分，比逐个就地更新稳。
 */
const springMeshEffect = {
	id: 'spring-mesh',
	name: '弹簧网格',
	summary: '8×3 节点网格被中心冲量激起，向静止位回弹、波沿邻接边扩散',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: true },

	createState: () => {
		// 24 个节点，col/row 固定，x/y 是当前位移，vx/vy 是速度。
		const nodes = []
		for (let index = 0; index < 24; index += 1) {
			nodes.push({ col: index % 8, row: Math.floor(index / 8), x: 0, y: 0, vx: 0, vy: 0 })
		}
		// 加速度缓冲预分配，整帧复用。
		return {
			nodes,
			ax: new Float64Array(24),
			ay: new Float64Array(24),
			ready: false,
			kickClock: 0,
			lastEnergy: -1,
		}
	},

	step(state, frame) {
		// 固定 1/60 步长：host 的 dt 不参与积分，只决定画面推进的节奏。
		const STEP = 1 / 60
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const stiffness = 0.15 + 0.85 * energy
		const damping = 0.86 + 0.1 * energy
		const impulse = 2 + 14 * energy
		// 邻接耦合系数：只做 1 环差分，够让波沿边扩散，又不会把显式积分推爆。
		const coupling = 0.12 + 0.1 * energy
		const maxSpeed = 6 + 24 * energy
		const margin = 12
		const gapX = Math.max(1, width - margin * 2) / 7
		const padY = 5
		const gapY = Math.max(1, bandHeight - padY * 2) / 2
		const nodes = state.nodes
		const ax = state.ax
		const ay = state.ay

		// 首帧先把节点摆到静止位，并且立刻敲一下：prefers-reduced-motion 只画
		// 一帧，t=0 就必须能看到波，不能等 0.9s 后的第一次泵浦。
		let kick = 0
		if (!state.ready) {
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index]
				node.x = margin + node.col * gapX
				node.y = bandTop + padY + node.row * gapY
				node.vx = 0
				node.vy = 0
			}
			state.ready = true
			state.lastEnergy = energy
			state.kickClock = 0
			kick = 1
		} else if (Math.abs(energy - state.lastEnergy) > 0.02) {
			// 换档也算一次冲量，让「档位一变，网格立刻被敲一下」。
			state.lastEnergy = energy
			state.kickClock = 0
			kick = 0.85
		}
		state.kickClock += STEP
		// 周期泵浦：回弹快停下来时再敲一次，画面不会死掉。
		const interval = 0.9 - 0.45 * energy
		if (state.kickClock >= interval) {
			state.kickClock -= interval
			kick = Math.max(kick, 0.8)
		}

		if (kick > 0) {
			// 中心冲量：只敲中间一行（靠近中心的列最强），上下两行靠耦合被带起来。
			const strength = impulse * kick
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index]
				const dx = (node.col - 3.5) / 3.5
				const dy = node.row - 1
				const falloff = Math.max(0, 1 - (dx * dx + dy * dy))
				if (falloff <= 0) continue
				node.vx += dx * strength * 0.45 * falloff
				node.vy += (node.row === 1 ? -1 : 0.55) * strength * 0.8 * falloff
			}
		}

		// 先算所有节点的加速度（Jacobi）：弹簧力拉回静止位，邻接差分把波传出去。
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index]
			const selfX = node.x - (margin + node.col * gapX)
			const selfY = node.y - (bandTop + padY + node.row * gapY)
			let forceX = -selfX * stiffness
			let forceY = -selfY * stiffness

			if (node.col > 0) {
				const other = nodes[index - 1]
				forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
				forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
			}
			if (node.col < 7) {
				const other = nodes[index + 1]
				forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
				forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
			}
			if (node.row > 0) {
				const other = nodes[index - 8]
				forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
				forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
			}
			if (node.row < 2) {
				const other = nodes[index + 8]
				forceX += (other.x - (margin + other.col * gapX) - selfX) * coupling
				forceY += (other.y - (bandTop + padY + other.row * gapY) - selfY) * coupling
			}

			ax[index] = forceX
			ay[index] = forceY
		}

		// 再统一积分（半隐式欧拉），阻尼吃掉能量，位移 clamp 在 band 内。
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index]
			node.vx = (node.vx + ax[index]) * damping
			node.vy = (node.vy + ay[index]) * damping
			// 速度钳位只是积分保险，真正的边界是下面的位移 clamp。
			node.vx = Math.max(-maxSpeed, Math.min(maxSpeed, node.vx))
			node.vy = Math.max(-maxSpeed, Math.min(maxSpeed, node.vy))
			node.x += node.vx
			node.y += node.vy

			// 撞边时清掉法向速度，避免贴边抖动。
			if (node.x < 0) {
				node.x = 0
				node.vx = 0
			} else if (node.x > width) {
				node.x = width
				node.vx = 0
			}
			if (node.y < bandTop) {
				node.y = bandTop
				node.vy = 0
			} else if (node.y > bandTop + bandHeight) {
				node.y = bandTop + bandHeight
				node.vy = 0
			}
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const nodes = state.nodes
		const radius = 1 + 1.6 * energy

		context.save()

		// 线框：先横边（每行 7 条），再竖边（每列 2 条）。
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.3 + 0.25 * energy)
		context.beginPath()
		for (let row = 0; row < 3; row += 1) {
			for (let col = 0; col < 7; col += 1) {
				const a = nodes[row * 8 + col]
				const b = nodes[row * 8 + col + 1]
				context.moveTo(a.x, a.y)
				context.lineTo(b.x, b.y)
			}
		}
		for (let row = 0; row < 2; row += 1) {
			for (let col = 0; col < 8; col += 1) {
				const a = nodes[row * 8 + col]
				const b = nodes[(row + 1) * 8 + col]
				context.moveTo(a.x, a.y)
				context.lineTo(b.x, b.y)
			}
		}
		context.stroke()

		// 节点：档位越高越大，和线框一起读作「抖动强度」。
		context.fillStyle = accent
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index]
			context.beginPath()
			context.arc(node.x, node.y, radius, 0, Math.PI * 2)
			context.fill()
		}

		context.restore()
	},
}
