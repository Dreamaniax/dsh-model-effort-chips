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

const { nearestIndex, energyFor, wavePoints } = module.__internals
check(nearestIndex(0, 4) === 0, 'drag at the left edge snaps to the first level')
check(nearestIndex(1, 4) === 3, 'drag at the right edge snaps to the last level')
check(nearestIndex(0.51, 4) === 2, 'drag just past half snaps to the third level')
check(nearestIndex(0.5, 1) === 0, 'a single level snaps to itself')
check(nearestIndex(-3, 4) === 0 && nearestIndex(9, 4) === 3, 'out-of-range drag is clamped')
check(energyFor(0, 4) === 0 && energyFor(3, 4) === 1, 'energy runs 0..1 across the levels')
check(energyFor(0, 1) === 1, 'a single level is full energy')

const amplitude = (points) => {
  const ys = points.split(' ').map((pair) => Number(pair.split(',')[1]))
  const mid = 13
  return Math.max(...ys.map((y) => Math.abs(y - mid)))
}
check(amplitude(wavePoints(1)) > amplitude(wavePoints(0)), 'higher energy grows the wave amplitude')
check(wavePoints(0.5).split(' ').length === 51, 'wave samples the full width')

// --- M5: alpha, stroke thickness, compact fallback ---------------------------

const { withAlpha, strokeWidthFor, isCompact } = module.__internals
check(withAlpha('rgb(34, 197, 94)', 0.5) === 'rgba(34, 197, 94, 0.5)', 'withAlpha parses rgb()')
check(withAlpha('#22c55e', 0.25) === 'rgba(34, 197, 94, 0.25)', 'withAlpha parses hex')
check(strokeWidthFor(0) === 1, 'off is the thinnest line')
check(Math.abs(strokeWidthFor(1) - 3.4) < 1e-9, 'max is the thickest line')
check(strokeWidthFor(0.5) > strokeWidthFor(0) && strokeWidthFor(0.5) < strokeWidthFor(1), 'thickness grows with energy')
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

const { particleCountFor, spectrumSpanFor, spectrumSwingFor } = module.__internals
check(Math.abs(magnetize(1 / 3 + 0.09, 4) - 1 / 3) < 0.02, 'the wider magnet catches a drag 9% away')
check(magnetize(0, 4) === 0 && magnetize(1, 4) === 1, 'the ends stay pinned')

const counts = [0, 1 / 3, 2 / 3, 1].map(particleCountFor)
check(counts[0] === 0, 'off has no particles')
check(counts[1] === 2 && counts[2] === 6 && counts[3] === 14, 'particles follow a geometric curve 0,2,6,14')
check(counts[3] - counts[2] > counts[2] - counts[1], 'each level adds more particles than the last')

check(spectrumSpanFor(0) === 30, 'spectrum starts as a third of the band')
check(spectrumSpanFor(1) === 100, 'spectrum reaches the full track length at max')
check(spectrumSpanFor(0.5) > spectrumSpanFor(0) && spectrumSpanFor(0.5) < spectrumSpanFor(1), 'the spectrum widens with the level')
check(spectrumSwingFor(0.5) - spectrumSwingFor(1) > spectrumSwingFor(0) - spectrumSwingFor(0.5), 'the pulse swing accelerates with the level')
check(spectrumSwingFor(1) < spectrumSwingFor(0.5) && spectrumSwingFor(0.5) < spectrumSwingFor(0), 'pulse swing deepens with the level')
check(spectrumSwingFor(1) <= 0.12, 'max level swings almost to nothing')

// --- wave motion synced to the pulse ---------------------------------------

const { waveCalmScaleFor } = module.__internals
check(waveCalmScaleFor(0) === 1, 'off keeps the wave still')
check(waveCalmScaleFor(1) < waveCalmScaleFor(0.5) && waveCalmScaleFor(0.5) < waveCalmScaleFor(0), 'the wave breathes deeper as the level rises')
check(waveCalmScaleFor(1) >= 0.7, 'the calm frame never collapses the wave')

const rippleAt = (dynamic) => {
  const points = wavePoints(1, 300, 26, dynamic).split(' ').map((pair) => Number(pair.split(',')[1]))
  return points
}
const still = rippleAt(0)
const alive = rippleAt(1)
check(still.length === alive.length, 'both frames keep the same sampling')
check(still.some((y, index) => Math.abs(y - alive[index]) > 0.5), 'the dynamic frame actually ripples')
check(wavePoints(1, 300, 26, 1) !== wavePoints(1, 300, 26, 0), 'the two frames differ')

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
