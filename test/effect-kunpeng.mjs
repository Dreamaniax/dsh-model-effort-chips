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
check(effectiveSky(kunpengEffect) === 0, 'the procedural painter stays at the baseline panel')
check(effectiveSky(internals.resolveEffect('kunpeng-art')) === 84, 'the art variant gets an 84px sky band')
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
check(Number.isFinite(fresh.time) && Number.isFinite(fresh.x), 'a fresh state carries finite time/x')
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
      if (!Number.isFinite(state.x) || !Number.isFinite(state.time)) nonFinite = true
      if (!withinCanvas(state.x, 280)) escaped = true
    }
  } catch (error) {
    stepError = error
  }
  check(stepError === null, `${label}: 120 steps do not throw`)
  check(!nonFinite, `${label}: the state never turns NaN/Infinity`)
  check(Number.isFinite(state.time) && state.time > 0, `${label}: time advances`)
  check(!escaped, `${label}: the creature stays near the canvas`)
}

// A long run has to pass the right edge and wrap around more than once.
const longState = kunpengEffect.createState()
let previousX = longState.x
let wraps = 0
let longBad = false
for (let frame = 0; frame < 2000; frame += 1) {
  kunpengEffect.step(longState, stepFrame(1))
  if (!withinCanvas(longState.x, 280)) longBad = true
  if (longState.x < previousX) wraps += 1
  previousX = longState.x
}
check(!longBad, 'a 2000-frame run wraps without leaving the canvas')
check(wraps >= 2, 'the creature re-enters from the left when it swims off')

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
check(Number.isFinite(degenerate.x) && Number.isFinite(degenerate.time), 'a degenerate frame keeps the state finite')

// --- 5. level -> size / lift / wing / ribbon (pure functions only) -----------

const isNonDecreasing = (values) => values.every((value, index) => index === 0 || value >= values[index - 1] - 1e-9)
const samples = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]

const { kunpengScaleFor, kunpengWingFor, kunpengLiftFor, kunpengAngleFor } = internals

const scales = samples.map(kunpengScaleFor)
check(scales.every(Number.isFinite), 'kunpengScaleFor is finite across the range')
check(isNonDecreasing(scales), 'a higher level never shrinks the body')
check(scales[scales.length - 1] > scales[0], 'max is bigger than off')

const lifts = samples.map(kunpengLiftFor)
check(lifts.every(Number.isFinite), 'kunpengLiftFor is finite across the range')
check(isNonDecreasing(lifts), 'a higher level never lowers the creature')
check(lifts[lifts.length - 1] - lifts[0] >= 12, 'max lifts the creature off the bar')

const wings = samples.map(kunpengWingFor)
check(isNonDecreasing(wings), 'a higher level never shrinks the wings')
check(wings[0] < 0.01, 'off has no wings')
check(wings[wings.length - 1] > 0.9, 'max has full wings')

const angles = samples.map(kunpengAngleFor)
check(angles.every(Number.isFinite), 'kunpengAngleFor is finite across the range')

// The track is now the shared horizontal bar (particle-wave form) drawn by the
// DOM, so the effect exposes no ribbon curve any more. What still has to hold is
// that the panel never grows: layout.sky is clamped to zero for every effect.
check(internals.effectiveSky(kunpengEffect) === 0, 'kunpeng cannot grow the panel')
check(kunpengEffect.layout.track === 'bar', 'kunpeng uses the standard bar track')
check(kunpengEffect.layout.spectrum === false, 'kunpeng hides the spectrum')

// --- 5b. art motion: swimming at low levels, wing beats at high ----------

const { kunpengSwimRate, kunpengTravelFor, kunpengBobFor, kunpengTiltFor, kunpengSquashFor } = internals
const motionSamples = [0, 0.25, 0.5, 0.75, 1]
const rates = motionSamples.map(kunpengSwimRate)
const travels = motionSamples.map(kunpengTravelFor)
const bobs = motionSamples.map(kunpengBobFor)
const tilts = motionSamples.map(kunpengTiltFor)
const squashes = motionSamples.map(kunpengSquashFor)

check(rates.every(Number.isFinite) && rates.every((value) => value > 0), 'the creature always moves')
check(rates[rates.length - 1] > rates[0] * 2, 'max moves at least twice as fast as off')
check(isNonDecreasing(rates), 'a higher level never slows the creature down')
check(isNonDecreasing(travels), 'the swim stroke widens with the level')
check(isNonDecreasing(bobs), 'the bob gets stronger with the level')
check(tilts.every((value) => value > 0 && value < 0.1), 'the tilt stays subtle')
check(squashes.every((value) => value > 0 && value < 0.1), 'the wing-beat squash stays subtle')

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

let hostPaint = null
let hostPaintError = null
try {
  hostPaint = paintOnce(1)
} catch (error) {
  hostPaintError = error
}
check(hostPaintError === null, 'paint accepts the host frame shape (no trackY)')
check(hostPaint !== null, 'paint returns after drawing')
const hostCalls = hostPaint.context.calls
check(hostCalls.length > 20, 'paint draws the ribbon and the creature')
const hostNumbers = paintedNumbers(hostPaint.context)
check(hostNumbers.length > 0, 'paint emits numeric coordinates')
check(hostNumbers.every(Number.isFinite), 'every painted coordinate is finite')
const translates = hostCalls.filter(([name]) => name === 'translate')
check(translates.length >= 1, 'the creature is drawn through a translate')
check(
  translates.every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  'every translate is finite'
)
check(
  translates.some(([, x]) => withinCanvas(x, 280)),
  'the creature is painted near the canvas'
)

let explicitTrack = null
let explicitTrackError = null
try {
  explicitTrack = paintOnce(0, { trackY: 24 })
} catch (error) {
  explicitTrackError = error
}
check(explicitTrackError === null, 'paint accepts an explicit trackY')
check(paintedNumbers(explicitTrack.context).every(Number.isFinite), 'a low level paints only finite coordinates')

// --- report -----------------------------------------------------------------

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log('\nKUNPENG EFFECT TEST PASSED')
