/**
 * 瞳孔 (pupil)
 *
 * 视觉机制：一只抽象眼——外圈杏仁形眼睑、虹膜环、放射状虹膜纹、居中瞳孔与一点
 * 高光。档位越高瞳孔越小、虹膜纹越密、眨眼越勤；眨眼时上下眼睑合拢成一条缝，
 * 把眼睛短暂遮住，再张开。
 *
 * 能量映射：瞳孔半径 8 - 5e（8..3）；眨眼间隔 5 - 3e 秒（5..2s）；每次眨眼
 * 0.12s；虹膜纹 12 + 12e 条（12..24）。眨眼是 clip 遮罩，不改变眼睛整体尺寸。
 * 布局：50/bar/off —— 只在 50px 天空带作画，不占 band、不显示频谱。
 *
 * 计时与眨眼状态在 createState 建立；step/paint 不建数组/对象，不用模糊。
 */
const pupilEffect = {
	id: 'pupil',
	name: '瞳孔',
	summary: '抽象眼随档位缩小瞳孔、加密虹膜纹，并每隔几秒眨一次眼',
	category: 'life',
	layout: { sky: 50, band: 0, track: 'bar', spectrum: false },

	createState: () => ({
		time: 0,
		// 首次眨眼留一点延迟，保证 t=0 的那一帧眼睛是睁开的。
		nextBlink: 1.6,
		blinkStart: -1,
		openness: 1,
	}),

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const interval = 5 - 3 * energy
		state.time += dt

		// 档位把间隔调短时，把下一次眨眼提前到新间隔内；其余情况保持节奏。
		if (state.nextBlink > state.time + interval) state.nextBlink = state.time + interval
		if (state.nextBlink <= state.time) {
			state.blinkStart = state.time
			state.nextBlink = state.time + interval
		}

		// 眨眼 0.12s：用 sin 的半个周期合拢再张开，眼睛整体尺寸不变。
		let openness = 1
		if (state.blinkStart >= 0) {
			const progress = (state.time - state.blinkStart) / 0.12
			if (progress >= 1) {
				state.blinkStart = -1
			} else if (progress >= 0) {
				openness = 1 - Math.sin(Math.PI * progress)
			}
		}
		state.openness = openness
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 50)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const centerX = width * 0.5
		const centerY = sky * 0.5
		const eyeRadius = Math.max(2, Math.min(sky * 0.42, width * 0.4))
		const openness = clamp01(state.openness ?? 1)
		// 眼睑开口的半高：眨眼时收到 0，再张开；眼白/虹膜都画在这个 clip 里。
		const lidHeight = Math.max(0.35, eyeRadius * 0.7 * openness)
		const pupilRadius = 8 - 5 * energy
		const irisRadius = Math.max(pupilRadius + 1.5, eyeRadius * 0.8)
		const rays = Math.min(24, Math.round(12 + 12 * energy))
		const rotation = state.time * (0.12 + 0.18 * energy)

		context.save()

		// 眼睑开口：杏仁形 clip。眨眼就是把这个开口压成一条缝。
		context.beginPath()
		context.ellipse(centerX, centerY, eyeRadius, lidHeight, 0, 0, TAU)
		context.clip()

		// 眼白：非常淡的一层 accent。
		context.fillStyle = accent
		context.globalAlpha = 0.06
		context.beginPath()
		context.ellipse(centerX, centerY, eyeRadius, lidHeight, 0, 0, TAU)
		context.fill()

		// 虹膜盘。
		context.globalAlpha = 0.2
		context.beginPath()
		context.arc(centerX, centerY, irisRadius, 0, TAU)
		context.fill()

		// 虹膜纹：围绕瞳孔的放射短线，缓慢旋转。
		context.globalAlpha = 0.5
		context.strokeStyle = accent
		context.lineWidth = 1
		context.beginPath()
		for (let index = 0; index < rays; index += 1) {
			const angle = rotation + (index / rays) * TAU
			const cos = Math.cos(angle)
			const sin = Math.sin(angle)
			context.moveTo(centerX + cos * irisRadius * 0.56, centerY + sin * irisRadius * 0.56)
			context.lineTo(centerX + cos * irisRadius * 0.95, centerY + sin * irisRadius * 0.95)
		}
		context.stroke()

		// 虹膜环。
		context.globalAlpha = 0.9
		context.lineWidth = 1.3
		context.beginPath()
		context.arc(centerX, centerY, irisRadius, 0, TAU)
		context.stroke()

		// 瞳孔：深色圆盘 + accent 细边 + 高光点。
		context.globalAlpha = 0.94
		context.fillStyle = '#080b10'
		context.beginPath()
		context.arc(centerX, centerY, pupilRadius, 0, TAU)
		context.fill()
		context.globalAlpha = 0.6
		context.strokeStyle = accent
		context.lineWidth = 1
		context.stroke()
		context.globalAlpha = 0.9
		context.fillStyle = accent
		context.beginPath()
		context.arc(
			centerX - pupilRadius * 0.35,
			centerY - pupilRadius * 0.35,
			Math.max(0.8, pupilRadius * 0.2),
			0,
			TAU
		)
		context.fill()

		context.restore()

		// 上下眼睑轮廓：不随瞳孔缩放变化，只跟眨眼开口走。
		context.globalAlpha = 0.45
		context.strokeStyle = accent
		context.lineWidth = 1.2
		context.beginPath()
		context.ellipse(centerX, centerY, eyeRadius, lidHeight, 0, Math.PI, TAU)
		context.stroke()
		context.beginPath()
		context.ellipse(centerX, centerY, eyeRadius, lidHeight, 0, 0, Math.PI)
		context.stroke()
		context.globalAlpha = 1
	},
}
