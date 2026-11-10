/**
 * 分段进度 (segments)
 *
 * 视觉机制：20 段小方块排成一条进度条，按档位填充；末端一段像呼吸一样脉冲，
 * 提示「当前正在这一档」。方块只画 fillRect，没有圆角、没有渐变。
 *
 * 能量映射：填充 floor(20e) 段；段宽 6 - 2e px（越高档越窄）、间距固定 2px；
 * 末端一段 alpha = 0.4 + 0.55·(0.5 + 0.5·sin(6t))。
 * 布局：0/bar/off —— 只用 30px band。
 *
 * step 只推进时间；paint 里所有坐标由 width/energy 现算，20 个 fillRect，
 * 不建数组、不做圆角路径。
 */
const segmentsEffect = {
	id: 'segments',
	name: '分段进度',
	summary: '20 段小方块按档位填充，末端一段脉冲提示当前进度',
	category: 'data',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => ({ time: 0 }),

	step(state, frame) {
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const COUNT = 20
		const gap = 2
		const segmentWidth = 6 - 2 * level
		const segmentHeight = Math.min(14, bandHeight * 0.5)
		const totalWidth = COUNT * segmentWidth + (COUNT - 1) * gap
		const originX = (width - totalWidth) * 0.5
		const originY = bandTop + (bandHeight - segmentHeight) * 0.5
		const filled = Math.max(0, Math.min(COUNT, Math.floor(COUNT * level)))
		const pulse = 0.5 + 0.5 * Math.sin(6 * state.time)

		context.save()

		// 未填充的段：暗影，保持整条 20 格的结构。
		context.fillStyle = withAlpha(accent, 0.12)
		for (let index = filled; index < COUNT; index += 1) {
			context.fillRect(originX + index * (segmentWidth + gap), originY, segmentWidth, segmentHeight)
		}

		// 已填充的段：亮色；最后一段随 6rad/s 的脉冲变亮。
		for (let index = 0; index < filled; index += 1) {
			const terminal = index === filled - 1
			context.fillStyle = terminal
				? withAlpha(accent, 0.4 + 0.55 * pulse)
				: withAlpha(accent, 0.88)
			context.fillRect(originX + index * (segmentWidth + gap), originY, segmentWidth, segmentHeight)
		}

		context.restore()
	},
}
