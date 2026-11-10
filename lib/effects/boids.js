/**
 * Boids 群集 (boids)
 *
 * 视觉机制：每条 boid 只受三股力——和邻居拉开距离（分离）、朝邻居平均朝向偏转
 * （对齐）、朝邻居质心靠拢（聚合）。档位越高个体越多、邻域越大、速度上限越高，
 * 群集自己长出密度与湍流，而不是把同一套运动放大。
 *
 * 能量映射：N = 24 + 56e（最多 80）；邻域 12 + 12e px；vmax = 30 + 90e px/s；
 * 分离权重 1.4。边界用反弹不用 wrap；三条边都在 band 内。
 * 布局：0/bar/off —— 只占 30px band，关掉 DOM 频谱。
 *
 * 80 个 boid 在 createState 里预分配；O(n²) 三力只对当前活跃数量做，step/paint
 * 不建数组、不建对象。位置/速度初值来自固定种子 LCG，可复现。
 * frame.sprite 是已解码的 32×32 光点精灵时用 drawImage 画头部，否则退回 arc。
 */
const boidsEffect = {
	id: 'boids',
	name: 'Boids 群集',
	summary: '分离/对齐/聚合三力驱动鸟群，档位越高越密越快，撞边反弹',
	category: 'particle',
	layout: { sky: 0, band: 30, track: 'bar', spectrum: false },

	createState: () => {
		const MAX = 80
		const boids = []
		for (let index = 0; index < MAX; index += 1) {
			boids.push({ x: 0, y: 0, vx: 0, vy: 0 })
		}
		// 固定种子 LCG：位置/初速可复现，测试与预览每次一样。
		let seed = 0x9e3779b9
		const random = () => {
			seed = (seed * 1664525 + 1013904223) >>> 0
			return seed / 4294967296
		}
		const starts = new Float64Array(MAX * 2)
		for (let index = 0; index < MAX; index += 1) {
			starts[index * 2] = random()
			starts[index * 2 + 1] = random()
			boids[index].vx = random() * 2 - 1
			boids[index].vy = (random() * 2 - 1) * 0.6
		}
		return { boids, starts, ready: false }
	},

	step(state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const width = Math.max(1, frame.width ?? 284)
		const bandTop = frame.band?.top ?? frame.sky ?? 0
		const bandHeight = Math.max(1, frame.band?.height ?? 30)
		const dt = Math.max(0.001, Math.min(0.033, frame.dt ?? 1 / 60))
		const target = Math.max(8, Math.min(80, Math.round(24 + 56 * energy)))
		const radius = 12 + 12 * energy
		const radiusSq = radius * radius
		const maxSpeed = 30 + 90 * energy
		const minSpeed = maxSpeed * 0.35
		const separationWeight = 1.4
		const margin = Math.min(3, Math.max(1, bandHeight * 0.1))
		const loX = Math.min(margin, width * 0.4)
		const hiX = Math.max(loX + 1, width - loX)
		const loY = bandTop + margin
		const hiY = Math.max(loY + 1, bandTop + bandHeight - margin)
		const boids = state.boids
		const starts = state.starts

		// 首帧：把 80 个 boid 撒进 band，初速按当前 vmax 归一化。
		if (!state.ready) {
			for (let index = 0; index < boids.length; index += 1) {
				const boid = boids[index]
				boid.x = loX + starts[index * 2] * (hiX - loX)
				boid.y = loY + starts[index * 2 + 1] * (hiY - loY)
				const speed = Math.hypot(boid.vx, boid.vy)
				const scale = speed > 0.0001 ? (maxSpeed * 0.55) / speed : 0
				boid.vx *= scale
				boid.vy *= scale
			}
			state.ready = true
		}

		// O(n²) 三力：只遍历活跃个体，距离先用平方比较，邻居才开方。
		for (let index = 0; index < target; index += 1) {
			const boid = boids[index]
			let alignX = 0
			let alignY = 0
			let centerX = 0
			let centerY = 0
			let awayX = 0
			let awayY = 0
			let neighbors = 0

			for (let other = 0; other < target; other += 1) {
				if (other === index) continue
				const mate = boids[other]
				const dx = boid.x - mate.x
				const dy = boid.y - mate.y
				const distanceSq = dx * dx + dy * dy
				if (distanceSq >= radiusSq || distanceSq < 0.0001) continue
				const inverse = 1 / Math.sqrt(distanceSq)
				neighbors += 1
				alignX += mate.vx
				alignY += mate.vy
				centerX += mate.x
				centerY += mate.y
				awayX += dx * inverse
				awayY += dy * inverse
			}

			let ax = 0
			let ay = 0
			if (neighbors > 0) {
				// 对齐：朝邻居平均朝向偏转；聚合：朝邻居质心靠拢。
				const alignMag = Math.hypot(alignX, alignY)
				if (alignMag > 0.0001) {
					ax += ((alignX / alignMag) * maxSpeed - boid.vx) * 1.1
					ay += ((alignY / alignMag) * maxSpeed - boid.vy) * 1.1
				}
				const toCenterX = centerX / neighbors - boid.x
				const toCenterY = centerY / neighbors - boid.y
				const centerMag = Math.hypot(toCenterX, toCenterY)
				if (centerMag > 0.0001) {
					ax += ((toCenterX / centerMag) * maxSpeed - boid.vx) * 0.9
					ay += ((toCenterY / centerMag) * maxSpeed - boid.vy) * 0.9
				}
				// 分离：邻居越近推得越狠，权重 1.4 压过对齐/聚合。
				const awayMag = Math.hypot(awayX, awayY)
				if (awayMag > 0.0001) {
					ax += (awayX / awayMag) * maxSpeed * separationWeight * 1.6
					ay += (awayY / awayMag) * maxSpeed * separationWeight * 1.6
				}
			}

			// 靠近上下边时加一股回中力：否则高速群会贴着两条边滑成「车道」。
			const edgeZone = bandHeight * 0.28
			if (boid.y < loY + edgeZone) {
				ay += maxSpeed * 3 * (1 - (boid.y - loY) / edgeZone)
			} else if (boid.y > hiY - edgeZone) {
				ay -= maxSpeed * 3 * (1 - (hiY - boid.y) / edgeZone)
			}
			const sideZone = Math.min(width * 0.08, 20)
			if (boid.x < loX + sideZone) {
				ax += maxSpeed * 2 * (1 - (boid.x - loX) / sideZone)
			} else if (boid.x > hiX - sideZone) {
				ax -= maxSpeed * 2 * (1 - (hiX - boid.x) / sideZone)
			}

			boid.vx += ax * dt
			boid.vy += ay * dt

			// 限速：不许超过 vmax，也不许停死（否则群会散成一堆静止点）。
			let speed = Math.hypot(boid.vx, boid.vy)
			if (speed > maxSpeed) {
				boid.vx = (boid.vx / speed) * maxSpeed
				boid.vy = (boid.vy / speed) * maxSpeed
			} else if (speed < minSpeed) {
				if (speed > 0.0001) {
					boid.vx = (boid.vx / speed) * minSpeed
					boid.vy = (boid.vy / speed) * minSpeed
				} else {
					boid.vx = minSpeed
					boid.vy = 0
				}
			}

			boid.x += boid.vx * dt
			boid.y += boid.vy * dt

			// 边缘反弹，不用 wrap：撞墙把法向速度翻正。
			if (boid.x < loX) {
				boid.x = loX
				boid.vx = Math.abs(boid.vx)
			} else if (boid.x > hiX) {
				boid.x = hiX
				boid.vx = -Math.abs(boid.vx)
			}
			if (boid.y < loY) {
				boid.y = loY
				boid.vy = Math.abs(boid.vy)
			} else if (boid.y > hiY) {
				boid.y = hiY
				boid.vy = -Math.abs(boid.vy)
			}
		}
	},

	paint(context, state, frame) {
		const energy = clamp01(frame.energy ?? 0)
		const accent = frame.accent ?? 'rgb(120, 200, 255)'
		const sprite = frame.sprite ?? null
		const count = Math.max(8, Math.min(80, Math.round(24 + 56 * energy)))
		const boids = state.boids
		const length = 1.5 + 2.5 * energy

		context.save()

		// 速度方向上的短线段：一只 boid 一笔，但整群一次 stroke。
		context.lineWidth = 1
		context.strokeStyle = withAlpha(accent, 0.45 + 0.15 * energy)
		context.beginPath()
		for (let index = 0; index < count; index += 1) {
			const boid = boids[index]
			const speed = Math.hypot(boid.vx, boid.vy)
			if (speed < 0.0001) continue
			const tailX = boid.x - (boid.vx / speed) * length
			const tailY = boid.y - (boid.vy / speed) * length
			context.moveTo(tailX, tailY)
			context.lineTo(boid.x, boid.y)
		}
		context.stroke()

		if (sprite !== null) {
			// 有精灵：头部画成柔光点，颜色靠线段的 accent 读出来。
			const size = 4 + 2 * energy
			const half = size / 2
			context.globalAlpha = 0.75
			for (let index = 0; index < count; index += 1) {
				const boid = boids[index]
				context.drawImage(sprite, boid.x - half, boid.y - half, size, size)
			}
			context.globalAlpha = 1
		} else {
			// 没有精灵：退回实心圆点，一次 fill 画完。
			context.fillStyle = accent
			const headRadius = 1.2 + 0.6 * energy
			context.beginPath()
			for (let index = 0; index < count; index += 1) {
				const boid = boids[index]
				context.moveTo(boid.x + headRadius, boid.y)
				context.arc(boid.x, boid.y, headRadius, 0, Math.PI * 2)
			}
			context.fill()
		}

		context.restore()
	},
}
