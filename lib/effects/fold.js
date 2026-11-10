/**
 * 折纸翻折 (fold)
 *
 * 视觉机制：一张多边形纸片沿竖直中轴折起：左半边保持正面，右半边向后折、投影
 * 宽度按 cos(折角) 收窄，背面叠一层黑阴影；折边外侧再加一条纸厚侧边。档位越高
 * 折角越大、背面越暗，接近 π/2 时右面退化成 1px 边。
 *
 * 能量映射：折角 0.05 + 0.85e（0..π/2）；投影宽 halfWidth·cos(angle)（保底 1px）；
 * 阴影 0.2 + 0.4e。
 * 布局：46/bar/off —— 只在 46px 天空带作画，不占 band、不显示频谱。
 *
 * 两个四边形 + 侧边的坐标都由 frame 直接算出；step 无状态，paint 不建数组/对象。
 */
const foldEffect = {
	id: 'fold',
	name: '折纸翻折',
	summary: '多边形纸片沿竖直轴折起，右半边按 cos 收窄、背面越折越暗，留一条纸厚侧边',
	category: 'morph',
	layout: { sky: 46, band: 0, track: 'bar', spectrum: false },

	createState: () => ({}),

	step() {
		// 折角完全由 frame.energy 决定，没有需要逐帧推进的状态。
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const sky = Math.max(1, frame.artBox?.height ?? frame.band?.top ?? frame.sky ?? 46)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const centerX = width * 0.5
		const centerY = sky * 0.5
		const halfWidth = Math.min(width * 0.32, 68)
		const height = Math.max(6, sky * 0.72)
		const angle = 0.05 + 0.85 * energy
		const projected = Math.max(1, halfWidth * Math.cos(angle))
		const top = centerY - height * 0.5
		const bottom = centerY + height * 0.5
		const inset = Math.min(3.2, height * 0.1)
		const leftX = centerX - halfWidth
		const rightX = centerX + projected
		const shadow = 0.2 + 0.4 * energy
		// 纸厚侧边：折得越狠露出的侧边越宽，最窄保留 1px。
		const edgeWidth = 1 + 2.2 * Math.sin(angle)

		context.save()
		context.lineWidth = 1
		context.fillStyle = accent
		context.strokeStyle = accent

		// 左半边（正面，不折）：外缘略收，像一个有透视的四边形。
		context.beginPath()
		context.moveTo(leftX, top + inset)
		context.lineTo(centerX, top)
		context.lineTo(centerX, bottom)
		context.lineTo(leftX, bottom - inset)
		context.closePath()
		context.globalAlpha = 0.78
		context.fill()
		context.globalAlpha = 0.9
		context.stroke()

		// 折痕内侧的暗带：给右半边压出来的阴影一点落点。
		context.globalAlpha = shadow * 0.25
		context.fillStyle = '#000000'
		context.beginPath()
		context.moveTo(centerX - 8, top)
		context.lineTo(centerX, top)
		context.lineTo(centerX, bottom)
		context.lineTo(centerX - 8, bottom)
		context.closePath()
		context.fill()

		// 右半边（折起的背面）：投影宽 = halfWidth·cos(angle)，再压一层阴影。
		context.fillStyle = accent
		context.globalAlpha = 0.78
		context.beginPath()
		context.moveTo(centerX, top)
		context.lineTo(rightX, top + inset)
		context.lineTo(rightX, bottom - inset)
		context.lineTo(centerX, bottom)
		context.closePath()
		context.fill()
		context.globalAlpha = shadow
		context.fillStyle = '#000000'
		context.fill()
		context.globalAlpha = 0.9
		context.strokeStyle = accent
		context.stroke()

		// 纸厚侧边：贴在右面外缘的一条窄四边形，角度接近 π/2 时仍有 1px。
		if (projected >= 1 && edgeWidth >= 1) {
			context.fillStyle = accent
			context.globalAlpha = 0.85
			context.beginPath()
			context.moveTo(rightX, top + inset)
			context.lineTo(rightX + edgeWidth, top + inset + edgeWidth * 0.4)
			context.lineTo(rightX + edgeWidth, bottom - inset + edgeWidth * 0.4)
			context.lineTo(rightX, bottom - inset)
			context.closePath()
			context.fill()
			context.globalAlpha = shadow * 0.9
			context.fillStyle = '#000000'
			context.fill()
			context.globalAlpha = 0.5
			context.strokeStyle = accent
			context.stroke()
		}

		// 折痕高光：一条竖直亮线，把两半分开。
		context.globalAlpha = 0.95
		context.strokeStyle = accent
		context.beginPath()
		context.moveTo(centerX, top)
		context.lineTo(centerX, bottom)
		context.stroke()

		context.globalAlpha = 1
		context.restore()
	},
}
