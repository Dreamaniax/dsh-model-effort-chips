/**
 * 陀螺进动 (gyroscope)
 *
 * 视觉机制：一枚椭圆陀螺躺在虚线圆环上，沿环进动，同时自身高速自旋；
 * 一根轴线从陀螺中心穿出并按倾角倾斜。
 *
 * 尺寸恒定：圆环半径按画板宽度铺满（高度不足时由天空带高度封顶），
 * 陀螺本体、倾角、环半径都不随档位变化——档位只改两件事：
 * 自旋 3 + 15e rad/s、进动 0.2 + 1.4e rad/s。
 *
 * 布局：72/bar/off —— 72px 天空带，环的椭圆投影正好铺满画板。
 *
 * 纯参数方程：state 只存自旋/进动两个角度，paint 里按当前 angle 求位置；
 * 虚线环用固定 48 段、每 4 段亮 2 段的索引模式绘制，不建 Path2D、不 new 数组。
 */
const gyroscopeEffect = {
	id: 'gyroscope',
	name: '陀螺进动',
	summary: '椭圆陀螺沿铺满画板的虚线圆环进动，档位越高自旋与公转越快',
	layout: { sky: 72, band: 0, track: 'bar', spectrum: false },

	createState: () => ({ spin: 0, precession: 0 }),

	step(state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.spin = (state.spin + (3 + 15 * level) * dt) % TAU
		state.precession = (state.precession + (0.2 + 1.4 * level) * dt) % TAU
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const boxTop = frame.artBox?.top ?? 0
		const boxHeight = Math.max(1, frame.artBox?.height ?? 20)
		const centerX = width * 0.5
		const centerY = boxTop + boxHeight * 0.51

		// 俯视圆的透视压扁；半径取「铺满画板宽度」与「不超出天空带高度」的较小值。
		const ringSquash = 0.3
		const ringRadius = Math.max(
			10,
			Math.min(width * 0.44, (boxHeight - 6) / (2 * ringSquash))
		)
		const ringRadiusY = ringRadius * ringSquash
		// 倾角、盘身、轴线全部与档位无关，只保留速度随档位变化。
		const tilt = 0.34
		const bodyRadiusX = 5.2
		const bodyRadiusY = 2.6
		const axisLength = bodyRadiusX + 1.2

		context.save()

		// 虚线圆环：48 段，i % 4 < 2 的段可见（固定 dash 模式，无数组分配）。
		const segments = 48
		const segmentAngle = TAU / segments
		context.beginPath()
		for (let i = 0; i < segments; i += 1) {
			if (i % 4 >= 2) continue
			const from = i * segmentAngle
			const to = from + segmentAngle
			context.moveTo(
				centerX + Math.cos(from) * ringRadius,
				centerY + Math.sin(from) * ringRadiusY
			)
			context.lineTo(
				centerX + Math.cos(to) * ringRadius,
				centerY + Math.sin(to) * ringRadiusY
			)
		}
		context.strokeStyle = withAlpha(accent, 0.26 + 0.2 * level)
		context.lineWidth = 1
		context.stroke()

		// 陀螺在环上的进动位置。
		const gyroX = centerX + Math.cos(state.precession) * ringRadius
		const gyroY = centerY + Math.sin(state.precession) * ringRadiusY
		// 盘面随倾角一起偏转（轴线是盘面法线，两者角度一致）。
		const bodyAngle = tilt

		context.save()
		context.translate(gyroX, gyroY)
		context.rotate(bodyAngle)

		// 椭圆盘身，用 24 段折线近似，走 preview 也支持的原语。
		context.beginPath()
		for (let i = 0; i <= 24; i += 1) {
			const angle = (i / 24) * TAU
			const pointX = Math.cos(angle) * bodyRadiusX
			const pointY = Math.sin(angle) * bodyRadiusY
			if (i === 0) context.moveTo(pointX, pointY)
			else context.lineTo(pointX, pointY)
		}
		context.closePath()
		context.fillStyle = withAlpha(accent, 0.16 + 0.2 * level)
		context.fill()
		context.strokeStyle = withAlpha(accent, 0.72)
		context.lineWidth = 1
		context.stroke()

		// 自旋：盘面内一根随 spin 角转动的辐条。
		const spokeX = Math.cos(state.spin) * (bodyRadiusX - 1.1)
		const spokeY = Math.sin(state.spin) * (bodyRadiusY - 0.6)
		context.beginPath()
		context.moveTo(-spokeX, -spokeY)
		context.lineTo(spokeX, spokeY)
		context.strokeStyle = withAlpha(accent, 0.45 + 0.25 * level)
		context.lineWidth = 1
		context.stroke()

		context.restore()

		// 轴线：穿过盘心，按倾角偏离竖直方向。
		const axisX = Math.sin(tilt) * axisLength
		const axisY = Math.cos(tilt) * axisLength
		context.beginPath()
		context.moveTo(gyroX - axisX, gyroY + axisY)
		context.lineTo(gyroX + axisX, gyroY - axisY)
		context.strokeStyle = withAlpha(accent, 0.5 + 0.35 * level)
		context.lineWidth = 1.2
		context.stroke()

		// 轴顶亮点 + 盘心。
		context.fillStyle = accent
		context.globalAlpha = 0.85
		context.beginPath()
		context.arc(gyroX + axisX, gyroY - axisY, 0.9, 0, TAU)
		context.fill()
		context.globalAlpha = 0.6
		context.beginPath()
		context.arc(gyroX, gyroY, 0.8, 0, TAU)
		context.fill()
		context.globalAlpha = 1

		context.restore()
	},
}
