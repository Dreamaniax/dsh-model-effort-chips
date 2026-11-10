/**
 * 5×7 点阵字 (dot-matrix)
 *
 * 视觉机制：一块小点阵屏，用硬编码的 5×7 字模显示 `AI` / 档位缩写；每个字模
 * 点亮 round(e*35) 个格（从最上一行往下一格格“打印”出来），档位越高字亮得越满，
 * 整块屏按 4 + 10e Hz 闪烁。
 *
 * 能量映射：每个 5×7 字模点亮 round(e*35) 格；字模按档位切换
 * AI → LOW → MID → MAX；闪烁 4 + 10e Hz。单元 2px，只画点亮格（不画整屏、
 * 不用 fillText）。
 * 布局：36/bar/off —— 只在 36px 天空带作画，不占 band、不显示频谱。
 *
 * 字模常量表在 createState 建一次（按字符码索引），step/paint 不建数组/对象。
 */
const dotMatrixEffect = {
	id: 'dot-matrix',
	name: '5×7 点阵字',
	summary: '硬编码 5×7 字模显示 AI / 档位缩写，点亮格数随档位增加并快速闪烁',
	category: 'data',
	layout: { sky: 36, band: 0, track: 'bar', spectrum: false },

	createState: () => {
		// 5×7 字模：每行一个 5 位掩码，bit4 是最左列。按 ASCII 码索引。
		// A dense map keyed by char code: a 128-slot holey array trips every
		// size walker (and wastes the 116 empty slots).
		const glyphs = {}
		glyphs[65] = [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001] // A
		glyphs[73] = [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111] // I
		glyphs[88] = [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001] // X
		glyphs[76] = [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111] // L
		glyphs[77] = [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001] // M
		glyphs[79] = [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110] // O
		glyphs[87] = [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001] // W
		glyphs[68] = [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110] // D
		glyphs[72] = [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001] // H
		glyphs[49] = [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110] // 1
		glyphs[50] = [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111] // 2
		glyphs[51] = [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110] // 3
		return { time: 0, glyphs }
	},

	step(state, frame) {
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		state.time += dt
	},

	paint(context, state, frame) {
		const TAU = Math.PI * 2
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 36)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const glyphs = state.glyphs
		// 字模按档位切换：off 显示品牌 AI，往上依次是 LOW / MID / MAX。
		let label = 'AI'
		if (energy >= 0.75) label = 'MAX'
		else if (energy >= 0.5) label = 'MID'
		else if (energy >= 0.25) label = 'LOW'
		const length = label.length
		const cell = 2
		const gap = 1
		const totalWidth = (length * 5 + (length - 1) * gap) * cell
		const left = Math.round((width - totalWidth) * 0.5)
		const top = Math.round((sky - 7 * cell) * 0.5)
		// 每个 5×7 字模点亮 round(e*35) 格；e=1 时整字满亮。
		const budget = Math.round(energy * 35)
		const pulse = 0.5 + 0.5 * Math.sin(state.time * TAU * (4 + 10 * energy))
		const alpha = 0.35 + 0.65 * pulse

		context.save()
		context.globalAlpha = alpha
		context.fillStyle = accent
		context.beginPath()
		for (let glyphIndex = 0; glyphIndex < length; glyphIndex += 1) {
			const rows = glyphs[label.charCodeAt(glyphIndex)]
			if (rows === undefined) continue
			let lit = 0
			for (let row = 0; row < 7; row += 1) {
				const bits = rows[row]
				for (let col = 0; col < 5; col += 1) {
					if ((bits & (1 << (4 - col))) === 0) continue
					if (lit < budget) {
						context.rect(
							left + (glyphIndex * (5 + gap) + col) * cell,
							top + row * cell,
							cell,
							cell
						)
					}
					lit += 1
				}
			}
		}
		context.fill()
		context.restore()
		context.globalAlpha = 1
	},
}
