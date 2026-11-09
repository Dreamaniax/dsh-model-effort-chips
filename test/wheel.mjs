#!/usr/bin/env node
/**
 * Wheel behaviour test in a real DOM (jsdom + React 18).
 *
 * The stub harness cannot exercise wheel events, and the reported bug was a
 * wheel that "sticks on a level after a few switches". This test mounts the
 * seat, fires real WheelEvents and asserts:
 *
 *   1. slow notches walk one level at a time and clamp at the ends
 *   2. a fast flick is not swallowed (the trailing step lands)
 *   3. a select that never settles does NOT lock the chip
 *   4. a select that throws does NOT lock the chip
 *
 * Run: node test/wheel.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(here, 'test', 'wheel.mjs'))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom

globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.WheelEvent = window.WheelEvent
globalThis.Event = window.Event
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver =
  window.ResizeObserver ??
  class {
    observe() {}
    disconnect() {}
  }
window.ResizeObserver = globalThis.ResizeObserver
// jsdom has no 2D context; the effect canvas already guards null.
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  return null
}

const React = nodeRequire('react')
const { createRoot } = nodeRequire('react-dom/client')
const act = React.act
const ReactDOM = nodeRequire('react-dom')

const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const levels = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]

/** A directory whose select() can be made slow, broken or never-settling. */
function makeDirectory(mode = 'fast') {
  let state = {
    current: { provider: 'p', model: 'm', reasoningEffort: levels[0].id },
    groups: [
      {
        id: 'p',
        name: 'Provider',
        models: [{ id: 'm', name: 'Model', reasoning: { defaultEffort: levels[0].id, efforts: levels } }],
      },
    ],
    status: 'ready',
    pending: null,
    error: null,
  }
  const listeners = new Set()
  const calls = []
  const publish = (next) => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const store = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const select = async (selection) => {
    calls.push(selection)
    publish({ ...state, status: 'selecting', pending: selection, error: null })
    if (mode === 'never') return new Promise(() => {})
    if (mode === 'throw') {
      publish({ ...state, status: 'error', pending: null, error: 'boom' })
      throw new Error('boom')
    }
    await sleep(4)
    publish({ ...state, current: { ...selection }, status: 'ready', pending: null })
  }
  return { store, select, calls, get state() { return state } }
}

function mountSeat(directory) {
  const registrations = []
  const ctx = {
    get: (name, fallback) => (name === 'modelDirectories' ? { directoryFor: () => directory } : fallback),
    inject: (_names, callback) => callback(ctx),
    slots: {
      inject: (_slot, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  const sandbox = {
    __ModuleLoader__: {
      load: ({ factory }) =>
        factory((name) => {
          if (name === 'react') return React
          if (name === 'react-dom') return ReactDOM
          throw new Error(`unexpected require(${name})`)
        }),
    },
  }
  new Function('window', 'console', 'setInterval', 'clearInterval', source)(sandbox, console, setInterval, clearInterval)
  sandbox.loadedModule = sandbox.__ModuleLoader__.last
  return { ctx, registrations }
}

const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

const realWarn = console.warn
const realError = console.error

/** Load the bundle, mount the seat, return the effort chip. */
async function setup(mode) {
  // The failure scenarios log the rejected select on purpose; keep the output clean.
  console.warn = mode === 'throw' ? () => {} : realWarn
  console.error = mode === 'throw' ? () => {} : realError
  const directory = makeDirectory(mode)
  const registrations = []

  let captured = null
  const sandbox = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        captured = factory((name) => {
          if (name === 'react') return React
          if (name === 'react-dom') return ReactDOM
          throw new Error(`unexpected require(${name})`)
        })
      },
    },
  }
  const ctx = {
    get: (name, fallback) => (name === 'modelDirectories' ? { directoryFor: () => directory } : fallback),
    inject: (_names, callback) => callback(ctx),
    slots: {
      inject: (_slot, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  new Function('window', 'console', 'setInterval', 'clearInterval', source)(sandbox, console, setInterval, clearInterval)
  captured.apply(ctx)

  const seat = registrations.find((entry) => entry.options.name === 'conversation.input.model')
  if (seat === undefined) throw new Error('seat not registered')

  const host = window.document.createElement('div')
  window.document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(seat.component, { sessionId: 's1' }))
  })
  const chip = window.document.querySelector('[data-dsh-mec="effort"]')
  if (chip === null) throw new Error('effort chip not rendered')
  return { directory, chip, root }
}

const wheel = (element, deltaY) => {
  const event = new window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

// --- 1. slow notches walk one level at a time and clamp ---------------------
{
  const { directory, chip, root } = await setup('fast')
  for (let step = 0; step < 5; step += 1) {
    await act(async () => {
      wheel(chip, -120)
      await sleep(140)
    })
  }
  check(directory.calls.length >= 3, 'five notches produced at least three selections')
  check(directory.state.current.reasoningEffort === levels[3].id, 'the wheel walked up to max and clamped')

  await act(async () => {
    wheel(chip, 120)
    await sleep(140)
  })
  check(directory.state.current.reasoningEffort === levels[2].id, 'a downward notch steps back one level')
  await act(async () => root.unmount())
}

// --- 2. a fast flick still lands (trailing step) ----------------------------
{
  const { directory, chip, root } = await setup('fast')
  await act(async () => {
    for (let step = 0; step < 6; step += 1) wheel(chip, -120)
    await sleep(320)
  })
  check(directory.calls.length >= 2, 'a fast flick is not swallowed')
  check(directory.state.current.reasoningEffort !== levels[0].id, 'the level actually moved')
  await act(async () => root.unmount())
}

// --- 3. a select that never settles must not lock the wheel -----------------
{
  const { directory, chip, root } = await setup('never')
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      wheel(chip, -120)
      await sleep(140)
    })
  }
  check(directory.calls.length === 3, 'a pending select does not block the next notch')
  check(chip.disabled === false, 'the chip stays enabled while a select hangs')
  await act(async () => root.unmount())
}

// --- 4. a throwing select must not lock the wheel ---------------------------
{
  const { directory, chip, root } = await setup('throw')
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      wheel(chip, -120)
      await sleep(160)
    })
  }
  check(directory.calls.length === 3, 'a failing select does not block the next notch')
  check(chip.disabled === false, 'the chip stays enabled after a failure')
  await act(async () => root.unmount())
  console.warn = realWarn
  console.error = realError
}

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log('\nWHEEL DOM TEST PASSED')
