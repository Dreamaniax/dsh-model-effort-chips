/**
 * 分段进度 (segments) — 数据与文字, docs/plan/01-effects-taxonomy.md §8.
 *
 * A row of fixed-size blocks whose **count** follows the level: nothing at off,
 * a single block as soon as you drag, and enough blocks to fill the whole panel
 * at max. The block size never changes, so the row always reads as one scale.
 *
 *   block    6 x 12 px, 3 px gap (constant at every level)
 *   count    round(e * maxCount), maxCount = however many fit across the panel
 *   head     the newest block breathes, the rest sit at full alpha
 *
 * Layout sky 0 / band 30 / bar / off.
 */
const segmentsEffect = {
	id: 'segments',
	name: '分段进度',
	summary: '方块大小固定，数量随档位从 0 增加到铺满整条滑条',
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
		const bandHeight = Math.max(1, frame.band?.height || frame.height || 30)

		// Constant geometry: only the number of blocks changes with the level.
		const blockWidth = 6
		const gap = 3
		const blockHeight = Math.min(bandHeight - 8, 14)
		const stride = blockWidth + gap
		const maxCount = Math.max(1, Math.floor((width - 8 + gap) / stride))
		const count = Math.round(level * maxCount)
		const totalWidth = count > 0 ? count * blockWidth + (count - 1) * gap : 0
		const startX = Math.round((width - totalWidth) * 0.5)
		const y = Math.round(bandTop + (bandHeight - blockHeight) * 0.5)
		const pulse = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(state.time * 6))

		context.save()
		for (let index = 0; index < count; index += 1) {
			const newest = index === count - 1
			context.fillStyle = withAlpha(accent, newest ? pulse : 0.82)
			context.fillRect(startX + index * stride, y, blockWidth, blockHeight)
		}
		context.restore()
	},
}
