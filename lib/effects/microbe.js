/**
 * 微生物 (microbe)
 *
 * 视觉机制：一枚椭圆身体像草履虫一样在 30px band 里横向游动，身后两条鞭毛
 * 各用 12 段正弦摆动；身体角度跟着速度方向轻微俯仰，出右边界后从左侧回场。
 *
 * 能量映射：游速 20 + 80e px/s、鞭毛摆动 2 + 8e rad/s、体长 10 + 6e、
 *          鞭毛 8 + 14e。
 * 布局：0/bar/off —— 只用 30px band，不显示频谱。
 *
 * 游动路线是「匀速前进 + 正弦上下浮」，所以摆角可以从 vy/vx 直接算，
 * 身体永远顺着速度方向；鞭毛末端按 band 上下沿 clamp，不会画到轨道区。
 * state 只有 x/y/angle/phase/time 五个数字，paint 不建数组、不 new。
 */
const microbeEffect = {
	id: 'microbe',
	name: '微生物',
	summary: '椭圆身体横向游动，两条 12 段鞭毛正弦摆动，像一只草履虫',
	category: 'life',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ x: 0, y: 0, angle: 0, phase: 0, time: 0, ready: false }),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const middleY = bandTop + bandHeight * 0.5

		if (!state.ready) {
			state.x = width * 0.5
			state.y = middleY
			state.angle = 0
			state.ready = true
		}

		state.time += dt
		state.phase = (state.phase + (2 + 8 * level) * dt) % TAU
		const speed = 20 + 80 * level
		const bobAmplitude = 2 + 2 * level
		const bobRate = 1.1 + 0.5 * level
		// 匀速前进 + 余弦上下浮；俯仰角直接由速度分量算，跟随速度方向。
		state.y = middleY + Math.sin(state.time * bobRate) * bobAmplitude
		state.angle = Math.atan2(Math.cos(state.time * bobRate) * bobAmplitude * bobRate, speed)
		state.x += speed * dt
		if (state.x > width + 24) state.x = -24
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const top = bandTop + 0.5
		const bottom = bandTop + bandHeight - 0.5
		const bodyLength = 10 + 6 * level
		const flagellaLength = 8 + 14 * level
		const swing = 2 + 8 * level
		const half = bodyLength * 0.5
		const angle = state.angle
		const centerX = state.x
		const centerY = state.y

		context.save()

		// 两条鞭毛：各 12 段正弦；末端 clamp 在 band 内。
		context.beginPath()
		const directionX = Math.cos(angle + Math.PI)
		const directionY = Math.sin(angle + Math.PI)
		const normalX = Math.cos(angle + Math.PI * 1.5)
		const normalY = Math.sin(angle + Math.PI * 1.5)
		for (let flagellum = 0; flagellum < 2; flagellum += 1) {
			const phase = state.phase + flagellum * Math.PI * 0.9
			// 两条鞭毛从尾部上下两侧出发、各自再偏转一点方向，高速摆动也不会绞团。
			const side = flagellum === 0 ? 1.4 : -1.4
			const spread = flagellum === 0 ? 0.16 : -0.16
			const dirX = Math.cos(angle + Math.PI + spread)
			const dirY = Math.sin(angle + Math.PI + spread)
			const startX = centerX + directionX * half + normalX * side
			const startY = centerY + directionY * half + normalY * side
			context.moveTo(startX, startY)
			for (let segment = 1; segment <= 12; segment += 1) {
				const t = segment / 12
				const lateral = Math.sin(phase - segment * 0.55) * swing * t * 0.4
				const pointX = startX + dirX * flagellaLength * t + normalX * lateral
				let pointY = startY + dirY * flagellaLength * t + normalY * lateral
				if (pointY < top) pointY = top
				else if (pointY > bottom) pointY = bottom
				context.lineTo(pointX, pointY)
			}
		}
		context.strokeStyle = withAlpha(accent, 0.45 + 0.2 * level)
		context.lineWidth = 1
		context.lineCap = 'round'
		context.stroke()

		// 身体：椭圆；旋转跟随速度方向，内部一个细胞核。
		context.save()
		context.translate(centerX, centerY)
		context.rotate(angle)
		context.beginPath()
		context.ellipse(0, 0, half, half * 0.55, 0, 0, TAU)
		context.fillStyle = withAlpha(accent, 0.16 + 0.12 * level)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.85)
		context.lineWidth = 1.2
		context.stroke()
		context.beginPath()
		context.ellipse(half * 0.25, 0, half * 0.24, half * 0.2, 0, 0, TAU)
		context.fillStyle = withAlpha(accent, 0.55)
		context.fill()
		context.restore()

		context.restore()
	},
}
