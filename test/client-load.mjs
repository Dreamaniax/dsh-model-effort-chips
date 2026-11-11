#!/usr/bin/env node
/**
 * Client-half load + logic test — no DSH required.
 *
 * Emulates the browser module host (`window.__ModuleLoader__.load`), a minimal
 * React (`createElement` + hook shims), react-dom's `createPortal`, the slots
 * service, and a fake per-session model directory. Then asserts:
 *
 *   1. the factory registers under the package id,
 *   2. the seat is taken over with priority -1 and a tool-row fallback exists,
 *   3. the seat reads the directory snapshot and renders both chips,
 *   4. a model with no declared reasoning levels hides the effort chip,
 *   5. mapEffortIndex carries the level across by index and clamps in range.
 *
 * Run: node test/client-load.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

let focus = { value: [] }
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

const level = (id, name) => ({ id, name })
const levels4 = [level('off', 'Off'), level('low', 'Low'), level('high', 'High'), level('max', 'Max')]
const levels5 = [level('off', 'Off'), level('low', 'Low'), level('medium', 'Medium'), level('high', 'High'), level('max', 'Max')]

const models = {
  flash: { id: 'flash', name: 'DeepSeek V4 Flash', reasoning: { defaultEffort: 'low', efforts: levels4 } },
  pro: { id: 'pro', name: 'DeepSeek V4 Pro', reasoning: { defaultEffort: 'medium', efforts: levels5 } },
  plain: { id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash', reasoning: undefined },
}

function makeDirectory(initial) {
  const listeners = new Set()
  let state = initial
  return {
    store: {
      getSnapshot: () => state,
      subscribe: (fn) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    select: async (selection) => {
      state = { ...state, current: selection, pending: null }
      for (const fn of listeners) fn()
    },
    set: (next) => {
      state = next
      for (const fn of listeners) fn()
    },
  }
}

const directories = new Map()
const registrations = []

const ctx = {
  slots: {
    inject(slot, callback) {
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  inject(names, callback) {
    return callback(ctx)
  },
  get(name, fallback) {
    return ctx[name] ?? fallback
  },
  modelDirectories: {
    directoryFor(sessionId) {
      const existing = directories.get(sessionId)
      if (existing !== undefined) return existing
      throw new Error('session binding not ready')
    },
    seed(sessionId, directory) {
      directories.set(sessionId, directory)
    },
  },
}

const sandbox = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      sandbox.loaded = { id, module: factory(fakeRequire) }
    },
  },
}

const origWarn = console.warn
const warnings = []
console.warn = (...args) => warnings.push(args.join(' '))

new Function('window', 'console', source)(sandbox, console)

const { id, module } = sandbox.loaded
const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

check(id === 'dsh-model-effort-chips', 'factory id')
check(typeof module.apply === 'function', 'apply is a function')
check(Array.isArray(module.inject) && module.inject.length === 0, 'no hard service dependency blocks apply')

const renderSeat = (component, props) => {
  const outer = component(props)
  const inner = outer.children.flat(Infinity)[0]
  return inner.type(inner.props)
}

module.apply(ctx)
const seat = registrations.find((entry) => entry.options.name === 'conversation.input.model')
check(seat !== undefined, 'seat occupant registered')
check(seat.options.priority === -1, 'seat priority is -1')
check(
  registrations.some((entry) => entry.options.name === 'conversation.input.right'),
  'tool-row fallback registered'
)

// --- index mapping (the user's rule) ----------------------------------------

const { mapEffortIndex } = module.__internals
check(mapEffortIndex(levels4, 'high', levels5, 'medium') === 'medium', 'high(3rd) stays 3rd on a 5-level model')
check(mapEffortIndex(levels4, 'max', levels4.slice(0, 3), 'low') === 'high', '4th clamps to 3rd when the target has three')
check(mapEffortIndex(levels4, 'off', levels5, 'medium') === 'off', 'first level stays first')
check(mapEffortIndex(levels4, undefined, levels5, 'medium') === 'medium', 'no current level falls back to the target default')
check(mapEffortIndex(levels4, 'high', [], undefined) === undefined, 'model without levels selects no effort')

// --- slider geometry (M3) ---------------------------------------------------

const { colorAt, percentAt } = module.__internals
check(percentAt(0, 4) === 0 && percentAt(3, 4) === 100, 'level 0/3 sit at the track ends')
check(percentAt(0, 1) === 50, 'a single level sits centred')
check(colorAt(0, 4) === 'rgb(34, 197, 94)', 'first level is green')
check(colorAt(3, 4) === 'rgb(232, 121, 249)', 'last level is magenta')
check(colorAt(0, 1) === 'rgb(34, 197, 94)', 'a single level stays green')
check(/^rgb\(/.test(colorAt(1, 4)), 'intermediate levels interpolate')

// --- drag snapping + energy (M4 / M3.5) -------------------------------------

const { nearestIndex, energyFor } = module.__internals
check(nearestIndex(0, 4) === 0, 'drag at the left edge snaps to the first level')
check(nearestIndex(1, 4) === 3, 'drag at the right edge snaps to the last level')
check(nearestIndex(0.51, 4) === 2, 'drag just past half snaps to the third level')
check(nearestIndex(0.5, 1) === 0, 'a single level snaps to itself')
check(nearestIndex(-3, 4) === 0 && nearestIndex(9, 4) === 3, 'out-of-range drag is clamped')
check(energyFor(0, 4) === 0 && energyFor(3, 4) === 1, 'energy runs 0..1 across the levels')
check(energyFor(0, 1) === 1, 'a single level is full energy')

// the waveform is gone; the droplets carry the motion

// --- M5: alpha, stroke thickness, compact fallback ---------------------------

const { withAlpha, isCompact } = module.__internals
check(withAlpha('rgb(34, 197, 94)', 0.5) === 'rgba(34, 197, 94, 0.5)', 'withAlpha parses rgb()')
check(withAlpha('#22c55e', 0.25) === 'rgba(34, 197, 94, 0.25)', 'withAlpha parses hex')
check(isCompact(320) === true, 'a narrow composer goes compact')
check(isCompact(800) === false, 'a wide composer keeps the text')
check(isCompact(null) === false, 'an unmeasured composer is not compact')

// --- magnetism + light-surface accents (user round 4) -----------------------

const { magnetize, shade, accentFor, parseColorToRgb, luminanceOf } = module.__internals
check(Math.abs(magnetize(0.334, 4) - 1 / 3) < 1e-3, 'a drag right on a level sticks to it')
check(Math.abs(magnetize(0.36, 4) - 0.36) > 0.01, 'inside the magnet range the knob is pulled')
check(magnetize(0.5, 4) === 0.5, 'outside the magnet range the knob follows the pointer exactly')
check(magnetize(0.999, 4) > 0.99, 'the magnet never overshoots the last level')
check(magnetize(0.5, 1) === 0.5, 'a single level does not magnetize')
check(shade('rgb(34, 197, 94)', -0.5) === 'rgb(17, 99, 47)', 'shade darkens toward black')
check(shade('rgb(34, 197, 94)', 0.5) === 'rgb(145, 226, 175)', 'shade lightens toward white')
check(parseColorToRgb('rgba(10, 20, 30, 0.5)')[2] === 30, 'parseColorToRgb reads rgba')
check(Math.abs(luminanceOf([255, 255, 255]) - 1) < 1e-9 && Math.abs(luminanceOf([0, 0, 0])) < 1e-9, 'luminance spans 0..1')
const darkAccent = accentFor(2, 4, false)
const lightAccent = accentFor(2, 4, true)
check(luminanceOf(parseColorToRgb(lightAccent)) < luminanceOf(parseColorToRgb(darkAccent)), 'light surface gets a darker accent')
check(accentFor(0, 4, false) === colorAt(0, 4), 'dark surface keeps the palette colour')

// --- wider magnet + exponential particle/spectrum curves --------------------

const { particleCountFor, spectrumBarHeightFor, dropletRadiusFor, dropletGravityFor, dropletSpeedFor, dropletRestitutionFor } = module.__internals
check(Math.abs(magnetize(1 / 3 + 0.09, 4) - 1 / 3) < 0.02, 'the wider magnet catches a drag 9% away')
check(magnetize(0, 4) === 0 && magnetize(1, 4) === 1, 'the ends stay pinned')

const counts = [0, 1 / 3, 2 / 3, 1].map((energy) => particleCountFor(energy, 4))
check(counts[0] === 0, 'off has no balls')
check(counts[1] === 6, 'the second level already shows six balls')
check(counts[1] < counts[2], 'the pit grows from low to high')
check(counts[2] === counts[3], 'max matches the high level density')
check(counts[2] === 14 && counts[3] === 14, 'the pit is capped at the old high value')
check(particleCountFor(1, 5) > 0, 'five-level models get a pit too')
check(particleCountFor(0, 1) === 0, 'a single level has no pit')

check(spectrumBarHeightFor(3, 1, 1) > spectrumBarHeightFor(3, 1, -1), 'bars grow on the shared breathing')
check(spectrumBarHeightFor(3, 1, 0) > spectrumBarHeightFor(3, 0.3, 0), 'bars are taller at a higher level')
check(spectrumBarHeightFor(3, 1, 1) > spectrumBarHeightFor(3, 0.3, 1), 'the same phase keeps the level ordering')

// --- ball pit physics -------------------------------------------------------

check(dropletGravityFor(1) > dropletGravityFor(0.4), 'gravity grows with the level')
check(dropletSpeedFor(1) > dropletSpeedFor(0.4), 'launch speed grows with the level')
check(dropletRadiusFor(0) === dropletRadiusFor(1), 'the ball size is constant across levels')
check(dropletRadiusFor(0) === dropletRadiusFor(0.33), 'the size is pinned at the low level value')
check(dropletRestitutionFor(0) > 0.5 && dropletRestitutionFor(1) < 1, 'bounciness rises but never exceeds a bounce')
check(dropletRestitutionFor(1) > dropletRestitutionFor(0), 'the drum bounces harder at high levels')

// --- effect registry (the extension point) ----------------------------------

const { EFFECTS, DEFAULT_EFFECT_ID, resolveEffect, particleWaveEffect } = module.__internals
check(Array.isArray(EFFECTS) && EFFECTS.length >= 1, 'at least one effect is registered')
check(DEFAULT_EFFECT_ID === 'kunpeng', 'the default effect is the kunpeng one')
check(EFFECTS.length === 36, 'thirty-six effects are registered (5 physics + 5 particle + 1 core + 3 feedback + 3 texture + 3 data + 4 life + 3 morph + 3 light + 2 geometry + 3 wave + 1 character)')
check(resolveEffect('kunpeng').name === '鲲鹏动效', 'the kunpeng effect is named 鲲鹏动效')
check(resolveEffect('kunpeng').layout.track === 'bar', 'every effect uses the standard bar track')
check(resolveEffect('kunpeng').layout.track === 'bar', 'kunpeng keeps the bar track')
check(resolveEffect('kunpeng').layout.sky === 84, 'kunpeng asks for its 84px sky band')
check(resolveEffect(DEFAULT_EFFECT_ID) === EFFECTS[0], 'the default resolves to the first effect')
check(resolveEffect('does-not-exist') === EFFECTS[0], 'an unknown id falls back to the first effect')
check(EFFECTS[0].name === '鲲鹏动效', 'the default effect is the kunpeng one')
check(typeof EFFECTS[0].step === 'function' && typeof EFFECTS[0].paint === 'function', 'an effect exposes step and paint')

const { nextEffectId, readStoredEffectId, writeStoredEffectId, EFFECT_STORAGE_KEY } = module.__internals
check(nextEffectId(EFFECTS[EFFECTS.length - 1].id) === EFFECTS[0].id, 'the cycle wraps back to the first effect')
check(nextEffectId('does-not-exist') === EFFECTS[0].id, 'an unknown id cycles from the start')
for (const effect of EFFECTS) {
  check(resolveEffect(effect.id) === effect, `resolveEffect finds ${effect.id}`)
  check(effect.name.length > 0 && effect.summary.length > 0, `${effect.id} has a name and a summary`)
  check(typeof effect.createState === 'function' && typeof effect.step === 'function' && typeof effect.paint === 'function', `${effect.id} implements the contract`)
}
check(EFFECT_STORAGE_KEY === 'dsh-model-effort-chips:effect', 'the storage key is stable')
check(readStoredEffectId() === null, 'no storage in node means no saved effect')
check(writeStoredEffectId('particle-wave') === undefined, 'writing without storage does not throw')

const pit = particleWaveEffect.createState()
check(Array.isArray(pit.balls) && pit.balls.length === 0, 'a fresh effect state starts empty')
for (let frame = 0; frame < 120; frame += 1) {
  particleWaveEffect.step(pit, { energy: 1, totalLevels: 4, width: 280, height: 30, dt: 0.016 })
}
check(pit.balls.length === particleCountFor(1, 4), 'stepping fills the pit to the level density')
const inside = pit.balls.every((ball) => ball.x >= 0 && ball.x <= 280 && ball.y >= 0 && ball.y <= 30)
check(inside, 'balls stay inside the band')

// --- wheel stepping (M6) ----------------------------------------------------

const { stepLevelIndex, WHEEL_THROTTLE_MS } = module.__internals
check(stepLevelIndex(1, 1, 4) === 2, 'a notch down steps up one level')
check(stepLevelIndex(1, -1, 4) === 0, 'a notch up steps down one level')
check(stepLevelIndex(0, -1, 4) === 0, 'the wheel cannot go below off')
check(stepLevelIndex(3, 1, 4) === 3, 'the wheel cannot go past max')
check(stepLevelIndex(-1, 1, 4) === 0, 'an unset level starts at the first stop')
check(stepLevelIndex(0, 1, 0) === 0, 'no levels means no movement')
check(WHEEL_THROTTLE_MS === 120, 'the wheel throttle stays at 120ms')

// --- rendering --------------------------------------------------------------

const flatten = (children) => children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
// Directory not ready yet: the seat must still render (loading state).
const cold = flatten(renderSeat(seat.component, { sessionId: 's-cold' }).children)
check(cold.length >= 1, 'seat renders while the directory is unresolved')

// Ready session with flash/high.
const directory = makeDirectory({
  current: { provider: 'deepseek-account', model: 'flash', reasoningEffort: 'high' },
  groups: [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [models.flash, models.pro, models.plain] }],
  status: 'ready',
  pending: null,
  error: null,
})
ctx.modelDirectories.seed('s1', directory)

const tree = renderSeat(seat.component, { sessionId: 's1' })
const chips = flatten(tree.children)
check(chips.length === 2, 'two chips rendered')
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}
check(textOf(chips[0]).includes('DeepSeek V4 Flash'), 'model chip shows the catalog name')
check(textOf(chips[1]).includes('High'), 'effort chip shows the level name')
check(textOf(chips[0]).includes('\u2304'), 'model chip carries the chevron affordance')
check(textOf(chips[1]).includes('\u2304'), 'effort chip carries the chevron affordance')

// A model without reasoning metadata hides the effort chip.
const plainDirectory = makeDirectory({
  current: { provider: 'deepseek-account', model: 'agnes-3.0-flash' },
  groups: [{ id: 'deepseek-account', name: 'DeepSeek Account', models: [models.plain] }],
  status: 'ready',
  pending: null,
  error: null,
})
ctx.modelDirectories.seed('s2', plainDirectory)
const plainTree = flatten(renderSeat(seat.component, { sessionId: 's2' }).children)
check(plainTree.length === 1, 'model without levels hides the effort chip')

// Writing a level goes through directory.select with the full selection.
await directory.select({ provider: 'deepseek-account', model: 'flash', reasoningEffort: 'max' })
check(directory.store.getSnapshot().current.reasoningEffort === 'max', 'directory.select writes the effort')

console.warn = origWarn

for (const entry of checks) console.log(`  ok  ${entry.label}`)
if (warnings.length > 0) console.log(`  (warnings: ${warnings.length})`)
console.log('\nCLIENT LOAD TEST PASSED')
