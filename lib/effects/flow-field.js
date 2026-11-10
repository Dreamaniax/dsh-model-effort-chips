/**
 * 流场 (flow-field)
 *
 * 视觉机制：最多 240 颗墨点被整数哈希 value noise 生成的向量场推着走，每颗拖一条
 * 4~14 点短尾迹，像风里的墨线；档位越高粒子越多、流场特征越小、速度越快。
 *
 * 能量映射：N = 80 + 160e（最多 240）、速度 15 + 90e px/s、
 *          噪声尺度 0.015 + 0.035e、尾迹 4 + 10e 点。
 * 布局：0/bar/off —— 只占 30px band，不显示频谱。
 *
 * 随机性：初始位置用固定种子的整数 LCG 生成，噪声用整数 hash，全程不碰
 * 随机数 API，所以同一帧的预览/测试可复现。粒子、尾迹（Float64Array 环形
 * 缓冲）与计数数组都在 createState 里一次性分配；step/paint 只写槽位。
 *
 * 噪声：value noise，四角 hash + smoothstep 双线性插值；角度 = value·4π，
 * 场本身随时间横向漂移，粒子路径不会永远重复同一条流线。
 *
 * 只靠静态向量场 + 边界环绕不行：240 颗粒子会全部收进同一个涡核，band 很快
 * 一半空掉。所以每颗粒子带 0.9~2.5s 的寿命，到期用固定种子 LCG 在带内重生
 * （尾迹清零、快速长回来），密度因此始终均匀；另外给方向加一点 +0.5 的向右
 * 偏置，让整体读起来是「被风吹着走的墨线」，而不是原地打转的涡。
 */
const flowFieldEffect = {
	id: 'flow-field',
	name: '流场',
	summary: '粒子被整型噪声向量场推着走，拖出短尾迹，档位越高越密越快',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 240
		const TRAIL = 14
		const x = new Float64Array(MAX)
		const y = new Float64Array(MAX)
		const trail = new Float64Array(MAX * TRAIL * 2)
		const trailHead = new Uint8Array(MAX)
		const trailCount = new Uint8Array(MAX)
		const age = new Float64Array(MAX)
		// 归一化寿命 [0,1)，step 里映射成 0.9~2.5s；相位错开避免成批重生。
		const lifeN = new Float64Array(MAX)
		let seed = 0x9e3779b9
		for (let index = 0; index < MAX; index += 1) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			x[index] = seed / 4294967296
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			y[index] = seed / 4294967296
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			age[index] = (seed / 4294967296) * 2
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			lifeN[index] = seed / 4294967296
		}
		return { x, y, trail, trailHead, trailCount, age, lifeN, seed, time: 0, ready: false }
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const MAX = 240
		const TRAIL = 14
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const bandBottom = bandTop + bandHeight
		const scale = 0.015 + 0.035 * level
		const speed = 15 + 90 * level

		if (!state.ready) {
			for (let index = 0; index < MAX; index += 1) {
				state.x[index] *= width
				state.y[index] = bandTop + state.y[index] * bandHeight
			}
			state.ready = true
		}
		state.time += dt
		const drift = state.time * 0.25

		for (let index = 0; index < MAX; index += 1) {
			const fieldX = state.x[index] * scale + drift
			const fieldY = state.y[index] * scale
			const ix = Math.floor(fieldX)
			const iy = Math.floor(fieldY)
			const fx = fieldX - ix
			const fy = fieldY - iy
			// smoothstep：格点之间一阶导连续，流线不会出现格子边的折角。
			const ux = fx * fx * (3 - 2 * fx)
			const uy = fy * fy * (3 - 2 * fy)

			// value noise：四个格点角各做一次整数 hash（Math.imul 保 32 位）。
			let n00 = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
			n00 = Math.imul(n00 ^ (n00 >>> 13), 1274126177)
			const v00 = ((n00 ^ (n00 >>> 16)) >>> 0) / 4294967296
			let n10 = Math.imul(ix + 1, 374761393) + Math.imul(iy, 668265263)
			n10 = Math.imul(n10 ^ (n10 >>> 13), 1274126177)
			const v10 = ((n10 ^ (n10 >>> 16)) >>> 0) / 4294967296
			let n01 = Math.imul(ix, 374761393) + Math.imul(iy + 1, 668265263)
			n01 = Math.imul(n01 ^ (n01 >>> 13), 1274126177)
			const v01 = ((n01 ^ (n01 >>> 16)) >>> 0) / 4294967296
			let n11 = Math.imul(ix + 1, 374761393) + Math.imul(iy + 1, 668265263)
			n11 = Math.imul(n11 ^ (n11 >>> 13), 1274126177)
			const v11 = ((n11 ^ (n11 >>> 16)) >>> 0) / 4294967296
			const top = v00 + (v10 - v00) * ux
			const bottom = v01 + (v11 - v01) * ux
			const value = top + (bottom - top) * uy
			const angle = value * TAU * 2

			// 生命周期：到期就换一个随机落点，密度才不会被涡核吸空。
			// lifeN 归一化，映射到 0.9~2.5s。
			state.age[index] += dt
			if (state.age[index] >= 0.9 + 1.6 * state.lifeN[index]) {
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				const rx = state.seed / 4294967296
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				const ry = state.seed / 4294967296
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				state.age[index] = (state.seed / 4294967296) * 0.15
				state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
				state.lifeN[index] = state.seed / 4294967296
				state.x[index] = rx * width
				state.y[index] = bandTop + ry * bandHeight
				state.trailHead[index] = 0
				state.trailCount[index] = 0
				continue
			}

			// 方向加 0.5 的向右偏置（单位化后仍按 speed 走），像被风吹的墨线。
			const dirX = Math.cos(angle) + 0.5
			const dirY = Math.sin(angle)
			const stride = (speed * dt) / Math.hypot(dirX, dirY)
			let px = state.x[index] + dirX * stride
			let py = state.y[index] + dirY * stride
			let wrapped = false
			if (px < 0) {
				px += width
				wrapped = true
			} else if (px >= width) {
				px -= width
				wrapped = true
			}
			if (py < bandTop) {
				py += bandHeight
				wrapped = true
			} else if (py >= bandBottom) {
				py -= bandHeight
				wrapped = true
			}
			state.x[index] = px
			state.y[index] = py

			// 环形尾迹；跨边界时清空，避免一条线横穿整块画布。
			const base = index * TRAIL * 2
			if (wrapped) {
				state.trailHead[index] = 0
				state.trailCount[index] = 0
			}
			const head = state.trailHead[index]
			state.trail[base + head * 2] = px
			state.trail[base + head * 2 + 1] = py
			state.trailHead[index] = (head + 1) % TRAIL
			if (state.trailCount[index] < TRAIL) state.trailCount[index] += 1
		}
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		if (!state.ready) return
		const MAX = 240
		const TRAIL = 14
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const activeFloat = Math.min(MAX, 80 + 160 * level)
		const full = Math.floor(activeFloat)
		const partial = activeFloat - full
		const trailPoints = Math.max(2, Math.min(TRAIL, Math.round(4 + 10 * level)))

		context.save()

		// 所有尾迹合成一条 path 一次 stroke，避免 240 次 stroke 调用。
		context.beginPath()
		let anyTrail = false
		for (let index = 0; index < full; index += 1) {
			const points = Math.min(trailPoints, state.trailCount[index])
			if (points < 2) continue
			const base = index * TRAIL * 2
			let cursor = (state.trailHead[index] - points + TRAIL) % TRAIL
			context.moveTo(state.trail[base + cursor * 2], state.trail[base + cursor * 2 + 1])
			for (let step = 1; step < points; step += 1) {
				cursor = (cursor + 1) % TRAIL
				context.lineTo(state.trail[base + cursor * 2], state.trail[base + cursor * 2 + 1])
			}
			anyTrail = true
		}
		if (anyTrail) {
			context.strokeStyle = withAlpha(accent, 0.16 + 0.3 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 粒子头：有已解码的光点精灵就用 drawImage，否则退回实心圆。
		const radius = 0.7 + 0.6 * level
		const sprite = frame.sprite ?? null
		if (sprite !== null) {
			const size = 2.2 + 1.8 * level
			context.globalAlpha = 0.9
			for (let index = 0; index < full; index += 1) {
				context.drawImage(
					sprite,
					state.x[index] - size / 2,
					state.y[index] - size / 2,
					size,
					size
				)
			}
			if (partial > 0.02) {
				context.globalAlpha = 0.9 * partial
				context.drawImage(
					sprite,
					state.x[full] - size / 2,
					state.y[full] - size / 2,
					size,
					size
				)
			}
			context.globalAlpha = 1
		} else {
			context.fillStyle = accent
			context.globalAlpha = 0.9
			context.beginPath()
			for (let index = 0; index < full; index += 1) {
				context.moveTo(state.x[index] + radius, state.y[index])
				context.arc(state.x[index], state.y[index], radius, 0, TAU)
			}
			context.fill()
			if (partial > 0.02) {
				context.globalAlpha = 0.9 * partial
				context.beginPath()
				context.moveTo(state.x[full] + radius, state.y[full])
				context.arc(state.x[full], state.y[full], radius, 0, TAU)
				context.fill()
			}
			context.globalAlpha = 1
		}

		context.restore()
	},
}
