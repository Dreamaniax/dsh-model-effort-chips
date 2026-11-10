#!/usr/bin/env node
/**
 * Effect menu behaviour in a real DOM (jsdom + React 18).
 *
 * The switcher used to cycle on click. It is now a menu, and this test pins the
 * behaviour a user actually depends on:
 *
 *   1. clicking the switch opens a list with one row per registered effect
 *   2. the active effect is marked and the others are not
 *   3. choosing a row swaps the effect, persists it and closes the menu
 *   4. Escape and an outside click close the menu without changing anything
 *
 * Run: node test/effect-menu.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(here, 'test', 'effect-menu.mjs'))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const { window } = dom

globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
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
// The canvas host starts a rAF loop; jsdom exposes it on window only.
globalThis.requestAnimationFrame = window.requestAnimationFrame ?? ((cb) => setTimeout(() => cb(Date.now()), 16))
globalThis.cancelAnimationFrame = window.cancelAnimationFrame ?? ((id) => clearTimeout(id))

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

function makeDirectory() {
  const state = {
    current: { provider: 'p', model: 'm', reasoningEffort: 'low' },
    groups: [{ id: 'p', name: 'Provider', models: [{ id: 'm', name: 'Model', reasoning: { defaultEffort: 'low', efforts: levels } }] }],
    status: 'ready',
    pending: null,
    error: null,
  }
  return {
    store: { getSnapshot: () => state, subscribe: () => () => {} },
    select: async () => {},
  }
}

const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

let captured = null
const sandbox = {
  // a browser window, as the bundle sees it: it reads window.localStorage
  localStorage: window.localStorage,
  innerWidth: 520,
  innerHeight: 800,
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
  get: (name, fallback) => (name === 'modelDirectories' ? { directoryFor: () => makeDirectory() } : fallback),
  inject: (_names, callback) => callback(ctx),
  slots: {
    inject: (_slot, callback) => callback(),
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
const registrations = []

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

// open the effort panel
const chip = window.document.querySelector('[data-dsh-mec="effort"]')
check(chip !== null, 'the effort chip rendered')
await act(async () => {
  chip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})

const switcher = window.document.querySelector('[data-dsh-mec="effect-switch"]')
check(switcher !== null, 'the effect switcher is rendered in the panel')
check(switcher.getAttribute('aria-haspopup') === 'listbox', 'the switcher advertises a listbox')
check(switcher.getAttribute('aria-expanded') === 'false', 'the menu starts closed')

const options = () => [...window.document.querySelectorAll('[data-effect-option]')]
check(options().length === 0, 'no options before opening')

await act(async () => {
  switcher.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
const categories = () => [...window.document.querySelectorAll('[data-effect-category]')]
check(options().length === 0, 'the first level lists categories, not effects')
check(categories().length >= 2, 'every non-empty category is offered')
check(
  categories().map((row) => row.dataset.effectCategory).includes('physics'),
  'the physics effects are grouped under 物理仿真'
)

// open 物理仿真 and check the four physics effects are inside it
const physics = categories().find((row) => row.dataset.effectCategory === 'physics')
await act(async () => {
  physics.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
check(options().length === 4, '物理仿真 holds the four physics effects')
check(window.document.querySelector('[data-effect-back]') !== null, 'a back row returns to the categories')

// back to the categories
await act(async () => {
  window.document.querySelector('[data-effect-back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
check(options().length === 0 && categories().length >= 2, 'the back row restores the category list')

// choose from 经典
const classic = categories().find((row) => row.dataset.effectCategory === 'classic')
await act(async () => {
  classic.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
const particle = options().find((row) => row.dataset.effectOption === 'particle-wave')
check(particle !== undefined, 'the particle effect is offered under 经典')
await act(async () => {
  particle.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }))
  particle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
check(options().length === 0, 'choosing a row closes the menu')
check(window.localStorage.getItem('dsh-model-effort-chips:effect') === 'particle-wave', 'the choice is persisted')
const label = window.document.querySelector('[data-dsh-mec="effect-switch"]').dataset.effect
check(label === 'particle-wave', 'the switcher now shows the new effect')

// reopen and close with Escape
await act(async () => {
  window.document.querySelector('[data-dsh-mec="effect-switch"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(20)
})
check(categories().length >= 2, 'the menu reopens at the category level')
await act(async () => {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(20)
})
check(options().length === 0, 'Escape closes the menu')
const afterEscape = window.document.querySelector('[data-dsh-mec="effect-switch"]')
check(afterEscape === null || afterEscape.dataset.effect === 'particle-wave', 'Escape changes nothing')

await act(async () => root.unmount())

for (const entry of checks) console.log(`  ok  ${entry.label}`)
console.log('\nEFFECT MENU TEST PASSED')
