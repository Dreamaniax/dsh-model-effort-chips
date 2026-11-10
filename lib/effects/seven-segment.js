/**
 * 七段数码管 (seven-segment)
 *
 * 视觉机制：三位硬编码七段数字显示当前档位百分比（0–100），亮段用 accent、
 * 未亮段保留 alpha 0.12 的暗影，读数一眼可见。段全部是常量矩形，不碰字体、
 * 不调字体测量 API，位数固定为三位，换档时不会左右抖动。
 *
 * 能量映射：显示 round(e·100)；刷新频率 8 + 20e Hz —— step 里节流，只有累计
 * 时间超过 1/(8+20e) 才更新 state.shown，paint 只按已存值画。
 * 布局：0/bar/off —— 只用 30px band。
 *
 * 段位坐标与 0–9 的亮灭位掩码都在 createState 里一次性预计算（Float32Array /
 * Uint8Array），step/paint 只读，不 new、不调字体 API。
 */
const sevenSegmentEffect = {
	id: 'seven-segment',
	name: '七段数码管',
	summary: '三位硬编码七段数码管显示当前百分比，未亮段留暗影',
	category: 'data',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		// 七段在本地位坐标系里的矩形：a b c d e f g，顺序与位掩码一致。
		// 位：a=1, b=2, c=4, d=8, e=16, f=32, g=64。
		const segments = new Float32Array([
			// a: 上横
			2, 0, 8, 2,
			// b: 右上竖
			10, 2, 2, 9,
			// c: 右下竖
			10, 13, 2, 9,
			// d: 下横
			2, 22, 8, 2,
			// e: 左下竖
			0, 13, 2, 9,
			// f: 左上竖
			0, 2, 2, 9,
			// g: 中横
			2, 11, 8, 2,
		])
		// 0–9 的亮段掩码，顺序为 a b c d e f g。
		const digits = new Uint8Array([
			63, // 0: a b c d e f
			6, // 1: b c
			91, // 2: a b d e g
			79, // 3: a b c d g
			102, // 4: b c f g
			109, // 5: a c d f g
			125, // 6: a c d e f g
			7, // 7: a b c
			127, // 8: all
			111, // 9: a b c d f g
		])
		return { time: 0, shown: 0, accumulate: 0, ready: false, segments, digits }
	},

	step(state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const dt = Math.min(1 / 30, Math.max(1 / 240, frame.dt ?? 1 / 60))
		state.time += dt
		state.accumulate += dt

		// 节流刷新：8 + 20e Hz。越高的档刷新越快，但都不是每帧重算。
		const interval = 1 / (8 + 20 * level)
		if (!state.ready || state.accumulate >= interval) {
			state.ready = true
			state.accumulate = 0
			state.shown = Math.round(level * 100)
		}
	},

	paint(context, state, frame) {
		const level = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const width = Math.max(40, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const segments = state.segments
		const digits = state.digits
		// 三位定宽：100 -> 1,0,0；7 -> 0,0,7，永远占满三个位，画面不抖。
		const value = Math.max(0, Math.min(100, Math.round(state.shown)))
		const digitWidth = 12
		const digitHeight = 24
		const gap = 4
		const totalWidth = digitWidth * 3 + gap * 2
		const originX = (width - totalWidth) * 0.5
		const originY = bandTop + (bandHeight - digitHeight) * 0.5

		context.save()

		// 先铺暗段，再铺亮段：两次 fillStyle，21 个 fillRect 就够了。
		context.fillStyle = withAlpha(accent, 0.12)
		for (let position = 0; position < 3; position += 1) {
			const digit = Math.floor(value / (position === 0 ? 100 : position === 1 ? 10 : 1)) % 10
			const mask = digits[digit]
			const baseX = originX + position * (digitWidth + gap)
			for (let segment = 0; segment < 7; segment += 1) {
				if ((mask & (1 << segment)) !== 0) continue
				const offset = segment * 4
				context.fillRect(
					baseX + segments[offset],
					originY + segments[offset + 1],
					segments[offset + 2],
					segments[offset + 3]
				)
			}
		}

		context.fillStyle = withAlpha(accent, 0.92)
		for (let position = 0; position < 3; position += 1) {
			const digit = Math.floor(value / (position === 0 ? 100 : position === 1 ? 10 : 1)) % 10
			const mask = digits[digit]
			const baseX = originX + position * (digitWidth + gap)
			for (let segment = 0; segment < 7; segment += 1) {
				if ((mask & (1 << segment)) === 0) continue
				const offset = segment * 4
				context.fillRect(
					baseX + segments[offset],
					originY + segments[offset + 1],
					segments[offset + 2],
					segments[offset + 3]
				)
			}
		}

		context.restore()
	},
}
