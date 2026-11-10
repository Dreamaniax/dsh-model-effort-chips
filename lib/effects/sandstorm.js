/**
 * 风沙 (sandstorm)
 *
 * 视觉机制：240 粒沙被横向风场推着从左向右扫过，叠加正弦湍流让每颗沙的
 * 轨迹各自抖动，同时受一点重力下坠；每颗沙拖一条与速度成正比的 1px 短线，
 * 整片看起来像斜着扫过的沙暴。
 *
 * 能量映射：N = 120 + 120e（预分配 240）、风速 50 + 260e px/s、
 *          湍流 10 + 40e、寿命 0.8 - 0.4e 秒。
 * 布局：0/bar/off —— 只占 30px band，不显示频谱。
 *
 * 寿命只有 0.4~0.8s，比穿过画布所需时间短，所以死掉的沙粒按固定种子 LCG
 * 在带内任意位置重生（每帧最多重置 10% 的活跃粒子）：密度始终均匀，风场方向
 * 由水平速度与拖线表达，而不是靠粒子真的从左边飞到右边。粒子池与相位数组
 * 在 createState 里一次分配；step/paint 只写字段，不用 splice、不 new 数组。
 */
const sandstormEffect = {
	id: 'sandstorm',
	name: '风沙',
	summary: '沙粒被横向风场和正弦湍流卷着扫过，档位越高风越急、沙越密',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 240
		return {
			x: new Float64Array(MAX),
			y: new Float64Array(MAX),
			vx: new Float64Array(MAX),
			vy: new Float64Array(MAX),
			age: new Float64Array(MAX),
			phase: new Float64Array(MAX),
			seed: 0x51ed270b,
			time: 0,
			life: 0.8,
			ready: false,
		}
	},

	step(state, frame) {
		const TAU = Math.PI * 2
		const MAX = 240
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const bandBottom = bandTop + bandHeight
		const activeFloat = Math.min(MAX, 120 + 120 * level)
		const life = 0.8 - 0.4 * level
		const wind = 50 + 260 * level
		const turbulence = 10 + 40 * level
		const gravity = 18 + 14 * level
		const spin = 3.2 + 4 * level
		state.life = life

		if (!state.ready) {
			let seed = state.seed
			for (let index = 0; index < MAX; index += 1) {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r1 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r2 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r3 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r4 = seed / 4294967296
				state.x[index] = r1 * width
				state.y[index] = bandTop + 0.8 + r2 * (bandHeight - 1.6)
				state.age[index] = r3 * life * 0.9
				state.phase[index] = r4 * TAU
				state.vx[index] = wind
				state.vy[index] = 0
			}
			state.seed = seed
			state.ready = true
		}

		state.time += dt
		// 文档的「每帧只重置死掉的 10%」：避免一帧里成批重生造成闪烁。
		const maxResets = Math.max(1, Math.ceil(activeFloat * 0.1))
		let resets = 0
		let seed = state.seed

		for (let index = 0; index < MAX; index += 1) {
			state.age[index] += dt
			const phase = state.phase[index]
			// 横向风 + 低频湍流；纵向是重力 + 异相湍流，沙才会一阵阵起伏。
			const vx = wind + turbulence * 0.55 * Math.sin(state.time * 1.7 + phase * 1.31)
			const vy = gravity + turbulence * 0.45 * Math.sin(state.time * spin + phase)
			state.vx[index] = vx
			state.vy[index] = vy

			const dead = state.age[index] >= life
			if (dead) {
				if (resets >= maxResets) continue
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r1 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r2 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r3 = seed / 4294967296
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
				const r4 = seed / 4294967296
				// 带内均匀重生（寿命短于穿屏时间），密度不随档位塌到左边。
				state.x[index] = r1 * width
				state.y[index] = bandTop + 0.8 + r2 * (bandHeight - 1.6)
				state.age[index] = r3 * 0.15
				state.phase[index] = r4 * TAU
				state.vx[index] = wind
				state.vy[index] = gravity
				resets += 1
				continue
			}

			let x = state.x[index] + vx * dt
			let y = state.y[index] + vy * dt
			// 竖向不出带：触底沿地面滑、触顶被风压回。
			if (y < bandTop + 0.6) y = bandTop + 0.6
			else if (y > bandBottom - 0.6) y = bandBottom - 0.6
			// 极少数活过右边界的沙也回收一次，避免堆在画布外。
			if (x > width + 4) {
				state.age[index] = life
				continue
			}
			state.x[index] = x
			state.y[index] = y
		}
		state.seed = seed
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		if (!state.ready) return
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const activeFloat = Math.min(240, 120 + 120 * level)
		const full = Math.floor(activeFloat)
		const partial = activeFloat - full
		const life = state.life
		const streakSeconds = 0.035

		context.save()

		// 拖线全部合进一条 path 一次 stroke：1px 短线，长度随速度。
		context.beginPath()
		let anyStreak = false
		for (let index = 0; index < full; index += 1) {
			if (state.age[index] >= life) continue
			context.moveTo(state.x[index] - state.vx[index] * streakSeconds, state.y[index] - state.vy[index] * streakSeconds)
			context.lineTo(state.x[index], state.y[index])
			anyStreak = true
		}
		if (anyStreak) {
			context.strokeStyle = withAlpha(accent, 0.28 + 0.32 * level)
			context.lineWidth = 1
			context.lineCap = 'round'
			context.stroke()
		}

		// 沙粒本体：有光点精灵就 drawImage，否则退化到 1px fillRect。
		const sprite = frame.sprite ?? null
		if (sprite !== null) {
			const size = 1.8 + 1.4 * level
			context.globalAlpha = 0.85
			for (let index = 0; index < full; index += 1) {
				if (state.age[index] >= life) continue
				context.drawImage(sprite, state.x[index] - size / 2, state.y[index] - size / 2, size, size)
			}
			if (partial > 0.02 && state.age[full] < life) {
				context.globalAlpha = 0.85 * partial
				context.drawImage(sprite, state.x[full] - size / 2, state.y[full] - size / 2, size, size)
			}
			context.globalAlpha = 1
		} else {
			context.fillStyle = accent
			context.globalAlpha = 0.85
			for (let index = 0; index < full; index += 1) {
				if (state.age[index] >= life) continue
				context.fillRect(state.x[index], state.y[index], 1.2, 1.2)
			}
			if (partial > 0.02 && state.age[full] < life) {
				context.globalAlpha = 0.85 * partial
				context.fillRect(state.x[full], state.y[full], 1.2, 1.2)
			}
			context.globalAlpha = 1
		}

		context.restore()
	},
}
