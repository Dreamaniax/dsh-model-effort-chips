#!/usr/bin/env node
/**
 * Dev-only: render an effect to SVG so the artwork can be inspected headlessly.
 *
 * node-canvas will not build on this machine, so instead of rasterising we
 * replay the effect's paint calls into a tiny CanvasRenderingContext2D recorder
 * and emit SVG. macOS QuickLook (`qlmanage -t`) turns that into a PNG.
 *
 * Usage: node scripts/preview-effect.mjs <effectId> <energy> <out.svg>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(here, 'scripts', 'preview-effect.mjs'))

const effectId = process.argv[2] ?? 'kunpeng'
const energy = Number(process.argv[3] ?? '0.66')
const outPath = process.argv[4] ?? '/tmp/effect.svg'

const WIDTH = 284

// --- minimal 2D context recorder -------------------------------------------
let nextGradientId = 0
const defs = []
const body = []

function identity() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

function multiply(m, n) {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

function apply(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
}

function colorOf(style) {
  if (style && typeof style === 'object' && style.__gradient) return `url(#${style.__id})`
  return String(style ?? '#fff')
}

class Context {
  constructor() {
    this.state = {
      transform: identity(),
      fillStyle: '#fff',
      strokeStyle: '#fff',
      globalAlpha: 1,
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }
    this.stack = []
    this.path = []
    this.current = null
  }

  save() {
    this.stack.push({ ...this.state, transform: { ...this.state.transform } })
  }

  restore() {
    const previous = this.stack.pop()
    if (previous) this.state = previous
  }

  translate(x, y) {
    this.state.transform = multiply(this.state.transform, { a: 1, b: 0, c: 0, d: 1, e: x, f: y })
  }

  scale(x, y) {
    this.state.transform = multiply(this.state.transform, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 })
  }

  rotate(angle) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    this.state.transform = multiply(this.state.transform, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 })
  }

  beginPath() {
    this.path = []
    this.current = null
  }

  moveTo(x, y) {
    const point = apply(this.state.transform, x, y)
    this.path.push(`M ${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
    this.current = point
  }

  lineTo(x, y) {
    const point = apply(this.state.transform, x, y)
    this.path.push(`L ${point[0].toFixed(2)} ${point[1].toFixed(2)}`)
    this.current = point
  }

  quadraticCurveTo(cx, cy, x, y) {
    const control = apply(this.state.transform, cx, cy)
    const point = apply(this.state.transform, x, y)
    this.path.push(
      `Q ${control[0].toFixed(2)} ${control[1].toFixed(2)} ${point[0].toFixed(2)} ${point[1].toFixed(2)}`
    )
    this.current = point
  }

  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
    const c1 = apply(this.state.transform, c1x, c1y)
    const c2 = apply(this.state.transform, c2x, c2y)
    const point = apply(this.state.transform, x, y)
    this.path.push(
      `C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${point[0].toFixed(2)} ${point[1].toFixed(2)}`
    )
    this.current = point
  }

  fillRect(x, y, w, h) {
    const topLeft = apply(this.state.transform, x, y)
    const bottomRight = apply(this.state.transform, x + w, y + h)
    this.path = [
      `M ${topLeft[0].toFixed(2)} ${topLeft[1].toFixed(2)}`,
      `L ${bottomRight[0].toFixed(2)} ${topLeft[1].toFixed(2)}`,
      `L ${bottomRight[0].toFixed(2)} ${bottomRight[1].toFixed(2)}`,
      `L ${topLeft[0].toFixed(2)} ${bottomRight[1].toFixed(2)}`,
      'Z',
    ]
    body.push(
      `<path d="${this.path.join(' ')}" fill="${colorOf(this.state.fillStyle)}" fill-opacity="${this.state.globalAlpha.toFixed(3)}"/>`
    )
    this.path = []
  }

  ellipse(x, y, rx, ry, rotation, start, end) {
    const center = apply(this.state.transform, x, y)
    const sweep = Math.abs(end - start)
    const segments = Math.max(10, Math.round((sweep / (Math.PI * 2)) * 28))
    for (let index = 0; index <= segments; index += 1) {
      const angle = start + ((end - start) * index) / segments
      const cos = Math.cos(angle) * rx
      const sin = Math.sin(angle) * ry
      const px = center[0] + cos * Math.cos(rotation) - sin * Math.sin(rotation)
      const py = center[1] + cos * Math.sin(rotation) + sin * Math.cos(rotation)
      this.path.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`)
    }
    this.current = center
  }

  rect(x, y, w, h) {
    const corners = [
      apply(this.state.transform, x, y),
      apply(this.state.transform, x + w, y),
      apply(this.state.transform, x + w, y + h),
      apply(this.state.transform, x, y + h),
    ]
    this.path.push(`M ${corners[0][0].toFixed(2)} ${corners[0][1].toFixed(2)}`)
    for (let index = 1; index < corners.length; index += 1) {
      this.path.push(`L ${corners[index][0].toFixed(2)} ${corners[index][1].toFixed(2)}`)
    }
    this.path.push('Z')
    this.current = corners[0]
  }

  clip() {}

  arc(x, y, r, start, end) {
    const center = apply(this.state.transform, x, y)
    const radius = r * Math.abs(this.state.transform.a)
    const sweep = Math.abs(end - start)
    const segments = Math.max(8, Math.round((sweep / (Math.PI * 2)) * 24))
    for (let index = 0; index <= segments; index += 1) {
      const angle = start + ((end - start) * index) / segments
      const px = center[0] + Math.cos(angle) * radius
      const py = center[1] + Math.sin(angle) * radius
      this.path.push(`${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`)
    }
    this.current = [center[0] + radius, center[1]]
  }

  closePath() {
    this.path.push('Z')
  }

  fill() {
    if (this.path.length === 0) return
    body.push(
      `<path d="${this.path.join(' ')}" fill="${colorOf(this.state.fillStyle)}" fill-opacity="${this.state.globalAlpha.toFixed(3)}"/>`
    )
  }

  stroke() {
    if (this.path.length === 0) return
    body.push(
      `<path d="${this.path.join(' ')}" fill="none" stroke="${colorOf(this.state.strokeStyle)}" stroke-opacity="${this.state.globalAlpha.toFixed(3)}" stroke-width="${this.state.lineWidth}" stroke-linecap="${this.state.lineCap}" stroke-linejoin="${this.state.lineJoin}"/>`
    )
  }

  createLinearGradient(x0, y0, x1, y1) {
    const id = `grad${nextGradientId++}`
    const gradient = { __gradient: true, __id: id, stops: [], x0, y0, x1, y1 }
    defs.push(gradient)
    return {
      addColorStop(offset, color) {
        gradient.stops.push({ offset, color })
      },
      __gradient: true,
      __id: id,
    }
  }

  clearRect() {}

  set fillStyle(value) {
    this.state.fillStyle = value
  }
  get fillStyle() {
    return this.state.fillStyle
  }
  set strokeStyle(value) {
    this.state.strokeStyle = value
  }
  get strokeStyle() {
    return this.state.strokeStyle
  }
  set globalAlpha(value) {
    this.state.globalAlpha = value
  }
  get globalAlpha() {
    return this.state.globalAlpha
  }
  set lineWidth(value) {
    this.state.lineWidth = value
  }
  get lineWidth() {
    return this.state.lineWidth
  }
  set lineCap(value) {
    this.state.lineCap = value
  }
  get lineCap() {
    return this.state.lineCap
  }
  set lineJoin(value) {
    this.state.lineJoin = value
  }
  get lineJoin() {
    return this.state.lineJoin
  }
  set shadowColor(_value) {}
  set shadowBlur(_value) {}
}

// --- load the bundle and grab the effect -----------------------------------
const React = nodeRequire('react')
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

let captured = null
const sandbox = {
  __ModuleLoader__: {
    load: ({ factory }) => {
      captured = factory((name) => {
        if (name === 'react') return React
        if (name === 'react-dom') return nodeRequire('react-dom')
        throw new Error(`unexpected require(${name})`)
      })
    },
  },
}
new Function('window', 'console', 'setInterval', 'clearInterval', source)(sandbox, console, setInterval, clearInterval)
const internals = captured.__internals
const effect = internals.resolveEffect(effectId)
if (effect === undefined) throw new Error(`unknown effect ${effectId}`)

const layout = effect.layout ?? { sky: 0, track: 'bar', spectrum: true }
const sky = internals.effectiveSky(effect)
// The canvas follows whatever sky the effect asked for, exactly like the host.
const HEIGHT = sky + 30 + 58
const band = { top: sky, height: 30 }
const trackY = sky + 30 + 16

const context = new Context()
const state = effect.createState()
const dt = 1 / 30
// warm up so the creature is somewhere visible
for (let frame = 0; frame < 12; frame += 1) {
  effect.step(state, { energy, totalLevels: 4, width: WIDTH, height: HEIGHT, dt, band, trackY, sky, artBox: { top: 0, height: sky } })
}
// The track is the standard DOM bar now; draw it so the still matches the panel.
if (layout.track !== 'wave') {
  const gradient = context.createLinearGradient(0, 0, WIDTH, 0)
  gradient.addColorStop(0, '#22c55e')
  gradient.addColorStop(0.33, '#22d3ee')
  gradient.addColorStop(0.66, '#a855f7')
  gradient.addColorStop(1, '#e879f9')
  context.save()
  context.globalAlpha = 1
  context.fillStyle = gradient
  context.beginPath()
  context.moveTo(0, trackY - 4)
  context.lineTo(WIDTH, trackY - 4)
  context.lineTo(WIDTH, trackY + 4)
  context.lineTo(0, trackY + 4)
  context.closePath()
  context.fill()
  context.restore()
}

// park the creature mid-canvas so the still shows it
if (typeof state.x === 'number') state.x = WIDTH * 0.45
effect.paint(context, state, {
  energy,
  accent: internals.colorAtFraction(energy),
  width: WIDTH,
  height: HEIGHT,
  band,
  trackY,
  artBox: { top: 0, height: sky },
  sky,
})

const gradientDefs = defs
  .map(
    (gradient) =>
      `<linearGradient id="${gradient.__id}" gradientUnits="userSpaceOnUse" x1="${gradient.x0}" y1="${gradient.y0}" x2="${gradient.x1}" y2="${gradient.y1}">${gradient.stops
        .map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}"/>`)
        .join('')}</linearGradient>`
  )
  .join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>${gradientDefs}</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="#1a1d22"/>
${body.join('\n')}
</svg>`

writeFileSync(outPath, svg)
console.log(`wrote ${outPath} (${svg.length} bytes, ${body.length} draw ops, effect=${effect.id}, energy=${energy})`)
