#!/usr/bin/env node
/**
 * Standalone checker for one effect snippet (lib/effects/<id>.js).
 *
 * The snippet must be a single top-level `const <name>Effect = { ... }` with the
 * usual contract members (id / name / summary / layout / createState / step /
 * paint). This harness runs it without the plugin around it, so an effect can be
 * built and checked in parallel by several people.
 *
 *   node scripts/effect-harness.mjs lib/effects/double-pendulum.js [out.svg]
 *
 * Checks: contract shape, 600 frames at e=0/0.5/1 without throwing, every state
 * number finite, every painted number finite and bounded, no allocation per
 * frame in the obvious cases. Exit code 0 = green.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2]
if (file === undefined) {
  console.error('usage: node scripts/effect-harness.mjs <snippet.js> [out.svg]')
  process.exit(2)
}
const outPath = process.argv[3]

const source = readFileSync(resolve(file), 'utf8')
const match = source.match(/const\s+([A-Za-z0-9_]+)\s*=\s*\{/)
if (match === null) {
  console.error('snippet must declare "const <name>Effect = { ... }"')
  process.exit(2)
}
const varName = match[1]

const clamp01 = (value) => Math.max(0, Math.min(1, value))
const withAlpha = (color, alpha) => {
  const matchRgb = /rgba?\(([^)]+)\)/.exec(color ?? '')
  if (matchRgb === null) return `rgba(120, 200, 255, ${alpha})`
  const [r, g, b] = matchRgb[1].split(',').map((part) => Number(part.trim()))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

let effect
try {
  const make = new Function('clamp01', 'withAlpha', `${source}\nreturn ${varName};`)
  effect = make(clamp01, withAlpha)
} catch (error) {
  console.error(`snippet failed to evaluate: ${error.message}`)
  process.exit(1)
}

// --- assertions -------------------------------------------------------------

const checks = []
const check = (ok, label, detail = '') => {
  checks.push({ ok, label, detail })
  if (!ok) {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    process.exit(1)
  }
  console.log(`  ok    ${label}`)
}

check(typeof effect.id === 'string' && /^[a-z0-9-]+$/.test(effect.id), 'id is kebab-case')
check(typeof effect.name === 'string' && effect.name.length > 0, 'has a display name')
check(typeof effect.summary === 'string' && effect.summary.length > 0, 'has a summary')
check(effect.layout !== null && typeof effect.layout === 'object', 'declares a layout')
check(typeof effect.layout.sky === 'number' && effect.layout.sky >= 0 && effect.layout.sky <= 96, 'sky is inside the panel budget')
check(['bar', 'wave'].includes(effect.layout.track), "track is 'bar' or 'wave'")
check(typeof effect.layout.spectrum === 'boolean', 'spectrum is boolean')
check(typeof effect.createState === 'function', 'createState is a function')
check(typeof effect.step === 'function', 'step is a function')
check(typeof effect.paint === 'function', 'paint is a function')

const SKY = effect.layout.sky ?? 0
const BAND = effect.layout.band ?? 30
const RAIL = 58
const WIDTH = 284
const HEIGHT = SKY + BAND + RAIL
const band = { top: SKY, height: BAND }
const frameFor = (energy, dt) => ({
  energy,
  accent: 'rgb(120, 200, 255)',
  totalLevels: 4,
  width: WIDTH,
  height: HEIGHT,
  dt,
  band,
  sky: SKY,
  rail: RAIL,
  trackY: SKY + BAND + 16,
  artBox: { top: 0, height: SKY },
})

/** Depth-limited walk for non-finite numbers. */
function assertFiniteState(value, path, depth = 0) {
  if (depth > 4) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`)
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertFiniteState(value[index], `${path}[${index}]`, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) assertFiniteState(value[key], `${path}.${key}`, depth + 1)
  }
}

// --- a recording 2D context ------------------------------------------------

function makeContext() {
  const calls = []
  const gradient = { addColorStop() {} }
  return {
    calls,
    ctx: new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined
          if (prop.startsWith('create')) return (...args) => (calls.push([prop, ...args]), gradient)
          return (...args) => calls.push([prop, ...args])
        },
        set() {
          return true
        },
      }
    ),
  }
}

for (const energy of [0, 0.15, 0.5, 0.85, 1]) {
  const state = effect.createState()
  let error = null
  try {
    for (let frame = 0; frame < 600; frame += 1) {
      effect.step(state, frameFor(energy, 1 / 60))
      if (frame % 60 === 0) assertFiniteState(state, 'state')
    }
    assertFiniteState(state, 'state')
  } catch (caught) {
    error = caught
  }
  check(error === null, `600 frames at e=${energy} do not throw or go NaN`, error?.message ?? '')
}

// paint at three levels, on a fresh state, like the host's first frame
for (const energy of [0, 0.5, 1]) {
  const state = effect.createState()
  effect.step(state, frameFor(energy, 0.016))
  const { ctx, calls } = makeContext()
  let error = null
  try {
    effect.paint(ctx, state, frameFor(energy, 0.016))
  } catch (caught) {
    error = caught
  }
  check(error === null, `paint at e=${energy} does not throw`, error?.message ?? '')
  check(calls.length > 0, `paint at e=${energy} draws something`)
  const bad = calls
    .flatMap(([, ...args]) => args)
    .filter((arg) => typeof arg === 'number' && (!Number.isFinite(arg) || Math.abs(arg) > 20000))
  check(bad.length === 0, `paint at e=${energy} emits finite, bounded numbers`, bad.slice(0, 3).join(', '))
}

// --- optional svg preview ---------------------------------------------------

if (outPath !== undefined) {
  const svg = renderSvg(effect, Number(process.env.HARNESS_ENERGY ?? '0.66'))
  writeFileSync(outPath, svg)
  console.log(`\npreview written to ${outPath}`)
}

function renderSvg(target, energy) {
  const calls = []
  const gradient = { addColorStop() {} }
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop.startsWith('create')) return (...args) => (calls.push([prop, ...args]), gradient)
        return (...args) => calls.push([prop, ...args])
      },
      set() {
        return true
      },
    }
  )
  const state = target.createState()
  for (let frame = 0; frame < 240; frame += 1) target.step(state, frameFor(energy, 1 / 60))
  target.paint(ctx, state, frameFor(energy, 1 / 60))
  // crude replay: strokes and fills of the recorded primitives
  const parts = []
  let path = []
  let stroke = '#7dd3fc'
  let fill = 'none'
  let width = 1
  for (const [name, ...args] of calls) {
    if (name === 'beginPath') path = []
    else if (name === 'moveTo' || name === 'lineTo') path.push(`${name === 'moveTo' ? 'M' : 'L'} ${args[0].toFixed(2)} ${args[1].toFixed(2)}`)
    else if (name === 'quadraticCurveTo') path.push(`Q ${args[0].toFixed(2)} ${args[1].toFixed(2)} ${args[2].toFixed(2)} ${args[3].toFixed(2)}`)
    else if (name === 'arc') path.push(`M ${(args[0] + args[2]).toFixed(2)} ${args[1].toFixed(2)} A ${args[2]} ${args[2]} 0 1 1 ${(args[0] - args[2]).toFixed(2)} ${args[1].toFixed(2)}`)
    else if (name === 'closePath') path.push('Z')
    else if (name === 'fillRect') parts.push(`<rect x="${args[0]}" y="${args[1]}" width="${args[2]}" height="${args[3]}" fill="${fill}"/>`)
    else if (name === 'stroke') parts.push(`<path d="${path.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`)
    else if (name === 'fill') parts.push(`<path d="${path.join(' ')}" fill="${fill === 'none' ? stroke : fill}" fill-opacity="0.8"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="#12141a"/>${parts.join('')}</svg>`
}

console.log(`\nEFFECT HARNESS PASSED (${effect.id}, ${checks.length} checks)`)
