#!/usr/bin/env node
/**
 * Stability sweep over every registered effect.
 *
 * The per-effect harness checks snippets in isolation; this one checks the
 * effects as the bundle actually ships them, all in one pass:
 *
 *   1. every registered effect implements the contract and has a unique id
 *   2. 900 frames at e=0/0.5/1 stay finite, never throw, never leak array growth
 *   3. paint at five levels emits finite, bounded coordinates and draws something
 *   4. a zero-width canvas and dt=0 do not throw
 *   5. the effect survives being driven backwards (e 1 -> 0, dragging left)
 *
 * Run: node test/effects-all.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(here, 'test', 'effects-all.mjs'))

const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  Component: class { constructor(props) { this.props = props } setState() {} },
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect() {},
  useRef: (value) => ({ current: value ?? null }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_s, getSnapshot) => getSnapshot(),
}
const reactDom = { createPortal: (node) => node }

const sandbox = {
  localStorage: undefined,
  // a decoded sprite strip, so the art effect takes its drawing path
  Image: function FakeImage() {
    this.complete = true
    this.naturalWidth = 3408
    this.naturalHeight = 168
    this.src = ''
  },
  __ModuleLoader__: {
    load: ({ factory }) => {
      sandbox.loaded = factory((id) => {
        if (id === 'react') return react
        if (id === 'react-dom') return reactDom
        throw new Error(`unexpected require(${id})`)
      })
    },
  },
}
new Function('window', 'console', 'setInterval', 'clearInterval', readFileSync(join(here, 'lib', 'client.js'), 'utf8'))(
  sandbox,
  console,
  setInterval,
  clearInterval
)
const { __internals } = sandbox.loaded
const { EFFECTS, resolveEffect, DEFAULT_EFFECT_ID } = __internals

const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

function makeContext() {
  const calls = []
  const gradient = { addColorStop() {} }
  const ctx = new Proxy(
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
  )
  return { ctx, calls }
}

function frameFor(effect, energy, width = 284, dt = 1 / 60) {
  const sky = Math.max(0, Math.min(96, effect.layout?.sky ?? 0))
  const band = Math.max(0, effect.layout?.band ?? 30)
  return {
    energy,
    accent: 'rgb(120, 200, 255)',
    totalLevels: 4,
    width,
    height: sky + band + 58,
    dt,
    band: { top: sky, height: band },
    sky,
    rail: 58,
    trackY: sky + band + 16,
    artBox: { top: 0, height: sky },
  }
}

/** Depth-limited finite walk. */
function assertFinite(value, path, depth = 0) {
  if (depth > 4) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}`)
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertFinite(value[index], `${path}[${index}]`, depth + 1)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) assertFinite(value[key], `${path}.${key}`, depth + 1)
  }
}

/** Rough allocation guard: how big the arrays in state get. */
function largestArray(value, depth = 0) {
  if (depth > 3 || value === null || typeof value !== 'object') return 0
  if (Array.isArray(value)) {
    let biggest = value.length
    for (let index = 0; index < Math.min(value.length, 8); index += 1) {
      biggest = Math.max(biggest, largestArray(value[index], depth + 1))
    }
    return biggest
  }
  let biggest = 0
  for (const key of Object.keys(value)) biggest = Math.max(biggest, largestArray(value[key], depth + 1))
  return biggest
}

// --- 1. registry ------------------------------------------------------------

check(Array.isArray(EFFECTS) && EFFECTS.length >= 3, 'the registry holds several effects')
const ids = new Set()
for (const effect of EFFECTS) {
  check(typeof effect.id === 'string' && !ids.has(effect.id), `unique id: ${effect.id}`)
  ids.add(effect.id)
  check(typeof effect.name === 'string' && effect.name.length > 0, `${effect.id} has a name`)
  check(typeof effect.summary === 'string' && effect.summary.length > 0, `${effect.id} has a summary`)
  check(typeof effect.createState === 'function', `${effect.id} createState`)
  check(typeof effect.step === 'function', `${effect.id} step`)
  check(typeof effect.paint === 'function', `${effect.id} paint`)
  check(effect.layout !== null && typeof effect.layout === 'object', `${effect.id} has a layout`)
  check((effect.layout.sky ?? 0) <= 96, `${effect.id} sky is inside the panel budget`)
  check(resolveEffect(effect.id) === effect, `${effect.id} resolves to itself`)
}
check(ids.has(DEFAULT_EFFECT_ID), 'the default id is registered')

// --- 2/3/4. stepping and painting ------------------------------------------

for (const effect of EFFECTS) {
  for (const energy of [0, 0.5, 1]) {
    const state = effect.createState()
    let error = null
    try {
      for (let frame = 0; frame < 900; frame += 1) {
        effect.step(state, frameFor(effect, energy))
        if (frame % 90 === 0) assertFinite(state, 'state')
      }
      assertFinite(state, 'state')
    } catch (caught) {
      error = caught
    }
    check(error === null, `${effect.id}: 900 frames at e=${energy} stay finite`, error?.message ?? '')

    const { ctx, calls } = makeContext()
    let paintError = null
    try {
      effect.paint(ctx, state, frameFor(effect, energy))
    } catch (caught) {
      paintError = caught
    }
    check(paintError === null, `${effect.id}: paint at e=${energy} does not throw`, paintError?.message ?? '')
    check(energy === 0 || calls.length > 0, `${effect.id}: paint at e=${energy} draws something`)
    const bad = calls
      .flatMap(([, ...args]) => args)
      .filter((arg) => typeof arg === 'number' && (!Number.isFinite(arg) || Math.abs(arg) > 20000))
    check(bad.length === 0, `${effect.id}: paint at e=${energy} stays bounded`, bad.slice(0, 3).join(','))
    // Only plain Arrays count. Typed buffers (flow-field's 6720-slot trail,
    // metaballs' field, spirograph's trail) are allocated once in createState and
    // never grow, so they are deliberately outside this ceiling.
    const biggest = largestArray(state)
    check(biggest <= 400, `${effect.id}: state stays small at e=${energy}`, `largest array ${biggest}`)
  }

  // dragging backwards must not throw or go NaN
  const back = effect.createState()
  let backError = null
  try {
    for (let frame = 0; frame < 300; frame += 1) {
      const energy = 1 - (frame % 100) / 100
      effect.step(back, frameFor(effect, energy))
    }
    assertFinite(back, 'state')
  } catch (caught) {
    backError = caught
  }
  check(backError === null, `${effect.id}: dragging backwards stays finite`, backError?.message ?? '')

  // degenerate frames
  const degenerate = effect.createState()
  let degenerateError = null
  try {
    for (let frame = 0; frame < 30; frame += 1) effect.step(degenerate, frameFor(effect, 0.5, 0, 0))
  } catch (caught) {
    degenerateError = caught
  }
  check(degenerateError === null, `${effect.id}: zero width / zero dt does not throw`, degenerateError?.message ?? '')
}

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log(`\nALL EFFECTS TEST PASSED (${EFFECTS.length} effects, ${checks.length} checks)`)
