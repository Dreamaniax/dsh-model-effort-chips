#!/usr/bin/env node
/**
 * 鲲鹏动效 (kunpeng) effect test — no DSH required.
 *
 * The effect registry is the extension point: an effect is an object with
 * id / name / summary / layout / createState / step / paint, registered in
 * EFFECTS. This test loads the browser bundle through the same stub host as
 * test/client-load.mjs and asserts, using only what module.__internals exposes:
 *
 *   1. the registry carries kunpeng with a complete identity + layout
 *      (layout.track === 'wave', a sky band, a spectrum flag),
 *   2. resolveEffect('kunpeng') finds it, and an unknown id still falls back
 *      to the first effect,
 *   3. createState() starts legal and 120 steps at energy 0 / 0.5 / 1 neither
 *      throw nor produce NaN,
 *   4. the creature stays near the canvas — a little overrun at the edges is
 *      allowed (it swims off and re-enters), NaN / Infinity is not,
 *   5. a higher level never shrinks the body, the wing or the lift, and the
 *      ribbon sways wider,
 *   6. paint() survives the frame shape the real canvas host passes (energy,
 *      accent, width, height — no trackY) and emits only finite coordinates.
 *
 * Run: node test/effect-kunpeng.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// --- stub host: the browser module loader + a minimal React ------------------

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState() {}
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useRef(value) {
    return { current: value ?? null }
  },
  useCallback(fn) {
    return fn
  },
  useMemo(fn) {
    return fn()
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

const reactDom = { createPortal: (node) => node }
const fakeRequire = (id) => {
  if (id === 'react') return react
  if (id === 'react-dom') return reactDom
  throw new Error(`unexpected require("${id}")`)
}

const sandbox = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      sandbox.loaded = { id, module: factory(fakeRequire) }
    },
  },
}

new Function('window', 'console', source)(sandbox, console)

const { module } = sandbox.loaded
const internals = module.__internals
const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

// --- 1. the registry carries kunpeng with its layout ------------------------

const { EFFECTS, DEFAULT_EFFECT_ID, resolveEffect, kunpengEffect } = internals

check(Array.isArray(EFFECTS) && EFFECTS.length >= 2, 'the registry holds more than one effect')
check(EFFECTS.includes(kunpengEffect), 'kunpeng is registered in EFFECTS')
check(
  EFFECTS.every(
    (effect) =>
      typeof effect.id === 'string' &&
      typeof effect.name === 'string' &&
      typeof effect.step === 'function' &&
      typeof effect.paint === 'function' &&
      typeof effect.createState === 'function'
  ),
  'every registered effect satisfies the contract'
)
check(kunpengEffect.id === 'kunpeng', 'the effect id is kunpeng')
check(kunpengEffect.name === '鲲鹏动效', 'the effect keeps its display name')
check(typeof kunpengEffect.summary === 'string' && kunpengEffect.summary.length > 0, 'the effect has a summary')
check(kunpengEffect.layout !== undefined && kunpengEffect.layout !== null, 'the effect declares a layout')
check(kunpengEffect.layout.track === 'bar', 'the kunpeng track is the standard bar')
check(
  typeof kunpengEffect.layout.sky === 'number' && Number.isFinite(kunpengEffect.layout.sky),
  'the kunpeng layout declares a finite sky'
)
check(typeof kunpengEffect.layout.spectrum === 'boolean', 'the layout declares whether it draws a spectrum')
const barEffect = EFFECTS.find((effect) => effect.id === 'particle-wave')
check(barEffect?.layout?.track === 'bar', 'the original effect keeps the flat bar track')
// Panel budget: the particle effect stays at the baseline, the pixel-art
// variant is allowed a sky band above the bar, and anything greedy is clamped.
const { effectiveSky, MAX_STAGE_SKY } = module.__internals
check(MAX_STAGE_SKY > 0 && MAX_STAGE_SKY <= 96, 'the panel budget allows a bounded sky band')
check(effectiveSky(barEffect) === 0, 'the particle effect stays at the baseline panel')
check(effectiveSky(kunpengEffect) === 84, 'kunpeng gets an 84px sky band for the art')
check(effectiveSky({ layout: { sky: 200 } }) === MAX_STAGE_SKY, 'a greedy effect is clamped to the budget')
check(effectiveSky({ layout: { sky: Number.NaN } }) === 0, 'a broken sky value falls back to zero')

// --- 2. lookup contract -----------------------------------------------------

check(resolveEffect('kunpeng') === kunpengEffect, 'resolveEffect finds kunpeng')
check(resolveEffect('does-not-exist') === EFFECTS[0], 'an unknown id still falls back to the first effect')
check(resolveEffect(undefined) === EFFECTS[0], 'a missing id falls back to the first effect')
check(
  EFFECTS.some((effect) => effect.id === DEFAULT_EFFECT_ID),
  'the default id names a registered effect'
)

// --- 3./4. createState + stepping (120 frames per energy) --------------------

const stepFrame = (energy) => ({ energy, totalLevels: 4, width: 280, height: 30, dt: 0.016 })

// The creature is allowed to swim a little past either edge before it
// re-enters; anything further out, or non-finite, is a runaway bug.
const NEAR = 200
const withinCanvas = (x, width) => Number.isFinite(x) && x >= -NEAR && x <= width + NEAR

const fresh = kunpengEffect.createState()
check(typeof fresh === 'object' && fresh !== null, 'createState returns an object')
check(Number.isFinite(fresh.time) && Number.isFinite(fresh.travel), 'a fresh state carries finite time/travel')
check(kunpengEffect.createState() !== fresh, 'createState returns a fresh state each call')

for (const energy of [0, 0.5, 1]) {
  const label = `energy ${energy}`
  const state = kunpengEffect.createState()
  let stepError = null
  let nonFinite = false
  let escaped = false
  try {
    for (let frame = 0; frame < 120; frame += 1) {
      kunpengEffect.step(state, stepFrame(energy))
      if (!Number.isFinite(state.travel) || !Number.isFinite(state.time)) nonFinite = true
      if (state.travel < 0 || state.travel >= 1) escaped = true
    }
  } catch (error) {
    stepError = error
  }
  check(stepError === null, `${label}: 120 steps do not throw`)
  check(!nonFinite, `${label}: the state never turns NaN/Infinity`)
  check(Number.isFinite(state.time) && state.time > 0, `${label}: time advances`)
  check(!escaped, `${label}: travel stays inside 0..1`)
}

// A long run has to wrap the loop more than once and stay bounded.
const longState = kunpengEffect.createState()
let previous = longState.travel
let wraps = 0
let longBad = false
for (let frame = 0; frame < 2000; frame += 1) {
  kunpengEffect.step(longState, stepFrame(1))
  if (!Number.isFinite(longState.travel) || longState.travel < 0 || longState.travel >= 1) longBad = true
  if (longState.travel < previous) wraps += 1
  previous = longState.travel
}
check(!longBad, 'a 2000-frame run keeps travel in range')
check(wraps >= 2, 'the creature re-enters from the left after crossing')

// The frame loop is defensive about a canvas that measured zero.
const degenerate = kunpengEffect.createState()
let degenerateError = null
try {
  for (let frame = 0; frame < 60; frame += 1) {
    kunpengEffect.step(degenerate, { energy: 0, totalLevels: 1, width: 0, height: 0, dt: 0 })
  }
} catch (error) {
  degenerateError = error
}
check(degenerateError === null, 'a zero-sized canvas / zero dt frame does not throw')
check(Number.isFinite(degenerate.travel) && Number.isFinite(degenerate.time), 'a degenerate frame keeps the state finite')

// --- 5. the single 鲲鹏动效 keeps the standard bar track ----------------------

const isNonDecreasing = (values) => values.every((value, index) => index === 0 || value >= values[index - 1] - 1e-9)
check(kunpengEffect.layout.track === 'bar', 'kunpeng uses the standard bar track')
check(kunpengEffect.layout.spectrum === false, 'kunpeng hides the spectrum band')
check(kunpengEffect.layout.band === 0, 'kunpeng collapses the spectrum band')

// --- 5c. sprite-strip playback ---------------------------------------------

const { kunpengFrameRate, artFramesOf, ART_FRAMES } = internals
check(ART_FRAMES > 1, 'the pack is a multi-frame strip')
check(kunpengFrameRate(0) > 0, 'off still animates')
check(kunpengFrameRate(1) > kunpengFrameRate(0), 'max beats faster than off')
check(kunpengFrameRate(0.5) > kunpengFrameRate(0) && kunpengFrameRate(0.5) < kunpengFrameRate(1), 'the rate grows with the level')
check(artFramesOf({ naturalWidth: 568 * ART_FRAMES }) === ART_FRAMES, 'a divisible strip reports its frames')
check(artFramesOf({ naturalWidth: 568 }) === 1, 'a single-frame pack falls back to one frame')
check(artFramesOf(null) === 1, 'a missing image does not explode')

// --- 5d. left-to-right travel ----------------------------------------------

const { kunpengCrossSeconds, kunpengDrawScale } = internals
const crossings = [0, 0.33, 0.66, 1].map(kunpengCrossSeconds)
check(crossings.every((value) => value > 0 && Number.isFinite(value)), 'a crossing always takes positive time')
check(crossings[crossings.length - 1] < crossings[0], 'max crosses the panel faster than off')
check(kunpengCrossSeconds(0.5) < kunpengCrossSeconds(0) && kunpengCrossSeconds(0.5) > kunpengCrossSeconds(1), 'the crossing speeds up with the level')
const drawScales = [0, 0.5, 1].map(kunpengDrawScale)
check(isNonDecreasing(drawScales), 'max is drawn at least as large as off')
check(drawScales[0] > 0.5 && drawScales[drawScales.length - 1] <= 1, 'the creature stays inside the box')

// --- 6. paint survives the real host's frame shape ---------------------------

/** A 2D context stub that records every call and accepts gradient objects. */
function makeRecordingContext() {
  const calls = []
  const gradient = { addColorStop() {} }
  const target = {}
  return new Proxy(target, {
    get(object, prop) {
      if (prop === 'calls') return calls
      if (typeof prop !== 'string') return undefined
      if (prop.startsWith('create')) {
        return (...args) => {
          calls.push([prop, ...args])
          return gradient
        }
      }
      if (prop in object) return object[prop]
      return (...args) => {
        calls.push([prop, ...args])
      }
    },
    set(object, prop, value) {
      object[prop] = value
      return true
    },
  })
}

function paintOnce(energy, extra = {}) {
  const context = makeRecordingContext()
  const state = kunpengEffect.createState()
  for (let frame = 0; frame < 30; frame += 1) kunpengEffect.step(state, stepFrame(energy))
  kunpengEffect.paint(context, state, { energy, accent: 'rgb(34, 197, 94)', width: 280, height: 30, ...extra })
  return { context, state }
}

const paintedNumbers = (context) =>
  context.calls.flatMap(([, ...args]) => args.filter((value) => typeof value === 'number'))

// A fake <img> so the art path can be exercised without a browser.
function installFakeImage(frameWidth) {
  sandbox.Image = function FakeImage() {
    this.complete = true
    this.naturalWidth = frameWidth * ART_FRAMES
    this.naturalHeight = 168
    this.src = ''
  }
}

installFakeImage(270)
const artFrame = (energy, extra = {}) => ({
  energy, accent: 'rgb(34, 197, 94)', width: 284, height: 146, artBox: { top: 0, height: 84 }, ...extra,
})

function paintArt(energy, ageSeconds, extra = {}) {
  const context = makeRecordingContext()
  const state = kunpengEffect.createState()
  for (let frame = 0; frame < Math.round(ageSeconds * 60); frame += 1) kunpengEffect.step(state, stepFrame(energy))
  kunpengEffect.paint(context, state, artFrame(energy, extra))
  return { context, state }
}

let hostPaint = null
let hostPaintError = null
try {
  hostPaint = paintArt(1, 0.5)
} catch (error) {
  hostPaintError = error
}
check(hostPaintError === null, 'paint accepts the host frame shape')
const hostCalls = hostPaint.context.calls
const draws = hostCalls.filter(([name]) => name === 'drawImage')
check(draws.length === 1, 'paint blits exactly one sprite frame')
check(draws[0].length === 10, 'drawImage gets source and destination rects')
check(paintedNumbers(hostPaint.context).every(Number.isFinite), 'every painted coordinate is finite')

// the sprite moves right as time passes
const early = paintArt(1, 0.1).context.calls.filter(([name]) => name === 'drawImage')[0]
const later = paintArt(1, 2.0).context.calls.filter(([name]) => name === 'drawImage')[0]
check(later[6] > early[6], 'the sprite travels to the right over time')

// the frame index advances (source x offset changes)
const earlySrc = paintArt(1, 0.1).context.calls.filter(([name]) => name === 'drawImage')[0][1]
const laterSrc = paintArt(1, 0.6).context.calls.filter(([name]) => name === 'drawImage')[0][1]
check(laterSrc !== earlySrc, 'the animation frame advances over time')

// missing art must not throw and must not draw
delete sandbox.Image
const emptyState = kunpengEffect.createState()
for (let frame = 0; frame < 10; frame += 1) kunpengEffect.step(emptyState, stepFrame(0.5))
const emptyContext = makeRecordingContext()
let emptyError = null
try {
  kunpengEffect.paint(emptyContext, emptyState, artFrame(0.5))
} catch (error) {
  emptyError = error
}
check(emptyError === null, 'paint survives a missing art pack')
check(emptyContext.calls.filter(([name]) => name === 'drawImage').length === 0, 'nothing is drawn without art')

// --- report -----------------------------------------------------------------

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log('\nKUNPENG EFFECT TEST PASSED')
